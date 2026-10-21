import { TEEN_PATTI_MAIN_RETURN, TEEN_PATTI_TIE_RETURN, TEEN_PATTI_PAIR_RETURNS } from "@workspace/api-zod/game-economics";
/**
 * Pure Teen Patti 20/20 math: hand evaluation, ranking comparison, and bet
 * settlement. No IO — fully deterministic given the shuffled single deck, so
 * the /verify endpoint can recompute everything from the seeds.
 *
 * Card encoding (shared with deriveDeckShuffle in rtp.ts): card is an integer
 * 0..51; rank = card % 13 with 0=A, 1=2, ... 9=10, 10=J, 11=Q, 12=K;
 * suit = floor(card / 13).
 *
 * Ranking (high → low): trail (trio) > pure sequence (straight flush) >
 * sequence (straight) > color (flush) > pair > high card.
 * Sequence order: A-K-Q highest, then A-2-3, then K-Q-J ... 4-3-2 lowest.
 *
 * Payout table (return per unit stake, hundredths — includes stake back):
 *   playerA / playerB win: 195 (0.95:1, ~2.5% edge; exact tie pushes)
 *   tie:                 87600 (875:1; P(exact tie) = 0.0011065 → RTP 96.9%)
 *   pairPlus (on that hand's category):
 *     pair 200 (1:1), color 500 (4:1), sequence 700 (6:1),
 *     pureSequence 3100 (30:1), trail 3600 (35:1)  → RTP 96.7%
 * Exact 3-card probabilities: trail .2353%, pure seq .2172%, seq 3.2579%,
 * color 4.9593%, pair 16.9412%, high card 74.3891%.
 */

export type TeenPattiBetType =
  | "playerA"
  | "playerB"
  | "tie"
  | "pairPlusA"
  | "pairPlusB";

export const TEEN_PATTI_BET_TYPES: readonly TeenPattiBetType[] = [
  "playerA",
  "playerB",
  "tie",
  "pairPlusA",
  "pairPlusB",
];

export type TeenPattiCategory =
  | "highCard"
  | "pair"
  | "color"
  | "sequence"
  | "pureSequence"
  | "trail";

/** Category strength for comparison (higher wins). */
const CATEGORY_RANK: Record<TeenPattiCategory, number> = {
  highCard: 0,
  pair: 1,
  color: 2,
  sequence: 3,
  pureSequence: 4,
  trail: 5,
};

/** Return per unit stake in hundredths (includes returned stake). */
export const TEEN_PATTI_RETURN_HUNDREDTHS = {
  main: 195n, // playerA / playerB win
  tie: 87600n, // tie bet win (875:1)
  pairPlus: {
    pair: 200n,
    color: 500n,
    sequence: 700n,
    pureSequence: 3100n,
    trail: 3600n,
  } as Record<Exclude<TeenPattiCategory, "highCard">, bigint>,
} as const;

export interface TeenPattiBetInput {
  type: TeenPattiBetType;
  amountPaise: bigint;
}

export interface SettledTeenPattiBet {
  payoutVersion?: number;
  type: TeenPattiBetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
  /** True when a playerA/playerB bet pushed on an exact tie (stake returned). */
  push?: boolean;
}

export interface TeenPattiHandEval {
  category: TeenPattiCategory;
  /**
   * Comparable strength: same number ⇔ exact tie. Category-major, then
   * tiebreak values packed base-16.
   */
  score: number;
}

export interface TeenPattiDeal {
  handACards: number[];
  handBCards: number[];
  handA: TeenPattiHandEval;
  handB: TeenPattiHandEval;
  winner: "playerA" | "playerB" | "tie";
}

export function cardRank(card: number): number {
  return (card % 52) % 13;
}

export function cardSuit(card: number): number {
  return Math.floor((card % 52) / 13);
}

/** Teen patti comparison value of a rank: A=14, 2=2 ... K=13. */
function rankValue(rank: number): number {
  return rank === 0 ? 14 : rank + 1;
}

/** Evaluate a 3-card teen patti hand into category + comparable score. */
export function evaluateHand(cards: number[]): TeenPattiHandEval {
  if (cards.length !== 3) throw new Error("INVALID_HAND");
  const vs = cards.map((c) => rankValue(cardRank(c))).sort((a, b) => b - a);
  const suits = cards.map(cardSuit);
  const flush = suits[0] === suits[1] && suits[1] === suits[2];
  const trips = vs[0] === vs[1] && vs[1] === vs[2];

  // Straight detection with teen patti ordering: A-K-Q (15) > A-2-3 (14) >
  // K-Q-J (13) > ... > 4-3-2 (4).
  let straightStrength = 0;
  if (!trips) {
    if (vs[0] === 14 && vs[1] === 13 && vs[2] === 12) straightStrength = 15;
    else if (vs[0] === 14 && vs[1] === 3 && vs[2] === 2) straightStrength = 14;
    else if (vs[0]! - 1 === vs[1] && vs[1]! - 1 === vs[2])
      straightStrength = vs[0]!;
  }
  const pair = !trips && (vs[0] === vs[1] || vs[1] === vs[2]);

  let category: TeenPattiCategory;
  let tiebreak: number[];
  if (trips) {
    category = "trail";
    tiebreak = [vs[0]!];
  } else if (straightStrength && flush) {
    category = "pureSequence";
    tiebreak = [straightStrength];
  } else if (straightStrength) {
    category = "sequence";
    tiebreak = [straightStrength];
  } else if (flush) {
    category = "color";
    tiebreak = vs as number[];
  } else if (pair) {
    const p = vs[0] === vs[1] ? vs[0]! : vs[1]!;
    const kicker = vs[0] === vs[1] ? vs[2]! : vs[0]!;
    category = "pair";
    tiebreak = [p, kicker];
  } else {
    category = "highCard";
    tiebreak = vs as number[];
  }
  const score =
    CATEGORY_RANK[category] * 16 ** 4 +
    tiebreak.reduce((acc, v) => acc * 16 + v, 0);
  return { category, score };
}

/** Positive if a beats b, negative if b beats a, 0 on exact tie. */
export function compareHands(a: number[], b: number[]): number {
  return evaluateHand(a).score - evaluateHand(b).score;
}

/**
 * Deal one Teen Patti 20/20 round from the top of a shuffled single deck.
 * Cards alternate A,B,A,B,A,B (traditional deal), deck positions 0..5.
 */
export function dealTeenPatti(deck: number[]): TeenPattiDeal {
  if (deck.length < 6) throw new Error("DECK_TOO_SMALL");
  const handACards = [deck[0]!, deck[2]!, deck[4]!];
  const handBCards = [deck[1]!, deck[3]!, deck[5]!];
  const handA = evaluateHand(handACards);
  const handB = evaluateHand(handBCards);
  const winner =
    handA.score > handB.score
      ? "playerA"
      : handB.score > handA.score
        ? "playerB"
        : "tie";
  return { handACards, handBCards, handA, handB, winner };
}

/** Return multiplier (total return per 1 staked) for display, e.g. config. */
export function teenPattiReturnMultiplier(
  type: TeenPattiBetType,
  category?: TeenPattiCategory,
  payoutVersion = 2,
): number {
  if (payoutVersion === 2) {
    if (type === "tie") return TEEN_PATTI_TIE_RETURN / 100;
    if (type === "playerA" || type === "playerB") return TEEN_PATTI_MAIN_RETURN / 100;
    return !category || category === "highCard" ? 0 : TEEN_PATTI_PAIR_RETURNS[category] / 100;
  }
  if (type === "tie") return Number(TEEN_PATTI_RETURN_HUNDREDTHS.tie) / 100;
  if (type === "playerA" || type === "playerB")
    return Number(TEEN_PATTI_RETURN_HUNDREDTHS.main) / 100;
  if (!category || category === "highCard") return 0;
  return Number(TEEN_PATTI_RETURN_HUNDREDTHS.pairPlus[category]) / 100;
}

export interface TeenPattiSettleResult {
  settled: SettledTeenPattiBet[];
  totalStake: bigint;
  totalPayout: bigint;
}

/** Quote exactly the same hundredths and cap that settlement uses. */
export function teenPattiPayouts(maxMultiplier: number, payoutVersion = 2) {
  const cap = Math.max(1, Math.floor(maxMultiplier * 100)) / 100;
  const quote = (type: TeenPattiBetType, category?: TeenPattiCategory) =>
    Math.min(cap, teenPattiReturnMultiplier(type, category, payoutVersion));
  return {
    playerA: quote("playerA"),
    playerB: quote("playerB"),
    tie: quote("tie"),
    pairPlus: {
      pair: quote("pairPlusA", "pair"),
      color: quote("pairPlusA", "color"),
      sequence: quote("pairPlusA", "sequence"),
      pureSequence: quote("pairPlusA", "pureSequence"),
      trail: quote("pairPlusA", "trail"),
    },
  };
}

/**
 * Settle a list of bets against a deal. Cap: per-bet return multiplier is
 * clamped to `maxMultiplier` (hundredths-exact), mirroring baccarat.
 */
export function settleTeenPattiBets(
  bets: TeenPattiBetInput[],
  deal: TeenPattiDeal,
  maxMultiplier: number,
  payoutVersion = 1,
): TeenPattiSettleResult {
  const capHundredths = BigInt(Math.max(1, Math.floor(maxMultiplier * 100)));
  const settled: SettledTeenPattiBet[] = [];
  let totalStake = 0n;
  let totalPayout = 0n;
  for (const b of bets) {
    if (!TEEN_PATTI_BET_TYPES.includes(b.type)) {
      throw new Error("INVALID_TEEN_PATTI_BET");
    }
    if (typeof b.amountPaise !== "bigint" || b.amountPaise <= 0n) {
      throw new Error("INVALID_TEEN_PATTI_BET");
    }
    totalStake += b.amountPaise;

    let didWin = false;
    let push = false;
    let returnHundredths = 0n;
    switch (b.type) {
      case "playerA":
        didWin = deal.winner === "playerA";
        push = deal.winner === "tie";
        returnHundredths = payoutVersion === 2 ? BigInt(TEEN_PATTI_MAIN_RETURN) : TEEN_PATTI_RETURN_HUNDREDTHS.main;
        break;
      case "playerB":
        didWin = deal.winner === "playerB";
        push = deal.winner === "tie";
        returnHundredths = payoutVersion === 2 ? BigInt(TEEN_PATTI_MAIN_RETURN) : TEEN_PATTI_RETURN_HUNDREDTHS.main;
        break;
      case "tie":
        didWin = deal.winner === "tie";
        returnHundredths = payoutVersion === 2 ? BigInt(TEEN_PATTI_TIE_RETURN) : TEEN_PATTI_RETURN_HUNDREDTHS.tie;
        break;
      case "pairPlusA":
      case "pairPlusB": {
        const cat =
          b.type === "pairPlusA" ? deal.handA.category : deal.handB.category;
        if (cat !== "highCard") {
          didWin = true;
          returnHundredths = payoutVersion === 2 ? BigInt(TEEN_PATTI_PAIR_RETURNS[cat]) : TEEN_PATTI_RETURN_HUNDREDTHS.pairPlus[cat];
        }
        break;
      }
    }

    let payout = 0n;
    if (didWin) {
      const hundredths =
        returnHundredths < capHundredths ? returnHundredths : capHundredths;
      payout = (b.amountPaise * hundredths) / 100n;
    } else if (push) {
      payout = b.amountPaise;
    }
    totalPayout += payout;
    settled.push({
      payoutVersion,
      type: b.type,
      amountPaise: b.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin,
      ...(push ? { push: true } : {}),
    });
  }
  return { settled, totalStake, totalPayout };
}
