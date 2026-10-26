import { randomBytes } from "node:crypto";
import { db, betsTable, type Bet } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { collectionGame, collectionMultiplier, collectionPayout, collectionSteps, progressive, normalizeSevenBets, sevenPayout, type CollectionCode, type CollectionOptions, type CollectionRound } from "@workspace/api-zod/instant-collection";
import { requireGameConfig } from "./rtp";
import { postEntry, publishWalletBalance } from "./wallet";
import { badRequest, conflict, notFound } from "../lib/errors";
import { instantDraw, instantHazards, instantSafe, instantSeedHash } from "./instantCollectionMath";
import { isRetiredGame } from "../lib/retiredGames";

// Historical receipts still need their original rules after a game is removed.
const settlementGame = (code: string) => collectionGame(code) ?? (code === "chicken-road-2"
  ? { code: "chicken-road-2" as const, name: "Chicken Road 2.0", kind: "road" as const }
  : undefined);

interface Metadata {
  version: 1; requestId: string; options: CollectionOptions; step: number; revealed: number[]; outcome: number[];
  serverSeed: string; clientSeed: string; rtp: number; maxMultiplier: number; lastActionId?: string;
}
const owned = (userId: string, game: string) => and(eq(betsTable.userId, userId), eq(betsTable.gameCode, game), sql`${betsTable.metadata}->>'version' = '1'`);
export function instantReceipt(bet: Bet): CollectionRound {
  const m = bet.metadata as Metadata, game = settlementGame(bet.gameCode)!;
  const active = bet.status === "placed";
  const multiplier = progressive(game.kind) ? collectionMultiplier(game.kind, m.step, m.options, m.rtp, m.maxMultiplier) : bet.multiplier ?? 0;
  return { id: bet.id, gameCode: game.code, requestId: m.requestId, status: active ? "active" : bet.status === "lost" ? "lost" : bet.status === "cashed_out" ? "cashed_out" : "won",
    stakeAmount: bet.stakeAmount.toString(), payoutAmount: bet.payoutAmount.toString(), cashoutAmount: (game.kind === "dice" && m.options.bets ? bet.payoutAmount : collectionPayout(bet.stakeAmount, multiplier)).toString(), multiplier,
    step: m.step, options: m.options, revealed: m.revealed, outcome: m.outcome,
    hazards: !active && game.kind === "mines" ? instantHazards(m.serverSeed, m.clientSeed, game.code, m.options.mines) : null,
    serverSeedHash: instantSeedHash(m.serverSeed), serverSeed: active ? null : m.serverSeed, clientSeed: m.clientSeed,
    createdAt: bet.placedAt.toISOString(), rtp: m.rtp, maxMultiplier: m.maxMultiplier };
}
export async function instantConfig(code: CollectionCode) {
  const c = await requireGameConfig(code);
  return { enabled: c.enabled && !isRetiredGame(code), minStakePaise: c.minStakePaise.toString(), maxStakePaise: c.maxStakePaise.toString(), rtp: 1 - c.houseEdge, maxMultiplier: c.maxMultiplier };
}
export async function instantState(userId: string, code: CollectionCode) {
  const active = await db.select().from(betsTable).where(and(owned(userId, code), eq(betsTable.status, "placed"))).limit(1);
  const history = await db.select().from(betsTable).where(owned(userId, code)).orderBy(desc(betsTable.placedAt)).limit(20);
  return { round: active[0] ? instantReceipt(active[0]) : null, history: history.map(instantReceipt) };
}
export async function placeInstant(userId: string, code: CollectionCode, input: { requestId: string; stakeAmount: string; clientSeed: string; options: CollectionOptions }) {
  if (isRetiredGame(code)) throw badRequest("This game is no longer available.");
  const game = collectionGame(code)!, config = await instantConfig(code), stake = BigInt(input.stakeAmount);
  if (input.options.bets) {
    if (game.kind !== "dice") throw badRequest("Chip bets are only available on 7 Up 7 Down.");
    try { input = { ...input, options: { ...input.options, bets: normalizeSevenBets(input.options.bets, stake) } }; }
    catch (e) { throw badRequest((e as Error).message); }
  }
  let wallet: { balance: bigint; amount: bigint } | undefined;
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`instant:${code}:${userId}`}))`);
    const [prior] = await tx.select().from(betsTable).where(and(owned(userId, code), sql`${betsTable.metadata}->>'requestId' = ${input.requestId}`)).limit(1);
    if (prior) {
      const m = prior.metadata as Metadata;
      if (prior.stakeAmount !== stake || m.clientSeed !== input.clientSeed || m.options.choice !== input.options.choice || m.options.mines !== input.options.mines || m.options.difficulty !== input.options.difficulty || JSON.stringify(m.options.bets) !== JSON.stringify(input.options.bets)) throw conflict("This request already belongs to another bet.");
      return instantReceipt(prior);
    }
    if (!config.enabled) throw badRequest("This game is temporarily unavailable.");
    if (stake < BigInt(config.minStakePaise) || stake > BigInt(config.maxStakePaise) || stake <= 0n) throw badRequest("Bet is outside the game limits.");
    const [active] = await tx.select({ id: betsTable.id }).from(betsTable).where(and(owned(userId, code), eq(betsTable.status, "placed"))).limit(1);
    if (active) throw conflict("Finish your current round first.");
    const m: Metadata = { version: 1, requestId: input.requestId, options: input.options, clientSeed: input.clientSeed, serverSeed: randomBytes(32).toString("hex"), step: 0, revealed: [], outcome: [], rtp: config.rtp, maxMultiplier: config.maxMultiplier };
    let multiplier = 1, status: Bet["status"] = "placed";
    if (!progressive(game.kind)) {
      const draw = instantDraw(game.kind, m.serverSeed, m.clientSeed, code, m.options.choice, m.rtp);
      multiplier = Math.min(config.maxMultiplier, draw.multiplier); m.outcome = draw.outcome;
      status = multiplier > 0 ? "won" : "lost";
    }
    const payout = game.kind === "dice" && m.options.bets
      ? sevenPayout(m.options.bets, m.outcome, m.rtp, config.maxMultiplier)
      : status === "won" ? collectionPayout(stake, multiplier) : 0n;
    if (game.kind === "dice" && m.options.bets) {
      multiplier = Number(payout) / Number(stake);
      status = payout > 0n ? "won" : "lost";
    }
    const [bet] = await tx.insert(betsTable).values({ userId, gameCode: code, stakeAmount: stake, payoutAmount: payout, multiplier, status, metadata: m, settledAt: status === "placed" ? null : new Date() }).returning();
    try {
      const debit = await postEntry({ userId, type: "bet", amount: -stake, refType: "bet", refId: bet.id, memo: `${game.name} stake` }, tx);
      wallet = { balance: debit.entry.balanceAfter, amount: -stake };
      if (payout > 0n) {
        const credit = await postEntry({ userId, type: "win", amount: payout, refType: "bet", refId: bet.id, memo: `${game.name} ${multiplier}x` }, tx);
        wallet = { balance: credit.entry.balanceAfter, amount: payout - stake };
      }
    } catch (e) { if ((e as Error).message === "INSUFFICIENT_FUNDS") throw badRequest("Insufficient wallet balance."); throw e; }
    return instantReceipt(bet);
  });
  if (wallet) publishWalletBalance({ userId, balance: wallet.balance, amount: wallet.amount, entryType: "bet" });
  return result;
}
export async function moveInstant(userId: string, code: CollectionCode, id: string, input: { action: "reveal" | "cashout"; expectedStep: number; cell: number; actionId: string }) {
  if (isRetiredGame(code) && input.action !== "cashout") throw badRequest("This game has been removed. Cash out your existing round.");
  let wallet: { balance: bigint; amount: bigint } | undefined;
  const result = await db.transaction(async tx => {
    const [bet] = await tx.select().from(betsTable).where(and(owned(userId, code), eq(betsTable.id, id))).for("update").limit(1);
    if (!bet) throw notFound("Round not found.");
    if (bet.status !== "placed") return instantReceipt(bet);
    const game = settlementGame(code)!, old = bet.metadata as Metadata;
    if (old.lastActionId === input.actionId) return instantReceipt(bet);
    if (old.step !== input.expectedStep) throw conflict("Round changed. Refresh before playing again.");
    const m: Metadata = { ...old, revealed: [...old.revealed], lastActionId: input.actionId };
    let status: Bet["status"] = "placed";
    if (input.action === "cashout") status = "cashed_out"; // A zero-step exit refunds the original stake.
    else {
      if (!progressive(game.kind)) throw badRequest("This round has no moves.");
      if (game.kind === "mines" && (input.cell > 24 || m.revealed.includes(input.cell))) throw badRequest("Choose an unopened tile.");
      if (game.kind === "tower" && input.cell > 2) throw badRequest("Choose one of the three doors.");
      const safe = instantSafe(game.kind, m.serverSeed, m.clientSeed, code, m.step + 1, input.cell, m.options);
      m.revealed.push(input.cell);
      if (safe) { m.step++; if (m.step === collectionSteps(game.kind, m.options)) status = "cashed_out"; }
      else status = "lost";
    }
    const multiplier = collectionMultiplier(game.kind, m.step, m.options, m.rtp, m.maxMultiplier);
    const payout = status === "cashed_out" ? collectionPayout(bet.stakeAmount, multiplier) : 0n;
    if (payout > 0n) {
      const credit = await postEntry({ userId, type: "win", amount: payout, refType: "bet", refId: id, memo: `${game.name} cash out` }, tx);
      wallet = { balance: credit.entry.balanceAfter, amount: payout };
    }
    const [updated] = await tx.update(betsTable).set({ metadata: m, status, multiplier, payoutAmount: payout, settledAt: status === "placed" ? null : new Date() }).where(eq(betsTable.id, id)).returning();
    return instantReceipt(updated);
  });
  if (wallet) publishWalletBalance({ userId, balance: wallet.balance, amount: wallet.amount, entryType: "win" });
  return result;
}
