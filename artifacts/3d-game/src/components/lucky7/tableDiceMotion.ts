import { clamp, hashSeed, rng } from "./dicePlan";

// Naina's 24 fps take, normalized from 2560x1440 to the SVG's 1920x1080.
export const DICE_RELEASE_MS = 93 / 24 * 1000;
// Keep the measured hand release, then give the dice 56 frames to tumble,
// bounce and roll out. The final pose is reached at frame 149, not frame 111.
export const DICE_LAND_MS = 149 / 24 * 1000;
export const DICE_PICKUP_START_MS = 500;
export const DICE_PICKUP_MS = 27 / 24 * 1000;
export const DICE_FLIGHT_MS = DICE_LAND_MS - DICE_RELEASE_MS;
export const DICE_FALLBACK_MS = DICE_FLIGHT_MS;
// Presentation can finish during the existing settlement phase. Leave time
// for the win receipt before the next betting round; never extend server time.
export const DICE_PRESENTATION_TAIL_MS = 2000;
export const DICE_RESULT_HOLD_MS = 1500;
// Contacts share the pose clock: four bounces followed by quieter edge taps.
export const TABLE_DICE_CONTACTS = [
  { t: .23, strength: 1 }, { t: .42, strength: .7 },
  { t: .57, strength: .46 }, { t: .68, strength: .3 },
  { t: .78, strength: .19 }, { t: .86, strength: .11 },
  { t: .93, strength: .06 },
] as const;
export interface TableDiePlan {
  from: [number, number]; pickup: [number, number]; to: [number, number]; curve: number;
  yaw: number; turns: number; direction: number;
}
export interface TableDiePose { x: number; y: number; size: number; rx: number; ry: number; rz: number }

/** Round IDs vary presentation only. Faces always come from the server result. */
export function tableDicePlan(roundId: string): [TableDiePlan, TableDiePlan] {
  const random = rng(hashSeed(roundId));
  const drift = (random() - .5) * 60;
  return [0, 1].map(index => ({
    from: [index ? 978 : 936, index ? 852 : 856],
    pickup: [index ? 1002 : 910, index ? 932 : 930],
    to: [(index ? 1050 : 870) + drift + (random() - .5) * 24, 961 + (random() - .5) * 24],
    curve: (random() - .5) * 90,
    yaw: (random() - .5) * .65,
    turns: 1.85 + random() * .55,
    direction: random() < .5 ? -1 : 1,
  })) as [TableDiePlan, TableDiePlan];
}

export function tableDiePose(plan: TableDiePlan, fraction: number): TableDiePose {
  const t = clamp(fraction, 0, 1);
  const travel = 1 - (1 - t) ** 2;
  // Successively shorter/lower hops lose energy on contact. The last third
  // stays on the felt, still turning and sliding with declining speed.
  const hop = (start: number, end: number, height: number) => {
    const progress = (t - start) / (end - start);
    return progress > 0 && progress < 1 ? 4 * height * progress * (1 - progress) : 0;
  };
  const [first, second, third, fourth] = TABLE_DICE_CONTACTS;
  const height = hop(0, first.t, 28) + hop(first.t, second.t, 12)
    + hop(second.t, third.t, 4.5) + hop(third.t, fourth.t, 1.5);
  // Angular velocity reaches zero only at the endpoint. The old t/.76
  // clamp stopped the rotation well before the dice finished travelling.
  const tumble = (1 - t) ** 1.7 * plan.turns * Math.PI * 2;
  return {
    x: plan.from[0] + (plan.to[0] - plan.from[0]) * travel + plan.curve * Math.sin(Math.PI * travel),
    y: plan.from[1] + (plan.to[1] - plan.from[1]) * travel - height,
    size: 42 + 22 * travel,
    rx: -.48 + tumble, ry: -.36 + tumble * .65 * plan.direction,
    rz: plan.yaw + tumble * .3 * plan.direction,
  };
}

/** Collect the previous result back to the recorded pickup before her fingers close. */
export function pickupPose(plan: TableDiePlan, fraction: number): TableDiePose {
  const t = clamp(fraction, 0, 1);
  const ease = t * t * (3 - 2 * t);
  const rest = tableDiePose(plan, 1);
  return { ...rest, x: rest.x + (plan.pickup[0] - rest.x) * ease,
    y: rest.y + (plan.pickup[1] - rest.y) * ease, size: 64 - 20 * ease,
    rz: rest.rz * (1 - ease) };
}
