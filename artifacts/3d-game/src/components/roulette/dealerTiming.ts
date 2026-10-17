import { createContext, type MutableRefObject } from "react";

// Both the dealer clip and the physical ball use the same server-derived clock.
export const DEALER_ACTION_MS = 4000;
// Frame 36: ball centre (842, 535), still touching the fingertips. Frame 37:
// (827, 560); frame 38: (814, 600). Use this observed path for the handoff.
export const DEALER_RELEASE_MS = 1500;
export const BALL_FLIGHT_MS = 96;
export const BALL_ENTRY_DEGREES = 187.5;
export const BALL_RELEASE_POINT = { x: 842, y: 535 };
export const DEALER_FOREGROUND_HEIGHT = 570;

export interface DealerVideoFrame {
  roundId: string | null;
  mediaMs: number;
  sampledAt: number;
  active: boolean;
}
export const DealerVideoContext = createContext<MutableRefObject<DealerVideoFrame> | null>(null);
