// European single-zero wheel, clockwise pocket order.
export const EUROPEAN_WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const ROULETTE_SLICE_DEG = 360 / EUROPEAN_WHEEL_ORDER.length;

/**
 * The optimized supplied GLB maps texture-top (pocket zero) to local -X.
 * The camera's top pointer looks toward local -Z, so the model rotor needs
 * this fixed quarter-turn in addition to the logical wheel rotation.
 */
export const ROULETTE_MODEL_ZERO_OFFSET_DEG = -90;

export function wrapRouletteDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function rouletteWheelRotationForPocket(pocket: number): number | null {
  const index = EUROPEAN_WHEEL_ORDER.indexOf(
    pocket as (typeof EUROPEAN_WHEEL_ORDER)[number],
  );
  return index < 0
    ? null
    : wrapRouletteDegrees(-index * ROULETTE_SLICE_DEG);
}

export function roulettePocketAtWheelRotation(rotationDeg: number): number {
  const index =
    Math.round(
      wrapRouletteDegrees(-rotationDeg) / ROULETTE_SLICE_DEG,
    ) % EUROPEAN_WHEEL_ORDER.length;
  return EUROPEAN_WHEEL_ORDER[index];
}

export function rouletteModelRotorDegrees(wheelDeg: number): number {
  return wheelDeg + ROULETTE_MODEL_ZERO_OFFSET_DEG;
}

export const RED_NUMBERS: ReadonlySet<number> = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export function pocketColor(n: number): "green" | "red" | "black" {
  if (n === 0) return "green";
  return RED_NUMBERS.has(n) ? "red" : "black";
}

export function pocketColorHex(n: number): string {
  const c = pocketColor(n);
  return c === "green" ? "#0f9960" : c === "red" ? "#dc2626" : "#18181b";
}

/**
 * Shared visual language for the current winning pocket. Motion is disabled by
 * CSS for reduced-motion players, while the static outline remains visible.
 */
export const WINNING_RESULT_CLASS = "roulette-winning-result";

export type BetType =
  | "straight"
  | "split"
  | "street"
  | "corner"
  | "line"
  | "dozen"
  | "column"
  | "red"
  | "black"
  | "odd"
  | "even"
  | "high"
  | "low";

export interface PlacedBet {
  type: BetType;
  numbers?: number[];
  selection?: number;
  /** rupees on this spot */
  amount: number;
}

/** Stable identity key for a bet spot so chips stack. */
export function betKey(b: { type: BetType; numbers?: number[]; selection?: number }): string {
  if (b.numbers) return `${b.type}:${[...b.numbers].sort((x, y) => x - y).join("-")}`;
  if (b.selection !== undefined) return `${b.type}:${b.selection}`;
  return b.type;
}

export function betLabel(b: { type: BetType; numbers?: number[]; selection?: number }): string {
  switch (b.type) {
    case "straight":
      return `#${b.numbers?.[0]}`;
    case "split":
    case "street":
    case "corner":
    case "line":
      return `${b.type} ${b.numbers?.join("·")}`;
    case "dozen":
      return ["1st 12", "2nd 12", "3rd 12"][((b.selection ?? 1) - 1)] ?? "dozen";
    case "column":
      return `Col ${b.selection}`;
    default:
      return b.type.toUpperCase();
  }
}
