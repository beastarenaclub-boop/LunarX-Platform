import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db, ludoMatches, ludoMembers, ludoMessages } from "@workspace/db";
import {
  LUDO,
  LUDO_EMOJIS,
  type LudoChat,
  type LudoChatInput,
  type LudoState,
} from "@workspace/api-zod/ludo";
import { badRequest, conflict, forbidden, tooMany } from "../lib/errors";
import { bus } from "../realtime/eventBus";
import { getBalanceByUser, postEntry, publishWalletBalance } from "./wallet";
import { logger } from "../lib/logger";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function member(tx: Tx, userId: string, matchId: string) {
  const [m] = await tx
    .select()
    .from(ludoMembers)
    .where(
      and(eq(ludoMembers.userId, userId), eq(ludoMembers.matchId, matchId)),
    )
    .orderBy(desc(ludoMembers.joinedAt))
    .limit(1);
  if (!m) throw forbidden("Only players in this match can use its chat");
  return m;
}
function sendingAllowed(
  r: typeof ludoMatches.$inferSelect,
  m: typeof ludoMembers.$inferSelect,
) {
  const s = r.state as LudoState;
  return (
    !m.endedAt &&
    !s.players[m.seat]?.forfeited &&
    ["waiting", "playing"].includes(r.status) &&
    (!r.startedAt || Date.now() < r.startedAt.getTime() + LUDO.maxMatchMs)
  );
}
export async function ludoChat(
  userId: string,
  matchId: string,
): Promise<LudoChat> {
  const data = await db.transaction(async (tx) => {
    const m = await member(tx, userId, matchId);
    const [r] = await tx
      .select()
      .from(ludoMatches)
      .where(eq(ludoMatches.id, matchId));
    const rows = await tx
      .select()
      .from(ludoMessages)
      .where(eq(ludoMessages.matchId, matchId))
      .orderBy(desc(ludoMessages.createdAt), desc(ludoMessages.id))
      .limit(80);
    return {
      canSend: sendingAllowed(r, m),
      messages: rows.reverse().map((row) => ({
        id: row.id,
        seat: row.seat,
        name: row.name,
        kind: row.kind as "text" | "emoji",
        text: row.text,
        emojiId: row.emojiId,
        costPaise: String(row.costPaise),
        at: row.createdAt.getTime(),
      })),
    };
  });
  return {
    ...data,
    emojiPaise: LUDO.emojiPaise,
    balancePaise: String((await getBalanceByUser(userId)).balance),
  };
}

export async function sendLudoChat(
  userId: string,
  matchId: string,
  input: LudoChatInput,
): Promise<LudoChat> {
  const emoji =
    input.kind === "emoji"
      ? LUDO_EMOJIS.find((e) => e.id === input.emojiId)
      : null;
  const text =
    input.kind === "text"
      ? input.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim()
      : (emoji?.glyph ?? "");
  if (input.kind === "emoji" && !emoji)
    throw badRequest("Choose an emoji from the tray");
  if (!text || text.length > 200)
    throw badRequest("Write a message of 1 to 200 characters");
  if (
    input.kind === "text" &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]\uFE0F?\u20E3/u.test(
      text,
    )
  )
    throw badRequest(
      "Send emojis from the tray. Each emoji costs ₹5; text messages are free.",
    );
  const charged = await db.transaction(async (tx) => {
    // Chat has its own IDs; sending messages never changes a dice/move version.
    const [r] = await tx
      .select()
      .from(ludoMatches)
      .where(eq(ludoMatches.id, matchId))
      .for("update");
    if (!r) throw forbidden("Only players in this match can use its chat");
    const m = await member(tx, userId, matchId);
    const [repeat] = await tx
      .select()
      .from(ludoMessages)
      .where(
        and(
          eq(ludoMessages.userId, userId),
          eq(ludoMessages.requestId, input.requestId),
        ),
      );
    if (repeat) {
      if (
        repeat.matchId !== matchId ||
        repeat.kind !== input.kind ||
        repeat.text !== text ||
        repeat.emojiId !== (emoji?.id ?? null)
      )
        throw conflict("This request already sent a different message");
      return false;
    }
    if (!sendingAllowed(r, m))
      throw conflict("Chat sending is closed for this seat");
    const [last] = await tx
      .select()
      .from(ludoMessages)
      .where(eq(ludoMessages.userId, userId))
      .orderBy(desc(ludoMessages.createdAt))
      .limit(1);
    if (last && Date.now() - last.createdAt.getTime() < 700)
      throw tooMany("Wait a moment before sending another message");
    const id = randomUUID(),
      cost = emoji ? BigInt(LUDO.emojiPaise) : 0n;
    if (cost)
      await postEntry(
        {
          userId,
          type: "adjustment",
          amount: -cost,
          scope: "ludo",
          refType: "ludo_emoji",
          refId: id,
          memo: `Ludo emoji: ${emoji!.name}`,
          metadata: { matchId, emojiId: emoji!.id, costPaise: String(cost) },
        },
        tx,
      );
    await tx
      .insert(ludoMessages)
      .values({
        id,
        matchId,
        userId,
        requestId: input.requestId,
        seat: m.seat,
        name: (r.state as LudoState).players[m.seat]!.name,
        kind: input.kind,
        text,
        emojiId: emoji?.id ?? null,
        costPaise: cost,
      });
    return !!cost;
  });
  const data = await ludoChat(userId, matchId);
  try {
    const participants = await db
      .select({ userId: ludoMembers.userId })
      .from(ludoMembers)
      .where(eq(ludoMembers.matchId, matchId));
    for (const id of new Set(participants.map((p) => p.userId)))
      bus.publish({
        topic: `ludo-chat:${id}`,
        type: "changed",
        matchId,
        ts: Date.now(),
      });
    if (charged)
      publishWalletBalance({
        userId,
        balance: BigInt(data.balancePaise),
        entryType: "adjustment",
        amount: -BigInt(LUDO.emojiPaise),
      });
  } catch (err) {
    logger.warn({ err }, "Ludo chat notification failed; polling will recover");
  }
  return data;
}
