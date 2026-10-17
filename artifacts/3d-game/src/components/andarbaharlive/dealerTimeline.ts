import {
  AB_TIMING,
  andarBaharRevealMs,
} from "@workspace/api-zod/andar-bahar-live";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import { orderedCards, type Deal, type Side } from "./model";

export type Quad = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export type Track = {
  start: number;
  end: number;
  face: number;
  release: number;
  points: { at: number; quad: Quad }[];
};
// Use the complete waiting performance before the first physical card turn.
// The old 4.8-second cut repeated six times during one betting window.
export const IDLE_TRACK = { start: 0.7, end: 8.9 } as const;
export const PREPARED_FPS = 60;
// Measured against the decoded 1430 × 610 reference footage. The first
// upper-right hand opening is the joker; subsequent openings use the two
// left stacks. Card backs and fingers remain the real recorded foreground.
const SOURCE_TRACKS: Record<Side | "joker", Track> = {
  joker: {
    start: 9.02,
    end: 10.1,
    face: 9.6,
    release: 10.033,
    points: [
      { at: 9.6, quad: [846, 497, 890, 493, 897, 498, 850, 503] },
      { at: 9.7, quad: [846, 496, 891, 493, 899, 509, 852, 514] },
      { at: 9.9, quad: [845, 496, 892, 495, 903, 519, 853, 523] },
      { at: 10.033, quad: [845, 495, 892, 494, 903, 522, 854, 524] },
    ],
  },
  bahar: {
    start: 10.1,
    end: 11.35,
    face: 10.9667,
    release: 11.2,
    points: [
      { at: 10.9667, quad: [746, 535, 795, 535, 797, 542, 746, 542] },
      { at: 11.0333, quad: [746, 537, 795, 537, 797, 560, 746, 560] },
      { at: 11.2, quad: [747, 541, 794, 541, 796, 572, 747, 572] },
    ],
  },
  andar: {
    start: 11.35,
    end: 12.6,
    face: 11.8667,
    release: 12.3333,
    points: [
      { at: 11.8667, quad: [750, 500, 797, 499, 800, 504, 750, 506] },
      { at: 11.9, quad: [750, 499, 797, 499, 800, 506, 750, 507] },
      { at: 12.0333, quad: [746, 500, 799, 501, 800, 519, 748, 516] },
      { at: 12.2, quad: [748, 503, 794, 503, 795, 531, 748, 530] },
      { at: 12.3333, quad: [751, 503, 793, 503, 795, 530, 750, 529] },
    ],
  },
};
// v7 keeps each physical turn at its recorded speed. The remainder of the
// server slot contains an approach/return, with the same resting pose at
// every join (prepared by prepare-andar-bahar-continuous.mjs).
const OPENINGS = {
  joker: {
    start: 13.3,
    end: 15.2,
    approach: 25 / 60,
    source: 541 / 60,
    frames: 65,
  },
  bahar: {
    start: 15.2,
    end: 16.9,
    approach: 14 / 60,
    source: 10.1,
    frames: 75,
  },
  andar: {
    start: 16.9,
    end: 18.6,
    approach: 27 / 60,
    source: 11.35,
    frames: 75,
  },
} as const;
export const TRACKS = Object.fromEntries(
  (["joker", "andar", "bahar"] as const).map((side) => {
    const take = OPENINGS[side],
      original = SOURCE_TRACKS[side];
    const offset = take.start + take.approach - take.source;
    return [
      side,
      {
        start: take.start,
        end: take.end,
        face: original.face + offset,
        release: original.release + offset,
        points: original.points.map((p) => ({
          at: p.at + offset,
          quad: p.quad,
        })),
      },
    ];
  }),
) as Record<Side | "joker", Track>;

/** Recorded paper footprints, including the resting cards inside bridges. */
export function recordedCardQuads(mediaTime: number): (Quad | null)[] {
  const take = Object.values(OPENINGS).find(
    (t) => mediaTime >= t.start && mediaTime < t.end,
  );
  let sourceTime = mediaTime;
  if (take) {
    const elapsed = mediaTime - take.start - take.approach;
    sourceTime =
      elapsed >= 0 && elapsed < take.frames / 60 ? take.source + elapsed : 12.6;
  }
  return (["joker", "andar", "bahar"] as const).map((side) =>
    interpolateQuad(SOURCE_TRACKS[side], sourceTime),
  );
}
export const restingQuad = (side: Side | "joker") =>
  TRACKS[side].points.at(-1)!.quad;
export function cardQuad(side: Side | "joker", mediaTime: number): Quad | null {
  return interpolateQuad(TRACKS[side], mediaTime);
}
function interpolateQuad(track: Track, mediaTime: number): Quad | null {
  if (mediaTime < track.face) return null;
  const points = track.points;
  const next = points.findIndex((p) => p.at > mediaTime);
  if (next < 0) return points.at(-1)!.quad;
  if (next === 0) return points[0].quad;
  const a = points[next - 1],
    b = points[next];
  const t = (mediaTime - a.at) / (b.at - a.at);
  return a.quad.map((v, i) => v + (b.quad[i] - v) * t) as Quad;
}
export type DealerCue = {
  key: string;
  kind: "idle" | "joker" | "card" | "hold";
  side: Side | "joker";
  index: number;
  time: number;
  end: number;
  rate: number;
};
export function dealerCue(
  snapshot: TableRoundSnapshot | null,
  deal: Deal | null,
  clock: number,
): DealerCue {
  if (!snapshot || !deal || clock < snapshot.bettingEndsAt) {
    const elapsed = Math.max(
      0,
      clock -
        ((snapshot?.bettingEndsAt ?? clock) -
          (snapshot?.config.bettingWindowMs ?? AB_TIMING.bettingWindowMs)),
    );
    const durationMs = (IDLE_TRACK.end - IDLE_TRACK.start) * 1000;
    return {
      key: `idle:${Math.floor(elapsed / durationMs)}`,
      kind: "idle",
      side: "joker",
      index: -1,
      time: IDLE_TRACK.start + (elapsed % durationMs) / 1000,
      end: IDLE_TRACK.end,
      rate: 1,
    };
  }
  // A round opened by the previous server version still finishes on its
  // original deadline. New rounds always allow a full hand opening per card.
  const duration = snapshot.revealEndsAt - snapshot.bettingEndsAt;
  const scale = snapshot.config.andarBaharMotionVersion
    ? 1
    : Math.max(0.15, duration / andarBaharRevealMs(deal.cardsDealt));
  const elapsed = Math.max(0, clock - snapshot.bettingEndsAt) / scale;
  const index = Math.floor((elapsed - AB_TIMING.jokerMs) / AB_TIMING.cardMs);
  if (index >= deal.cardsDealt) {
    return {
      key: "hold",
      kind: "hold",
      side: "joker",
      index: deal.cardsDealt,
      time:
        IDLE_TRACK.start +
        ((elapsed - AB_TIMING.jokerMs - deal.cardsDealt * AB_TIMING.cardMs) %
          ((IDLE_TRACK.end - IDLE_TRACK.start) * 1000)) /
          1000,
      end: IDLE_TRACK.end,
      rate: 1,
    };
  }
  const side = index < 0 ? "joker" : orderedCards(deal)[index].side;
  const track = TRACKS[side];
  const slotMs = index < 0 ? AB_TIMING.jokerMs : AB_TIMING.cardMs;
  const local =
    index < 0 ? elapsed : (elapsed - AB_TIMING.jokerMs) % AB_TIMING.cardMs;
  // Play the full filmed action across its server slot. Previously playback
  // finished early and froze for 450–820 ms on every opening. A continuous
  // clock preserves the recorded hand/card relationship without frame blends.
  const rate = (track.end - track.start) / ((slotMs * scale) / 1000);
  return {
    key: index < 0 ? "joker" : `card:${index}`,
    kind: index < 0 ? "joker" : "card",
    side,
    index,
    time: Math.min(
      track.end - 1 / PREPARED_FPS,
      track.start + (local * scale * rate) / 1000,
    ),
    end: track.end,
    rate,
  };
}

export function shownCards(
  cue: DealerCue,
  decodedTime: number,
  deal: Deal | null,
) {
  if (!deal || cue.kind === "idle") return { joker: false, dealt: 0 };
  if (cue.kind === "hold") return { joker: true, dealt: deal.cardsDealt };
  const released = decodedTime >= TRACKS[cue.side].release;
  return {
    joker: cue.kind === "card" || released,
    dealt: cue.kind === "card" ? cue.index + Number(released) : 0,
  };
}
