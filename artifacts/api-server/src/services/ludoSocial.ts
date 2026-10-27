import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  ludoProfiles,
  ludoFriendships as friends,
  ludoDirectMessages as messages,
  ludoMatches,
  ludoMembers,
} from "@workspace/db";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { previewLudoRoom } from "./ludo";
import type { LudoState } from "@workspace/api-zod/ludo";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function active(tx: Tx, id: string) {
  const [user] = await tx
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id));
  if (
    !user ||
    user.role !== "player" ||
    user.status !== "active" ||
    user.migratedToUserId
  )
    throw forbidden("An active player account is required");
  return user;
}
function sameChannel(
  a: typeof usersTable.$inferSelect,
  b: typeof usersTable.$inferSelect,
) {
  return (
    a.channel === b.channel &&
    (a.channel !== "b2b" || a.b2bAgentId === b.b2bAgentId)
  );
}
async function connection(tx: Tx, userId: string, id: string, accepted = true) {
  const [f] = await tx
    .select()
    .from(friends)
    .where(eq(friends.id, id))
    .for("update");
  if (!f || ![f.leftId, f.rightId].includes(userId))
    throw notFound("Friend not found");
  const a = await active(tx, userId),
    b = await active(tx, f.leftId === userId ? f.rightId : f.leftId);
  if (!sameChannel(a, b))
    throw forbidden("Friend is not available on this player website");
  if (accepted && (f.status !== "accepted" || f.leftBlocked || f.rightBlocked))
    throw forbidden("Accept the friend request before chatting");
  return f;
}
export async function ludoSocial(userId: string) {
  return db.transaction(async (tx) => {
    const user = await active(tx, userId);
    await tx
      .insert(ludoProfiles)
      .values({
        userId,
        friendCode: randomBytes(6).toString("hex").toUpperCase(),
      })
      .onConflictDoNothing({ target: ludoProfiles.userId });
    const [profile] = await tx
      .update(ludoProfiles)
      .set({ seenAt: new Date() })
      .where(eq(ludoProfiles.userId, userId))
      .returning();
    const rows = await tx
      .select()
      .from(friends)
      .where(or(eq(friends.leftId, userId), eq(friends.rightId, userId)))
      .orderBy(desc(friends.updatedAt))
      .limit(200);
    const ids = rows.map((f) => (f.leftId === userId ? f.rightId : f.leftId));
    const people = ids.length
      ? await tx
          .select({ user: usersTable, profile: ludoProfiles })
          .from(usersTable)
          .leftJoin(ludoProfiles, eq(ludoProfiles.userId, usersTable.id))
          .where(inArray(usersTable.id, ids))
      : [];
    return {
      friendCode: profile.friendCode,
      friends: rows.flatMap((f) => {
        const other = people.find(
          (p) => p.user.id === (f.leftId === userId ? f.rightId : f.leftId),
        );
        const blockedByYou =
          f.leftId === userId ? f.leftBlocked : f.rightBlocked;
        if (
          !other ||
          !sameChannel(user, other.user) ||
          other.user.status !== "active" ||
          (!blockedByYou &&
            (f.leftBlocked || f.rightBlocked || f.status === "removed"))
        )
          return [];
        return [
          {
            id: f.id,
            name: other.user.displayName || "Player",
            code: other.profile?.friendCode ?? "",
            status: f.status,
            incoming: f.requestedBy !== userId,
            blockedByYou,
            online:
              f.status === "accepted" &&
              !blockedByYou &&
              Date.now() - (other.profile?.seenAt.getTime() ?? 0) < 45000,
          },
        ];
      }),
    };
  });
}
export async function requestLudoFriend(userId: string, code: string) {
  await db.transaction(async (tx) => {
    const me = await active(tx, userId);
    const [profile] = await tx
      .select()
      .from(ludoProfiles)
      .where(eq(ludoProfiles.friendCode, code.toUpperCase()));
    if (!profile || profile.userId === userId)
      throw badRequest("Enter another player's friend code");
    const other = await active(tx, profile.userId);
    if (!sameChannel(me, other))
      throw notFound("Player not found on this website");
    const [leftId, rightId] = [userId, other.id].sort();
    await tx
      .insert(friends)
      .values({
        id: randomUUID(),
        leftId,
        rightId,
        requestedBy: userId,
        status: "pending",
      })
      .onConflictDoNothing({ target: [friends.leftId, friends.rightId] });
    const [f] = await tx
      .select()
      .from(friends)
      .where(and(eq(friends.leftId, leftId), eq(friends.rightId, rightId)))
      .for("update");
    if (f.leftBlocked || f.rightBlocked)
      throw forbidden("This player cannot receive your request");
    if (f.status === "removed")
      await tx
        .update(friends)
        .set({ status: "pending", requestedBy: userId, updatedAt: new Date() })
        .where(eq(friends.id, f.id));
  });
  return ludoSocial(userId);
}
export async function updateLudoFriend(
  userId: string,
  id: string,
  action: "accept" | "remove" | "block" | "unblock",
) {
  await db.transaction(async (tx) => {
    const f = await connection(tx, userId, id, false);
    if (action === "accept") {
      if (
        f.leftBlocked ||
        f.rightBlocked ||
        f.status !== "pending" ||
        f.requestedBy === userId
      )
        throw forbidden("Only the recipient can accept this request");
      await tx
        .update(friends)
        .set({ status: "accepted", updatedAt: new Date() })
        .where(eq(friends.id, id));
    } else {
      const blockedKey = f.leftId === userId ? "leftBlocked" : "rightBlocked";
      await tx
        .update(friends)
        .set({
          status: "removed",
          updatedAt: new Date(),
          ...(action !== "remove" ? { [blockedKey]: action === "block" } : {}),
        })
        .where(eq(friends.id, id));
    }
  });
  return ludoSocial(userId);
}
export async function ludoDirectChat(userId: string, id: string) {
  return db.transaction(async (tx) => {
    await connection(tx, userId, id);
    const rows = await tx
      .select()
      .from(messages)
      .where(eq(messages.friendshipId, id))
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(80);
    return {
      messages: rows.reverse().map((m) => ({
        id: m.id,
        mine: m.senderId === userId,
        kind: m.kind,
        text: m.text,
        roomCode: m.roomCode,
        at: m.createdAt.getTime(),
      })),
    };
  });
}
export async function sendLudoDirectMessage(
  userId: string,
  id: string,
  input: { requestId: string; text?: string; roomCode?: string },
) {
  const text = (input.text ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (input.roomCode) {
    await previewLudoRoom(userId, input.roomCode);
    // Only a member of the open room may invite a friend to it.
    const rows = await db
      .select({ state: ludoMatches.state })
      .from(ludoMembers)
      .innerJoin(ludoMatches, eq(ludoMembers.matchId, ludoMatches.id))
      .where(
        and(
          eq(ludoMembers.userId, userId),
          eq(ludoMatches.status, "waiting"),
          sql`${ludoMembers.endedAt} is null`,
        ),
      );
    if (!rows.some((r) => (r.state as LudoState).roomCode === input.roomCode))
      throw forbidden("Join or create the room before sending an invite");
  } else if (!text || text.length > 500)
    throw badRequest("Write a message of 1 to 500 characters");
  await db.transaction(async (tx) => {
    await connection(tx, userId, id);
    const content = input.roomCode ? "Join my Ludo room" : text;
    const [repeat] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.senderId, userId),
          eq(messages.requestId, input.requestId),
        ),
      );
    if (repeat) {
      if (
        repeat.friendshipId !== id ||
        repeat.text !== content ||
        repeat.roomCode !== (input.roomCode ?? null)
      )
        throw conflict("This request already sent a different message");
      return;
    }
    const inserted = await tx
      .insert(messages)
      .values({
        id: randomUUID(),
        friendshipId: id,
        senderId: userId,
        requestId: input.requestId,
        kind: input.roomCode ? "invite" : "text",
        text: content,
        roomCode: input.roomCode ?? null,
      })
      .onConflictDoNothing({ target: [messages.senderId, messages.requestId] })
      .returning({ id: messages.id });
    if (!inserted.length) {
      const [existing] = await tx
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.senderId, userId),
            eq(messages.requestId, input.requestId),
          ),
        );
      if (
        !existing ||
        existing.friendshipId !== id ||
        existing.text !== content ||
        existing.roomCode !== (input.roomCode ?? null)
      )
        throw conflict("This request already sent a different message");
    }
  });
  return ludoDirectChat(userId, id);
}
