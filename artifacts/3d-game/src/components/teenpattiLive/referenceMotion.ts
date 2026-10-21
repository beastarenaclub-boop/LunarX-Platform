import { ARM_SOURCE, segmentMatrix, type Point } from "./studioMotion";

export { ARM_SOURCE, segmentMatrix };
export const STUDIO = { width: 1200, height: 675 };
export const DEALER = { x: 434, y: 15, scale: 0.29 };
export const CARD = { width: 53, height: 75 };
export const TURN_ORDER = [0, 3, 1, 4, 2, 5];
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const mix = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const target = (index: number) => ({
  x: (index < 3 ? 438 : 665) + (index % 3) * 62,
  y: 440,
});
export const restingHand = (side: "A" | "B") => ({
  x: DEALER.x + ARM_SOURCE[side].tip.x * DEALER.scale,
  y: DEALER.y + ARM_SOURCE[side].tip.y * DEALER.scale,
});

/** Absolute server-phase time, shared by the cards and the dealer's hands. */
export function referencePose(
  index: number,
  progress: number,
  revealing: boolean,
) {
  const order = TURN_ORDER.indexOf(index);
  const slotStart = 0.08 + order * 0.135;
  const raw = clamp((progress - slotStart) / 0.105);
  const move = ease(raw);
  const end = target(index);
  if (revealing)
    return {
      ...end,
      y: end.y - Math.sin(Math.PI * raw) * 23,
      flip: move,
      visible: true,
      lift: Math.sin(Math.PI * raw),
      contact: progress >= slotStart && progress < slotStart + 0.105,
    };
  const start = { x: 610, y: 394 };
  const point = mix(start, end, move);
  return {
    ...point,
    y: point.y - Math.sin(Math.PI * raw) * 9,
    flip: 0,
    visible: progress >= slotStart,
    lift: Math.sin(Math.PI * raw) * 0.3,
    contact: progress >= slotStart && progress < slotStart + 0.105,
  };
}

export function handPose(
  side: "A" | "B",
  progress: number,
  revealing: boolean,
) {
  const rest = restingHand(side);
  let previous = rest;
  let previousEnd = 0;
  for (let order = 0; order < TURN_ORDER.length; order++) {
    const index = TURN_ORDER[order];
    if ((index < 3 ? "A" : "B") !== side) continue;
    const start = 0.08 + order * 0.135;
    const end = start + 0.105;
    const contact = (at: number) => {
      const card = referencePose(index, at, revealing);
      return {
        x: card.x + (side === "A" ? 19 : -19) * Math.cos(Math.PI * card.flip),
        y: card.y + 3,
      };
    };
    if (progress < start)
      return {
        ...mix(
          previous,
          contact(start),
          ease((progress - previousEnd) / (start - previousEnd)),
        ),
        card: -1,
      };
    if (progress < end) return { ...contact(progress), card: index };
    previous = contact(end);
    previousEnd = end;
  }
  return {
    ...mix(previous, rest, ease((progress - previousEnd) / (1 - previousEnd))),
    card: -1,
  };
}

/** Two-bone inverse kinematics: preserve the photographed limb lengths. */
export function joints(side: "A" | "B", tip: Point) {
  const source = ARM_SOURCE[side];
  const shoulder = {
    x: DEALER.x + source.shoulder.x * DEALER.scale,
    y: DEALER.y + source.shoulder.y * DEALER.scale,
  };
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const upper = distance(source.shoulder, source.elbow) * DEALER.scale;
  const lower = distance(source.elbow, source.tip) * DEALER.scale;
  const d = Math.max(1, distance(shoulder, tip));
  const reach = Math.min(d, upper + lower - 0.1);
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const across = Math.sqrt(Math.max(0, upper * upper - along * along));
  const dx = (tip.x - shoulder.x) / d,
    dy = (tip.y - shoulder.y) / d;
  const bend = side === "A" ? 1 : -1;
  return {
    shoulder,
    elbow: {
      x: shoulder.x + dx * along - dy * across * bend,
      y: shoulder.y + dy * along + dx * across * bend,
    },
    tip,
  };
}
