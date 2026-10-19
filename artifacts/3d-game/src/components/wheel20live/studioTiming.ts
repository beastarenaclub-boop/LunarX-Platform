// Measured against the delivered 24 fps performance. The disc cannot move
// before the frame in which the presenter's hand actually pulls the rim.
export const W20_CUES = { pull: 66 / 24, stop: 9.25, duration: 10 };

export interface W20Playback {
  roundId: string;
  stage: "waiting" | "betting" | "spin" | "result" | "fallback";
  mediaTime: number;
  ready: boolean;
  sampledAt?: number;
}

export function performanceProgress(frame: W20Playback, roundId: string) {
  if (frame.roundId !== roundId || !frame.ready) return 0;
  if (frame.stage === "result") return 1;
  if (frame.stage !== "spin") return 0;
  return Math.max(
    0,
    Math.min(
      1,
      (frame.mediaTime - W20_CUES.pull) / (W20_CUES.stop - W20_CUES.pull),
    ),
  );
}
