/** Measured seconds in the spin take, not browser or network time. */
export const STUDIO_CUES = {
  wheelPull: 3.875,
  wheelStop: 7.5,
  actionEnd: 9.083333,
  idleStart: 6.5,
  idleEnd: 9,
} as const;

/** The wheel reads only frames which the presenter video actually displayed. */
export interface StudioPlayback {
  roundId: string | null;
  stage: "waiting" | "betting" | "spin" | "result" | "fallback";
  mediaTime: number;
  ready: boolean;
  presentedAt?: number;
  rate?: number;
  advancing?: boolean;
}

// Interpolate for the display refresh rate, at most one decoded video frame.
// Never cross the pull until the actual contact frame has been presented.
export function studioFrameTime(
  frame: StudioPlayback,
  now = performance.now(),
) {
  if (!frame.advancing || frame.mediaTime < STUDIO_CUES.wheelPull)
    return frame.mediaTime;
  return (
    frame.mediaTime +
    Math.min(
      1 / 24,
      (Math.max(0, now - (frame.presentedAt ?? now)) / 1000) *
        (frame.rate ?? 1),
    )
  );
}

export function studioPlaybackRate(revealMs: number) {
  return Math.max(
    1,
    (STUDIO_CUES.actionEnd * 1000) /
      Math.max(3_000, revealMs - Math.min(3_000, revealMs / 6)),
  );
}
