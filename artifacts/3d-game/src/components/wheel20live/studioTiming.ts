// Measured against the delivered 24 fps performance. The disc cannot move
// before the frame in which the presenter's hand actually pulls the rim.
export const W20_CUES = { pull: 66 / 24, stop: 9.25, duration: 10 };

// Each handoff is baked into one continuous foreground film: the outgoing
// presenter walks out, the stage clears, then the incoming presenter walks in.
export const W20_HANDOFF = { walkStart: 2, changeover: 6, end: 10 };

export function handoffAt(clip: string, time: number) {
  if (clip === "lastCall")
    return time < W20_HANDOFF.walkStart
      ? { presenter: "host", action: "hosting" }
      : time < W20_HANDOFF.changeover
        ? { presenter: "host", action: "host-exit" }
        : { presenter: "spinner", action: "spinner-enter" };
  if (clip === "result")
    return time < W20_HANDOFF.walkStart
      ? { presenter: "spinner", action: "result" }
      : time < W20_HANDOFF.changeover
        ? { presenter: "spinner", action: "spinner-exit" }
        : { presenter: "host", action: "host-enter" };
  return {
    presenter: clip === "spin" ? "spinner" : "host",
    action: clip === "spin" ? "spinning" : "hosting",
  };
}

export interface W20Playback {
  roundId: string;
  stage: "waiting" | "betting" | "spin" | "result" | "fallback";
  mediaTime: number;
  ready: boolean;
  sampledAt?: number;
  cameraWide?: boolean;
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
