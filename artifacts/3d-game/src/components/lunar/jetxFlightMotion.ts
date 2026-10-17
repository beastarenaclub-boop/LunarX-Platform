import type { Phase } from "@/game/store";

export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (start: number, end: number, value: number) => {
  const t = clamp01((value - start) / (end - start));
  return t * t * (3 - 2 * t);
};

/** A continuous, server-clock-driven flight. Never delays a bet or cashout. */
export function jetxFlightMotion(phase: Phase, flyMs: number, multiplier: number) {
  const seconds = phase === "betting" ? 0 : Math.max(0, flyMs / 1000, Math.log(Math.max(1, multiplier)) * 10);
  const lift = smooth(2.2, 4.5, seconds);
  const climb = smooth(2.2, 4.9, seconds);
  const distance = seconds < 2.2 ? 42 * seconds * seconds : 203.28 + (seconds - 2.2) * 184.8;
  return {
    seconds, lift, climb, distance,
    pitch: -14 * lift,
    gear: 1 - smooth(2.4, 3.8, seconds),
    dusk: smooth(6.5, 12, seconds),
    night: smooth(24, 38, seconds),
    stage: phase === "crashed" ? "flew-away" : phase === "betting" ? "runway" : seconds < 2.2 ? "rolling" : seconds < 5.8 ? "takeoff" : seconds < 10.5 ? "climbing" : "cruising",
  };
}
