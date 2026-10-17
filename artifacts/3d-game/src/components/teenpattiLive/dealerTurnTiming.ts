/** Source-time maps used by scripts/prepare-teen-patti-turns.py.
 * Each photographed arm finishes its turn while the other waits on the felt.
 * Times are relative to the opening segment, after six seconds of betting. */
export const TURN_TIME_MAPS = [
  [
    [0, 0],
    [0.375, 0.375],
    [0.85, 1.65],
    [1.95, 3.6],
    [2.45, 4.5],
    [3.02, 4.5],
    [3.9, 6.0],
    [4.72, 6.0],
    [5.88, 7.5],
    [6.45, 7.9],
    [8.5, 8.5],
    [9, 9],
  ],
  [
    [0, 0],
    [0.375, 0.375],
    [0.85, 1.65],
    [1.98, 1.65],
    [3.08, 3.65],
    [3.5, 4.5],
    [3.94, 4.5],
    [4.82, 6.0],
    [5.91, 6.0],
    [7.07, 7.55],
    [7.65, 8.1],
    [8.5, 8.5],
    [9, 9],
  ],
] as const;

/** First encoded frame that has actually reached a measured source cue. */
export function editedCue(sourceTime: number, card: number) {
  const track = TURN_TIME_MAPS[card < 3 ? 0 : 1];
  for (let i = 1; i < track.length; i++) {
    const [end, sourceEnd] = track[i];
    const [start, sourceStart] = track[i - 1];
    if (sourceEnd < sourceTime || sourceEnd === sourceStart) continue;
    const time =
      start +
      ((sourceTime - sourceStart) / (sourceEnd - sourceStart)) * (end - start);
    return Math.ceil((time - 1e-7) * 24) / 24;
  }
  return 8.5;
}

export const TURN_ORDER = [0, 5, 2, 3, 1, 4] as const;
