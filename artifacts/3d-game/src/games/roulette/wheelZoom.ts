/**
 * Wheel Zoom — ONE setting for how much room the wheel gets (parity spec 08
 * §6b, third edition second pass).
 *
 * It decides whether the wheel zooms to centre for the spin AND whether the
 * bet table folds out at all: a player who does not want the camera moving
 * does not want the board moving either. OFF, the table takes chips where it
 * sits and a tap on it places a chip instead of expanding it.
 *
 * APP-SCOPED, default ON, shared by both wheels, NOT persisted. It was a
 * screen field, so it was rebuilt as ON on every trip through the lobby —
 * which is what "the toggle does not work" looks like from the other side of
 * the screen. A restart puts it back to ON: a smaller and rarer surprise, and
 * it costs no storage read on the way into a round.
 */
import { useSyncExternalStore } from "react";

let on = true;
const listeners = new Set<() => void>();

export function wheelZoomOn(): boolean {
  return on;
}

export function setWheelZoom(next: boolean): void {
  if (next === on) return;
  on = next;
  for (const l of listeners) l();
}

export function useWheelZoom(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    wheelZoomOn,
    wheelZoomOn,
  );
}
