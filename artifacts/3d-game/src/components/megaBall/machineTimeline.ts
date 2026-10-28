import type { MegaBallOutcome } from "@workspace/api-zod/mega-ball";
import { SHOW_TIMING, showFrame } from "./showTimeline";

export const MACHINE_NUMBERS = Array.from({ length: 51 }, (_, i) => i + 1);
export const NORMAL_DRAW_START = SHOW_TIMING.ballsStart;
export const NORMAL_DRAW_END = SHOW_TIMING.ballsEnd;
export const MEGA_DRAW_START = SHOW_TIMING.megaStart;
export const RELEASE_POINT = 0.25;
export const RACK_POINT = 0.92;

/** Release uses a floating-point tolerance; the curve itself must stay in [0, 1]. */
export function chuteProgress(travel: number) {
  return Math.max(
    0,
    Math.min(1, (travel - RELEASE_POINT) / (RACK_POINT - RELEASE_POINT)),
  );
}

export interface MachineClock {
  roundId: string | null;
  progress: number;
}

/** A server clock correction must never pull a released ball back into the bowl. */
export function advanceMachineClock(
  previous: MachineClock,
  roundId: string | null,
  progress: number,
): MachineClock {
  const next = Math.max(0, Math.min(1, progress));
  return {
    roundId,
    progress:
      roundId === previous.roundId ? Math.max(previous.progress, next) : next,
  };
}

export interface MachineFrame extends ReturnType<typeof showFrame> {
  progress: number;
  drawn: number[];
  bowl: number[];
  rack: number[];
  chute: number | null;
  current: number | null;
  normalCount: number;
  megaVisible: boolean;
  multiplierVisible: boolean;
  active: {
    number: number;
    index: number;
    travel: number;
    released: boolean;
    mega: boolean;
  } | null;
}

/** One clock owns the physical gate, numbered readout, cards and spoken call. */
export function machineFrame(
  outcome: MegaBallOutcome | null,
  progress: number,
): MachineFrame {
  const p = Math.max(0, Math.min(1, progress));
  let normalCount = 0;
  let megaVisible = false;
  let active: MachineFrame["active"] = null;
  if (outcome) {
    if (p >= NORMAL_DRAW_START && p < NORMAL_DRAW_END) {
      const slot =
        ((p - NORMAL_DRAW_START) / (NORMAL_DRAW_END - NORMAL_DRAW_START)) * 20;
      const index = Math.min(19, Math.floor(slot));
      const travel = slot - index;
      const released = travel + 1e-9 >= RELEASE_POINT;
      normalCount = index + Number(released);
      active = {
        number: outcome.balls[index],
        index,
        travel,
        released,
        mega: false,
      };
    } else if (p >= NORMAL_DRAW_END) {
      normalCount = 20;
      if (p >= MEGA_DRAW_START && p < 1) {
        const travel = (p - MEGA_DRAW_START) / (1 - MEGA_DRAW_START);
        megaVisible = travel + 1e-9 >= RELEASE_POINT;
        active = {
          number: outcome.megaBall,
          index: 20,
          travel,
          released: megaVisible,
          mega: true,
        };
      } else if (p >= 1) megaVisible = true;
    }
  }
  const drawn = outcome
    ? [
        ...outcome.balls.slice(0, normalCount),
        ...(megaVisible ? [outcome.megaBall] : []),
      ]
    : [];
  const chute =
    active?.released && active.travel < RACK_POINT ? active.number : null;
  return {
    ...showFrame(p, !!outcome),
    progress: p,
    drawn,
    bowl: MACHINE_NUMBERS.filter((n) => !drawn.includes(n)),
    rack: drawn.filter((n) => n !== chute),
    chute,
    current: drawn.at(-1) ?? null,
    normalCount,
    megaVisible,
    active,
  };
}
