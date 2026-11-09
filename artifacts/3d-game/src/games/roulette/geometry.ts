/**
 * Where the ball goes, and how the tilted ring is projected.
 *
 * Angles here are the SCREEN convention: 0 rad is +x (3 o'clock) and a positive
 * angle turns CLOCKWISE, because the canvas y-axis points down. Getting the
 * sign wrong sends the ball the other way round the wheel, which looks almost
 * right and lands on the wrong number every time.
 */
import { BOWL, POCKET_ZERO_REST_ANGLE } from "./layout";
import { sweepOf, type Wheel } from "./wheelSpec";

/** Where a pocket sits on the UNROTATED sprite, clockwise from 12 o'clock. */
export function angleForPocket(wheel: Wheel, pocket: number): number {
  const index = wheel.order.indexOf(pocket);
  if (index < 0) return wheel.zeroOffset;
  return wheel.zeroOffset + index * sweepOf(wheel);
}

/**
 * The ring's one canonical orientation.
 *
 * The ring spins exactly five whole turns, so it starts and ends here every
 * time and NEVER stops on the winner. The ball alone marks the number — which
 * is why this is a constant and not a function of the pocket.
 */
export function canonicalRestSpin(wheel: Wheel): number {
  return POCKET_ZERO_REST_ANGLE + Math.PI / 2 - wheel.zeroOffset;
}

/**
 * The screen angle the ball rests at for a pocket.
 *
 * Algebraically this is `POCKET_ZERO_REST_ANGLE + index * sweep` — the zero
 * offset cancels — but it is written the long way because that is the form that
 * stays correct if the ring ever stops somewhere other than canonical.
 */
export function pocketRestAngle(wheel: Wheel, pocket: number): number {
  return canonicalRestSpin(wheel) + angleForPocket(wheel, pocket) - Math.PI / 2;
}

/**
 * The spin curve, `f(u) = u + u^2 - u^3`.
 *
 * NOT an ease-out. Angular velocity is the quadratic `300 + 100t - 25t^2` deg/s:
 * it starts at average speed rather than from rest, peaks at 4/3 of it one third
 * through, and arrives stopped. That "already moving when you first see it" is
 * what a real wheel looks like, and an ease-out reads as a machine slowing down
 * from a standing start.
 */
export function measuredSpin(u: number): number {
  return u + u * u - u * u * u;
}

/**
 * A CSS/Flutter cubic-bezier curve, solved for y at a given x.
 *
 * These two curves were the CSS-tutorial polynomials (`1-(1-t)³` and the
 * piecewise `4t³`), which are NOT what `Curves.easeOutCubic` and
 * `Curves.easeInOut` are. Flutter defines them as cubic-beziers, and the
 * difference is visible on the slower of the two: the polynomial `easeInOut` is
 * up to 0.084 behind the real curve around t = 0.35, so the bet panel sat still
 * for its first third and then lurched, and the zoom-out hung at full zoom
 * about 90 ms too long.
 *
 * Newton-Raphson with a bisection fallback, which is what browsers do. Ten
 * iterations is far past the 1e-6 the spec's ±0.001 sample tolerance needs.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const curve = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
  };
  const slope = (a: number, b: number, t: number) => {
    const u = 1 - t;
    return 3 * u * u * a + 6 * u * t * (b - a) + 3 * t * t * (1 - b);
  };
  return (x: number): number => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 10; i++) {
      const err = curve(x1, x2, t) - x;
      if (Math.abs(err) < 1e-7) return curve(y1, y2, t);
      const d = slope(x1, x2, t);
      if (Math.abs(d) < 1e-7) break;
      t -= err / d;
    }
    // Newton stalled (a near-flat segment) — bisect, which cannot.
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = curve(x1, x2, t);
      if (Math.abs(v - x) < 1e-7) break;
      if (v > x) hi = t;
      else lo = t;
      t = (lo + hi) / 2;
    }
    return curve(y1, y2, t);
  };
}

/** `Curves.easeOutCubic` = cubic-bezier(0.215, 0.61, 0.355, 1.0). */
export const easeOutCubic = cubicBezier(0.215, 0.61, 0.355, 1.0);

/** `Curves.easeInOut` = cubic-bezier(0.42, 0.0, 0.58, 1.0). */
export const easeInOut = cubicBezier(0.42, 0.0, 0.58, 1.0);

/**
 * Project a point on the ring's plane into the bowl box.
 *
 * The ring is a flat disc tilted back by `discTiltDeg` and viewed through a
 * perspective of `discPerspective`. A point at (radius, angle) on that disc
 * lands here, and the local scale tells the caller how much the ball should
 * shrink to sit in the same plane.
 */
export function discPoint(
  radius: number,
  angle: number,
): { x: number; y: number; scale: number; patch: { x: number; y: number } } {
  const tilt = (BOWL.discTiltDeg * Math.PI) / 180;
  // The disc's own square is `discBase`; it is drawn at discW x discH.
  const sx = BOWL.discW / BOWL.discBase;
  const sy = BOWL.discH / BOWL.discBase;
  // The painted stretch (sx, sy) is the OUTERMOST step, applied to the
  // projected point — the same order the ring itself is drawn in. Folding it
  // into the depth would put the ball on a slightly different plane from the
  // ring it is meant to sit in.
  const flatY = radius * Math.sin(angle);
  const px = radius * Math.cos(angle) * sx;
  // Tilting about the x-axis foreshortens y by cos(tilt) and pushes the far
  // edge away from the camera.
  const y = flatY * Math.cos(tilt) * sy;
  const z = flatY * Math.sin(tilt);
  // CSS-style perspective divide. The near edge (negative z) comes toward the
  // camera and grows; the far edge shrinks.
  const w = 1 - z / BOWL.discPerspective;
  const scale = 1 / w;
  // The LOCAL PATCH scale: how a small piece of the disc at this point
  // appears on screen. Across, the painted stretch and the perspective; down,
  // those and the tilt's cos as well. A thing drawn with this lies IN the
  // wheel's plane, foreshortened like the pocket under it. Drawn with the
  // uniform `scale` alone it stays a circle and reads as a sticker on top.
  const patch = {
    x: sx * scale,
    y: sy * Math.cos(tilt) * scale,
  };
  return { x: px * scale, y: y * scale, scale, patch };
}

/**
 * The ball's position at a point in the spin.
 *
 * The angle is eased; the RADIUS IS NOT. The measured drift inward is linear in
 * time, and easing it too makes the ball hang at the rim and then dive, which
 * is not what the recording does.
 */
export function ballAt(
  restAngle: number,
  travel: number,
  u: number,
): { angle: number; radius: number } {
  return {
    angle: restAngle + travel * measuredSpin(u),
    radius: BOWL.ballRadiusStart + (BOWL.ballRadiusEnd - BOWL.ballRadiusStart) * u,
  };
}

/**
 * How far the ball travels: five whole turns plus the gap to the winner.
 *
 * The gap is normalised into [0, 2pi) so the ball always arrives going forwards
 * — a negative gap would make it stop just short and creep backwards.
 */
export function spinTravel(from: number, to: number, turns: number): number {
  const TAU = Math.PI * 2;
  let delta = (to - from) % TAU;
  if (delta < 0) delta += TAU;
  return turns * TAU + delta;
}
