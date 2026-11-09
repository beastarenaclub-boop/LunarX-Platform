import samples from "./wheel-samples.json";
const first = samples[0].flutter_clockwise_radians;
const range = samples[samples.length - 1].flutter_clockwise_radians - first;
export function spinProgress(t: number): number {
  const pos = Math.max(0, Math.min(1, t)) * (samples.length - 1);
  const i = Math.floor(pos), j = Math.min(i + 1, samples.length - 1);
  return ((samples[i].flutter_clockwise_radians * (1 - (pos - i)) + samples[j].flutter_clockwise_radians * (pos - i)) - first) / range;
}
export function targetAngle(fromAngle: number, pocket: number): number {
  const normalized = ((fromAngle % 360) + 360) % 360;
  const destination = ((-36 * pocket) % 360 + 360) % 360;
  return fromAngle + 1800 + ((destination - normalized + 360) % 360);
}
export function angleAt(from: number, pocket: number, progress: number) {
  return from + (targetAngle(from, pocket) - from) * spinProgress(progress);
}
