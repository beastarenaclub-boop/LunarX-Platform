export const SHOW_TIMING = {
  ballsStart: 0.06,
  ballsEnd: 0.7,
  doorStart: 0.72,
  spinStart: 0.75,
  spinEnd: 0.83,
  lights: 0.84,
  megaStart: 0.87,
} as const;

export type ShowStage =
  | "betting"
  | "mixing"
  | "drawing"
  | "draw-complete"
  | "multiplier-opening"
  | "multiplier-spinning"
  | "multiplier-selected"
  | "mega-draw"
  | "result";
export type ShowCamera = "wide" | "machine" | "chute" | "multiplier" | "mega";
export const REEL_VALUES = [5, 10, 15, 20, 25, 50, 100, 10, 5, 20, 15, 10];
const unit = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const x = unit(n);
  return x * x * (3 - 2 * x);
};

export function showFrame(progress: number, hasOutcome: boolean) {
  const p = unit(progress),
    t = SHOW_TIMING;
  const stage: ShowStage = !hasOutcome
    ? "betting"
    : p < t.ballsStart
      ? "mixing"
      : p < t.ballsEnd
        ? "drawing"
        : p < t.doorStart
          ? "draw-complete"
          : p < t.spinStart
            ? "multiplier-opening"
            : p < t.spinEnd
              ? "multiplier-spinning"
              : p < t.megaStart
                ? "multiplier-selected"
                : p < 1
                  ? "mega-draw"
                  : "result";
  const camera: ShowCamera =
    !hasOutcome || p < 0.27 || p >= 1
      ? "wide"
      : p < 0.62
        ? "machine"
        : p < t.doorStart
          ? "chute"
          : p < 0.86
            ? "multiplier"
            : p < 0.902
              ? "machine"
              : p < 0.974
                ? "mega"
                : "machine";
  return {
    stage,
    camera,
    reelOpen: hasOutcome
      ? unit((p - t.doorStart) / (t.spinStart - t.doorStart))
      : 0,
    reelSpin: hasOutcome
      ? unit((p - t.spinStart) / (t.spinEnd - t.spinStart))
      : 0,
    multiplierVisible: hasOutcome && p >= t.spinEnd,
    bonusLights: hasOutcome && p >= t.lights,
    resultVisible: hasOutcome && p >= 1,
  };
}

/** Bidirectional presentation only. The authoritative multiplier sets the stop. */
export function multiplierReelPosition(spin: number, multiplier: number) {
  const q = unit(spin);
  const stop =
    REEL_VALUES.length * 3 + Math.max(0, REEL_VALUES.indexOf(multiplier));
  if (q < 0.28) return 18 * smooth(q / 0.28);
  if (q < 0.5) return 18 - 26 * smooth((q - 0.28) / 0.22);
  const settle = unit((q - 0.5) / 0.5);
  return -8 + (stop + 8) * (1 - (1 - settle) ** 3);
}
