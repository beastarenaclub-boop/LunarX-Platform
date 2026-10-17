import { randomBytes } from "node:crypto";
import { db, betsTable, type Bet } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { CHICKEN_MODES, CHICKEN_RTP, CHICKEN_VERSION, CHICKEN_ROUND_DURATION_MS, chickenPayout, chickenReturn, chickenSurvival, type ChickenDifficulty, type ChickenRound, type ChickenVersion } from "@workspace/api-zod/chicken-road-game";
import { requireGameConfig } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import { badRequest, conflict, notFound } from "../lib/errors";
import { chickenSeedHash, chickenStepSafe } from "./chickenRoadMath";
import { bus } from "../realtime/eventBus";
import { logger } from "../lib/logger";

export const CHICKEN_CODE = "chicken-road";
interface Metadata {
  version: ChickenVersion;
  requestId: string;
  difficulty: ChickenDifficulty;
  step: number;
  attemptedStep: number;
  serverSeed: string;
  clientSeed: string;
  expiresAt?: string;
  endReason?: "timeout";
}
const owned = (userId: string) => and(eq(betsTable.userId, userId), eq(betsTable.gameCode, CHICKEN_CODE));

// The general bet/history DTO deliberately excludes metadata. Only this allowlist
// reaches players; the secret seed is revealed only after a terminal outcome.
export function chickenReceipt(bet: Bet): ChickenRound {
  const m = bet.metadata as Metadata;
  const active = bet.status === "placed";
  const totalSteps = CHICKEN_MODES[m.difficulty].returns.length;
  return {
    id: bet.id, requestId: m.requestId, version: m.version, difficulty: m.difficulty,
    status: active ? "active" : bet.status === "lost" ? "busted" : "cashed_out",
    step: m.step, attemptedStep: m.attemptedStep, totalSteps,
    stakeAmount: bet.stakeAmount.toString(), payoutAmount: bet.payoutAmount.toString(),
    cashoutAmount: chickenPayout(bet.stakeAmount, m.difficulty, m.step).toString(),
    multiplier: chickenReturn(m.difficulty, m.step) / 100,
    nextMultiplier: active && m.step < totalSteps ? chickenReturn(m.difficulty, m.step + 1) / 100 : null,
    nextSurvival: active && m.step < totalSteps ? chickenSurvival(m.difficulty, m.step + 1, m.version) : null,
    serverSeedHash: chickenSeedHash(m.serverSeed), serverSeed: active ? null : m.serverSeed,
    clientSeed: m.clientSeed, createdAt: bet.placedAt.toISOString(),
    expiresAt: m.expiresAt ?? null, serverTime: Date.now(), endReason: m.endReason ?? null,
  };
}

export async function chickenConfig() {
  const cfg = await requireGameConfig(CHICKEN_CODE);
  return { enabled: cfg.enabled, minStakePaise: cfg.minStakePaise.toString(), maxStakePaise: cfg.maxStakePaise.toString(), rtp: CHICKEN_RTP, version: CHICKEN_VERSION, roundDurationMs: CHICKEN_ROUND_DURATION_MS };
}
export async function chickenState(userId: string) {
  await recoverChickenRounds(userId);
  const [active, history] = await Promise.all([
    db.select().from(betsTable).where(and(owned(userId), eq(betsTable.status, "placed"))).orderBy(desc(betsTable.placedAt)).limit(1),
    db.select().from(betsTable).where(owned(userId)).orderBy(desc(betsTable.placedAt)).limit(12),
  ]);
  return { round: active[0] ? chickenReceipt(active[0]) : null, history: history.map(chickenReceipt) };
}
export async function getChickenRound(userId: string, id: string) {
  return resolveChicken(userId, id, "expire");
}

export async function startChicken(userId: string, input: { requestId: string; difficulty: ChickenDifficulty; stakeAmount: string; clientSeed: string }) {
  await recoverChickenRounds(userId);
  const cfg = await chickenConfig();
  const stake = BigInt(input.stakeAmount);
  let balance: bigint | undefined;
  const round = await db.transaction(async tx => {
    // One user lock covers lookup + insert, even across multiple API processes.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`chicken-road:${userId}`}))`);
    const [prior] = await tx.select().from(betsTable).where(and(owned(userId), sql`${betsTable.metadata}->>'requestId' = ${input.requestId}`)).limit(1);
    if (prior) {
      const m = prior.metadata as Metadata;
      if (prior.stakeAmount !== stake || m.difficulty !== input.difficulty || m.clientSeed !== input.clientSeed) throw conflict("This request was already used for another bet.");
      return chickenReceipt(prior);
    }
    if (!cfg.enabled) throw badRequest("Chicken Road is temporarily unavailable.");
    if (stake <= 0n || stake < BigInt(cfg.minStakePaise) || stake > BigInt(cfg.maxStakePaise)) throw badRequest("Stake is outside the table limits.");
    const [active] = await tx.select({ id: betsTable.id }).from(betsTable).where(and(owned(userId), eq(betsTable.status, "placed"))).limit(1);
    if (active) throw conflict("Finish your current Chicken Road round first.");
    const metadata: Metadata = { version: CHICKEN_VERSION, requestId: input.requestId, difficulty: input.difficulty, step: 0, attemptedStep: 0, serverSeed: randomBytes(32).toString("hex"), clientSeed: input.clientSeed, expiresAt: new Date(Date.now() + CHICKEN_ROUND_DURATION_MS).toISOString() };
    const [bet] = await tx.insert(betsTable).values({ userId, gameCode: CHICKEN_CODE, stakeAmount: stake, multiplier: 1, metadata }).returning();
    try {
      const posted = await postEntry({ userId, type: "bet", amount: -stake, refType: "bet", refId: bet.id, memo: "Chicken Road stake" }, tx);
      balance = posted.entry.balanceAfter;
    } catch (e) {
      if ((e as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Insufficient wallet balance.");
      throw e;
    }
    return chickenReceipt(bet);
  });
  if (balance !== undefined) publishWalletBalance({ userId, balance, entryType: "bet", amount: -stake });
  return round;
}

export async function moveChicken(userId: string, id: string, action: "step" | "cashout", expectedStep: number) {
  return resolveChicken(userId, id, action, expectedStep);
}

async function resolveChicken(userId: string, id: string, action: "step" | "cashout" | "expire", expectedStep?: number) {
  let credit: { balance: bigint; amount: bigint } | undefined;
  let changed = false;
  const round = await db.transaction(async tx => {
    let [bet] = await tx.select().from(betsTable).where(and(owned(userId), eq(betsTable.id, id))).for("update").limit(1);
    if (!bet) throw notFound("Round not found.");
    // Terminal retries are read-only. The wallet, result and progress commit together.
    if (bet.status !== "placed") return chickenReceipt(bet);
    let m = bet.metadata as Metadata;
    const now = Date.now();
    // Give pre-timer rounds a full grace period, persisted once under the row lock.
    if (!m.expiresAt) {
      m = { ...m, expiresAt: new Date(now + CHICKEN_ROUND_DURATION_MS).toISOString() };
      [bet] = await tx.update(betsTable).set({ metadata: m }).where(eq(betsTable.id, id)).returning();
    }
    const expired = now >= Date.parse(m.expiresAt!);
    if (action === "expire" && !expired) return chickenReceipt(bet);
    // Deadline wins over late/stale actions. Never roll another lane after time is up.
    if (!expired && m.step !== expectedStep) throw conflict("Round changed. Refresh before your next move.");
    if (!expired && action === "cashout" && m.step === 0) throw badRequest("Cross one lane before cashing out.");
    const next = { ...m };
    let status: Bet["status"] = "placed";
    if (expired) {
      status = "cashed_out";
      next.endReason = "timeout";
    } else if (action === "step") {
      next.attemptedStep = m.step + 1;
      if (chickenStepSafe(m.serverSeed, m.clientSeed, m.difficulty, next.attemptedStep, m.version)) {
        next.step++;
        if (next.step === CHICKEN_MODES[m.difficulty].returns.length) status = "cashed_out";
      } else status = "lost";
    } else status = "cashed_out";
    const payout = status === "cashed_out" ? chickenPayout(bet.stakeAmount, m.difficulty, next.step) : 0n;
    if (payout > 0n) {
      const posted = await postEntry({ userId, type: "win", amount: payout, refType: "bet", refId: bet.id, memo: expired && next.step === 0 ? "Chicken Road timeout: stake returned" : `Chicken Road ${expired ? "timeout: " : ""}${chickenReturn(m.difficulty, next.step) / 100}x cash out` }, tx);
      credit = { balance: posted.entry.balanceAfter, amount: payout };
    }
    const [updated] = await tx.update(betsTable).set({ metadata: next, status, payoutAmount: payout, multiplier: chickenReturn(m.difficulty, next.step) / 100, settledAt: status === "placed" ? null : new Date() }).where(eq(betsTable.id, bet.id)).returning();
    changed = true;
    return chickenReceipt(updated);
  });
  if (credit) publishWalletBalance({ userId, balance: credit.balance, entryType: "win", amount: credit.amount });
  if (changed && round.status !== "active") bus.publish({ topic: "admin:metrics", type: "bump", reason: "bet_settled", ts: Date.now() });
  return round;
}

// Recovery and the worker use the same locked settlement path as player actions.
// Wallet credit and the terminal receipt are committed once, across API processes.
async function recoverChickenRounds(userId: string) {
  const rows = await db.select({ id: betsTable.id }).from(betsTable)
    .where(and(owned(userId), eq(betsTable.status, "placed")));
  for (const row of rows) await resolveChicken(userId, row.id, "expire");
}

export async function sweepChickenTimeouts() {
  const rows = await db.select({ id: betsTable.id, userId: betsTable.userId }).from(betsTable)
    .where(and(eq(betsTable.gameCode, CHICKEN_CODE), eq(betsTable.status, "placed"),
      sql`(${betsTable.metadata}->>'expiresAt' is null or ${betsTable.metadata}->>'expiresAt' <= ${new Date().toISOString()})`))
    .orderBy(betsTable.placedAt).limit(100);
  for (const row of rows) {
    try { await resolveChicken(row.userId, row.id, "expire"); }
    catch (err) { logger.error({ err, roundId: row.id }, "Chicken Road timeout failed; will retry"); }
  }
}

let timeoutWorker: ReturnType<typeof setInterval> | undefined;
export function startChickenTimeoutSweeper() {
  if (timeoutWorker) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await sweepChickenTimeouts(); }
    catch (err) { logger.error({ err }, "Chicken Road timeout sweep failed"); }
    finally { running = false; }
  };
  timeoutWorker = setInterval(() => void tick(), 1000);
  timeoutWorker.unref();
  void tick();
}
