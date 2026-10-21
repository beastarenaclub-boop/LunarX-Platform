export const CARD = { width: 46, height: 68 };
export const TURN_ORDER = [0, 3, 1, 4, 2, 5];
export const FOOTAGE = { bettingEnd: 18.3, openingEnd: 29.3, rest: 30.5 };
// Six actual opening gestures, with the long pauses removed from the recording.
export const OPENINGS = [
  { index: 0, start: 0, end: 1.1 },
  { index: 3, start: 1.1, end: 3 },
  { index: 1, start: 3, end: 5 },
  { index: 4, start: 5, end: 7 },
  { index: 2, start: 7, end: 9 },
  { index: 5, start: 9, end: 11 },
];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const target = (index: number) => ({
  x: ([386, 431, 477, 646, 601, 555][index] / 1036) * 1200,
  y: (371 / 586) * 675,
});

/** Match the visible card to its gesture; values come only from the round API. */
export function referencePose(
  index: number,
  progress: number,
  revealing: boolean,
) {
  const cue = OPENINGS.find((opening) => opening.index === index)!;
  const elapsed = progress * 11;
  const raw = clamp((elapsed - cue.start) / (cue.end - cue.start));
  const flip = clamp((raw - 0.12) / 0.73);
  const end = target(index);
  const lift = Math.sin(flip * Math.PI);
  return {
    x: end.x + (index < 3 ? 15 : -4) * (1 - clamp(raw * 4)),
    y: end.y - lift * 30 - (1 - clamp(raw * 4)) * 18,
    flip,
    lift,
    visible: revealing && elapsed >= cue.start,
  };
}
