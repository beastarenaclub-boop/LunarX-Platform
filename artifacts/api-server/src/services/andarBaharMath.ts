import { ANDAR_FIRST_RETURN, ANDAR_SECOND_RETURN, ANDAR_RANGE_RETURNS } from "@workspace/api-zod/game-economics";
/**
 * Pure Andar Bahar math: joker + alternate dealing simulation and settlement.
 * No IO — fully deterministic given the shuffled deck, so the /verify
 * endpoint can recompute everything from the seeds.
 *
 * Card encoding (shared with deriveDeckShuffle in rtp.ts): a card is an
 * integer 0..51; rank = card % 13 with 0=A .. 12=K, suit = floor(card / 13)
 * (0=♠ 1=♥ 2=♦ 3=♣ per client rendering).
 *
 * Rules implemented (classic single-deck Andar Bahar):
 *   - Deck of 52 shuffled; first card is the joker (game card).
 *   - Dealing starts on ANDAR when the joker is black (♠/♣), BAHAR when red
 *     (♥/♦), then alternates until a card of the joker's rank appears.
 *   - The side receiving the matching card wins.
 *
 * Payouts (total-return hundredths so bigint paise math stays exact):
 *   - Winning bet on the STARTING side (first to receive a card) pays 0.9:1
 *     → 190. Starting side wins with p ≈ 0.5150, so house edge ≈ 2.15%.
 *   - Winning bet on the OTHER side pays 1:1 → 200. Other side wins with
 *     p ≈ 0.4850, so house edge ≈ 3.00%.
 *   - Match-position side bets: bet that the total number of cards dealt
 *     after the joker (including the matching card) lands in a range.
 *     Standard live-casino paytable, edges ~2–8%:
 *       1–5: 2.5:1   6–10: 3.5:1   11–15: 4.5:1   16–25: 3.5:1
 *       26–30: 14:1  31–35: 25:1   36–40: 50:1    41–49: 120:1
 */

export type AndarBaharMainBet = "andar" | "bahar";

export type AndarBaharRangeBet =
  | "range1_5"
  | "range6_10"
  | "range11_15"
  | "range16_25"
  | "range26_30"
  | "range31_35"
  | "range36_40"
  | "range41_49";

export type AndarBaharBetType = AndarBaharMainBet | AndarBaharRangeBet;

export const ANDAR_BAHAR_BET_TYPES: readonly AndarBaharBetType[] = [
  "andar",
  "bahar",
  "range1_5",
  "range6_10",
  "range11_15",
  "range16_25",
  "range26_30",
  "range31_35",
  "range36_40",
  "range41_49",
];

/** [min, max] of total cards dealt (after the joker) covered by each range bet. */
export const RANGE_BOUNDS: Record<AndarBaharRangeBet, [number, number]> = {
  range1_5: [1, 5],
  range6_10: [6, 10],
  range11_15: [11, 15],
  range16_25: [16, 25],
  range26_30: [26, 30],
  range31_35: [31, 35],
  range36_40: [36, 40],
  range41_49: [41, 49],
};

/**
 * Total-return multipliers in hundredths. Main bets depend on whether the
 * bet side is the starting side — resolved at settlement time, so only the
 * range bets are listed here.
 */
const RANGE_RETURN_HUNDREDTHS: Record<AndarBaharRangeBet, bigint> = {
  range1_5: 350n, // 2.5:1
  range6_10: 450n, // 3.5:1
  range11_15: 550n, // 4.5:1
  range16_25: 450n, // 3.5:1
  range26_30: 1500n, // 14:1
  range31_35: 2600n, // 25:1
  range36_40: 5100n, // 50:1
  range41_49: 12100n, // 120:1
};

/** Total-return hundredths for main bets, keyed by whether bet side started. */
export const FIRST_SIDE_RETURN_HUNDREDTHS = 190n; // 0.9:1
export const SECOND_SIDE_RETURN_HUNDREDTHS = 200n; // 1:1

export function andarBaharReturnMultiplier(
  type: AndarBaharBetType,
  opts?: { isFirstSide?: boolean },
  payoutVersion = 2,
): number {
  if (payoutVersion === 2) return (type === "andar" || type === "bahar" ? (opts?.isFirstSide ? ANDAR_FIRST_RETURN : ANDAR_SECOND_RETURN) : ANDAR_RANGE_RETURNS[type]) / 100;
  if (type === "andar" || type === "bahar") {
    return opts?.isFirstSide
      ? Number(FIRST_SIDE_RETURN_HUNDREDTHS) / 100
      : Number(SECOND_SIDE_RETURN_HUNDREDTHS) / 100;
  }
  return Number(RANGE_RETURN_HUNDREDTHS[type]) / 100;
}

export function cardRank(card: number): number {
  return (card % 52) % 13;
}

export function cardSuit(card: number): number {
  return Math.floor((card % 52) / 13);
}

/** Suits 0=♠ and 3=♣ are black; 1=♥ and 2=♦ are red (client convention). */
export function cardIsBlack(card: number): boolean {
  const s = cardSuit(card);
  return s === 0 || s === 3;
}

export interface AndarBaharDeal {
  joker: number;
  /** Cards dealt to each side, in deal order. */
  andarCards: number[];
  baharCards: number[];
  /** Side that received the first post-joker card (pays 0.9:1). */
  firstSide: AndarBaharMainBet;
  /** Side that received the matching card. */
  winner: AndarBaharMainBet;
  /** Total cards dealt after the joker, including the matching card (1..49). */
  cardsDealt: number;
}

/**
 * Deal one Andar Bahar round from the top of a shuffled 52-card deck.
 * Deterministic; throws NO_MATCH_IN_DECK only if the deck is not a full
 * permutation (impossible for deriveDeckShuffle output — a rank has 3 more
 * cards after the joker, so a match always occurs by position 49).
 */
export function dealAndarBahar(deck: number[]): AndarBaharDeal {
  if (deck.length < 52) throw new Error("DECK_TOO_SMALL");
  const joker = deck[0]!;
  const jokerRank = cardRank(joker);
  const firstSide: AndarBaharMainBet = cardIsBlack(joker) ? "andar" : "bahar";
  const andarCards: number[] = [];
  const baharCards: number[] = [];
  for (let i = 1; i < deck.length; i++) {
    const card = deck[i]!;
    const toAndar =
      firstSide === "andar" ? (i - 1) % 2 === 0 : (i - 1) % 2 === 1;
    if (toAndar) andarCards.push(card);
    else baharCards.push(card);
    if (cardRank(card) === jokerRank) {
      return {
        joker,
        andarCards,
        baharCards,
        firstSide,
        winner: toAndar ? "andar" : "bahar",
        cardsDealt: i,
      };
    }
  }
  throw new Error("NO_MATCH_IN_DECK");
}

export interface AndarBaharBetInput {
  type: AndarBaharBetType;
  amountPaise: bigint;
}

export interface SettledAndarBaharBet {
  payoutVersion?: number;
  type: AndarBaharBetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
}

export interface AndarBaharSettlement {
  settled: SettledAndarBaharBet[];
  totalStake: bigint;
  totalPayout: bigint;
}

/**
 * Settle a list of bets against a deal. Payouts are exact bigint paise:
 * floor(stake × returnHundredths / 100), additionally capped at
 * stake × maxMultiplier. Throws INVALID_ANDAR_BAHAR_BET on bad type/amount.
 */
export function settleAndarBaharBets(
  bets: AndarBaharBetInput[],
  deal: AndarBaharDeal,
  maxMultiplier: number,
  payoutVersion = 1,
): AndarBaharSettlement {
  const capHundredths = BigInt(Math.max(100, Math.floor(maxMultiplier * 100)));
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled: SettledAndarBaharBet[] = [];
  for (const b of bets) {
    if (!ANDAR_BAHAR_BET_TYPES.includes(b.type)) {
      throw new Error("INVALID_ANDAR_BAHAR_BET");
    }
    if (typeof b.amountPaise !== "bigint" || b.amountPaise <= 0n) {
      throw new Error("INVALID_ANDAR_BAHAR_BET");
    }
    totalStake += b.amountPaise;

    let didWin = false;
    let hundredths = 0n;
    if (b.type === "andar" || b.type === "bahar") {
      didWin = deal.winner === b.type;
      hundredths =
        deal.firstSide === b.type
          ? FIRST_SIDE_RETURN_HUNDREDTHS
          : SECOND_SIDE_RETURN_HUNDREDTHS;
    } else {
      const [lo, hi] = RANGE_BOUNDS[b.type];
      didWin = deal.cardsDealt >= lo && deal.cardsDealt <= hi;
      hundredths = RANGE_RETURN_HUNDREDTHS[b.type];
    }

    if (payoutVersion === 2 && didWin) hundredths = BigInt(Math.round(andarBaharReturnMultiplier(b.type, { isFirstSide: b.type === deal.firstSide }) * 100));
    let payout = 0n;
    if (didWin) {
      const capped = hundredths < capHundredths ? hundredths : capHundredths;
      payout = (b.amountPaise * capped) / 100n;
    }
    totalPayout += payout;
    settled.push({
      payoutVersion,
      type: b.type,
      amountPaise: b.amountPaise.toString(),
      payoutPaise: payout.toString(),
      didWin,
    });
  }
  return { settled, totalStake, totalPayout };
}
