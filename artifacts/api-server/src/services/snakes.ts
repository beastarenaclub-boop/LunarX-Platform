import { randomInt, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  snakeRooms as rooms,
  snakeMembers as members,
  snakeRequests as requests,
} from "@workspace/db";
import {
  advanceSnake,
  type SnakeState,
  type SnakeRoom,
} from "@workspace/api-zod/snakes";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Row = typeof rooms.$inferSelect;
const state = (r: Row) => r.state as SnakeState;
async function clock(tx: Tx) {
  const r = await tx.execute<{ ms: string }>(
    sql`select (extract(epoch from clock_timestamp())*1000)::bigint::text as ms`,
  );
  return Number(r.rows[0].ms);
}
async function player(tx: Tx, id: string, lock = false) {
  const query = tx.select().from(usersTable).where(eq(usersTable.id, id));
  const [u] = await (lock ? query.for("update") : query);
  if (!u || u.role !== "player" || u.status !== "active" || u.migratedToUserId)
    throw forbidden("An active player account is required");
  return u;
}
const pool = (u: typeof usersTable.$inferSelect) =>
  u.channel === "b2b" ? `b2b:${u.b2bAgentId ?? "house"}` : "b2c";
async function locked(tx: Tx, id: string) {
  const [r] = await tx
    .select()
    .from(rooms)
    .where(eq(rooms.id, id))
    .for("update");
  if (!r) throw notFound("Room not found");
  return r;
}
async function save(tx: Tx, r: Row) {
  r.version++;
  await tx
    .update(rooms)
    .set({
      state: r.state,
      version: r.version,
      status: r.status,
      deadline: r.deadline,
      endsAt: r.endsAt,
    })
    .where(eq(rooms.id, r.id));
  if (r.status === "finished" || r.status === "cancelled")
    await tx
      .update(members)
      .set({ endedAt: new Date() })
      .where(and(eq(members.roomId, r.id), isNull(members.endedAt)));
}
async function refresh(tx: Tx, r: Row, now: number) {
  if (!["waiting", "playing"].includes(r.status)) return;
  if (
    now >= r.endsAt.getTime() ||
    (r.status === "waiting" && now >= r.deadline.getTime())
  ) {
    r.status = "cancelled";
    await save(tx, r);
    return;
  }
  if (r.status === "playing" && now >= r.deadline.getTime()) {
    r.state = advanceSnake(state(r), randomInt(1, 7));
    r.deadline = new Date(now + 30000);
    if (state(r).winner !== null) r.status = "finished";
    await save(tx, r);
  }
}
function view(r: Row, userId: string): SnakeRoom {
  const s = state(r),
    you = s.players.findIndex((p) => p.id === userId);
  if (you < 0) throw forbidden("This is not your room");
  return {
    id: r.id,
    code: r.code,
    mode: r.mode as SnakeRoom["mode"],
    capacity: r.capacity,
    status: r.status as SnakeRoom["status"],
    version: r.version,
    state: {
      ...s,
      players: s.players.map((p, i) => ({ ...p, id: `seat-${i}` })),
    },
    you,
    deadline: r.deadline.getTime(),
  };
}
async function request(
  tx: Tx,
  userId: string,
  requestId: string,
  payload: string,
) {
  const [r] = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.userId, userId), eq(requests.requestId, requestId)));
  if (r && r.payload !== payload)
    throw conflict("This request was already used for a different action");
  return r;
}
async function remember(
  tx: Tx,
  userId: string,
  requestId: string,
  roomId: string,
  payload: string,
) {
  await tx
    .insert(requests)
    .values({ id: randomUUID(), userId, requestId, roomId, payload });
}
export async function snakeTable(userId: string) {
  return db.transaction(async (tx) => {
    await player(tx, userId);
    const [m] = await tx
      .select()
      .from(members)
      .where(eq(members.userId, userId))
      .orderBy(desc(members.joinedAt))
      .limit(1);
    if (!m) return { room: null, serverNow: await clock(tx) };
    const r = await locked(tx, m.roomId),
      now = await clock(tx);
    await refresh(tx, r, now);
    return { room: view(r, userId), serverNow: now };
  });
}
export async function joinSnake(
  userId: string,
  input: {
    capacity: 2 | 4;
    mode: "online" | "private";
    code?: string;
    requestId: string;
  },
) {
  return db.transaction(async (tx) => {
    const u = await player(tx, userId, true),
      payload = JSON.stringify({
        kind: "join",
        capacity: input.capacity,
        mode: input.mode,
        code: input.code ?? null,
      });
    const retry = await request(tx, userId, input.requestId, payload);
    if (retry)
      return {
        room: view(await locked(tx, retry.roomId), userId),
        serverNow: await clock(tx),
      };
    if (input.code && input.mode !== "private")
      throw badRequest("Use Friends to join a room code");
    await tx.execute(sql`select pg_advisory_xact_lock(73482206)`);
    const now = await clock(tx),
      [active] = await tx
        .select()
        .from(members)
        .where(and(eq(members.userId, userId), isNull(members.endedAt)));
    if (active) {
      const r = await locked(tx, active.roomId);
      await refresh(tx, r, now);
      if (["waiting", "playing"].includes(r.status))
        throw conflict(
          "Resume or leave your current Snakes & Ladders game first",
        );
    }
    let room: Row | undefined;
    if (input.code) {
      [room] = await tx
        .select()
        .from(rooms)
        .where(and(eq(rooms.code, input.code), eq(rooms.pool, pool(u))))
        .for("update");
      if (!room) throw notFound("Room code not found on this player website");
      await refresh(tx, room, now);
      if (room.status !== "waiting" || room.capacity !== input.capacity)
        throw conflict(
          "This room is full, expired, or uses a different player count",
        );
    } else if (input.mode === "online") {
      const candidates = await tx
        .select()
        .from(rooms)
        .where(
          and(
            eq(rooms.pool, pool(u)),
            eq(rooms.status, "waiting"),
            eq(rooms.mode, "online"),
            eq(rooms.capacity, input.capacity),
          ),
        )
        .orderBy(rooms.createdAt)
        .limit(20)
        .for("update");
      for (const candidate of candidates) {
        await refresh(tx, candidate, now);
        if (
          candidate.status === "waiting" &&
          state(candidate).players.length < input.capacity
        ) {
          room = candidate;
          break;
        }
      }
    }
    if (!room) {
      let code: string | null = null;
      if (input.mode === "private") {
        for (let n = 0; n < 10; n++) {
          code = String(randomInt(10000000, 100000000));
          const [old] = await tx
            .select({ id: rooms.id })
            .from(rooms)
            .where(eq(rooms.code, code));
          if (!old) break;
          code = null;
        }
        if (!code) throw conflict("Please try creating a room again");
      }
      const s: SnakeState = {
        players: [],
        turn: 0,
        dice: null,
        winner: null,
        sequence: 0,
        last: null,
      };
      [room] = await tx
        .insert(rooms)
        .values({
          id: randomUUID(),
          pool: pool(u),
          mode: input.mode,
          code,
          capacity: input.capacity,
          status: "waiting",
          state: s,
          deadline: new Date(now + 300000),
          endsAt: new Date(now + 3600000),
        })
        .returning();
    }
    const s = state(room),
      seat = s.players.length;
    if (seat >= room.capacity) throw conflict("Room is full");
    s.players.push({
      id: userId,
      name: (u.displayName || "Player").slice(0, 24),
      kind: "human",
      position: 0,
    });
    room.state = s;
    await tx
      .insert(members)
      .values({ id: randomUUID(), roomId: room.id, userId, seat });
    if (s.players.length === room.capacity) {
      room.status = "playing";
      room.deadline = new Date(now + 30000);
      room.endsAt = new Date(now + 3600000);
    }
    await save(tx, room);
    await remember(tx, userId, input.requestId, room.id, payload);
    return { room: view(room, userId), serverNow: now };
  });
}
export async function actSnake(
  userId: string,
  roomId: string,
  input: { type: "roll" | "leave"; version: number; requestId: string },
) {
  return db.transaction(async (tx) => {
    await player(tx, userId, true);
    const payload = JSON.stringify({
        kind: input.type,
        roomId,
        version: input.version,
      }),
      retry = await request(tx, userId, input.requestId, payload),
      r = await locked(tx, roomId),
      s = state(r),
      you = s.players.findIndex((p) => p.id === userId);
    if (you < 0) throw forbidden("This is not your room");
    const now = await clock(tx);
    if (retry) return { room: view(r, userId), serverNow: now };
    if (input.type === "leave") {
      if (r.status === "waiting") {
        r.status = "cancelled";
      } else if (r.status === "playing" && !s.players[you].left) {
        s.players[you].left = true;
        const remaining = s.players
          .map((p, i) => (p.left ? -1 : i))
          .filter((i) => i >= 0);
        if (remaining.length <= 1) {
          s.winner = remaining[0] ?? null;
          r.status = "finished";
        } else if (s.turn === you) {
          do {
            s.turn = (s.turn + 1) % s.players.length;
          } while (s.players[s.turn].left);
          r.deadline = new Date(now + 30000);
        }
        await tx
          .update(members)
          .set({ endedAt: new Date() })
          .where(and(eq(members.roomId, roomId), eq(members.userId, userId)));
      }
      await save(tx, r);
    } else {
      await refresh(tx, r, now);
      if (r.status !== "playing" || state(r).players[you].left)
        throw conflict("This game has ended");
      if (r.version !== input.version)
        throw conflict("Board updated. Please try again");
      if (state(r).turn !== you) throw forbidden("Wait for your turn");
      r.state = advanceSnake(state(r), randomInt(1, 7));
      r.deadline = new Date(now + 30000);
      if (state(r).winner !== null) r.status = "finished";
      await save(tx, r);
    }
    await remember(tx, userId, input.requestId, roomId, payload);
    return { room: view(r, userId), serverNow: now };
  });
}
