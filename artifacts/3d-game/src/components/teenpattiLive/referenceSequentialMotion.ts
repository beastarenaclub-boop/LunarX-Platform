export const OPENING_START = 18.3;
export const OPENING_LENGTH = 11;
export const TURN_ORDER = [0, 3, 1, 4, 2, 5] as const;
// Show each card as the real hand places it back onto its printed slot.
export const CARD_CUES = [0.8, 2.7, 4.7, 6.7, 8.7, 10.7];
export const CARD_CENTRES = [386, 431, 477, 646, 601, 555];
export function openingState(elapsed: number, duration: number) {
  const openingMs = Math.max(1, duration * 0.9);
  const seconds = Math.max(
    0,
    Math.min(OPENING_LENGTH, (elapsed / openingMs) * OPENING_LENGTH),
  );
  return {
    openingMs,
    seconds,
    count: CARD_CUES.filter((cue) => seconds >= cue).length,
    settled: elapsed >= openingMs + Math.min(200, duration * 0.04),
  };
}
