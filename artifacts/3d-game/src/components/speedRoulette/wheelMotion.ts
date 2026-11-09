import { EUROPEAN_WHEEL_ORDER } from "../roulette/wheelData";

export const WHEEL = {
  zeroAngle: 9 * Math.PI * 2 / 37,
  rotorSpeed: .42,
  orbitRadius: 181,
  orbitFloor: 27,
  orbitAspect: .965,
  pocketRadius: 100,
  ballRadius: 4.4,
  pocketFloor: -4,
};
const TAU = Math.PI * 2;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => { const t = clamp(x); return t * t * (3 - 2 * t); };
export type BallStage = "hidden" | "orbit" | "inward" | "bouncing" | "seated";
export interface MotionInput { roundId: string | null; phase: string | null; pocket: number | null; remainingMs: number }
export interface WheelPose { rotorAngle: number; ballAngle: number; radius: number; aspect: number; floor: number; elevation: number; stage: BallStage; pocket: number | null }

/** Presentation only. The authoritative pocket comes from the server. */
export class WheelMotion {
  private epoch: number;
  private roundId: string | null = null;
  private launchedAt: number | null = null;
  private landing: { start: number; duration: number; relativeStart: number; relativeEnd: number; relativeSpeed: number; pocket: number } | null = null;
  constructor(now: number) { this.epoch = now; }
  sample(now: number, input: MotionInput): WheelPose {
    const rotorAngle = (now - this.epoch) / 1000 * WHEEL.rotorSpeed;
    if (input.roundId !== this.roundId) { this.roundId = input.roundId; this.launchedAt = null; this.landing = null; }
    if (input.phase === "betting" || !input.phase) return { rotorAngle, ballAngle: 0, radius: WHEEL.orbitRadius, aspect: WHEEL.orbitAspect, floor: WHEEL.orbitFloor, elevation: WHEEL.orbitFloor + WHEEL.ballRadius, stage: "hidden", pocket: null };
    this.launchedAt ??= now;
    const elapsed = Math.max(0, (now - this.launchedAt) / 1000);
    // A fast counter-rotating ball gradually loses speed on the stationary rim.
    const decelerationTime = Math.min(elapsed, 5.5);
    const ballSpeed = -6.8 + .48 * decelerationTime;
    const orbitAngle = -.8 - 6.8 * decelerationTime + .24 * decelerationTime ** 2 + Math.min(0, 5.5 - elapsed) * 4.16;
    if (!this.landing && input.pocket !== null && EUROPEAN_WHEEL_ORDER.includes(input.pocket as typeof EUROPEAN_WHEEL_ORDER[number])) {
      const duration = Math.max(0, Math.min(3400, input.remainingMs));
      const relativeStart = orbitAngle - rotorAngle, relativeSpeed = ballSpeed - WHEEL.rotorSpeed;
      const target = WHEEL.zeroAngle + EUROPEAN_WHEEL_ORDER.indexOf(input.pocket as typeof EUROPEAN_WHEEL_ORDER[number]) * TAU / 37;
      // Enough counter-clockwise travel for a monotone cubic with the incoming
      // velocity. Its final relative velocity is zero, so capture has no snap.
      const minimumTravel = Math.abs(relativeSpeed) * duration / 1000 / 3 + .05;
      const relativeEnd = target - Math.ceil((target - relativeStart + minimumTravel) / TAU) * TAU;
      this.landing = { start: now, duration, relativeStart, relativeEnd, relativeSpeed, pocket: input.pocket };
    }
    if (!this.landing) return { rotorAngle, ballAngle: orbitAngle, radius: WHEEL.orbitRadius, aspect: WHEEL.orbitAspect, floor: WHEEL.orbitFloor, elevation: WHEEL.orbitFloor + WHEEL.ballRadius, stage: "orbit", pocket: null };
    const l = this.landing, t = l.duration ? clamp((now - l.start) / l.duration) : 1;
    // Hermite interpolation in rotor coordinates preserves the initial orbital
    // velocity and locks the ball to the moving pocket after capture.
    const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2;
    const relative = h00 * l.relativeStart + h10 * l.relativeSpeed * l.duration / 1000 + h01 * l.relativeEnd;
    const slope = smooth((t - .16) / .44), capture = smooth((t - .60) / .4);
    const baseRadius = WHEEL.orbitRadius + (113 - WHEEL.orbitRadius) * slope + (WHEEL.pocketRadius - 113) * capture;
    const bounceT = clamp((t - .36) / .64);
    const bounce = Math.abs(Math.sin(bounceT * Math.PI * 4)) * 9 * (1 - bounceT) ** 1.7;
    const radialSkip = Math.sin(bounceT * Math.PI * 6) * 3 * Math.sin(Math.PI * bounceT) * (1 - bounceT);
    const floor = WHEEL.orbitFloor * (1 - slope) + WHEEL.pocketFloor * capture;
    return {
      rotorAngle, ballAngle: rotorAngle + relative, radius: baseRadius + radialSkip, aspect: WHEEL.orbitAspect + (1 - WHEEL.orbitAspect) * slope,
      floor, elevation: floor + WHEEL.ballRadius + bounce,
      stage: t === 1 ? "seated" : t < .16 ? "orbit" : t < .6 ? "inward" : "bouncing", pocket: l.pocket,
    };
  }
}
