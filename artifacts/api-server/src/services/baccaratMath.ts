import { BACCARAT_RETURNS } from "@workspace/api-zod/game-economics";
/**
 * Pure Punto Banco baccarat math: dealing (exact tableau third-card rules)
 * and settlement. No IO — fully deterministic given the shuffled shoe, so
 * the /verify endpoint can recompute everything from the seeds.
 *
 * Card encoding (shared with deriveDeckShuffle in rtp.ts): a shoe card is an
 * integer 0..(52*decks - 1); `card % 52` is the canonical card, rank =
 * (card % 52) % 13 with 0=A, 1=2, ... 8=9, 9=10, 10=J, 11=Q, 12=K.
 */

export type BaccaratBetType =
  | "player"
  | "banker"
  | "tie"
  | "playerPair"
  | "bankerPair";

export const BACCARAT_BET_TYPES: readonly BaccaratBetType[] = [
  "player",
  "banker",
  "tie",
  "playerPair",
  "bankerPair",
];

export interface BaccaratBetInput {
  type: BaccaratBetType;
  amountPaise: bigint;
}

export interface SettledBaccaratBet {
  payoutVersion?: number;
  type: BaccaratBetType;
  amountPaise: string;
  payoutPaise: string;
  didWin: boolean;
  /** True when a player/banker bet pushed on a tie (stake returned). */
  push?: boolean;
}

export interface BaccaratDeal {
  playerCards: number[];
  bankerCards: number[];
  playerTotal: number;
  bankerTotal: number;
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
  /** True when the first four cards produced an 8 or 9 natural. */
  natural: boolean;
}

export function cardRank(card: number): number {
  return (card % 52) % 13;
}

export function cardSuit(card: number): number {
  return Math.floor((card % 52) / 13);
}

/** Baccarat point value of a card: A=1, 2-9 pip, 10/J/Q/K = 0. */
export function baccaratCardValue(card: number): number {
  const r = cardRank(card);
  if (r === 0) return 1;
  if (r <= 8) return r + 1;
  return 0;
}

function handTotal(cards: number[]): number {
  return cards.reduce((s, c) => s + baccaratCardValue(c), 0) % 10;
}

/**
 * Deal one Punto Banco coup from the top of a shuffled shoe using the exact
 * standard tableau:
 *   - P1 B1 P2 B2 dealt in order (shoe positions 0..3).
 *   - Natural 8/9 on either side: no more cards.
 *   - Player draws a third card on 0-5, stands on 6-7.
 *   - If player stood, banker draws on 0-5, stands 6-7.
 *   - If player drew a third card of value v, banker draws per the tableau:
 *       banker 0-2: always draws
 *       banker 3: draws unless v == 8
 *       banker 4: draws if v in 2..7
 *       banker 5: draws if v in 4..7
 *       banker 6: draws if v in 6..7
 *       banker 7: stands
 */
export function dealBaccarat(shoe: number[]): BaccaratDeal {
  if (shoe.length < 6) throw new Error("SHOE_TOO_SMALL");
  let next = 0;
  const draw = () => shoe[next++]!;

  const playerCards = [draw()];
  const bankerCards = [draw()];
  playerCards.push(draw());
  bankerCards.push(draw());

  const playerPair = cardRank(playerCards[0]!) === cardRank(playerCards[1]!);
  const bankerPair = cardRank(bankerCards[0]!) === cardRank(bankerCards[1]!);

  let playerTotal = handTotal(playerCards);
  let bankerTotal = handTotal(bankerCards);
  const natural = playerTotal >= 8 || bankerTotal >= 8;

  if (!natural) {
    let playerThirdValue: number | null = null;
    if (playerTotal <= 5) {
      const c = draw();
      playerCards.push(c);
      playerThirdValue = baccaratCardValue(c);
      playerTotal = handTotal(playerCards);
    }
    let bankerDraws: boolean;
    if (playerThirdValue === null) {
      bankerDraws = bankerTotal <= 5;
    } else {
      const v = playerThirdValue;
      if (bankerTotal <= 2) bankerDraws = true;
      else if (bankerTotal === 3) bankerDraws = v !== 8;
      else if (bankerTotal === 4) bankerDraws = v >= 2 && v <= 7;
      else if (bankerTotal === 5) bankerDraws = v >= 4 && v <= 7;
      else if (bankerTotal === 6) bankerDraws = v >= 6 && v <= 7;
      else bankerDraws = false;
    }
    if (bankerDraws) {
      bankerCards.push(draw());
      bankerTotal = handTotal(bankerCards);
    }
  }

  const winner =
    playerTotal > bankerTotal
      ? "player"
      : bankerTotal > playerTotal
        ? "banker"
        : "tie";

  return {
    playerCards,
    bankerCards,
    playerTotal,
    bankerTotal,
    winner,
    playerPair,
    bankerPair,
    natural,
  };
}

/**
 * Classic total-return multipliers, expressed in hundredths so all payout
 * math stays exact in bigint paise:
 *   Player 1:1  → 200   Banker 0.95:1 (5% commission) → 195
 *   Tie 8:1     → 900   Pairs 11:1 → 1200
 * Player/Banker bets PUSH on a tie (stake returned, ×100).
 */
const RETURN_HUNDREDTHS: Record<BaccaratBetType, bigint> = {
  player: 200n,
  banker: 195n,
  tie: 900n,
  playerPair: 1200n,
  bankerPair: 1200n,
};

export function baccaratReturnMultiplier(type: BaccaratBetType, payoutVersion = 2): number {
  return Number(payoutVersion === 2 ? BACCARAT_RETURNS[type] : RETURN_HUNDREDTHS[type]) / 100;
}

export interface BaccaratSettlement {
  settled: SettledBaccaratBet[];
  totalStake: bigint;
  totalPayout: bigint;
}

/**
 * Settle a list of bets against a deal. Payouts are exact bigint paise:
 * floor(stake × returnHundredths / 100), additionally capped at
 * stake × maxMultiplier. Throws INVALID_BACCARAT_BET on bad type/amount.
 */
export function settleBaccaratBets(
  bets: BaccaratBetInput[],
  deal: BaccaratDeal,
  maxMultiplier: number,
  payoutVersion = 1,
): BaccaratSettlement {
  const capHundredths = BigInt(Math.max(100, Math.floor(maxMultiplier * 100)));
  let totalStake = 0n;
  let totalPayout = 0n;
  const settled: SettledBaccaratBet[] = [];
  for (const b of bets) {
    if (!BACCARAT_BET_TYPES.includes(b.type)) {
      throw new Error("INVALID_BACCARAT_BET");
    }
    if (typeof b.amountPaise !== "bigint" || b.amountPaise <= 0n) {
      throw new Error("INVALID_BACCARAT_BET");
    }
    totalStake += b.amountPaise;

    let didWin = false;
    let push = false;
    switch (b.type) {
      case "player":
        didWin = deal.winner === "player";
        push = deal.winner === "tie";
        break;
      case "banker":
        didWin = deal.winner === "banker";
        push = deal.winner === "tie";
        break;
      case "tie":
        didWin = deal.winner === "tie";
        break;
      case "playerPair":
        didWin = deal.playerPair;
        break;
      case "bankerPair":
        didWin = deal.bankerPair;
        break;
    }

    let payout = 0n;
    if (didWin) {
      const quoted = payoutVersion === 2 ? BigInt(BACCARAT_RETURNS[b.type]) : RETURN_HUNDREDTHS[b.type];
      const hundredths = quoted < capHundredths ? quoted : capHundredths;
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
