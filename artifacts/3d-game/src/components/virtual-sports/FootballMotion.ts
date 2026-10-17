/** Visual choreography only. Scores and outcomes always come from the server. */
export type PitchPoint = { x: number; z: number };
const formation: PitchPoint[] = [
  { x: -49, z: 0 },
  { x: -31, z: -23 },
  { x: -34, z: -8 },
  { x: -34, z: 8 },
  { x: -31, z: 23 },
  { x: -15, z: -20 },
  { x: -19, z: 0 },
  { x: -15, z: 20 },
  { x: 0, z: -16 },
  { x: 5, z: 0 },
  { x: 0, z: 16 },
];
const lanes = [6, 5, 8, 9, 10, 7, 6, 8, 9, 10];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const smooth = (n: number) => n * n * (3 - 2 * n);
export function footballPlayerPosition(
  index: number,
  seconds: number,
  playing: boolean,
): PitchPoint {
  const team = Math.floor(index / 11),
    role = index % 11,
    sign = team === 0 ? 1 : -1,
    base = formation[role];
  if (!playing) return { x: base.x * sign, z: base.z * sign };
  const advance = Math.sin(seconds * 0.22) * 15;
  if (role === 0)
    return {
      x: sign * (-49 + Math.max(0, sign * advance) * 0.07),
      z: Math.sin(seconds * 0.45) * 2.1,
    };
  return {
    x: clamp(
      base.x * sign + advance + Math.sin(seconds * 0.55 + role * 1.7) * 3.2,
      -45,
      45,
    ),
    z: clamp(
      base.z * sign + Math.sin(seconds * 0.46 + role * 2.3) * 3.2,
      -29,
      29,
    ),
  };
}
export function footballPlay(seconds: number, playing: boolean) {
  if (!playing)
    return {
      ball: { x: 0, z: 0, y: 0.112 },
      carrier: 9,
      receiver: 9,
      kicking: false,
    };
  const slot = Math.floor(seconds / 2.7),
    f = (seconds / 2.7) % 1;
  const team = Math.floor(slot / 5) % 2;
  const carrier = team * 11 + lanes[slot % lanes.length];
  // At a possession change a midfielder intercepts the final pass.
  const nextTeam = Math.floor((slot + 1) / 5) % 2;
  const receiver = nextTeam * 11 + lanes[(slot + 1) % lanes.length];
  const a = footballPlayerPosition(carrier, seconds, true),
    b = footballPlayerPosition(receiver, seconds, true);
  const dx = b.x - a.x,
    dz = b.z - a.z,
    length = Math.hypot(dx, dz) || 1;
  const u = smooth(clamp((f - 0.45) / 0.5, 0, 1));
  const ahead = footballPlayerPosition(carrier, seconds + 0.03, true),
    vx = ahead.x - a.x,
    vz = ahead.z - a.z,
    speed = Math.hypot(vx, vz) || 1;
  const turn = smooth(clamp((f - 0.25) / 0.2, 0, 1));
  const ox = ((vx / speed) * (1 - turn) + (dx / length) * turn) * 0.55,
    oz = ((vz / speed) * (1 - turn) + (dz / length) * turn) * 0.55;
  return {
    ball: {
      x: a.x + dx * u + ox * (1 - u),
      z: a.z + dz * u + oz * (1 - u),
      y: 0.112 + Math.sin(u * Math.PI) * 0.22,
    },
    carrier,
    receiver,
    kicking: f > 0.36 && f < 0.58,
  };
}
export function footballGoalReplay(team: number, seconds: number) {
  const sign = team === 0 ? 1 : -1,
    u = clamp(seconds / 1.05, 0, 1);
  return {
    x: sign * (34 + 19 * u),
    z: -2.5 + 4 * u,
    y: 0.112 + Math.sin(u * Math.PI) * 1.2,
  };
}
