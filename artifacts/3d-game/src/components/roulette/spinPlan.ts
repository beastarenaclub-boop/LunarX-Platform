import { wrapRouletteDegrees } from "./wheelData";

/* ── Roulette spin plans ────────────────────────────────────────────────
   The wheel is never parked. It idles at a slow croupier speed between
   rounds, steps up to an anticipation spin when the presentation opens for
   the last 20 seconds of betting, runs flat out for the final five seconds
   of the round, and hands that speed straight over to the landing — which
   holds the fast finishing run and then brakes onto the winning pocket
   across the last two seconds.

   A landing is a closed-form position curve, not an accumulator, so the
   angle at any instant is exact: a tab that was hidden for the whole spin
   resumes on the right pocket instead of drifting off the server result.

   Velocity profile of one plan (magnitudes):
     ramp   : smoothstep from the handoff speed v0 up to vPeak
     cruise : vPeak held flat — the fast finishing run
     brake  : vPeak·(1-z)² down to a standstill (zero slope at the end, so
              the wheel eases to rest instead of snapping)
   vPeak is solved from the required displacement, so the curve starts at the
   speed the wheel is really moving at (no jerk on handoff) and finishes
   exactly on target. */

/** Idle rotor speed (deg/s) — one revolution every ~15s. */
export const IDLE_WHEEL_DPS = 24;
/** Idle ball orbit (deg/s); it runs the opposite way, a little quicker. */
export const IDLE_BALL_DPS = 62;
/** Anticipation speeds while the wheel presentation counts betting down. */
export const ANTICIPATION_WHEEL_DPS = 172;
export const ANTICIPATION_BALL_DPS = 520;
/** Fast finishing run over the final seconds of the round. */
export const FINAL_RUN_WHEEL_DPS = 320;
export const FINAL_RUN_BALL_DPS = 1000;
/** Peak speeds the landing accelerates to before it brakes. */
const LANDING_WHEEL_PEAK_DPS = 560;
const LANDING_BALL_PEAK_DPS = 1180;

/**
 * How long before the end of the round the fast finishing run begins. The
 * page flips the wheel into it off the round clock, so the run is already at
 * speed by the time the server discloses the pocket and the landing takes
 * over.
 */
export const FINAL_RUN_MS = 5_000;
/** The closing slow-down: the last two seconds of the visible spin. */
export const LANDING_BRAKE_MS = 2_000;
/** A very short reveal window still brakes, just for less of its length. */
const MIN_BRAKE_MS = 420;
const MAX_BRAKE_FRACTION = 0.72;
/** Opening acceleration of a landing, clamped to these bounds (ms). */
const RAMP_FRACTION = 0.16;
const MIN_RAMP_MS = 120;
const MAX_RAMP_MS = 620;
/** At least this much flat-out running between the ramp and the brake. */
const MIN_CRUISE_MS = 110;
/** Tail of the brake during which the ball drops in and rides the pocket. */
const DROP_FRACTION = 0.3;
const MIN_DROP_MS = 260;
const MAX_DROP_MS = 800;
/** Turn floors for a full-length landing, scaled down for a shorter one so a
    clipped reveal window spins faster rather than turning into a blur. */
const MIN_WHEEL_TURNS = 2;
const MIN_BALL_TURNS = 4;
const REFERENCE_LANDING_MS = 3_000;
/** Hard cap on the search for a turn count that avoids a decelerating start. */
const MAX_EXTRA_TURNS = 24;

/** Shortest landing worth animating — below this the result shows at once. */
export const MIN_LANDING_MS = 1_200;
/** Longest landing, so a generous reveal window doesn't drag. */
const MAX_LANDING_MS = 5_000;
/** Slack left at the end of the reveal window so the wheel rests in time. */
const LANDING_TAIL_MS = 450;

/**
 * Ball speed (deg/s) the roll audio treats as "full tilt". Both the free
 * spin and the landing report their level against this one reference, so the
 * layer swells and thins with the ball's real speed across the handoff
 * instead of jumping when the plan takes over.
 */
export const BALL_ROLL_REFERENCE_DPS = 1_200;
/** Ball speed at which it starts skipping across the frets. */
export const BALL_RATTLE_DPS = 150;

export function ballRollLevel01(dps: number): number {
  return clamp(dps / BALL_ROLL_REFERENCE_DPS, 0, 1);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Landing duration for a reveal window with `remainingRevealMs` left on the
 * clock. Returns 0 when there is not enough time left to animate, which means
 * "show the resting pocket immediately" (joined late / operator set a very
 * short reveal).
 */
export function planLandingMs(remainingRevealMs: number): number {
  if (!Number.isFinite(remainingRevealMs)) return 0;
  const usable = remainingRevealMs - LANDING_TAIL_MS;
  if (usable < MIN_LANDING_MS) return 0;
  return Math.min(usable, MAX_LANDING_MS);
}

export type SpinPhase = "launch" | "run" | "brake";

export interface SpinPlan {
  /** Angle at t=0 (deg, unwrapped). */
  start: number;
  /** Signed total displacement (deg). */
  delta: number;
  durationMs: number;
  /** Opening acceleration from `v0` up to `vPeak`. */
  rampMs: number;
  /** Flat-out finishing run between the ramp and the brake. */
  cruiseMs: number;
  /** Closing deceleration to a standstill. */
  brakeMs: number;
  /** Speed magnitudes (deg/s). */
  v0: number;
  vPeak: number;
}

interface SpinPlanOptions {
  from: number;
  targetMod: number;
  dir: 1 | -1;
  /** Speed the motion is really running at when this plan takes over. */
  v0: number;
  durationMs: number;
  rampMs: number;
  brakeMs: number;
  minTurns: number;
  peakDps: number;
}

export function buildSpinPlan(opts: SpinPlanOptions): SpinPlan {
  const { from, targetMod, dir, v0, durationMs, minTurns, peakDps } = opts;
  const rampMs = clamp(opts.rampMs, 0, durationMs);
  const brakeMs = clamp(opts.brakeMs, 0, durationMs - rampMs);
  const cruiseMs = durationMs - rampMs - brakeMs;
  const r = rampMs / 1000;
  const c = cruiseMs / 1000;
  const b = brakeMs / 1000;
  // displacement = r·v0/2 + vPeak·(r/2 + c + b/3)
  const gain = r / 2 + c + b / 3;
  const head = (r * v0) / 2;
  // Residual travel (in the spin direction) from here to the target angle.
  const residual = wrapRouletteDegrees((targetMod - from) * dir);
  const solve = (turns: number) =>
    gain > 0 ? (turns * 360 + residual - head) / gain : v0;

  const wanted = head + peakDps * gain;
  let turns = clamp(
    Math.round((wanted - residual) / 360),
    minTurns,
    minTurns + MAX_EXTRA_TURNS,
  );
  // Never hand off into a slow-down: give the plan another turn until it can
  // at least hold the speed it inherited. vPeak itself is never clamped —
  // that would break the exact landing this whole curve exists for.
  while (solve(turns) < v0 && turns < minTurns + MAX_EXTRA_TURNS) turns++;

  return {
    start: from,
    delta: dir * (turns * 360 + residual),
    durationMs,
    rampMs,
    cruiseMs,
    brakeMs,
    v0,
    vPeak: solve(turns),
  };
}

/** Unwrapped angle of `plan` at `tMs` after its start. */
export function planAngle(plan: SpinPlan, tMs: number): number {
  if (tMs <= 0) return plan.start;
  if (tMs >= plan.durationMs) return plan.start + plan.delta;
  const dir = plan.delta < 0 ? -1 : 1;
  const t = tMs / 1000;
  const r = plan.rampMs / 1000;
  const c = plan.cruiseMs / 1000;
  const b = plan.brakeMs / 1000;
  const rampTravel = (r * (plan.v0 + plan.vPeak)) / 2;
  let travelled: number;
  if (tMs < plan.rampMs) {
    // ∫ v0 + (vPeak−v0)·smoothstep(t/r)
    const y = t / r;
    travelled = plan.v0 * t + (plan.vPeak - plan.v0) * r * (y ** 3 - y ** 4 / 2);
  } else if (tMs < plan.rampMs + plan.cruiseMs) {
    travelled = rampTravel + plan.vPeak * (t - r);
  } else {
    const z = b > 0 ? (t - r - c) / b : 1;
    travelled =
      rampTravel + plan.vPeak * c + (plan.vPeak * b * (1 - (1 - z) ** 3)) / 3;
  }
  return plan.start + dir * travelled;
}

/**
 * Speed magnitude (deg/s) of `plan` at `tMs` — the derivative of `planAngle`,
 * so it is exact at any point in time rather than inferred from frame deltas.
 * Drives the ball-roll audio layer and the fret rattle.
 */
export function planSpeedDps(plan: SpinPlan, tMs: number): number {
  if (tMs <= 0) return plan.v0;
  if (tMs >= plan.durationMs) return 0;
  if (tMs < plan.rampMs) {
    const y = tMs / plan.rampMs;
    return plan.v0 + (plan.vPeak - plan.v0) * (3 * y ** 2 - 2 * y ** 3);
  }
  if (tMs < plan.rampMs + plan.cruiseMs) return plan.vPeak;
  const z =
    plan.brakeMs > 0
      ? (tMs - plan.rampMs - plan.cruiseMs) / plan.brakeMs
      : 1;
  return plan.vPeak * (1 - z) ** 2;
}

export function planPhase(plan: SpinPlan, tMs: number): SpinPhase {
  if (tMs < plan.rampMs) return "launch";
  if (tMs < plan.rampMs + plan.cruiseMs) return "run";
  return "brake";
}

export interface RouletteLanding {
  durationMs: number;
  /** ms after the start at which wheel and ball begin their slow-down. */
  brakeAtMs: number;
  /** ms after the start at which the ball leaves the track. */
  dropAtMs: number;
  wheel: SpinPlan;
  ball: SpinPlan;
  /** Unwrapped rotor angle at rest. */
  endAngle: number;
}

/**
 * Plan a whole landing: the rotor's curve onto `targetMod`, the ball's
 * counter-orbit down to the drop, and the moments in between.
 *
 * `wheelV0` / `ballV0` are the speeds the wheel and ball are visibly moving
 * at right now — the plan continues from them rather than restarting from the
 * idle speed, so the fast finishing run flows into the landing with no jump.
 */
export function buildRouletteLanding(opts: {
  wheelFrom: number;
  ballFrom: number;
  targetMod: number;
  durationMs: number;
  wheelV0: number;
  ballV0: number;
  studio?: boolean;
}): RouletteLanding {
  const { wheelFrom, ballFrom, targetMod, durationMs, wheelV0, ballV0 } = opts;
  const brakeMs = clamp(
    LANDING_BRAKE_MS,
    Math.min(MIN_BRAKE_MS, durationMs),
    durationMs * MAX_BRAKE_FRACTION,
  );
  const rampMs = clamp(
    durationMs * RAMP_FRACTION,
    Math.min(MIN_RAMP_MS, durationMs - brakeMs),
    Math.max(0, durationMs - brakeMs - MIN_CRUISE_MS),
  );
  const brakeAtMs = durationMs - brakeMs;
  // The ball leaves the track inside the slow-down and rides the pocket home.
  const dropAtMs =
    durationMs - clamp(brakeMs * (opts.studio ? 0.52 : DROP_FRACTION), MIN_DROP_MS, opts.studio ? 1100 : MAX_DROP_MS);
  const turnScale = Math.min(1, durationMs / REFERENCE_LANDING_MS);

  const wheel = buildSpinPlan({
    from: wheelFrom,
    targetMod,
    dir: 1,
    v0: wheelV0,
    durationMs,
    rampMs,
    brakeMs,
    minTurns: opts.studio ? 0 : Math.max(1, Math.round(MIN_WHEEL_TURNS * turnScale)),
    peakDps: opts.studio ? 125 : LANDING_WHEEL_PEAK_DPS,
  });
  const endAngle = wheel.start + wheel.delta;

  // The ball finishes its orbit sitting on the winning pocket — wherever that
  // pocket happens to be at drop time — then rides it home. It starts braking
  // with the rotor, so both visibly slow together.
  const ballRampMs = Math.min(rampMs, dropAtMs * 0.4);
  const ball = buildSpinPlan({
    from: ballFrom,
    targetMod: wrapRouletteDegrees(planAngle(wheel, dropAtMs) - endAngle),
    dir: -1,
    v0: ballV0,
    durationMs: dropAtMs,
    rampMs: ballRampMs,
    brakeMs: clamp(dropAtMs - brakeAtMs, 0, dropAtMs - ballRampMs),
    minTurns: Math.max(1, Math.round((opts.studio ? 2 : MIN_BALL_TURNS) * turnScale)),
    peakDps: opts.studio ? 740 : LANDING_BALL_PEAK_DPS,
  });

  return { durationMs, brakeAtMs, dropAtMs, wheel, ball, endAngle };
}
