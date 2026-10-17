/** All compositing uses the same framing as the visible dealer video. */
export const DEALER_HEIGHT = 0.74;
export const DEALER_TOP = -0.025;
/** The idle take is 5.8% lower in its source frame than the throwing take. */
export const DEALER_IDLE_TOP = -0.058;
export const TABLE_HEIGHT = 0.40;

/** Last decoded video frame, shared by the hand and the dice renderer. */
export interface DealerPlayback {
  roundId: string | null;
  mediaMs: number;
  mode: "idle" | "roll" | "greeting" | "win" | "entry";
  frameReady: boolean;
  presentedAt: number;
  rate: number;
}

export const idlePlayback = (): DealerPlayback => ({
  roundId: null, mediaMs: 0, mode: "idle", frameReady: false, presentedAt: 0, rate: 1,
});
