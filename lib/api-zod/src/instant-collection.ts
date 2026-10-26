export type InstantKind = "road" | "mines" | "tower" | "coin" | "dice" | "duel" | "fishing";
export const INSTANT_COLLECTION = [
  { code: "chicken-road-pirate", name: "Chicken Road Pirate Edition", short: "Pirate Road", kind: "road", accent: "#ffce72", theme: "pirate", tagline: "One brave bird. A sea of treasure." },
  { code: "pirate-jackpot-mines", name: "Pirate Jackpot Mines", short: "Pirate Mines", kind: "mines", accent: "#f5c36a", theme: "pirate", tagline: "Find the treasure. Mind the cannons." },
  { code: "7up7down", name: "7up7down", short: "7up7down", kind: "dice", accent: "#a59bff", theme: "dice", tagline: "Two dice. Three ways to play." },
  { code: "duck-duel", name: "Duck Duel", short: "Duck Duel", kind: "duel", accent: "#ffcc68", theme: "duel", tagline: "Pick your duck. Own the pond." },
  { code: "tower-rush", name: "Tower Rush", short: "Tower Rush", kind: "tower", accent: "#a997ff", theme: "tower", tagline: "Build your luck, floor by floor." },
  { code: "jackpot-fishing", name: "Jackpot Fishing", short: "Jackpot Fishing", kind: "fishing", accent: "#64e7da", theme: "ocean", tagline: "Cast a line into the extraordinary." },
  { code: "coin-flip", name: "Coin Flip", short: "Coin Flip", kind: "coin", accent: "#edca7a", theme: "coin", tagline: "One coin. Your call." },
] as const;
// Retained only for existing round receipts and cash-out recovery.
export type CollectionCode = typeof INSTANT_COLLECTION[number]["code"] | "chicken-road-2";
export type CollectionGame = typeof INSTANT_COLLECTION[number];
export const REQUESTED_INSTANT_CODES = ["jetx", "chicken-road-pirate", "pirate-jackpot-mines", "fury", "7up7down", "duck-duel", "tower-rush", "jackpot-fishing", "mines", "coin-flip"];
export const collectionGame = (code: string) => INSTANT_COLLECTION.find(g => g.code === code);
export const progressive = (kind: InstantKind) => ["road", "mines", "tower"].includes(kind);
export const SEVEN_SPOTS = ["down", "seven", "up", "2", "3", "4", "5", "6", "8", "9", "10", "11", "12"] as const;
export type SevenSpot = typeof SEVEN_SPOTS[number];
export type SevenBet = { spot: SevenSpot; amount: string };
export type CollectionOptions = { difficulty: "easy" | "medium" | "hard"; mines: number; choice: string; bets?: SevenBet[] };

export function sevenWins(spot: SevenSpot, total: number): boolean {
  return spot === "down" ? total < 7 : spot === "up" ? total > 7 : spot === "seven" ? total === 7 : Number(spot) === total;
}
/** Total returns, including stake, derived from the existing server-owned RTP. */
export function sevenMultiplier(spot: SevenSpot, rtp: number, cap = 1000): number {
  const ways = spot === "down" || spot === "up" ? 15 : spot === "seven" ? 6 : 6 - Math.abs(7 - Number(spot));
  return Math.min(cap, Math.floor((rtp * 36 / ways + 1e-10) * 100) / 100);
}
export function normalizeSevenBets(bets: SevenBet[], stake: bigint): SevenBet[] {
  if (!Array.isArray(bets) || !bets.length || bets.length > SEVEN_SPOTS.length) throw new Error("Choose at least one valid betting spot.");
  const seen = new Set<string>();
  let total = 0n;
  for (const bet of bets) {
    if (!SEVEN_SPOTS.includes(bet.spot) || seen.has(bet.spot) || !/^[1-9]\d{0,14}$/.test(bet.amount)) throw new Error("Invalid or duplicate dice bet.");
    seen.add(bet.spot);
    total += BigInt(bet.amount);
  }
  if (total !== stake) throw new Error("Bet total does not match the chip amounts.");
  return [...bets].sort((a, b) => SEVEN_SPOTS.indexOf(a.spot) - SEVEN_SPOTS.indexOf(b.spot));
}
export function sevenPayout(bets: SevenBet[], outcome: number[], rtp: number, cap = 1000): bigint {
  const total = outcome[0] + outcome[1];
  return bets.reduce((sum, bet) => sum + (sevenWins(bet.spot, total) ? collectionPayout(BigInt(bet.amount), sevenMultiplier(bet.spot, rtp, cap)) : 0n), 0n);
}
export interface CollectionRound {
  id: string; gameCode: CollectionCode; requestId: string; status: "active" | "won" | "lost" | "cashed_out";
  stakeAmount: string; payoutAmount: string; cashoutAmount: string; multiplier: number; step: number;
  options: CollectionOptions; revealed: number[]; hazards: number[] | null; outcome: number[];
  serverSeedHash: string; serverSeed: string | null; clientSeed: string; createdAt: string;
  rtp: number; maxMultiplier: number;
}
export interface CollectionState { round: CollectionRound | null; history: CollectionRound[] }
export interface CollectionConfig { enabled: boolean; minStakePaise: string; maxStakePaise: string; rtp: number; maxMultiplier: number }
export type CoinSide = "heads" | "tails";
export type CoinLiveBet = { side: CoinSide; amount: string };
export type CoinLiveInput = { roundId: string; side: CoinSide; stakeAmount: string };
export type CoinLiveOutcome = { side: CoinSide; value: 0 | 1 };
export interface CoinLiveReceipt extends CollectionRound { tableRoundId: string; slipStatus: string }
export const COIN_LIVE_TIMING = { bettingWindowMs: 15000, revealDurationMs: 10000, settleDurationMs: 5000 };
export function coinLiveMultiplier(rtp: number, cap: number) {
  return Math.min(cap, Math.floor((rtp * 2 + 1e-10) * 100) / 100);
}
export function normalizeCoinLiveBet(raw: unknown): CoinLiveBet {
  if (!Array.isArray(raw) || raw.length !== 1) throw new Error("Choose one side for this round.");
  const bet = raw[0] as CoinLiveBet;
  if (!bet || !["heads", "tails"].includes(bet.side) || typeof bet.amount !== "string" || !/^[1-9]\d{0,14}$/.test(bet.amount)) throw new Error("Invalid coin bet.");
  return { side: bet.side, amount: bet.amount };
}
export const roadSurvival = (difficulty: CollectionOptions["difficulty"]) => ({ easy: .85, medium: .7, hard: .55 })[difficulty];
export function collectionMultiplier(kind: InstantKind, step: number, options: CollectionOptions, rtp = .97, cap = 1000): number {
  if (!step) return 1;
  let chance = 1;
  if (kind === "mines") for (let n = 0; n < step; n++) chance *= (25 - options.mines - n) / (25 - n);
  else chance = Math.pow(kind === "tower" ? 2 / 3 : roadSurvival(options.difficulty), step);
  return Math.min(cap, Math.floor((rtp / chance + 1e-10) * 100) / 100);
}
export const collectionSteps = (kind: InstantKind, options: CollectionOptions) => kind === "mines" ? 25 - options.mines : kind === "tower" ? 10 : 12;
export function collectionPayout(stake: bigint, multiplier: number): bigint { return stake * BigInt(Math.round(multiplier * 100)) / 100n; }
