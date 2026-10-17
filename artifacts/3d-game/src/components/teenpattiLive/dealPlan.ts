/**
 * Closed-form deal + flip choreography for the live Teen Patti table.
 *
 * Nothing here imports three: the page, the flat (no-WebGL / reduced motion)
 * fallback and the lazily-loaded 3D scene all read the same numbers, and only
 * the scene turns them into meshes.
 *
 * The choreography is a *curve in elapsed time*, not an accumulator. Every
 * card's pose at any instant is a pure function of the normalised time, so a
 * tab that was hidden for the whole reveal resumes with the cards exactly
 * where they belong, and a player who joins mid-reveal drops straight onto the
 * resting, face-up hands.
 *
 * The duration is derived from the round's reveal deadline, never from a
 * ticking timer, so an operator who shortens the reveal window simply gets a
 * shorter deal (or none at all) instead of cards still in the air when the
 * round settles.
 */

// Deterministic hashing/PRNG shared with the Lucky 7 throw plan — one
// implementation of "same round id, same motion" for every table game.
import { hashSeed, rng, clamp } from "@/components/lucky7/dicePlan";

/** Shortest deal worth animating — below this the hands show at once. */
export const MIN_DEAL_MS = 1400;
/** Longest deal, so a generous reveal window doesn't drag. */
export const MAX_DEAL_MS = 4200;
/** Slack at the end of the reveal window so the cards rest before settle. */
const DEAL_TAIL_MS = 350;

/** Six cards, alternating between the two hands. */
export const CARDS_PER_HAND = 3;

/* Normalised timeline. The deal fills the first half, the flips the second,
   with a beat between them where both hands sit face-down on the felt. */
const FLIGHT = 0.16; // one card's flight from the shoe to its slot
const DEAL_END = 0.56; // the sixth card lands here
const FLIP_START = 0.62;
const FLIP_DUR = 0.13;
const DEAL_STEP = (DEAL_END - FLIGHT) / 5;
const FLIP_STEP = (1 - FLIP_START - FLIP_DUR) / 5;

/**
 * Deal duration for a reveal window with `remainingRevealMs` left on the
 * clock. Returns 0 when there is not enough time to animate, which means
 * "show the resting, face-up hands immediately" — a late join, a very short
 * operator-configured reveal, or a player who prefers reduced motion.
 */
export function planDealMs(remainingRevealMs: number): number {
  if (!Number.isFinite(remainingRevealMs)) return 0;
  const usable = remainingRevealMs - DEAL_TAIL_MS;
  if (usable < MIN_DEAL_MS) return 0;
  return Math.min(usable, MAX_DEAL_MS);
}

export type HandSide = "A" | "B";

/** When one card leaves the shoe, lands, turns, and how it rests. */
export interface CardPlan {
  hand: HandSide;
  /** 0..2 — position within its own hand, left to right. */
  slot: number;
  /** 0..5 — order it leaves the shoe. */
  order: number;
  dealStart: number;
  dealEnd: number;
  flipStart: number;
  flipEnd: number;
  /** Apex of the card's arc above the straight shoe→slot path, in metres. */
  lift: number;
  /** Resting yaw jitter so a hand never looks machine-stacked, in radians. */
  yaw: number;
  /** Lateral jitter at rest, in metres. */
  skew: number;
}

export interface DealPlan {
  durationMs: number;
  /** Six cards in deal order: A, B, A, B, A, B. */
  cards: CardPlan[];
  /** Normalised time both hands are fully face up. */
  revealAt: number;
  /** Sound cues, ascending — a card landing on the felt, or turning over. */
  cues: { t: number; kind: "deal" | "flip" }[];
  /** Normalised window the dealer's deal gesture runs in. */
  dealGesture: { start: number; end: number };
  /** Normalised window the dealer's reveal gesture runs in. */
  revealGesture: { start: number; end: number };
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3;
}

function smoothstep(x: number): number {
  return x * x * (3 - 2 * x);
}

/**
 * Build the choreography for one round. Seeded by the round id, so the same
 * round always deals the same way — a reload mid-reveal picks the same deal
 * back up instead of starting a different one.
 */
export function buildDealPlan(seedKey: string, durationMs: number): DealPlan {
  const r = rng(hashSeed(seedKey));
  const cards: CardPlan[] = [];
  for (let order = 0; order < CARDS_PER_HAND * 2; order++) {
    const hand: HandSide = order % 2 === 0 ? "A" : "B";
    const slot = Math.floor(order / 2);
    const flipIndex = (hand === "A" ? 0 : CARDS_PER_HAND) + slot;
    const dealStart = order * DEAL_STEP;
    const flipStart = FLIP_START + flipIndex * FLIP_STEP;
    cards.push({
      hand,
      slot,
      order,
      dealStart,
      dealEnd: dealStart + FLIGHT,
      flipStart,
      flipEnd: flipStart + FLIP_DUR,
      lift: 0.075 + r() * 0.035,
      yaw: (r() - 0.5) * 0.16,
      skew: (r() - 0.5) * 0.006,
    });
  }
  const cues = cards
    .flatMap((c) => [
      { t: c.dealEnd, kind: "deal" as const },
      { t: c.flipStart, kind: "flip" as const },
    ])
    .sort((a, b) => a.t - b.t);
  return {
    durationMs,
    cards,
    revealAt: 1,
    cues,
    dealGesture: { start: 0, end: DEAL_END },
    // The dealer reaches for the hands slightly before the first card turns.
    revealGesture: { start: Math.max(0, FLIP_START - 0.07), end: 1 },
  };
}

export interface CardPose {
  /** 0 = still in the shoe, 1 = resting in its slot. */
  travel: number;
  /** Metres above the straight shoe→slot path. */
  lift: number;
  /** 0 = face down, 1 = face up. */
  faceUp: number;
  /** Resting yaw, eased in as the card lands, in radians. */
  yaw: number;
  /** False until the card has left the shoe. */
  dealt: boolean;
}

/** Exact pose of one card at normalised time `t` (0 = shoe, 1 = at rest). */
export function cardPose(plan: CardPlan, t: number): CardPose {
  const raw = clamp((t - plan.dealStart) / (plan.dealEnd - plan.dealStart), 0, 1);
  const travel = easeOutCubic(raw);
  const flipRaw = clamp(
    (t - plan.flipStart) / (plan.flipEnd - plan.flipStart),
    0,
    1,
  );
  return {
    travel,
    // A half-sine arc: the card leaves the shoe, floats, and settles flat.
    lift: Math.sin(Math.PI * raw) * plan.lift,
    faceUp: smoothstep(flipRaw),
    yaw: plan.yaw * travel,
    dealt: t >= plan.dealStart,
  };
}

/** Delay before this card leaves the shoe, for CSS-timed fallbacks. */
export function cardDealDelayMs(plan: DealPlan, card: CardPlan): number {
  return Math.max(0, card.dealStart * plan.durationMs);
}

/** Delay before this card turns over, for CSS-timed fallbacks. */
export function cardFlipDelayMs(plan: DealPlan, card: CardPlan): number {
  return Math.max(0, card.flipStart * plan.durationMs);
}
