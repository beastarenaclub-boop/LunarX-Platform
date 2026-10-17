import idle from "@/assets/lucky7/dealer-idle-v2.mp4";
import roll from "@/assets/lucky7/dealer-forward.mp4";
import greeting from "@/assets/lucky7/dealer-greeting.mp4";
import win from "@/assets/lucky7/dealer-win.mp4";
import type { DealerMedia } from "./DealerStage";
import { DEALER_IDLE_TOP } from "./dealerMotion";

/** Frame-measured handoff between the dealer footage and the 3D dice. */
export const lucky7DealerMedia: DealerMedia = {
  idle,
  roll,
  // Measured from the generated footage, rather than the requested prompt.
  // The two meshes follow the palm, then continue across the felt. The hand
  // foreground preserves the fingers above the table during the release.
  releaseMs: 2800,
  startMs: 400,
  endMs: 5000,
  windupMs: 2400,
  release: {
    x: 0.455, y: 0.93, videoAspect: 1280 / 720,
    hand: [
      { ms: 500, x: 0.451, y: 0.818 },
      { ms: 600, x: 0.448, y: 0.82 },
      { ms: 900, x: 0.436, y: 0.822 },
      { ms: 1200, x: 0.441, y: 0.85 },
      { ms: 1500, x: 0.451, y: 0.873 },
      { ms: 1800, x: 0.454, y: 0.877 },
      { ms: 2100, x: 0.457, y: 0.886 },
      { ms: 2500, x: 0.461, y: 0.889 },
      { ms: 2600, x: 0.461, y: 0.888 },
      { ms: 2700, x: 0.46, y: 0.904 },
      { ms: 2800, x: 0.455, y: 0.93 },
      { ms: 2900, x: 0.451, y: 0.89 },
      { ms: 3200, x: 0.453, y: 0.86 },
      { ms: 3600, x: 0.443, y: 0.846 },
      { ms: 4000, x: 0.456, y: 0.83 },
      { ms: 4500, x: 0.454, y: 0.844 },
      { ms: 5040, x: 0.458, y: 0.839 },
    ],
  },
  idleScale: 1,
  idleTop: `${DEALER_IDLE_TOP * 100}%`,
  reactions: {
    greeting: { src: greeting, durationMs: 5042, top: `${DEALER_IDLE_TOP * 100}%` },
    // The first second is a still resting pose. Skip it so all three claps
    // and the return to rest fit even when payout confirmation arrives late.
    win: { src: win, startMs: 1000, durationMs: 5042, top: `${DEALER_IDLE_TOP * 100}%` },
  },
};
