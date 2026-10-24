import { randomBytes, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import {
  db,
  ludoMatches as matches,
  ludoMembers as members,
  ludoActions as actions,
  usersTable,
  betsTable,
  gameConfigTable,
} from "@workspace/db";
import {
  LUDO,
  ludoColors,
  type LudoState,
  type LudoAction,
  type LudoMatch,
  type LudoTable,
} from "@workspace/api-zod/ludo";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import { bus } from "../realtime/eventBus";
import { getBalanceByUser, postEntry, publishWalletBalance } from "./wallet";
import {
  commitment,
  ludoDie,
  legalTokens,
  rollDie,
  moveToken,
  computerToken,
  nextTurn,
} from "./ludoRules";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Room = typeof matches.$inferSelect;
type Member = typeof members.$inferSelect;
const QUEUE_LOCK = 73482205;
const stateOf = (room: Room) => room.state as LudoState;
const prize = (r: Room) =>
  (r.entryPaise * BigInt(r.capacity) * BigInt(10000 - r.commissionBps)) /
  10000n;
async function now(tx: Tx) {
  const r = await tx.execute<{ ms: string }>(
    sql`select (extract(epoch from clock_timestamp())*1000)::bigint::text as ms`,
  );
  return Number(r.rows[0].ms);
}
async function locked(tx: Tx, id: string) {
  const [r] = await tx
    .select()
    .from(matches)
    .where(eq(matches.id, id))
    .for("update");
  if (!r) throw notFound("Match not found");
  return r;
}
async function participants(tx: Tx, id: string) {
  return tx
    .select()
    .from(members)
    .where(eq(members.matchId, id))
    .orderBy(members.userId);
}
async function save(
  tx: Tx,
  r: Room,
  event: object,
  userId: string | null = null,
  requestId: string | null = null,
) {
  r.version++;
  await tx
    .update(matches)
    .set({
      status: r.status,
      state: r.state,
      version: r.version,
      deadline: r.deadline,
      startedAt: r.startedAt,
      endedAt: r.endedAt,
      reason: r.reason,
    })
    .where(eq(matches.id, r.id));
  await tx.insert(actions).values({
    id: randomUUID(),
    matchId: r.id,
    version: r.version,
    userId,
    requestId,
    payload: event,
  });
}
async function settleMember(
  tx: Tx,
  r: Room,
  m: Member,
  result: "won" | "lost" | "voided",
  at: number,
) {
  // Room lock serializes settlement. The conditional update also makes every ledger effect exactly once.
  const payout =
    result === "won" ? prize(r) : result === "voided" ? r.entryPaise : 0n;
  const changed = await tx
    .update(betsTable)
    .set({
      status: result,
      payoutAmount: payout,
      multiplier: Number(payout) / Number(r.entryPaise),
      settledAt: new Date(at),
    })
    .where(and(eq(betsTable.id, m.betId), eq(betsTable.status, "placed")))
    .returning({ id: betsTable.id });
  if (changed.length && payout)
    await postEntry(
      {
        userId: m.userId,
        type: result === "won" ? "win" : "refund",
        amount: payout,
        refType: `ludo_${result}`,
        refId: m.betId,
        scope: "ludo",
        metadata: { matchId: r.id, commissionBps: r.commissionBps },
      },
      tx,
    );
  await tx
    .update(members)
    .set({ endedAt: new Date(at) })
    .where(and(eq(members.id, m.id), isNull(members.endedAt)));
}
async function finish(tx: Tx, r: Room, at: number, refund = false) {
  r.status = refund ? "cancelled" : "finished";
  r.endedAt = new Date(at);
  const s = stateOf(r);
  for (const m of await participants(tx, r.id))
    await settleMember(
      tx,
      r,
      m,
      refund ? "voided" : m.seat === s.winner && !m.endedAt ? "won" : "lost",
      at,
    );
}
function schedule(r: Room, at: number) {
  const p = stateOf(r).players[stateOf(r).turn];
  r.deadline = new Date(
    at + (p?.kind === "computer" ? LUDO.botMs : LUDO.turnMs),
  );
}
function start(r: Room, at: number) {
  const s = stateOf(r),
    colors = ludoColors(r.capacity);
  for (let seat = 0; seat < r.capacity; seat++)
    if (!s.players[seat])
      s.players[seat] = {
        seat,
        name: `Computer ${seat + 1}`,
        color: colors[seat],
        kind: "computer",
        tokens: [-1, -1, -1, -1],
        forfeited: false,
        auto: true,
      };
  r.status = "playing";
  r.startedAt = new Date(at);
  s.last = { seat: 0, text: "Match started · Red rolls first" };
  schedule(r, at);
}
async function notify(id: string) {
  // Notifications are hints; clients always recover the durable snapshot after reconnect.
  try {
    const [r] = await db
      .select({ version: matches.version })
      .from(matches)
      .where(eq(matches.id, id));
    const list = await db
      .select({ userId: members.userId })
      .from(members)
      .where(eq(members.matchId, id));
    for (const userId of new Set(list.map((m) => m.userId))) {
      bus.publish({
        topic: `ludo:${userId}`,
        type: "changed",
        matchId: id,
        version: r?.version ?? 0,
        ts: Date.now(),
      });
      const { balance } = await getBalanceByUser(userId);
      publishWalletBalance({
        userId,
        balance,
        entryType: "adjustment",
        amount: 0n,
      });
    }
  } catch (err) {
    logger.warn({ err }, "Ludo notification failed; polling will recover");
  }
}
export async function joinLudo(
  userId: string,
  input: { capacity: 2 | 4; entryPaise: number; requestId: string },
) {
  if (!LUDO.entries.includes(input.entryPaise as (typeof LUDO.entries)[number]))
    throw badRequest("Choose an available entry fee");
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${QUEUE_LOCK})`);
    const [repeat] = await tx
      .select()
      .from(members)
      .where(
        and(eq(members.userId, userId), eq(members.requestId, input.requestId)),
      );
    if (repeat) {
      const [r] = await tx
        .select()
        .from(matches)
        .where(eq(matches.id, repeat.matchId));
      if (
        r.capacity !== input.capacity ||
        r.entryPaise !== BigInt(input.entryPaise)
      )
        throw conflict("This request already joined a different match");
      return r.id;
    }
    const [active] = await tx
      .select()
      .from(members)
      .where(and(eq(members.userId, userId), isNull(members.endedAt)));
    if (active) return active.matchId;
    const [user] = await tx
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));
    if (
      !user ||
      user.status !== "active" ||
      !["player", "admin", "super_admin"].includes(user.role)
    )
      throw forbidden("An active player account is required");
    const [config] = await tx
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, "ludo"));
    if (
      config &&
      (!config.enabled ||
        BigInt(input.entryPaise) < config.minStakePaise ||
        BigInt(input.entryPaise) > config.maxStakePaise)
    )
      throw conflict("This entry fee is currently unavailable");
    const pool =
      user.channel === "b2b" ? `b2b:${user.b2bAgentId ?? "house"}` : "b2c";
    const at = await now(tx);
    const candidates = await tx
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.pool, pool),
          eq(matches.status, "waiting"),
          eq(matches.capacity, input.capacity),
          eq(matches.entryPaise, BigInt(input.entryPaise)),
        ),
      )
      .orderBy(matches.createdAt)
      .for("update");
    let r = candidates.find(
      (r) => r.deadline.getTime() > at && stateOf(r).players.some((p) => !p),
    );
    if (!r) {
      const seed = randomBytes(32).toString("hex");
      [r] = await tx
        .insert(matches)
        .values({
          id: randomUUID(),
          capacity: input.capacity,
          pool,
          status: "waiting",
          entryPaise: BigInt(input.entryPaise),
          commissionBps: LUDO.commissionBps,
          seed,
          commitment: commitment(seed),
          deadline: new Date(at + LUDO.queueMs),
          state: {
            players: Array(input.capacity).fill(null),
            turn: 0,
            phase: "roll",
            dice: null,
            sixes: 0,
            winner: null,
            rollNonce: 0,
            last: null,
          } satisfies LudoState,
        })
        .returning();
    }
    const s = stateOf(r),
      seat = s.players.findIndex((p) => !p),
      betId = randomUUID();
    await postEntry(
      {
        userId,
        type: "bet",
        amount: -r.entryPaise,
        scope: "ludo",
        refType: "ludo_entry",
        refId: betId,
        metadata: {
          matchId: r.id,
          capacity: r.capacity,
          commissionBps: r.commissionBps,
        },
      },
      tx,
    );
    await tx.insert(betsTable).values({
      id: betId,
      userId,
      gameCode: "ludo",
      roundId: r.id,
      stakeAmount: r.entryPaise,
      metadata: {
        capacity: r.capacity,
        seat,
        commissionBps: r.commissionBps,
      },
    });
    await tx.insert(members).values({
      id: randomUUID(),
      matchId: r.id,
      userId,
      seat,
      requestId: input.requestId,
      betId,
    });
    const name = (user.displayName || `Player ${seat + 1}`)
      .replace(/[\u0000-\u001f]/g, "")
      .slice(0, 24);
    s.players[seat] = {
      seat,
      name,
      color: ludoColors(r.capacity)[seat],
      kind: "human",
      tokens: [-1, -1, -1, -1],
      forfeited: false,
      auto: false,
    };
    if (s.players.every(Boolean)) start(r, await now(tx));
    await save(
      tx,
      r,
      {
        type: "join",
        seat,
        capacity: r.capacity,
        entryPaise: String(r.entryPaise),
      },
      userId,
    );
    return r.id;
  });
  await notify(id);
  return ludoTable(userId, id);
}
export async function actLudo(
  userId: string,
  matchId: string,
  input: LudoAction,
) {
  await db.transaction(async (tx) => {
    const r = await locked(tx, matchId),
      s = stateOf(r);
    const [m] = await tx
      .select()
      .from(members)
      .where(and(eq(members.matchId, matchId), eq(members.userId, userId)))
      .orderBy(desc(members.joinedAt))
      .limit(1);
    if (!m) throw forbidden("This is not your match");
    const [repeat] = await tx
      .select()
      .from(actions)
      .where(
        and(eq(actions.userId, userId), eq(actions.requestId, input.requestId)),
      );
    const command = {
      type: input.type,
      version: input.version,
      token: input.token ?? null,
    };
    if (repeat) {
      const payload = repeat.payload as { command?: typeof command };
      if (
        repeat.matchId !== matchId ||
        payload.command?.type !== command.type ||
        payload.command?.version !== command.version ||
        payload.command?.token !== command.token
      )
        throw conflict("Request already used for another action");
      return;
    }
    if (m.endedAt || !["waiting", "playing"].includes(r.status))
      throw conflict("Your match has ended");
    if (r.version !== input.version)
      throw conflict(
        "The board changed. Please try again on the updated board.",
      );
    const at = await now(tx);
    if (input.type === "leave") {
      if (r.status === "waiting") {
        // An elapsed waiting deadline is not a refund loophole: tick must start it first.
        if (at >= r.deadline.getTime())
          throw conflict("Match is starting. Refresh the board.");
        s.players[m.seat] = null;
        await settleMember(tx, r, m, "voided", at);
        if (s.players.every((p) => !p)) {
          r.status = "cancelled";
          r.endedAt = new Date(at);
          r.reason = "Queue cancelled; entry refunded";
        }
      } else {
        s.players[m.seat]!.forfeited = true;
        s.last = {
          seat: m.seat,
          text: `${s.players[m.seat]!.name} left the match`,
        };
        await settleMember(tx, r, m, "lost", at);
        const alive = s.players.filter((p) => p && !p.forfeited);
        if (alive.length === 1) {
          s.winner = alive[0]!.seat;
          await finish(tx, r, at);
        } else if (alive.every((p) => p!.kind === "computer")) {
          r.reason = "All players left";
          await finish(tx, r, at);
        } else if (s.turn === m.seat) {
          nextTurn(s);
          schedule(r, at);
        }
      }
    } else {
      if (r.status !== "playing" || s.turn !== m.seat)
        throw conflict("Wait for your turn");
      if (at >= r.deadline.getTime())
        throw conflict("Turn time elapsed. Refresh the board.");
      s.players[m.seat]!.auto = false;
      if (input.type === "roll") {
        if (s.phase !== "roll")
          throw conflict("Move a token before rolling again");
        rollDie(s, ludoDie(r.seed, r.id, s.rollNonce));
      } else {
        if (!legalTokens(s).includes(input.token ?? -1))
          throw badRequest("Choose a highlighted token");
        moveToken(s, input.token!);
      }
      if (s.winner !== null) await finish(tx, r, at);
      else schedule(r, at);
    }
    await save(
      tx,
      r,
      { command, result: s.last, rollNonce: s.rollNonce },
      userId,
      input.requestId,
    );
  });
  await notify(matchId);
  return ludoTable(userId, matchId);
}
export async function tickLudo() {
  const due = await db
    .select({ id: matches.id })
    .from(matches)
    .where(
      and(
        inArray(matches.status, ["waiting", "playing"]),
        or(
          lte(matches.deadline, sql`clock_timestamp()`),
          lte(matches.startedAt, sql`clock_timestamp() - interval '2 hours'`),
        ),
      ),
    )
    .orderBy(matches.deadline)
    .limit(50);
  for (const { id } of due) {
    const changed = await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(matches)
        .where(eq(matches.id, id))
        .for("update", { skipLocked: true });
      const r = rows[0];
      if (!r || !["waiting", "playing"].includes(r.status)) return false;
      const at = await now(tx);
      const overLimit =
        r.startedAt !== null && at - r.startedAt.getTime() >= LUDO.maxMatchMs;
      if (r.deadline.getTime() > at && !overLimit) return false;
      const s = stateOf(r);
      if (r.status === "waiting") start(r, at);
      else if (overLimit) {
        r.reason = "Time limit reached; entries refunded";
        await finish(tx, r, at, true);
      } else if (at - r.deadline.getTime() > 120000) {
        s.last = {
          seat: s.turn,
          text: "Connection restored · turn timer restarted",
        };
        schedule(r, at);
      } else {
        const p = s.players[s.turn]!;
        p.auto = true;
        if (s.phase === "roll") rollDie(s, ludoDie(r.seed, r.id, s.rollNonce));
        else moveToken(s, computerToken(s));
        if (s.winner !== null) await finish(tx, r, at);
        else schedule(r, at);
      }
      await save(tx, r, {
        type: "automatic",
        result: s.last,
        rollNonce: s.rollNonce,
      });
      return true;
    });
    if (changed) await notify(id);
  }
}
function publicMatch(r: Room, m: Member): LudoMatch {
  const s = stateOf(r);
  return {
    id: r.id,
    status: r.status as LudoMatch["status"],
    capacity: r.capacity as 2 | 4,
    entryPaise: String(r.entryPaise),
    prizePaise: String(prize(r)),
    commissionPaise: String(r.entryPaise * BigInt(r.capacity) - prize(r)),
    commissionBps: r.commissionBps,
    version: r.version,
    you: m.seat,
    deadline: r.deadline.getTime(),
    startedAt: r.startedAt?.getTime() ?? null,
    state: s,
    legalTokens:
      r.status === "playing" && s.turn === m.seat && !m.endedAt
        ? legalTokens(s)
        : [],
    commitment: r.commitment,
    seed: r.endedAt ? r.seed : null,
    reason: r.reason,
  };
}
export async function ludoTable(
  userId: string,
  matchId?: string,
): Promise<LudoTable> {
  const { balance } = await getBalanceByUser(userId);
  return db.transaction(async (tx) => {
    const [config] = await tx
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, "ludo"));
    const rows = await tx
      .select({ m: members, r: matches, b: betsTable })
      .from(members)
      .innerJoin(matches, eq(matches.id, members.matchId))
      .innerJoin(betsTable, eq(betsTable.id, members.betId))
      .where(eq(members.userId, userId))
      .orderBy(desc(members.joinedAt))
      .limit(12);
    let selected = matchId
      ? rows.find((row) => row.r.id === matchId)
      : (rows.find((row) => !row.m.endedAt) ?? rows[0]);
    if (matchId && !selected) {
      const [older] = await tx
        .select({ m: members, r: matches, b: betsTable })
        .from(members)
        .innerJoin(matches, eq(matches.id, members.matchId))
        .innerJoin(betsTable, eq(betsTable.id, members.betId))
        .where(and(eq(members.userId, userId), eq(members.matchId, matchId)))
        .orderBy(desc(members.joinedAt))
        .limit(1);
      if (!older) throw forbidden("This is not your match");
      selected = older;
    }
    return {
      serverNow: await now(tx),
      balancePaise: String(balance),
      enabled: config?.enabled ?? true,
      entries: LUDO.entries.filter(
        (n) =>
          !config ||
          (BigInt(n) >= config.minStakePaise &&
            BigInt(n) <= config.maxStakePaise),
      ),
      match: selected ? publicMatch(selected.r, selected.m) : null,
      recent: rows
        .filter((row) => row.m.endedAt)
        .slice(0, 10)
        .map(({ m, r, b }) => ({
          id: r.id,
          capacity: r.capacity,
          entryPaise: String(r.entryPaise),
          payoutPaise: String(b.payoutAmount),
          result: b.status,
          at: m.endedAt!.getTime(),
        })),
    };
  });
}
export async function ludoProof(userId: string, matchId: string) {
  const table = await ludoTable(userId, matchId),
    r = table.match!;
  if (!r.seed) throw conflict("Verification is available after the match ends");
  const events = await db
    .select({ version: actions.version, payload: actions.payload })
    .from(actions)
    .where(eq(actions.matchId, matchId))
    .orderBy(actions.version);
  return {
    matchId,
    algorithm:
      "HMAC-SHA256(seed, ludo:v1:matchId:nonce:block), first byte < 252, byte % 6 + 1",
    commitment: r.commitment,
    seed: r.seed,
    rolls: Array.from({ length: r.state.rollNonce }, (_, nonce) => ({
      nonce,
      dice: ludoDie(r.seed!, matchId, nonce),
    })),
    events,
  };
}
let started = false;
export function startLudoEngine() {
  if (started) return;
  started = true;
  let busy = false;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      await tickLudo();
    } catch (err) {
      logger.error({ err }, "Ludo engine tick failed");
    } finally {
      busy = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 500);
  timer.unref();
}
