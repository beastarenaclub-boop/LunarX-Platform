/** Independent Joker 20-20 rules. Cards: A..K, then spades/hearts/diamonds/clubs. */
export const JOKER_GAME = "teen-patti-joker";
export const JOKER_VERSION = 1;
export const JOKER_TIMING = {
  bettingWindowMs: 20_000,
  revealDurationMs:49_000,
  settleDurationMs:17_000,
};
export const JOKER_SPOTS = [
  "playerA",
  "playerB",
  "even",
  "odd",
  "red",
  "black",
  "spades",
  "hearts",
  "diamonds",
  "clubs",
] as const;
export type JokerSpot = (typeof JOKER_SPOTS)[number];
export type JokerBet = { spot: JokerSpot; amountPaise: string };
/** Total returns, including the stake, in hundredths. */
export const JOKER_RETURNS: Record<JokerSpot, number> = {
  playerA: 198,
  playerB: 198,
  even: 210,
  odd: 179,
  red: 195,
  black: 195,
  spades: 375,
  hearts: 375,
  diamonds: 375,
  clubs: 375,
};
export const JOKER_LABELS: Record<JokerSpot, string> = {
  playerA: "Player A",
  playerB: "Player B",
  even: "Even",
  odd: "Odd",
  red: "Red",
  black: "Black",
  spades: "Spades",
  hearts: "Hearts",
  diamonds: "Diamonds",
  clubs: "Clubs",
};
export const JOKER_CATEGORIES = [
  "High Card",
  "Pair",
  "Color",
  "Sequence",
  "Trail",
  "Pure Sequence",
] as const;
export type JokerHand = {
  category: (typeof JOKER_CATEGORIES)[number];
  score: number;
  resolved: number[];
  wildIndices: number[];
};
export type JokerOutcome = {
  version: number;
  joker: number;
  handACards: number[];
  handBCards: number[];
  handA: JokerHand;
  handB: JokerHand;
  winner: "playerA" | "playerB" | "tie";
};
export type JokerHistory = {
  roundId: string;
  outcome: JokerOutcome | null;
  bets: JokerBet[];
  totalStake: string;
  payoutAmount: string;
  status: string;
  createdAt: string;
};
export const jokerRank = (card: number) => (card % 13) + 1;
export const jokerSuit = (card: number) => Math.floor(card / 13);
export const jokerCardLabel = (card: number) =>
  `${["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"][card % 13]}${["♠", "♥", "♦", "♣"][jokerSuit(card)]}`;
const validCard = (card: number) =>
  Number.isInteger(card) && card >= 0 && card < 52;

function naturalHand(cards: number[]) {
  const ranks = cards
    .map((c) => (jokerRank(c) === 1 ? 14 : jokerRank(c)))
    .sort((a, b) => b - a);
  const [a, b, c] = ranks;
  const flush = cards.every((v) => jokerSuit(v) === jokerSuit(cards[0]));
  const trail = a === b && b === c;
  // A-K-Q, A-2-3, K-Q-J ... 4-3-2, as shown in the reference rules.
  const straight =
    a === 14 && b === 13 && c === 12
      ? 15
      : a === 14 && b === 3 && c === 2
        ? 14
        : a === b + 1 && b === c + 1
          ? a
          : 0;
  const pair = a === b || b === c;
  const strength =
    flush && straight ? 5 : trail ? 4 : straight ? 3 : flush ? 2 : pair ? 1 : 0;
  const values =
    straight && (strength === 5 || strength === 3)
      ? [straight, 0, 0]
      : trail
        ? [a, 0, 0]
        : strength === 1
          ? [a === b ? a : b, a === b ? c : a, 0]
          : ranks;
  return {
    category: JOKER_CATEGORIES[strength],
    score: strength * 4096 + values[0] * 256 + values[1] * 16 + values[2],
  };
}

/** Exhaustively find the best legal substitution; suits never break a tie. */
export function evaluateJokerHand(cards: number[], joker: number): JokerHand {
  if (
    !validCard(joker) ||
    cards.length !== 3 ||
    cards.some((c) => !validCard(c)) ||
    new Set(cards).size !== 3 ||
    cards.includes(joker)
  )
    throw new Error("Invalid Joker hand.");
  const wildIndices = cards.flatMap((c, i) =>
    jokerRank(c) === jokerRank(joker) ? [i] : [],
  );
  const working = [...cards],
    fixed = cards.filter((_, i) => !wildIndices.includes(i));
  let best = { ...naturalHand(cards), resolved: [...cards], wildIndices };
  const visit = (depth: number, start: number) => {
    if (depth === wildIndices.length) {
      const hand = naturalHand(working);
      if (hand.score > best.score)
        best = { ...hand, resolved: [...working], wildIndices };
      return;
    }
    // Wild cards are interchangeable. Combinations avoid redundant permutations.
    for (let c = start; c < 52; c++) {
      if (fixed.includes(c)) continue;
      working[wildIndices[depth]] = c;
      visit(depth + 1, c + 1);
    }
  };
  if (wildIndices.length) visit(0, 0);
  return best;
}

export function dealJoker(deck: number[]): JokerOutcome {
  const dealt = deck.slice(0, 7);
  if (
    dealt.length !== 7 ||
    dealt.some((c) => !validCard(c)) ||
    new Set(dealt).size !== 7
  )
    throw new Error("Seven unique cards are required.");
  const [joker] = dealt,
    handACards = [dealt[1], dealt[3], dealt[5]],
    handBCards = [dealt[2], dealt[4], dealt[6]];
  const handA = evaluateJokerHand(handACards, joker),
    handB = evaluateJokerHand(handBCards, joker);
  return {
    version: JOKER_VERSION,
    joker,
    handACards,
    handBCards,
    handA,
    handB,
    winner:
      handA.score > handB.score
        ? "playerA"
        : handA.score < handB.score
          ? "playerB"
          : "tie",
  };
}

export function validJokerOutcome(o: JokerOutcome): boolean {
  if (
    !o ||
    o.version !== JOKER_VERSION ||
    !Array.isArray(o.handACards) ||
    !Array.isArray(o.handBCards) ||
    o.handACards.length !== 3 ||
    o.handBCards.length !== 3
  )
    return false;
  try {
    const d = dealJoker([
      o.joker,
      o.handACards[0],
      o.handBCards[0],
      o.handACards[1],
      o.handBCards[1],
      o.handACards[2],
      o.handBCards[2],
    ]);
    // PostgreSQL jsonb reorders object keys; compare values, not serialization.
    const sameHand = (a: JokerHand, b: JokerHand) =>
      a.category === b.category &&
      a.score === b.score &&
      Array.isArray(b.resolved) &&
      a.resolved.length === b.resolved.length &&
      a.resolved.every((c, i) => c === b.resolved[i]) &&
      Array.isArray(b.wildIndices) &&
      a.wildIndices.length === b.wildIndices.length &&
      a.wildIndices.every((n, i) => n === b.wildIndices[i]);
    return (
      d.winner === o.winner &&
      sameHand(d.handA, o.handA) &&
      sameHand(d.handB, o.handB)
    );
  } catch {
    return false;
  }
}
export function normalizeJokerBets(raw: JokerBet[]): JokerBet[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > JOKER_SPOTS.length)
    throw new Error("Choose between one and ten markets.");
  const seen = new Set<string>();
  for (const b of raw) {
    if (!b || !JOKER_SPOTS.includes(b.spot) || seen.has(b.spot))
      throw new Error("Invalid or duplicate market.");
    if (
      typeof b.amountPaise !== "string" ||
      !/^[1-9]\d{0,14}$/.test(b.amountPaise)
    )
      throw new Error("Invalid stake.");
    seen.add(b.spot);
  }
  return raw
    .map((b) => ({ spot: b.spot, amountPaise: b.amountPaise }))
    .sort((a, b) => JOKER_SPOTS.indexOf(a.spot) - JOKER_SPOTS.indexOf(b.spot));
}
export const jokerStake = (bets: JokerBet[]) =>
  bets.reduce((sum, b) => sum + BigInt(b.amountPaise), 0n);
export function jokerWinningSpots(o: JokerOutcome): JokerSpot[] {
  const suit = jokerSuit(o.joker);
  return [
    ...(o.winner === "tie" ? [] : [o.winner]),
    jokerRank(o.joker) % 2 === 0 ? "even" : "odd",
    suit === 1 || suit === 2 ? "red" : "black",
    (["spades", "hearts", "diamonds", "clubs"] as const)[suit],
  ] as JokerSpot[];
}
export function jokerPayout(
  bets: JokerBet[],
  outcome: JokerOutcome,
  version = JOKER_VERSION,
): bigint {
  if (version !== JOKER_VERSION || !validJokerOutcome(outcome))
    throw new Error("Invalid Joker outcome or paytable version.");
  const winning = jokerWinningSpots(outcome);
  return normalizeJokerBets(bets).reduce(
    (sum, b) =>
      sum +
      (outcome.winner === "tie" &&
      (b.spot === "playerA" || b.spot === "playerB")
        ? BigInt(b.amountPaise)
        : winning.includes(b.spot)
          ? (BigInt(b.amountPaise) * BigInt(JOKER_RETURNS[b.spot])) / 100n
          : 0n),
    0n,
  );
}
