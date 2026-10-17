import {
  buildDealPlan,
  type CardPlan,
  type DealPlan,
  type HandSide,
} from "./dealPlan";

export interface Point {
  x: number;
  y: number;
}
export const STUDIO_WIDTH = 1200;
export const STUDIO_HEIGHT = 760;
export const CARD_WIDTH = 70;
export const CARD_HEIGHT = 104;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const ease = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};
const mix = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
export const DEALER_PHOTO = { x: 399, y: 12, scale: 0.35 };
export const ARM_SOURCE = {
  A: {
    shoulder: { x: 280, y: 645 },
    elbow: { x: 85, y: 1120 },
    tip: { x: 530, y: 1340 },
  },
  B: {
    shoulder: { x: 880, y: 645 },
    elbow: { x: 1060, y: 1120 },
    tip: { x: 617, y: 1340 },
  },
};
export const photoPoint = (p: Point): Point => ({
  x: DEALER_PHOTO.x + p.x * DEALER_PHOTO.scale,
  y: DEALER_PHOTO.y + p.y * DEALER_PHOTO.scale,
});
export const restingHand = (side: HandSide) => photoPoint(ARM_SOURCE[side].tip);
export const cardTarget = (c: CardPlan): Point => ({
  x: (c.hand === "A" ? 345 : 675) + c.slot * 90,
  y: 488,
});
const deckPoint = (side: HandSide): Point => ({
  x: side === "A" ? 550 : 650,
  y: 432,
});

/** Each hand deals and opens one card at a time. All movement shares a clock. */
export function buildStudioPlan(
  roundKey: string,
  durationMs: number,
): DealPlan {
  const plan = buildDealPlan(roundKey, durationMs);
  const cards = plan.cards.map((c) => ({
    ...c,
    dealStart: 0.025 + c.slot * 0.105,
    dealEnd: 0.105 + c.slot * 0.105,
    flipStart: 0.42 + c.slot * 0.2,
    flipEnd: 0.56 + c.slot * 0.2,
  }));
  return {
    ...plan,
    cards,
    revealAt: 1,
    dealGesture: { start: 0, end: 0.34 },
    revealGesture: { start: 0.34, end: 1 },
    cues: cards
      .filter((c) => c.hand === "A")
      .flatMap((c) => [
        { t: c.dealEnd, kind: "deal" as const },
        { t: c.flipStart, kind: "flip" as const },
      ])
      .sort((a, b) => a.t - b.t),
  };
}

export function studioCardPose(card: CardPlan, t: number) {
  const travel = ease((t - card.dealStart) / (card.dealEnd - card.dealStart));
  const flip = ease((t - card.flipStart) / (card.flipEnd - card.flipStart));
  const p = mix(deckPoint(card.hand), cardTarget(card), travel);
  const lift = Math.sin(flip * Math.PI) * 30;
  return {
    ...p,
    y: p.y - lift,
    flip,
    lift,
    visible: t >= card.dealStart,
    yaw: card.yaw * 20 * travel,
  };
}

/** Point on the moving card edge gripped by the photographed fingertips. */
export function cardContact(card: CardPlan, t: number): Point {
  const p = studioCardPose(card, t);
  const edge = (card.hand === "A" ? 1 : -1) * CARD_WIDTH * 0.4;
  return { x: p.x + edge * Math.cos(Math.PI * (1 - p.flip)), y: p.y + 15 };
}

export function studioHandPose(
  side: HandSide,
  plan: DealPlan | null,
  t: number,
) {
  const rest = restingHand(side);
  if (!plan || t >= 1) return { ...rest, contact: -1 };
  const cards = plan.cards.filter((c) => c.hand === side);
  let previous = rest;
  let previousEnd = 0;
  for (const card of cards) {
    if (t < card.dealStart)
      return {
        ...mix(
          previous,
          cardContact(card, card.dealStart),
          ease((t - previousEnd) / (card.dealStart - previousEnd)),
        ),
        contact: -1,
      };
    if (t <= card.dealEnd)
      return { ...cardContact(card, t), contact: card.order };
    previous = cardContact(card, card.dealEnd);
    previousEnd = card.dealEnd;
  }
  for (const card of cards) {
    if (t < card.flipStart)
      return {
        ...mix(
          previous,
          cardContact(card, card.flipStart),
          ease((t - previousEnd) / (card.flipStart - previousEnd)),
        ),
        contact: -1,
      };
    if (t <= card.flipEnd)
      return { ...cardContact(card, t), contact: card.order };
    previous = cardContact(card, card.flipEnd);
    previousEnd = card.flipEnd;
  }
  return {
    ...mix(previous, rest, ease((t - previousEnd) / (1 - previousEnd))),
    contact: -1,
  };
}

const distance = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
/** Two-bone IK connects shoulders, elbows and fingertips throughout a deal. */
export function armJoints(side: HandSide, tip: Point) {
  const source = ARM_SOURCE[side];
  const shoulder = photoPoint(source.shoulder);
  const upper = distance(source.shoulder, source.elbow) * DEALER_PHOTO.scale;
  const lower = distance(source.elbow, source.tip) * DEALER_PHOTO.scale;
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

/** Maps a clipped photo limb onto its animated joints without new textures. */
export function segmentMatrix(
  a: Point,
  b: Point,
  toA: Point,
  toB: Point,
): string {
  const sx = b.x - a.x,
    sy = b.y - a.y,
    tx = toB.x - toA.x,
    ty = toB.y - toA.y;
  const length2 = sx * sx + sy * sy;
  const u = (sx * tx + sy * ty) / length2,
    v = (sx * ty - sy * tx) / length2;
  return `matrix(${u} ${v} ${-v} ${u} ${toA.x - u * a.x + v * a.y} ${toA.y - v * a.x - u * a.y})`;
}
