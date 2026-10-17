/**
 * Pure blackjack math — no DB, no side effects. Deterministic replay of a
 * whole round from a provably-fair shoe + ordered action log so the verify
 * endpoint (and tests) can recompute cards, dealer play, and payouts.
 *
 * Rules (fixed):
 *   - 6-deck shoe, freshly shuffled per round from the seed tuple.
 *   - Dealer stands on ALL 17s (S17, including soft 17).
 *   - Blackjack (natural, first two cards of a non-split hand) pays 3:2.
 *   - Win pays 1:1, push refunds, insurance pays 2:1 (costs half the stake).
 *   - Double down on any first two cards, including after a split.
 *   - One split max; split aces get exactly one card each and auto-stand.
 *   - Dealer peeks for blackjack on an ace or ten-value upcard (US style);
 *     with an ace up, the peek happens after the insurance decision.
 */

/** Card id within the shoe → canonical rank 0..12 (0=A, 12=K). */
export function cardRank(card: number): number {
  return (card % 52) % 13;
}

/** Blackjack point value of a card (ace counts as 1 here; soft-ace logic in handValue). */
export function cardPoints(card: number): number {
  const r = cardRank(card);
  if (r === 0) return 1;
  if (r >= 9) return 10; // 10, J, Q, K
  return r + 1;
}

export interface HandValue {
  /** Best total ≤ 21 when possible, otherwise the minimum (busted) total. */
  total: number;
  /** True when an ace is currently counted as 11. */
  soft: boolean;
  busted: boolean;
}

export function handValue(cards: number[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardPoints(c);
    if (cardRank(c) === 0) aces += 1;
  }
  let soft = false;
  if (aces > 0 && total + 10 <= 21) {
    total += 10;
    soft = true;
  }
  return { total, soft, busted: total > 21 };
}

export function isBlackjack(cards: number[]): boolean {
  return cards.length === 2 && handValue(cards).total === 21;
}

export function isTenValue(card: number): boolean {
  return cardRank(card) >= 9;
}

export function isAce(card: number): boolean {
  return cardRank(card) === 0;
}

export interface BlackjackHand {
  cards: number[];
  stood: boolean;
  doubled: boolean;
  busted: boolean;
  fromSplit: boolean;
}

export type HandOutcome = "blackjack" | "win" | "push" | "lose";

export interface HandResult {
  outcome: HandOutcome;
  /** Total staked on this hand (base + double), paise as string. */
  stakePaise: string;
  /** Total returned (stake incl.) for this hand, paise as string. */
  payoutPaise: string;
}

export interface RoundResults {
  hands: HandResult[];
  dealerBlackjack: boolean;
  insurance: {
    taken: boolean;
    won: boolean;
    stakePaise: string;
    payoutPaise: string;
  } | null;
}

/** Dealer draws to 17+, standing on all 17s (S17). Mutates nothing. */
export function dealerPlay(
  holeAndUp: number[],
  draw: () => number,
): number[] {
  const cards = [...holeAndUp];
  while (handValue(cards).total < 17) {
    cards.push(draw());
  }
  return cards;
}

/** Outcome of one player hand vs the final dealer hand. */
export function handOutcome(
  hand: BlackjackHand,
  dealerCards: number[],
  dealerBlackjack: boolean,
): HandOutcome {
  const pv = handValue(hand.cards);
  const natural = !hand.fromSplit && !hand.doubled && isBlackjack(hand.cards);
  if (pv.busted) return "lose";
  if (dealerBlackjack) return natural ? "push" : "lose";
  if (natural) return "blackjack";
  const dv = handValue(dealerCards);
  if (dv.busted) return "win";
  if (pv.total > dv.total) return "win";
  if (pv.total < dv.total) return "lose";
  // Equal totals: a dealer 21 vs player 21 pushes (dealer natural handled above).
  return "push";
}

/** Total return (stake included) for a hand, exact bigint paise. */
export function handReturn(outcome: HandOutcome, stake: bigint, payoutVersion = 1): bigint {
  if (payoutVersion === 2) return handReturn(outcome, stake, 1) * 85n / 100n;
  switch (outcome) {
    case "blackjack":
      return (stake * 5n) / 2n; // 3:2 → return 2.5×
    case "win":
      return stake * 2n;
    case "push":
      return stake;
    case "lose":
      return 0n;
  }
}

export function insuranceStake(baseStake: bigint): bigint {
  return (baseStake + 1n) / 2n; // half, rounded up to a whole paise
}

/**
 * Compute final results for a finished round (dealer already played).
 * Doubled hands stake 2× base; returns are exact bigints.
 */
export function settleRound(args: {
  hands: BlackjackHand[];
  dealerCards: number[];
  dealerBlackjack: boolean;
  baseStake: bigint;
  insuranceTaken: boolean;
  payoutVersion?: number;
}): { results: RoundResults; totalStake: bigint; totalPayout: bigint } {
  const { hands, dealerCards, dealerBlackjack, baseStake } = args;
  let totalStake = 0n;
  let totalPayout = 0n;
  const handResults: HandResult[] = hands.map((h) => {
    const stake = h.doubled ? baseStake * 2n : baseStake;
    const outcome = handOutcome(h, dealerCards, dealerBlackjack);
    const ret = handReturn(outcome, stake, args.payoutVersion);
    totalStake += stake;
    totalPayout += ret;
    return {
      outcome,
      stakePaise: stake.toString(),
      payoutPaise: ret.toString(),
    };
  });
  let insurance: RoundResults["insurance"] = null;
  if (args.insuranceTaken) {
    const ins = insuranceStake(baseStake);
    const won = dealerBlackjack;
    const ret = won ? ins * 3n * (args.payoutVersion === 2 ? 85n : 100n) / 100n : 0n; // 2:1 → return 3×
    totalStake += ins;
    totalPayout += ret;
    insurance = {
      taken: true,
      won,
      stakePaise: ins.toString(),
      payoutPaise: ret.toString(),
    };
  }
  return {
    results: { hands: handResults, dealerBlackjack, insurance },
    totalStake,
    totalPayout,
  };
}

// ---------------------------------------------------------------------------
// Deterministic full-round replay from shoe + action log (verification).
// ---------------------------------------------------------------------------

export type BlackjackAction =
  | "deal"
  | "insurance:take"
  | "insurance:decline"
  | `hit:${number}`
  | `stand:${number}`
  | `double:${number}`
  | "split"
  | "dealer";

export interface ReplayedRound {
  hands: BlackjackHand[];
  dealerCards: number[];
  drawnCount: number;
  dealerBlackjack: boolean;
  insuranceTaken: boolean;
}

/**
 * Replay a round from the shuffled shoe and the ordered action log. Throws
 * on an impossible log (used only for verification of stored rounds).
 */
/**
 * Auto-stand every live hand for a timed-out round, dealing the deferred
 * second card to a one-card split hand first (mirroring replayRound's
 * activation semantics, so the persisted action log stays replayable).
 * Pure — returns fresh hands, the stand actions to append, and the new
 * drawn count.
 */
export function applyTimeoutStand(
  hands: BlackjackHand[],
  shoe: number[],
  drawnCount: number,
): { hands: BlackjackHand[]; actions: string[]; drawnCount: number } {
  const out = structuredClone(hands);
  const actions: string[] = [];
  let drawn = drawnCount;
  for (let i = 0; i < out.length; i++) {
    const h = out[i]!;
    if (h.cards.length === 1) {
      // Deferred split second card — dealt on activation, exactly like
      // replayRound does when the first action targets this hand.
      const c = shoe[drawn];
      if (c === undefined) throw new Error("SHOE_EXHAUSTED");
      h.cards.push(c);
      drawn += 1;
    }
    if (!h.stood && !h.busted) {
      h.stood = true;
      actions.push(`stand:${i}`);
    }
  }
  return { hands: out, actions, drawnCount: drawn };
}

export function replayRound(
  shoe: number[],
  actions: string[],
): ReplayedRound {
  let idx = 0;
  const draw = (): number => {
    const c = shoe[idx];
    if (c === undefined) throw new Error("SHOE_EXHAUSTED");
    idx += 1;
    return c;
  };
  if (actions[0] !== "deal") throw new Error("BAD_ACTION_LOG");
  const p1 = draw();
  const d1 = draw();
  const p2 = draw();
  const d2 = draw(); // hole card
  const hands: BlackjackHand[] = [
    { cards: [p1, p2], stood: false, doubled: false, busted: false, fromSplit: false },
  ];
  const dealerCards = [d1, d2];
  let insuranceTaken = false;
  let splitPendingSecondCard = false;
  for (const a of actions.slice(1)) {
    if (a === "insurance:take") {
      insuranceTaken = true;
      continue;
    }
    if (a === "insurance:decline") continue;
    if (a === "split") {
      const h0 = hands[0]!;
      const moved = h0.cards[1]!;
      h0.cards = [h0.cards[0]!];
      h0.fromSplit = true;
      hands.push({
        cards: [moved],
        stood: false,
        doubled: false,
        busted: false,
        fromSplit: true,
      });
      // First split hand gets its second card immediately.
      h0.cards.push(draw());
      splitPendingSecondCard = true;
      // Split aces: one card each, auto-stand both.
      if (isAce(h0.cards[0]!)) {
        h0.stood = true;
        hands[1]!.cards.push(draw());
        hands[1]!.stood = true;
        splitPendingSecondCard = false;
      }
      continue;
    }
    if (a === "dealer") {
      break;
    }
    const [verb, handStr] = a.split(":");
    const hi = Number(handStr);
    const hand = hands[hi];
    if (!hand) throw new Error("BAD_ACTION_LOG");
    // Second split hand draws its second card when it becomes active
    // (first hit/stand/double targeting hand 1).
    if (splitPendingSecondCard && hi === 1 && hand.cards.length === 1) {
      hand.cards.push(draw());
      splitPendingSecondCard = false;
    }
    if (verb === "hit") {
      hand.cards.push(draw());
      if (handValue(hand.cards).busted) hand.busted = true;
    } else if (verb === "stand") {
      hand.stood = true;
    } else if (verb === "double") {
      hand.doubled = true;
      hand.cards.push(draw());
      if (handValue(hand.cards).busted) hand.busted = true;
      hand.stood = true;
    } else {
      throw new Error("BAD_ACTION_LOG");
    }
  }
  // If hand 1 never became active before the dealer step (e.g. hand 0
  // busted after a non-ace split and hand 1 auto-completes), it still needs
  // its second card before dealer play.
  if (splitPendingSecondCard && hands[1] && hands[1].cards.length === 1) {
    hands[1].cards.push(draw());
  }
  const dealerBlackjack = isBlackjack(dealerCards);
  let finalDealer = dealerCards;
  if (actions.includes("dealer")) {
    const anyLive = hands.some((h) => !handValue(h.cards).busted);
    const allNaturalResolved =
      dealerBlackjack ||
      (!hands[0]!.fromSplit && isBlackjack(hands[0]!.cards) && hands.length === 1);
    if (anyLive && !allNaturalResolved) {
      finalDealer = dealerPlay(dealerCards, draw);
    }
  }
  return {
    hands,
    dealerCards: finalDealer,
    drawnCount: idx,
    dealerBlackjack,
    insuranceTaken,
  };
}
