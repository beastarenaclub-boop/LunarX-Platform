/** Native-speed choreography measured from the supplied casino recording.
 * The motion-transfer renders must be checked against these cues before use. */
export const JOKER_REFERENCE_FILM = {
  preparation: 20,
  dealStart: 20,
  dealEnd: 69,
  collectionStart: 69,
  collectionEnd: 86,
  // Joker, A1, B1, A2, B2, A3, B3: show a value after its paper lands.
  cardLandings: [8, 15, 20, 27, 34, 41, 48],
  cardClearings: [56.8, 57.5, 59.5, 57.7, 59, 58, 58.5],
} as const;

export type CinemaClock = {
  roundKey?: string;
  elapsed: number;
  bettingDurationMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
  revealing: boolean;
};

export function referenceCinemaPosition(clock: CinemaClock) {
  const film = JOKER_REFERENCE_FILM;
  if (!clock.revealing) {
    const age = Math.max(0, (clock.elapsed + clock.bettingDurationMs) / 1000);
    return {
      // Start the complete preparation at the round opening. Starting halfway
      // through it introduced an avoidable jump during a normal 20-second bet.
      time: age % film.preparation,
      rate: 1,
      action: "preparing",
    };
  }
  const dealing = clock.elapsed < clock.revealDurationMs;
  const elapsed = dealing
    ? clock.elapsed
    : clock.elapsed - clock.revealDurationMs;
  const duration = dealing ? clock.revealDurationMs : clock.settleDurationMs;
  const start = dealing ? film.dealStart : film.collectionStart;
  const length = dealing ? film.dealEnd - start : film.collectionEnd - start;
  if (elapsed < duration) {
    return {
      time:
        start +
        Math.max(
          0,
          Math.min(length - 0.04, (elapsed / Math.max(1, duration)) * length),
        ),
      // Native speed for the reference timing. Legacy/custom rounds use their
      // persisted deadlines, including one already running during an update.
      rate: Math.max(
        0.25,
        Math.min(16, (length * 1000) / Math.max(1, duration)),
      ),
      action: dealing ? "dealing" : "collecting",
    };
  }
  return {
    time: ((elapsed - duration) / 1000) % film.preparation,
    rate: 1,
    action: "preparing",
  };
}

export function referenceCardCount(
  elapsedMs: number,
  revealDurationMs: number,
) {
  return JOKER_REFERENCE_FILM.cardLandings.filter(
    (cue) =>
      Math.max(0, elapsedMs) *
        (JOKER_REFERENCE_FILM.dealEnd - JOKER_REFERENCE_FILM.dealStart) >=
      cue * Math.max(1, revealDurationMs),
  ).length;
}
