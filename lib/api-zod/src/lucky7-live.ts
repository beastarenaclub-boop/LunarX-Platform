/** Card Lucky 7. Profit odds match the supplied reference; returns include stake. */
export const L7_GAME = "lucky-7-live";
export const L7_VERSION = 1;
export const L7_TIMING = {
  bettingWindowMs: 20_000,
  revealDurationMs: 3_000,
  settleDurationMs: 6_000,
};
export const L7_SPOTS = [
  "up",
  "seven",
  "down",
  "red",
  "black",
  "odd",
  "even",
] as const;
export type L7Spot = (typeof L7_SPOTS)[number];
export type L7Bet = { spot: L7Spot; amountPaise: string };
export type L7Card = {
  rank: number;
  suit: "hearts" | "diamonds" | "clubs" | "spades";
};
export const L7_SUITS = ["hearts", "diamonds", "clubs", "spades"] as const;
export const L7_LABELS: Record<L7Spot, string> = {
  up: "7 Up",
  seven: "Lucky 7",
  down: "7 Down",
  red: "Red",
  black: "Black",
  odd: "Odd",
  even: "Even",
};
export const L7_PROFIT: Record<L7Spot, string> = {
  up: "1:1",
  seven: "11:1",
  down: "1:1",
  red: "0.9:1",
  black: "0.9:1",
  odd: "0.8:1",
  even: "1:1",
};
const RETURNS: Record<L7Spot, bigint> = {
  up: 200n,
  seven: 1200n,
  down: 200n,
  red: 190n,
  black: 190n,
  odd: 180n,
  even: 200n,
};
export const rankLabel = (rank: number) =>
  ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[rank] ?? String(rank);
export const isRed = (card: L7Card) =>
  card.suit === "hearts" || card.suit === "diamonds";
export const mainSpot = (card: L7Card): L7Spot =>
  card.rank > 7 ? "up" : card.rank < 7 ? "down" : "seven";
export function validCard(card: L7Card): boolean {
  return (
    !!card &&
    Number.isInteger(card.rank) &&
    card.rank >= 1 &&
    card.rank <= 13 &&
    L7_SUITS.includes(card.suit)
  );
}
export function wins(spot: L7Spot, card: L7Card): boolean {
  if (!validCard(card)) throw new Error("Invalid card");
  switch (spot) {
    case "up":
      return card.rank > 7;
    case "down":
      return card.rank < 7;
    case "seven":
      return card.rank === 7;
    case "red":
      return isRed(card);
    case "black":
      return !isRed(card);
    case "odd":
      return card.rank % 2 === 1;
    case "even":
      return card.rank % 2 === 0;
    default:
      throw new Error("Invalid selection");
  }
}
export function normalizeL7Bets(raw: L7Bet[]): L7Bet[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 7)
    throw new Error("Select between one and seven bets.");
  const seen = new Set<string>();
  for (const bet of raw) {
    if (!bet || !L7_SPOTS.includes(bet.spot) || seen.has(bet.spot))
      throw new Error("Invalid or duplicate selection.");
    if (
      typeof bet.amountPaise !== "string" ||
      !/^[1-9]\d{0,14}$/.test(bet.amountPaise)
    )
      throw new Error("Invalid stake.");
    seen.add(bet.spot);
  }
  return raw
    .map((b) => ({ spot: b.spot, amountPaise: b.amountPaise }))
    .sort((a, b) => a.spot.localeCompare(b.spot));
}
export const l7Stake = (bets: L7Bet[]) =>
  bets.reduce((sum, b) => sum + BigInt(b.amountPaise), 0n);
export function l7Payout(
  bets: L7Bet[],
  card: L7Card,
  version = L7_VERSION,
): bigint {
  if (version !== 1) throw new Error("Unsupported Lucky 7 paytable version");
  if (!validCard(card)) throw new Error("Invalid card");
  return normalizeL7Bets(bets).reduce(
    (sum, b) =>
      sum +
      (wins(b.spot, card)
        ? (BigInt(b.amountPaise) * RETURNS[b.spot]) / 100n
        : 0n),
    0n,
  );
}
export type L7History = {
  roundId: string;
  card: L7Card | null;
  bets: L7Bet[];
  totalStake: string;
  payoutAmount: string;
  status: string;
  createdAt: string;
};
