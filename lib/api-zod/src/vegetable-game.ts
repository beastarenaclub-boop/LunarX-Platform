/** Fixed total returns, including the original stake. */
export const VEGETABLE_MODES = [
  {
    id: "normal",
    label: "Normal",
    hint: "Less than 7",
    range: "1–6 vegetables",
    multiplier: 1.87,
    returnHundredths: 187,
    tickets: 1000,
  },
  {
    id: "hard",
    label: "Hard",
    hint: "More than 7",
    range: "8–12 vegetables",
    multiplier: 1.87,
    returnHundredths: 187,
    tickets: 1000,
  },
  {
    id: "risk",
    label: "Risk",
    hint: "Exactly 7",
    range: "7 vegetables",
    multiplier: 18.96,
    returnHundredths: 1896,
    tickets: 99,
  },
] as const;
export type VegetableMode = (typeof VEGETABLE_MODES)[number]["id"];
export type VegetableOutcomeVersion = 1 | 2;
export const VEGETABLE_OUTCOME_VERSION = 2;
/** A fixed, bet-independent draw: one in twenty rounds contains only junk. */
export const VEGETABLE_JUNK_ONE_IN = 20;
export const VEGETABLE_JUNK_CHANCE = 1 / VEGETABLE_JUNK_ONE_IN;
export const VEGETABLE_TICKETS = 2099;
export const VEGETABLE_LEGACY_RTP = 1980 / VEGETABLE_TICKETS;
export const VEGETABLE_RTP = 0.85; // Target; per-spot cent rounding yields 84.64%–84.95%.
export const VEGETABLE_JUNK_KINDS = ["stone", "boot", "can"] as const;
export type VegetableJunkKind = (typeof VEGETABLE_JUNK_KINDS)[number];
export const VEGETABLE_KINDS = [
  "carrot",
  "tomato",
  "aubergine",
  "broccoli",
  "pepper",
] as const;
export type VegetableKind = (typeof VEGETABLE_KINDS)[number];
export interface VegetableOutcome {
  total: number;
  winner: VegetableMode | "junk";
  vegetables: VegetableKind[];
  /** Present on junk-only rounds; these objects never count as vegetables. */
  junk?: VegetableJunkKind[];
}
export function vegetableWinner(total: number): VegetableOutcome["winner"] {
  if (!Number.isInteger(total) || total < 0 || total > 12)
    throw new Error("INVALID_VEGETABLE_COUNT");
  if (total === 0) return "junk";
  return total < 7 ? "normal" : total > 7 ? "hard" : "risk";
}
