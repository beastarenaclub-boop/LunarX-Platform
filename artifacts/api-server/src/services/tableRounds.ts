import { COIN_LIVE_TIMING, coinLiveMultiplier, collectionPayout, normalizeCoinLiveBet, type CoinLiveOutcome } from "@workspace/api-zod/instant-collection";
import { settleCoinLive, refundCoinLive, voidCoinLiveRound } from "./coinFlipLive";
import { W20_VERSION, normalizeW20Bets, w20Stake, w20Payout, type W20Bet, type W20Outcome } from "@workspace/api-zod/wheel20-live";
import { deriveW20Outcome } from "./wheel20LiveMath";
import { settleW20Live } from "./wheel20Live";
import { withRouletteAdmission } from "./rouletteAdmission";
import { AB_MOTION_VERSION, andarBaharRevealMs } from "@workspace/api-zod/andar-bahar-live";
import { L7_VERSION, normalizeL7Bets, l7Stake, l7Payout, type L7Bet, type L7Card } from "@workspace/api-zod/lucky7-live";
import { deriveL7Card } from "./lucky7LiveMath";
import { settleL7Live } from "./lucky7Live";
import { normalizeSevenBets, sevenPayout, type SevenBet } from "@workspace/api-zod/instant-collection";
import { instantDraw } from "./instantCollectionMath";
import { settleSevenLive, type SevenOutcome } from "./sevenUpDownLive";
/**
 * Shared server-scheduled round engine for the table games:
 * roulette, baccarat, blackjack, teen-patti, teen-patti-live, andar-bahar
 * and lucky-7.
 *
 * Every player bets into the SAME round on a fixed clock:
 *
 *   betting (default 55s) → reveal (default 5s) → settling (default 5s)
 *   → next round starts automatically.
 *
 * Phase durations, min/max stake and house edge are read fresh from
 * game_config at the start of every round, so admin edits apply on the next
 * round without a restart. A snapshot of the config used is persisted on the
 * round row so verification of historical rounds stays stable.
 *
 * Provable fairness: the round's serverSeedHash + clientSeed + nonce are
 * broadcast at round creation (before any bets exist); the outcome is
 * derived only at the reveal transition and the serverSeed is disclosed with
 * it. Per-player audit rows are written into the existing per-game round
 * tables at settlement so the existing /:id and /:id/verify endpoints keep
 * working unchanged.
 *
 * Restart safety: on boot, unsettled rounds whose outcome was already
 * revealed are settled idempotently; rounds still in the betting phase (no
 * outcome) are voided and every pending wager slip is refunded.
 */
import {
  db,
  betsTable,
  usersTable,
  tableRoundsTable,
  tableRoundBetsTable,
  rouletteRoundsTable,
  baccaratRoundsTable,
  teenPattiRoundsTable,
  teenPattiLiveRoundsTable,
  andarBaharRoundsTable,
  lucky7RoundsTable,
  type TableRound,
  type TableRoundBet,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { ROULETTE_HOUSE_EDGE, ROULETTE_LIMITS } from "@workspace/api-zod/roulette-game";
import {
  requireGameConfig,
  sha256Hex,
  generateSeed,
  deriveRouletteOutcome,
  deriveLucky7Outcome,
} from "./rtp";
import {
  settleRouletteBets,
  validateRouletteStakes,
  ROULETTE_PAYOUT_BASE,
  type RouletteBetInput,
} from "./rouletteMath";
import {
  settleBaccaratBets,
  type BaccaratBetInput,
  type BaccaratDeal,
} from "./baccaratMath";
import { deriveBaccaratDeal } from "./baccarat";
import {
  dealTeenPatti,
  settleTeenPattiBets,
  type TeenPattiBetInput,
  type TeenPattiDeal,
} from "./teenPattiMath";
import { deriveTeenPattiDeal } from "./teenPatti";
import {
  deriveTeenPattiLiveDeal,
  TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND,
} from "./teenPattiLive";
import {
  settleAndarBaharBets,
  type AndarBaharBetInput,
  type AndarBaharDeal,
} from "./andarBaharMath";
import { deriveAndarBaharDeal } from "./andarBahar";
import {
  settleLucky7Bets,
  LUCKY7_PAYOUT_VERSION,
  LUCKY7_MAX_RETURN,
  type Lucky7PayoutVersion,
  LUCKY7_MAX_BETS_PER_ROUND,
  type Lucky7BetInput,
  type Lucky7Roll,
} from "./lucky7Math";
import { dealForTableRound, forceFinishRounds } from "./blackjack";
import { placeBet, cashOutBet, settleLoss, refundStake } from "./bets";
import { bus } from "../realtime/eventBus";
import { logger } from "../lib/logger";
import { deriveVegetableOutcome, settleVegetableBets, type VegetableBet } from "./vegetableMath";
import { VEGETABLE_OUTCOME_VERSION, type VegetableOutcome, type VegetableOutcomeVersion } from "@workspace/api-zod/vegetable-game";
import { CRAZY_TIME_VERSION, CRAZY_TIME_MAX_RETURN, type CrazyTimeOutcome } from "@workspace/api-zod/crazy-time-game";
import { deriveCrazyTimeOutcome, validateCrazyTimeBets, settleCrazyTimeBets, type CrazyTimeBetInput } from "./crazyTimeMath";

export const TABLE_GAME_CODES = [
  "coin-flip",
  "wheel-2-live",
  "lucky-7-live",
  "roulette",
  "baccarat",
  "blackjack",
  "teen-patti",
  "teen-patti-live",
  "andar-bahar",
  "lucky-7",
  "vegetable-bowl",
  "crazy-time",
  "7up7down",
] as const;
export type TableGameCode = (typeof TABLE_GAME_CODES)[number];

export function isTableGame(code: string): code is TableGameCode {
  return (TABLE_GAME_CODES as readonly string[]).includes(code);
}

/** Config snapshot persisted on every round row. */
export interface RoundConfigSnapshot {
  wheel20Version?: number;
  andarBaharMotionVersion?: number;
  lucky7CardVersion?: number;
  crazyTimeVersion?: typeof CRAZY_TIME_VERSION;
  /** Missing on legacy rounds, which must replay the original vegetable draw. */
  vegetableOutcomeVersion?: VegetableOutcomeVersion;
  /** Missing on legacy rounds, which retain the version 1 payout rules. */
  lucky7PayoutVersion?: Lucky7PayoutVersion;
  payoutVersion?: number;
  roulettePayoutBase?: number;
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: string;
  minStakePaise: string;
  bettingWindowMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
}

// ---------------------------------------------------------------------------
// Per-game adapters (validation, derivation, settlement, audit persistence)
// ---------------------------------------------------------------------------

interface SettleOutcome {
  settled: unknown;
  totalPayout: bigint;
}

interface TableGameAdapter {
  /**
   * Validate raw slip bets + compute total stake. Throws known errors.
   * `houseEdge` comes from the round's config snapshot; games with edge-scaled
   * payouts (Lucky 7) need it, fixed-paytable games ignore it.
   */
  validate(
    bets: unknown,
    maxMultiplier: number,
    houseEdge: number,
  ): { totalStake: bigint };
  /** Derive the round outcome from the committed seed tuple. */
  derive(serverSeed: string, clientSeed: string, nonce: number, cfg: RoundConfigSnapshot): unknown;
  /** Settle one player's slip against the round outcome. */
  settle(
    bets: unknown,
    outcome: unknown,
    maxMultiplier: number,
    houseEdge: number,
    cfg: RoundConfigSnapshot,
  ): SettleOutcome;
  /** Persist the per-player audit row; returns its id. */
  insertAudit(args: {
    round: TableRound;
    slip: TableRoundBet;
    outcome: unknown;
    settled: unknown;
    payoutAmount: bigint;
    multiplier: number;
    cfg: RoundConfigSnapshot;
  }): Promise<string | null>;
}

function toBetInputs<T>(bets: unknown): T[] {
  if (!Array.isArray(bets) || bets.length === 0) throw new Error("NO_BETS");
  return bets.map((b) => ({
    ...(b as Record<string, unknown>),
    amountPaise: BigInt(String((b as { amountPaise: unknown }).amountPaise)),
  })) as T[];
}

function displayMultiplier(totalPayout: bigint, totalStake: bigint): number {
  if (totalStake <= 0n) return 0;
  return Math.round((Number(totalPayout) / Number(totalStake)) * 100) / 100;
}

const rouletteAdapter: TableGameAdapter = {
  validate(bets, maxMultiplier) {
    const inputs = toBetInputs<RouletteBetInput>(bets);
    if (inputs.length > 40) throw new Error("TOO_MANY_BETS");
    const { totalStake } = settleRouletteBets(inputs, 0, maxMultiplier);
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveRouletteOutcome(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, _houseEdge, cfg) {
    const inputs = toBetInputs<RouletteBetInput>(bets);
    const { pocket } = outcome as { pocket: number };
    const r = settleRouletteBets(inputs, pocket, maxMultiplier, cfg.roulettePayoutBase ?? 35);
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const { pocket } = outcome as { pocket: number };
    const [row] = await db
      .insert(rouletteRoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        pocket,
        // Store the wrapper so /:id/verify can recompute payouts with the
        // payout base that was active when this round settled.
        bets: { payoutBase: cfg.roulettePayoutBase ?? 35, bets: settled },
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .onConflictDoNothing({ target: rouletteRoundsTable.betId })
      .returning({ id: rouletteRoundsTable.id });
    if (row) return row.id;
    const [existing] = await db.select({ id: rouletteRoundsTable.id }).from(rouletteRoundsTable).where(eq(rouletteRoundsTable.betId, slip.betId));
    return existing?.id ?? null;
  },
};

const baccaratAdapter: TableGameAdapter = {
  validate(bets, maxMultiplier) {
    const inputs = toBetInputs<BaccaratBetInput>(bets);
    if (inputs.length > 5) throw new Error("TOO_MANY_BETS");
    const seen = new Set<string>();
    for (const b of inputs) {
      if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
      seen.add(b.type);
    }
    const dummy: BaccaratDeal = {
      playerCards: [0, 1],
      bankerCards: [2, 3],
      playerTotal: 0,
      bankerTotal: 0,
      winner: "tie",
      playerPair: false,
      bankerPair: false,
      natural: false,
    };
    const { totalStake } = settleBaccaratBets(inputs, dummy, maxMultiplier);
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveBaccaratDeal(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, _houseEdge, cfg) {
    const inputs = toBetInputs<BaccaratBetInput>(bets);
    const r = settleBaccaratBets(inputs, outcome as BaccaratDeal, maxMultiplier, cfg.payoutVersion ?? 1);
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const deal = outcome as BaccaratDeal;
    const [row] = await db
      .insert(baccaratRoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        playerCards: deal.playerCards,
        bankerCards: deal.bankerCards,
        playerTotal: deal.playerTotal,
        bankerTotal: deal.bankerTotal,
        winner: deal.winner,
        playerPair: deal.playerPair,
        bankerPair: deal.bankerPair,
        bets: settled,
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning({ id: baccaratRoundsTable.id });
    return row?.id ?? null;
  },
};

const teenPattiAdapter: TableGameAdapter = {
  validate(bets, maxMultiplier) {
    const inputs = toBetInputs<TeenPattiBetInput>(bets);
    if (inputs.length > 5) throw new Error("TOO_MANY_BETS");
    const seen = new Set<string>();
    for (const b of inputs) {
      if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
      seen.add(b.type);
    }
    const dummy: TeenPattiDeal = {
      handACards: [0, 14, 28],
      handBCards: [1, 15, 29],
      handA: { category: 0, ranks: [0, 0, 0], score: 0 } as unknown as TeenPattiDeal["handA"],
      handB: { category: 0, ranks: [0, 0, 0], score: 0 } as unknown as TeenPattiDeal["handB"],
      winner: "tie",
    };
    const { totalStake } = settleTeenPattiBets(inputs, dummy, maxMultiplier);
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveTeenPattiDeal(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, _houseEdge, cfg) {
    const inputs = toBetInputs<TeenPattiBetInput>(bets);
    const r = settleTeenPattiBets(inputs, outcome as TeenPattiDeal, maxMultiplier, cfg.payoutVersion ?? 1);
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const deal = outcome as TeenPattiDeal;
    const [row] = await db
      .insert(teenPattiRoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        handACards: deal.handACards,
        handBCards: deal.handBCards,
        handACategory: deal.handA.category,
        handBCategory: deal.handB.category,
        winner: deal.winner,
        bets: settled,
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning({ id: teenPattiRoundsTable.id });
    return row?.id ?? null;
  },
};

/**
 * Teen Patti 20-20 LIVE — a separate game from the flat teen-patti table
 * (own clock, own wallet, own audit trail) that deliberately shares its
 * maths: the same deal derivation, the same ranking and the same settlement
 * helpers. Nothing about the paytable is re-declared here, so the two games
 * cannot drift apart.
 */
const teenPattiLiveAdapter: TableGameAdapter = {
  validate(bets, maxMultiplier) {
    const inputs = toBetInputs<TeenPattiBetInput>(bets);
    if (inputs.length > TEEN_PATTI_LIVE_MAX_BETS_PER_ROUND) {
      throw new Error("TOO_MANY_BETS");
    }
    const seen = new Set<string>();
    for (const b of inputs) {
      if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
      seen.add(b.type);
    }
    // Validation only needs the stake total and the per-bet type/amount
    // checks, so settle against an arbitrary legal deal.
    const dummy = dealTeenPatti([0, 1, 2, 3, 4, 5]);
    const { totalStake } = settleTeenPattiBets(inputs, dummy, maxMultiplier);
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveTeenPattiLiveDeal(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, _houseEdge, cfg) {
    const inputs = toBetInputs<TeenPattiBetInput>(bets);
    const r = settleTeenPattiBets(inputs, outcome as TeenPattiDeal, maxMultiplier, cfg.payoutVersion ?? 1);
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const deal = outcome as TeenPattiDeal;
    const [row] = await db
      .insert(teenPattiLiveRoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        handACards: deal.handACards,
        handBCards: deal.handBCards,
        handACategory: deal.handA.category,
        handBCategory: deal.handB.category,
        winner: deal.winner,
        bets: settled,
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning({ id: teenPattiLiveRoundsTable.id });
    return row?.id ?? null;
  },
};
const andarBaharAdapter: TableGameAdapter = {
  validate(bets, maxMultiplier) {
    const inputs = toBetInputs<AndarBaharBetInput>(bets);
    if (inputs.length > 6) throw new Error("TOO_MANY_BETS");
    const seen = new Set<string>();
    for (const b of inputs) {
      if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
      seen.add(b.type);
    }
    const dummy: AndarBaharDeal = {
      joker: 0,
      andarCards: [13],
      baharCards: [],
      firstSide: "andar",
      winner: "andar",
      cardsDealt: 1,
    };
    const { totalStake } = settleAndarBaharBets(inputs, dummy, maxMultiplier);
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveAndarBaharDeal(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, _houseEdge, cfg) {
    const inputs = toBetInputs<AndarBaharBetInput>(bets);
    const r = settleAndarBaharBets(inputs, outcome as AndarBaharDeal, maxMultiplier, cfg.payoutVersion ?? 1);
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const deal = outcome as AndarBaharDeal;
    const [row] = await db
      .insert(andarBaharRoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        joker: deal.joker,
        andarCards: deal.andarCards,
        baharCards: deal.baharCards,
        firstSide: deal.firstSide,
        winner: deal.winner,
        cardsDealt: deal.cardsDealt,
        bets: settled,
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning({ id: andarBaharRoundsTable.id });
    return row?.id ?? null;
  },
};

const lucky7Adapter: TableGameAdapter = {
  validate(bets, maxMultiplier, houseEdge) {
    const inputs = toBetInputs<Lucky7BetInput>(bets);
    if (inputs.length > LUCKY7_MAX_BETS_PER_ROUND) {
      throw new Error("TOO_MANY_BETS");
    }
    const seen = new Set<string>();
    for (const b of inputs) {
      if (seen.has(b.type)) throw new Error("DUPLICATE_BET_TYPE");
      seen.add(b.type);
    }
    // Roll a losing-for-everyone dummy is impossible (every total pays some
    // spot), so validation just settles against an arbitrary legal roll — it
    // only needs the stake total and the per-bet type/amount checks.
    const dummy: Lucky7Roll = { dice: [1, 1], total: 2 };
    const { totalStake } = settleLucky7Bets(
      inputs,
      dummy,
      houseEdge,
      maxMultiplier,
    );
    return { totalStake };
  },
  derive(serverSeed, clientSeed, nonce) {
    return deriveLucky7Outcome(serverSeed, clientSeed, nonce);
  },
  settle(bets, outcome, maxMultiplier, houseEdge, cfg) {
    const inputs = toBetInputs<Lucky7BetInput>(bets);
    const r = settleLucky7Bets(
      inputs,
      outcome as Lucky7Roll,
      houseEdge,
      maxMultiplier,
      cfg.lucky7PayoutVersion ?? 1,
    );
    return { settled: r.settled, totalPayout: r.totalPayout };
  },
  async insertAudit({ round, slip, outcome, settled, payoutAmount, multiplier, cfg }) {
    const roll = outcome as Lucky7Roll;
    const [row] = await db
      .insert(lucky7RoundsTable)
      .values({
        betId: slip.betId,
        userId: slip.userId,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        clientSeed: round.clientSeed,
        nonce: round.nonce,
        die1: roll.dice[0],
        die2: roll.dice[1],
        total: roll.total,
        bets: { payoutVersion: cfg.lucky7PayoutVersion ?? 1, bets: settled },
        totalStake: slip.totalStake,
        payoutAmount,
        multiplier,
        // Keep legacy pricing inputs alongside the versioned audit payload.
        houseEdge: cfg.houseEdge,
        maxMultiplier: cfg.maxMultiplier,
      })
      .returning({ id: lucky7RoundsTable.id });
    return row?.id ?? null;
  },
};

const ADAPTERS: Record<Exclude<TableGameCode, "blackjack">, TableGameAdapter> = {
  "wheel-2-live": {
    validate: bets => ({ totalStake: w20Stake(normalizeW20Bets(bets as W20Bet[])) }),
    derive: (seed, client, nonce) => deriveW20Outcome(seed, client, nonce),
    settle: (bets, outcome, _cap, _edge, cfg) => ({ settled: bets, totalPayout: w20Payout(bets as W20Bet[], outcome as W20Outcome, cfg.wheel20Version) }),
    async insertAudit({ round }) { return round.id; },
  },
  "lucky-7-live": {
    validate: bets => ({ totalStake: l7Stake(normalizeL7Bets(bets as L7Bet[])) }),
    derive: (seed, client, nonce) => deriveL7Card(seed, client, nonce),
    settle: (bets, card, _cap, _edge, cfg) => ({ settled: bets, totalPayout: l7Payout(bets as L7Bet[], card as L7Card, cfg.lucky7CardVersion) }),
    async insertAudit({ round }) { return round.id; },
  },
  "coin-flip": {
    validate: raw => ({ totalStake: BigInt(normalizeCoinLiveBet(raw).amount) }),
    derive: (seed, client, nonce, cfg) => { const value = instantDraw("coin", seed, client, `coin-live:${nonce}`, "heads", 1 - cfg.houseEdge).outcome[0] as 0 | 1; return { value, side: value === 0 ? "heads" : "tails" }; },
    settle: (raw, outcome, cap, edge) => { const bet = normalizeCoinLiveBet(raw); return { settled: raw, totalPayout: bet.side === (outcome as CoinLiveOutcome).side ? collectionPayout(BigInt(bet.amount), coinLiveMultiplier(1 - edge, cap)) : 0n }; },
    async insertAudit({ round }) { return round.id; },
  },
  "7up7down": {
    validate: raw => {
      const bets = raw as SevenBet[];
      const totalStake = bets.reduce((sum, bet) => sum + BigInt(bet.amount), 0n);
      normalizeSevenBets(bets, totalStake);
      return { totalStake };
    },
    derive: (seed, client, nonce, cfg) => {
      const dice = instantDraw("dice", seed, client, `7up7down:${nonce}`, "up", 1 - cfg.houseEdge).outcome;
      return { dice, total: dice[0] + dice[1] };
    },
    settle: (bets, outcome, cap, edge) => ({ settled: bets, totalPayout: sevenPayout(bets as SevenBet[], (outcome as SevenOutcome).dice, 1 - edge, cap) }),
    async insertAudit({ round }) { return round.id; },
  },
  "crazy-time": {
    validate: bets => validateCrazyTimeBets(toBetInputs<CrazyTimeBetInput>(bets)),
    derive: (serverSeed, clientSeed, nonce, cfg) => deriveCrazyTimeOutcome(serverSeed, clientSeed, nonce, cfg.crazyTimeVersion ?? 1),
    settle: (bets, outcome, _max, _edge, cfg) => settleCrazyTimeBets(toBetInputs<CrazyTimeBetInput>(bets), outcome as CrazyTimeOutcome, cfg.payoutVersion ?? 1),
    async insertAudit({ round }) { return round.id; },
  },
  "vegetable-bowl": {
    validate: bets => settleVegetableBets(toBetInputs<VegetableBet>(bets), 7),
    derive: (serverSeed, clientSeed, nonce, cfg) => deriveVegetableOutcome(serverSeed, clientSeed, nonce, cfg.vegetableOutcomeVersion ?? 1),
    settle: (bets, outcome, _max, _edge, cfg) => settleVegetableBets(toBetInputs<VegetableBet>(bets), (outcome as VegetableOutcome).total, cfg.payoutVersion ?? 1),
    // The shared round and slip already persist the seeds, input and exact payout.
    async insertAudit({ round }) { return round.id; },
  },
  roulette: rouletteAdapter,
  baccarat: baccaratAdapter,
  "teen-patti": teenPattiAdapter,
  "teen-patti-live": teenPattiLiveAdapter,
  "andar-bahar": andarBaharAdapter,
  "lucky-7": lucky7Adapter,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function topic(gameCode: string): `table-rounds:${string}` {
  return `table-rounds:${gameCode}`;
}

async function userDisplayName(userId: string): Promise<string | null> {
  try {
    const r = await db
      .select({ displayName: usersTable.displayName, email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);
    if (!r[0]) return null;
    if (r[0].displayName) return r[0].displayName;
    const local = r[0].email.split("@")[0]!;
    return local.length > 12 ? local.slice(0, 10) + "…" : local;
  } catch {
    return null;
  }
}

function roundCfg(round: TableRound): RoundConfigSnapshot {
  return round.config as RoundConfigSnapshot;
}

function snapshotConfig(cfg: {
  houseEdge: number;
  maxMultiplier: number;
  maxStakePaise: bigint;
  minStakePaise: bigint;
  bettingWindowMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
}): RoundConfigSnapshot {
  return {
    houseEdge: cfg.houseEdge,
    payoutVersion: 2,
    roulettePayoutBase: ROULETTE_PAYOUT_BASE,
    maxMultiplier: cfg.maxMultiplier,
    maxStakePaise: cfg.maxStakePaise.toString(),
    minStakePaise: cfg.minStakePaise.toString(),
    bettingWindowMs: cfg.bettingWindowMs,
    revealDurationMs: cfg.revealDurationMs,
    settleDurationMs: cfg.settleDurationMs,
  };
}

// ---------------------------------------------------------------------------
// Outcome disclosure
// ---------------------------------------------------------------------------

/**
 * How long before the end of the reveal window a game's outcome is allowed to
 * leave the server.
 *
 * Roulette's wheel has to be handed its target pocket before it can physically
 * decelerate onto it, so the payload stays empty for the whole visible spin and
 * opens only for that final landing: a player reading the REST/WebSocket
 * traffic never learns the number before the wheel has shown it. Games that
 * animate a deal *from* the outcome disclose at the start of reveal, exactly as
 * they always have (lead 0).
 *
 * Keep this at or above the client's landing budget (`planLandingMs`) or the
 * wheel will not have time left to decelerate and will snap onto the pocket.
 */
const OUTCOME_DISCLOSE_LEAD_MS: Partial<Record<TableGameCode, number>> = {
  // Supply the face after betting is locked, before the filmed hand turns it
  // toward the camera. The client tracks the face through that physical turn.
  "lucky-7-live": 1_500,
  "7up7down": 650,
  roulette: 3_600,
};

interface DisclosableRound {
  gameCode: string;
  phase: string;
  outcome: unknown;
  bettingEndsAt: Date;
  revealEndsAt: Date;
}

/** Server-epoch ms at which this round's outcome may first be handed out. */
export function outcomeDiscloseAt(round: DisclosableRound): number {
  if (round.gameCode === "coin-flip") return round.revealEndsAt.getTime();
  const lead = OUTCOME_DISCLOSE_LEAD_MS[round.gameCode as TableGameCode] ?? 0;
  const revealStartsAt = round.bettingEndsAt.getTime();
  if (lead <= 0) return revealStartsAt;
  return Math.max(revealStartsAt, round.revealEndsAt.getTime() - lead);
}

/**
 * May this round's outcome (and its server seed) be serialized to clients yet?
 * Betting never discloses; settling/settled always does; reveal waits for the
 * game's disclosure moment.
 */
export function isOutcomeDisclosed(
  round: DisclosableRound,
  now: number = Date.now(),
): boolean {
  if (round.outcome == null) return false;
  if (round.phase === "betting") return false;
  if (round.phase !== "reveal") return true;
  return now >= outcomeDiscloseAt(round);
}

/** Rounds whose result event has already been published by this process. */
const disclosedRounds = new Set<string>();

/**
 * Publish the result event for a round whose outcome may now be seen.
 * Idempotent per process: the reveal transition and the scheduler loop both
 * call it, and only the first one broadcasts.
 */
export function discloseTableRoundOutcome(round: TableRound): void {
  if (round.outcome == null) return;
  if (disclosedRounds.has(round.id)) return;
  disclosedRounds.add(round.id);
  bus.publish({
    topic: topic(round.gameCode),
    type: "result",
    roundId: round.id,
    gameCode: round.gameCode,
    outcome: round.outcome,
    serverSeed: round.serverSeed,
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    ts: Date.now(),
  });
  // Keep the legacy anonymized roulette pockets strip fresh.
  if (round.gameCode === "roulette") {
    const { pocket } = round.outcome as { pocket: number };
    bus.publish({
      topic: "rounds:roulette",
      type: "result",
      roundId: round.id,
      pocket,
      ts: Date.now(),
    });
  }
}

/** Drop a finished round from the disclosure guard. */
function forgetDisclosedRound(roundId: string): void {
  disclosedRounds.delete(roundId);
}

function broadcastPhase(round: TableRound, phase: "betting" | "reveal" | "settling"): void {
  const endsAt =
    phase === "betting"
      ? round.bettingEndsAt
      : phase === "reveal"
        ? round.revealEndsAt
        : round.settleEndsAt;
  bus.publish({
    topic: topic(round.gameCode),
    type: "phase",
    roundId: round.id,
    gameCode: round.gameCode,
    phase,
    endsAt: endsAt.getTime(),
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    ts: Date.now(),
  });
}

/** Conditional phase transition (CAS on the current phase). */
async function advancePhase(
  roundId: string,
  from: string,
  patch: Partial<{
    phase: string;
    outcome: unknown;
    totalPayout: bigint;
    playerCount: number;
    settledAt: Date | null;
    revealEndsAt: Date;
    settleEndsAt: Date;
    config: RoundConfigSnapshot;
  }>,
): Promise<TableRound | null> {
  const [updated] = await db
    .update(tableRoundsTable)
    .set(patch as never)
    .where(and(eq(tableRoundsTable.id, roundId), eq(tableRoundsTable.phase, from)))
    .returning();
  return updated ?? null;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

/** Create a fresh round from LIVE config and broadcast the betting phase. */
export async function createTableRound(gameCode: TableGameCode): Promise<TableRound> {
  const cfg = await requireGameConfig(gameCode);
  const snap = snapshotConfig(cfg);
  if (gameCode === "coin-flip") Object.assign(snap, COIN_LIVE_TIMING);
  // Allow six physical card deliveries at their recorded speed. Existing
  // rounds retain their snapshotted timing; this applies to new coups only.
  if (gameCode === "baccarat") snap.revealDurationMs = Math.max(12_000, snap.revealDurationMs);
  if (gameCode === "wheel-2-live") { snap.wheel20Version = W20_VERSION; snap.maxMultiplier = 321; }
  if (gameCode === "andar-bahar") snap.andarBaharMotionVersion = AB_MOTION_VERSION;
  if (gameCode === "lucky-7-live") {
    snap.lucky7CardVersion = L7_VERSION;
    snap.maxMultiplier = 12;
  }
  if (gameCode === "roulette") {
    snap.roulettePayoutBase = ROULETTE_PAYOUT_BASE;
    snap.houseEdge = ROULETTE_HOUSE_EDGE;
    snap.maxMultiplier = Math.max(snap.maxMultiplier, ROULETTE_PAYOUT_BASE);
    snap.minStakePaise = ROULETTE_LIMITS.minBetPaise;
  }
  if (gameCode === "crazy-time") {
    snap.crazyTimeVersion = CRAZY_TIME_VERSION;
    snap.maxMultiplier = CRAZY_TIME_MAX_RETURN;
  }
  if (gameCode === "vegetable-bowl") {
    snap.maxMultiplier = 20;
    snap.vegetableOutcomeVersion = VEGETABLE_OUTCOME_VERSION;
  }
  if (gameCode === "lucky-7") {
    snap.lucky7PayoutVersion = LUCKY7_PAYOUT_VERSION;
    snap.maxMultiplier = Math.max(snap.maxMultiplier, LUCKY7_MAX_RETURN);
  }
  const now = Date.now();
  const bettingEndsAt = new Date(now + snap.bettingWindowMs);
  const revealEndsAt = new Date(now + snap.bettingWindowMs + snap.revealDurationMs);
  const settleEndsAt = new Date(
    now + snap.bettingWindowMs + snap.revealDurationMs + snap.settleDurationMs,
  );
  const serverSeed = generateSeed(32);
  const [round] = await db
    .insert(tableRoundsTable)
    .values({
      gameCode,
      phase: "betting",
      serverSeed,
      serverSeedHash: sha256Hex(serverSeed),
      clientSeed: generateSeed(16),
      nonce: 0,
      bettingEndsAt,
      revealEndsAt,
      settleEndsAt,
      config: snap,
    })
    .returning();
  if (!round) throw new Error("ROUND_PERSIST_FAILED");
  broadcastPhase(round, "betting");
  return round;
}

/**
 * betting → reveal: derive the provably-fair outcome, persist it, disclose
 * the server seed, and (blackjack) deal every queued hand.
 */
export async function revealTableRound(round: TableRound): Promise<TableRound> {
  let outcome: unknown = null;
  if (round.gameCode !== "blackjack") {
    const adapter = ADAPTERS[round.gameCode as Exclude<TableGameCode, "blackjack">];
    outcome = adapter.derive(round.serverSeed, round.clientSeed, round.nonce, roundCfg(round));
  } else {
    outcome = { dealt: true };
  }
  // Count-dependent timing is published only when betting closes. Publishing
  // it at round creation would disclose the winning card-count range.
  const cfg = roundCfg(round);
  const dealerTiming = round.gameCode === "andar-bahar" && cfg.andarBaharMotionVersion === AB_MOTION_VERSION
    ? (() => {
        const revealDurationMs = andarBaharRevealMs((outcome as AndarBaharDeal).cardsDealt);
        const revealEndsAt = new Date(round.bettingEndsAt.getTime() + revealDurationMs);
        return {
          revealEndsAt,
          settleEndsAt: new Date(revealEndsAt.getTime() + cfg.settleDurationMs),
          config: { ...cfg, revealDurationMs },
        };
      })()
    : {};
  const updated = await advancePhase(round.id, "betting", {
    phase: "reveal",
    outcome,
    ...dealerTiming,
  });
  if (!updated) {
    // Someone else advanced it (or it was voided) — return the fresh row.
    const rows = await db
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, round.id))
      .limit(1);
    return rows[0] ?? round;
  }

  if (round.gameCode === "blackjack") {
    await dealQueuedBlackjackHands(updated);
  }

  broadcastPhase(updated, "reveal");
  // The outcome travels separately from the phase change: a game with a
  // disclosure lead keeps it back until the client actually needs it, and the
  // scheduler loop publishes it then.
  if (outcomeDiscloseAt(updated) <= Date.now()) {
    discloseTableRoundOutcome(updated);
  }
  return updated;
}

/** Deal a blackjack hand for every pending slip of the round. */
async function dealQueuedBlackjackHands(round: TableRound): Promise<void> {
  const cfg = roundCfg(round);
  const slips = await db
    .select()
    .from(tableRoundBetsTable)
    .where(
      and(
        eq(tableRoundBetsTable.roundId, round.id),
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );
  for (const slip of slips) {
    if (slip.auditRoundId) continue; // already dealt (idempotent re-run)
    try {
      const bj = await dealForTableRound({
        payoutVersion: cfg.payoutVersion ?? 1,
        userId: slip.userId,
        betId: slip.betId,
        stakeAmount: slip.totalStake,
        serverSeed: round.serverSeed,
        serverSeedHash: round.serverSeedHash,
        // Per-player shoe from the same commitment: mix the user id into the
        // client seed so shoes are independent yet fully verifiable.
        clientSeed: `${round.clientSeed}:${slip.userId}`,
        nonce: round.nonce,
        maxMultiplier: cfg.maxMultiplier,
      });
      await db
        .update(tableRoundBetsTable)
        .set({ auditRoundId: bj.id })
        .where(eq(tableRoundBetsTable.id, slip.id));
    } catch (err) {
      logger.error(
        { err, roundId: round.id, slipId: slip.id },
        "[table-rounds] blackjack deal failed — refunding slip",
      );
      await refundSlip(slip);
    }
  }
}

/** reveal → settling: credit every winner, persist audit rows. */
export async function settleTableRound(round: TableRound): Promise<TableRound> {
  let current = await advancePhase(round.id, "reveal", { phase: "settling" });
  if (!current) {
    const rows = await db
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, round.id))
      .limit(1);
    current = rows[0] ?? round;
  }
  if (current.phase === "settling") broadcastPhase(current, "settling");
  await settlePendingSlips(current);
  return current;
}

/**
 * Settle all pending slips of a round whose outcome is known. Idempotent:
 * every slip flips pending → settled exactly once; re-runs skip settled
 * slips and swallow BET_ALREADY_SETTLED from the bets service.
 */
export async function settlePendingSlips(round: TableRound): Promise<void> {
  if (round.gameCode === "coin-flip") { await settleCoinLive(round); return; }
  if (round.gameCode === "lucky-7-live") { await settleL7Live(round); return; }
  if (round.gameCode === "wheel-2-live") { await settleW20Live(round); return; }
  if (round.gameCode === "7up7down") { await settleSevenLive(round); return; }
  const cfg = roundCfg(round);
  const slips = await db
    .select()
    .from(tableRoundBetsTable)
    .where(
      and(
        eq(tableRoundBetsTable.roundId, round.id),
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );
  let totalPayout = 0n;

  if (round.gameCode === "blackjack") {
    const ids = slips.map((s) => s.auditRoundId).filter((x): x is string => !!x);
    const finished = await forceFinishRounds(ids);
    for (const slip of slips) {
      const bj = slip.auditRoundId ? finished.get(slip.auditRoundId) : undefined;
      if (!bj) {
        // Never dealt (e.g. deal failure already refunded) — skip.
        continue;
      }
      totalPayout += bj.payoutAmount;
      await db
        .update(tableRoundBetsTable)
        .set({ status: "settled", payoutAmount: bj.payoutAmount })
        .where(eq(tableRoundBetsTable.id, slip.id));
    }
  } else {
    const adapter = ADAPTERS[round.gameCode as Exclude<TableGameCode, "blackjack">];
    if (round.outcome == null) throw new Error("OUTCOME_MISSING");
    for (const slip of slips) {
      try {
        const { settled, totalPayout: slipPayout } = adapter.settle(
          slip.bets,
          round.outcome,
          cfg.maxMultiplier,
          cfg.houseEdge,
          cfg,
        );
        let payoutAmount = 0n;
        try {
          if (slipPayout > 0n) {
            const creditMultiplier = Math.min(
              (Number(slipPayout) + 0.5) / Number(slip.totalStake),
              cfg.maxMultiplier,
            );
            const out = await cashOutBet({
              betId: slip.betId,
              userId: slip.userId,
              multiplier: creditMultiplier,
              maxMultiplierCap: cfg.maxMultiplier,
              ...(round.gameCode === "vegetable-bowl" ? { vegetablePayoutPaise: slipPayout } : {}),
              ...(round.gameCode === "crazy-time" ? { crazyTimePayoutPaise: slipPayout } : {}),
              ...(round.gameCode === "roulette" ? { roulettePayoutPaise: slipPayout } : {}),
            });
            payoutAmount = out.payoutAmount;
          } else {
            await settleLoss(slip.betId, slip.userId, 0, round.gameCode === "vegetable-bowl", round.gameCode === "crazy-time", round.gameCode === "roulette");
          }
        } catch (err) {
          if ((err as Error).message !== "BET_ALREADY_SETTLED") throw err;
          if (round.gameCode === "vegetable-bowl" || round.gameCode === "crazy-time" || round.gameCode === "roulette") {
            // A restart can occur after wallet credit but before the slip receipt.
            const [credited] = await db.select({ payout: betsTable.payoutAmount }).from(betsTable).where(eq(betsTable.id, slip.betId));
            payoutAmount = credited?.payout ?? 0n;
          }
        }
        const auditRoundId = await adapter.insertAudit({
          round,
          slip,
          outcome: round.outcome,
          settled,
          payoutAmount,
          multiplier: displayMultiplier(payoutAmount, slip.totalStake),
          cfg,
        });
        totalPayout += payoutAmount;
        await db
          .update(tableRoundBetsTable)
          .set({ status: "settled", payoutAmount, auditRoundId })
          .where(eq(tableRoundBetsTable.id, slip.id));
      } catch (err) {
        logger.error(
          { err, roundId: round.id, slipId: slip.id },
          "[table-rounds] slip settlement failed — left pending for retry",
        );
      }
    }
  }

  if (round.gameCode === "roulette") {
    // Rebuild from receipts so a restart cannot count the same credit twice.
    await db.update(tableRoundsTable).set({
      totalPayout: sql`(select coalesce(sum(${tableRoundBetsTable.payoutAmount}), 0) from ${tableRoundBetsTable} where ${tableRoundBetsTable.roundId} = ${round.id} and ${tableRoundBetsTable.status} = 'settled')`,
    }).where(eq(tableRoundsTable.id, round.id));
  } else if (totalPayout > 0n) {
    await db
      .update(tableRoundsTable)
      .set({ totalPayout: sql`${tableRoundsTable.totalPayout} + ${totalPayout}` })
      .where(eq(tableRoundsTable.id, round.id));
  }
}

/** settling → settled: final broadcast with anonymous totals. */
export async function finishTableRound(round: TableRound): Promise<TableRound | null> {
  const updated = await advancePhase(round.id, "settling", {
    phase: "settled",
    settledAt: new Date(),
  });
  if (!updated) return null;
  bus.publish({
    topic: topic(updated.gameCode),
    type: "settled",
    roundId: updated.id,
    gameCode: updated.gameCode,
    totalStake: updated.totalStake.toString(),
    totalPayout: updated.totalPayout.toString(),
    playerCount: updated.playerCount,
    ts: Date.now(),
  });
  return updated;
}

// ---------------------------------------------------------------------------
// Bet placement
// ---------------------------------------------------------------------------

export interface PlacedTableBet {
  slipId: string;
  roundId: string;
  betId: string;
  gameCode: string;
  phase: string;
  bettingEndsAt: string;
  totalStake: string;
}

/**
 * Place a wager slip into the game's current OPEN round. The wallet is
 * debited immediately; a live-bet event is broadcast to everyone at the
 * table. Rejects with BETTING_CLOSED outside the betting window.
 */
export async function placeTableBets(input: Parameters<typeof placeTableBetsUnlocked>[0]): Promise<PlacedTableBet> {
  if (input.gameCode !== "roulette") return placeTableBetsUnlocked(input);
  return withRouletteAdmission(input.userId, () => placeTableBetsUnlocked(input));
}

async function placeTableBetsUnlocked(input: {
  roundId?: string;
  gameCode: TableGameCode;
  userId: string;
  bets: unknown[];
}): Promise<PlacedTableBet> {
  const round = await getOpenRound(input.gameCode);
  if (!round || (input.roundId != null && input.roundId !== round.id) || round.phase !== "betting" || round.bettingEndsAt.getTime() <= Date.now()) {
    throw new Error("BETTING_CLOSED");
  }
  const cfg = roundCfg(round);

  if (input.gameCode === "roulette") {
    const previous = await db.select({ bets: tableRoundBetsTable.bets })
      .from(tableRoundBetsTable)
      .where(and(eq(tableRoundBetsTable.roundId, round.id), eq(tableRoundBetsTable.userId, input.userId), inArray(tableRoundBetsTable.status, ["pending", "settled"])));
    validateRouletteStakes(toBetInputs<RouletteBetInput>(input.bets), previous.flatMap(slip => toBetInputs<RouletteBetInput>(slip.bets)));
  }

  // Validate BEFORE any money moves.
  let totalStake: bigint;
  if (input.gameCode === "blackjack") {
    if (input.bets.length !== 1) throw new Error("INVALID_STAKE");
    const stake = BigInt(
      String((input.bets[0] as { amountPaise: unknown }).amountPaise),
    );
    if (stake <= 0n) throw new Error("INVALID_STAKE");
    totalStake = stake;
    // One hand per player per round.
    const existing = await db
      .select({ id: tableRoundBetsTable.id })
      .from(tableRoundBetsTable)
      .where(
        and(
          eq(tableRoundBetsTable.roundId, round.id),
          eq(tableRoundBetsTable.userId, input.userId),
        ),
      )
      .limit(1);
    if (existing[0]) throw new Error("ROUND_IN_PROGRESS");
  } else {
    const adapter = ADAPTERS[input.gameCode as Exclude<TableGameCode, "blackjack">];
    totalStake = adapter.validate(
      input.bets,
      cfg.maxMultiplier,
      cfg.houseEdge,
    ).totalStake;
  }
  if (totalStake <= 0n) throw new Error("INVALID_STAKE");
  if (totalStake > BigInt(cfg.maxStakePaise)) throw new Error("STAKE_TOO_LARGE");
  if (BigInt(cfg.minStakePaise) > 0n && totalStake < BigInt(cfg.minStakePaise)) {
    throw new Error("STAKE_TOO_SMALL");
  }

  // Debit the wallet (creates the auditable bets row).
  const bet = await placeBet({
    tableRoundPlacement: true,
    userId: input.userId,
    gameCode: input.gameCode,
    roundId: round.id,
    stakeAmount: totalStake,
  });

  // Serialize the slip's bets with string amounts (jsonb-safe).
  const betsJson = (input.bets as Record<string, unknown>[]).map((b) => ({
    ...b,
    amountPaise: String(b.amountPaise),
  }));

  let slip: TableRoundBet | undefined;
  try {
    [slip] = await db
      .insert(tableRoundBetsTable)
      .values({
        roundId: round.id,
        gameCode: input.gameCode,
        userId: input.userId,
        betId: bet.id,
        bets: betsJson,
        totalStake,
      })
      .returning();
    if (!slip) throw new Error("SLIP_PERSIST_FAILED");
    // Late-insert guard: if the round left the betting phase while we were
    // debiting, void the slip so no bet ever lands on a revealed outcome.
    const fresh = await db
      .select({ phase: tableRoundsTable.phase, bettingEndsAt: tableRoundsTable.bettingEndsAt })
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, round.id))
      .limit(1);
    if (!fresh[0] || fresh[0].phase !== "betting" || (["crazy-time", "roulette"].includes(input.gameCode) && fresh[0].bettingEndsAt.getTime() <= Date.now())) {
      await refundSlip(slip);
      throw new Error("BETTING_CLOSED");
    }
  } catch (err) {
    if ((err as Error).message !== "BETTING_CLOSED") {
      try {
        await refundStake(bet.id, input.userId, totalStake);
        await db
          .update(betsTable)
          .set({ status: "voided", settledAt: new Date() })
          .where(eq(betsTable.id, bet.id));
      } catch (refundErr) {
        logger.error(
          { err: refundErr, betId: bet.id },
          "[table-rounds] refund after slip failure failed",
        );
      }
    }
    throw err;
  }

  const [bumped] = await db
    .update(tableRoundsTable)
    .set({
      totalStake: sql`${tableRoundsTable.totalStake} + ${totalStake}`,
      playerCount: sql`${tableRoundsTable.playerCount} + 1`,
    })
    .where(eq(tableRoundsTable.id, round.id))
    .returning({
      totalStake: tableRoundsTable.totalStake,
      playerCount: tableRoundsTable.playerCount,
    });

  bus.publish({
    topic: topic(input.gameCode),
    type: "bet",
    roundId: round.id,
    gameCode: input.gameCode,
    displayName: await userDisplayName(input.userId),
    totalStake: totalStake.toString(),
    bets: betsJson,
    playerCount: bumped?.playerCount ?? 0,
    totalStakeAll: (bumped?.totalStake ?? 0n).toString(),
    ts: Date.now(),
  });

  return {
    slipId: slip.id,
    roundId: round.id,
    betId: bet.id,
    gameCode: input.gameCode,
    phase: "betting",
    bettingEndsAt: round.bettingEndsAt.toISOString(),
    totalStake: totalStake.toString(),
  };
}

async function refundSlip(slip: TableRoundBet): Promise<void> {
  if (slip.gameCode === "coin-flip") { await refundCoinLive(slip.id); return; }
  try {
    await refundStake(slip.betId, slip.userId, slip.totalStake);
    await db
      .update(betsTable)
      .set({ status: "voided", settledAt: new Date() })
      .where(eq(betsTable.id, slip.betId));
    await db
      .update(tableRoundBetsTable)
      .set({ status: "refunded" })
      .where(eq(tableRoundBetsTable.id, slip.id));
  } catch (err) {
    logger.error({ err, slipId: slip.id }, "[table-rounds] slip refund failed");
  }
}

// ---------------------------------------------------------------------------
// Snapshot (mid-round join / reconnect)
// ---------------------------------------------------------------------------

export interface TableRoundSnapshot {
  roundId: string;
  gameCode: string;
  phase: string;
  now: number;
  bettingEndsAt: number;
  revealEndsAt: number;
  settleEndsAt: number;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  /** null until the reveal phase. */
  outcome: unknown;
  serverSeed: string | null;
  totalStake: string;
  playerCount: number;
  config: RoundConfigSnapshot;
  liveBets: {
    displayName: string | null;
    totalStake: string;
    bets: unknown;
    createdAt: string;
  }[];
  myBets: { slipId: string; totalStake: string; bets: unknown; status: string; payoutAmount: string; auditRoundId: string | null }[];
  recent: { roundId: string; outcome: unknown; settledAt: string | null }[];
}

async function getOpenRound(gameCode: string): Promise<TableRound | null> {
  const rows = await db
    .select()
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.gameCode, gameCode),
        inArray(tableRoundsTable.phase, ["betting", "reveal", "settling"]),
      ),
    )
    .orderBy(desc(tableRoundsTable.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Lightweight round-cycle status for the admin Game Settings page: current
 * phase, per-phase deadlines, and the config snapshot the round was created
 * with (so the panel can verify a saved change was picked up next round).
 */
export interface RoundCycleStatus {
  roundId: string;
  phase: string;
  bettingEndsAt: number;
  revealEndsAt: number;
  settleEndsAt: number;
  config: RoundConfigSnapshot;
}

export async function getRoundCycleStatus(
  gameCode: TableGameCode,
): Promise<RoundCycleStatus | null> {
  const round = await getOpenRound(gameCode);
  if (!round) return null;
  return {
    roundId: round.id,
    phase: round.phase,
    bettingEndsAt: round.bettingEndsAt.getTime(),
    revealEndsAt: round.revealEndsAt.getTime(),
    settleEndsAt: round.settleEndsAt.getTime(),
    config: roundCfg(round),
  };
}

export async function getTableRoundSnapshot(
  gameCode: TableGameCode,
  userId?: string,
): Promise<TableRoundSnapshot | null> {
  const round = await getOpenRound(gameCode);
  if (!round) return null;
  const revealed = isOutcomeDisclosed(round);

  const slips = await db
    .select({
      id: tableRoundBetsTable.id,
      userId: tableRoundBetsTable.userId,
      totalStake: tableRoundBetsTable.totalStake,
      bets: tableRoundBetsTable.bets,
      status: tableRoundBetsTable.status,
      payoutAmount: tableRoundBetsTable.payoutAmount,
      auditRoundId: tableRoundBetsTable.auditRoundId,
      createdAt: tableRoundBetsTable.createdAt,
      displayName: usersTable.displayName,
      email: usersTable.email,
    })
    .from(tableRoundBetsTable)
    .leftJoin(usersTable, eq(usersTable.id, tableRoundBetsTable.userId))
    .where(eq(tableRoundBetsTable.roundId, round.id))
    .orderBy(desc(tableRoundBetsTable.createdAt))
    .limit(100);

  const nameOf = (s: (typeof slips)[number]): string | null => {
    if (s.displayName) return s.displayName;
    if (!s.email) return null;
    const local = s.email.split("@")[0]!;
    return local.length > 12 ? local.slice(0, 10) + "…" : local;
  };

  // A player's receipt must not disappear behind the 100-row public feed.
  // Crazy Time accepts a single combined slip per user, so this stays small.
  const personalSlips = (gameCode === "coin-flip" || gameCode === "wheel-2-live" || gameCode === "crazy-time" || gameCode === "7up7down" || gameCode === "lucky-7-live") && userId
    ? await db.select({ id: tableRoundBetsTable.id, userId: tableRoundBetsTable.userId,
      totalStake: tableRoundBetsTable.totalStake, bets: tableRoundBetsTable.bets,
      status: tableRoundBetsTable.status, payoutAmount: tableRoundBetsTable.payoutAmount,
      auditRoundId: tableRoundBetsTable.auditRoundId }).from(tableRoundBetsTable)
      .where(and(eq(tableRoundBetsTable.roundId, round.id), eq(tableRoundBetsTable.userId, userId)))
    : slips;

  const recentRows = await db
    .select({
      id: tableRoundsTable.id,
      outcome: tableRoundsTable.outcome,
      settledAt: tableRoundsTable.settledAt,
    })
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.gameCode, gameCode),
        eq(tableRoundsTable.phase, "settled"),
      ),
    )
    .orderBy(desc(tableRoundsTable.createdAt))
    .limit(20);

  return {
    roundId: round.id,
    gameCode: round.gameCode,
    phase: round.phase,
    now: Date.now(),
    bettingEndsAt: round.bettingEndsAt.getTime(),
    revealEndsAt: round.revealEndsAt.getTime(),
    settleEndsAt: round.settleEndsAt.getTime(),
    serverSeedHash: round.serverSeedHash,
    clientSeed: round.clientSeed,
    nonce: round.nonce,
    outcome: revealed ? round.outcome : null,
    serverSeed: revealed ? round.serverSeed : null,
    totalStake: round.totalStake.toString(),
    playerCount: round.playerCount,
    config: roundCfg(round),
    liveBets: slips.map((s) => ({
      displayName: nameOf(s),
      totalStake: s.totalStake.toString(),
      bets: s.bets,
      createdAt: s.createdAt.toISOString(),
    })),
    myBets: userId
      ? personalSlips
          .filter((s) => s.userId === userId)
          .map((s) => ({
            slipId: s.id,
            totalStake: s.totalStake.toString(),
            bets: s.bets,
            status: s.status,
            payoutAmount: s.payoutAmount.toString(),
            auditRoundId: s.auditRoundId,
          }))
      : [],
    recent: recentRows.map((r) => ({
      roundId: r.id,
      outcome: r.outcome,
      settledAt: r.settledAt?.toISOString() ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Restart recovery
// ---------------------------------------------------------------------------

/**
 * Recover one in-flight round after a restart. Returns the round when the
 * engine should pick it back up (its own clock is still running), or null when
 * recovery has finished with it:
 *  - revealed, clock still running → resume on the original deadlines
 *  - revealed, clock expired → finish settlement idempotently
 *  - still betting (no outcome) → void the round and refund every slip
 */
export async function recoverTableRound(
  round: TableRound,
  now: number = Date.now(),
): Promise<TableRound | null> {
  if (round.outcome != null && round.phase !== "betting") {
    // Settling it here would publish an outcome the round is still holding
    // back (see `outcomeDiscloseAt`) and cut the presentation short, so a
    // round that has not run out its own clock goes back to the loop instead.
    if (round.settleEndsAt.getTime() > now) {
      logger.info(
        { roundId: round.id, gameCode: round.gameCode, phase: round.phase },
        "[table-rounds] resumed in-flight round on its original clock",
      );
      return round;
    }
    await settlePendingSlips(round);
    await advancePhase(round.id, round.phase, {
      phase: "settled",
      settledAt: new Date(),
    });
    logger.info(
      { roundId: round.id, gameCode: round.gameCode },
      "[table-rounds] recovered + settled expired round",
    );
    return null;
  }
  if (round.gameCode === "coin-flip") return voidCoinLiveRound(round.id);
  const slips = await db
    .select()
    .from(tableRoundBetsTable)
    .where(
      and(
        eq(tableRoundBetsTable.roundId, round.id),
        eq(tableRoundBetsTable.status, "pending"),
      ),
    );
  for (const slip of slips) await refundSlip(slip);
  await advancePhase(round.id, round.phase, {
    phase: "voided",
    settledAt: new Date(),
  });
  logger.info(
    { roundId: round.id, gameCode: round.gameCode, refunded: slips.length },
    "[table-rounds] voided interrupted round + refunded bets",
  );
  return null;
}

/**
 * Recover every in-flight round of a game after a restart. Returns the round
 * the engine should carry on running, if any.
 */
export async function recoverTableRounds(
  gameCode: TableGameCode,
): Promise<TableRound | null> {
  const rows = await db
    .select()
    .from(tableRoundsTable)
    .where(
      and(
        eq(tableRoundsTable.gameCode, gameCode),
        inArray(tableRoundsTable.phase, ["betting", "reveal", "settling"]),
      ),
    );
  let resume: TableRound | null = null;
  for (const round of rows) {
    try {
      const keep = await recoverTableRound(round);
      if (!keep) continue;
      if (!resume || keep.settleEndsAt > resume.settleEndsAt) resume = keep;
    } catch (err) {
      logger.error(
        { err, roundId: round.id, gameCode },
        "[table-rounds] recovery failed for round",
      );
    }
  }
  return resume;
}

// ---------------------------------------------------------------------------
// Scheduler loop
// ---------------------------------------------------------------------------

let engineStopped = false;

function sleepUntil(ts: number): Promise<void> {
  const ms = Math.max(0, ts - Date.now());
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as NodeJS.Timeout).unref?.();
  });
}

async function runGameLoop(gameCode: TableGameCode): Promise<void> {
  // A restart mid-round hands the round back: it keeps its original clock, so
  // an outcome it is still holding back stays hidden for the rest of its own
  // reveal window instead of being disclosed early by an instant settlement.
  let resumed = await recoverTableRounds(gameCode);
  while (!engineStopped) {
    try {
      const cfg = await requireGameConfig(gameCode);
      if (!cfg.enabled && !(gameCode === "coin-flip" && resumed)) {
        await sleepUntil(Date.now() + 5000);
        continue;
      }
      let round = resumed;
      resumed = null;
      if (!round) {
        round = await createTableRound(gameCode);
        await sleepUntil(round.bettingEndsAt.getTime());
        round = await revealTableRound(round);
      }
      // Hold the outcome back until the client needs it to finish its own
      // animation; a no-op for games that disclose at reveal start.
      await sleepUntil(outcomeDiscloseAt(round));
      discloseTableRoundOutcome(round);
      await sleepUntil(round.revealEndsAt.getTime());
      round = await settleTableRound(round);
      await sleepUntil(round.settleEndsAt.getTime());
      await finishTableRound(round);
      forgetDisclosedRound(round.id);
    } catch (err) {
      logger.error({ err, gameCode }, "[table-rounds] round loop error — backing off");
      await sleepUntil(Date.now() + 5000);
    }
  }
}

/** Start one continuous round loop per table game. Call once at boot. */
export function startTableRoundEngines(): void {
  engineStopped = false;
  for (const gameCode of TABLE_GAME_CODES) {
    void runGameLoop(gameCode).catch((err) =>
      logger.error({ err, gameCode }, "[table-rounds] game loop crashed"),
    );
  }
  logger.info("[table-rounds] round engines started for all table games");
}

/** Stop the loops (tests / graceful shutdown). Running phases finish. */
export function stopTableRoundEngines(): void {
  engineStopped = true;
}
