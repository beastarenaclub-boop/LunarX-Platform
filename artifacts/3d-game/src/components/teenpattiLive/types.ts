/**
 * Shared vocabulary for the live Teen Patti table.
 *
 * Deliberately three-free: the page, the flat fallback and the lazily loaded
 * 3D scene all import from here, so nothing in this module may ever reach for
 * the graphics library.
 */

export type TeenPattiSpot =
  | "pairPlusA"
  | "playerA"
  | "tie"
  | "playerB"
  | "pairPlusB";

/** Felt order, left to right as the seated player sees them. */
export const TEEN_PATTI_SPOTS: TeenPattiSpot[] = [
  "pairPlusA",
  "playerA",
  "tie",
  "playerB",
  "pairPlusB",
];

export type TeenPattiWinner = "playerA" | "playerB" | "tie";

export interface TeenPattiHandResult {
  category: string;
  score: number;
}

/** Outcome broadcast by the shared round clock at the reveal phase. */
export interface TeenPattiDeal {
  handACards: number[];
  handBCards: number[];
  handA: TeenPattiHandResult;
  handB: TeenPattiHandResult;
  winner: TeenPattiWinner;
}

export type SpotAmounts = Partial<Record<TeenPattiSpot, number>>;

export const CATEGORY_LABELS: Record<string, string> = {
  highCard: "High Card",
  pair: "Pair",
  color: "Color",
  sequence: "Sequence",
  pureSequence: "Pure Sequence",
  trail: "Trail",
};

/** Felt accent per spot, matching the painted betting circles in the model. */
export const SPOT_ACCENTS: Record<TeenPattiSpot, string> = {
  pairPlusA: "#f5c451",
  playerA: "#38bdf8",
  tie: "#f97316",
  playerB: "#f472b6",
  pairPlusB: "#f5c451",
};

/** Chip denominations the model ships meshes for, largest first. */
export const CHIP_DENOMINATIONS = [1000, 500, 250, 100, 50, 25, 10] as const;

/**
 * Break a rupee amount into the chips a dealer would actually stack for it,
 * capped so a huge bet doesn't build a skyscraper on the felt.
 */
export function chipStack(amount: number, max = 12): number[] {
  const out: number[] = [];
  let rest = Math.floor(amount);
  for (const d of CHIP_DENOMINATIONS) {
    while (rest >= d && out.length < max) {
      out.push(d);
      rest -= d;
    }
  }
  // Anything under the smallest chip still deserves one chip on the felt.
  if (out.length === 0 && amount > 0) out.push(10);
  return out;
}

/** The three cards of one hand, or an empty row before the deal. */
export function handCards(
  deal: TeenPattiDeal | null,
  hand: "A" | "B",
): number[] {
  if (!deal) return [];
  return hand === "A" ? deal.handACards : deal.handBCards;
}

export function winnerLabel(winner: TeenPattiWinner): string {
  return winner === "tie"
    ? "Tie"
    : winner === "playerA"
      ? "Player A wins"
      : "Player B wins";
}

export function categoryLabel(category: string | undefined): string {
  if (!category) return "";
  return CATEGORY_LABELS[category] ?? category;
}
