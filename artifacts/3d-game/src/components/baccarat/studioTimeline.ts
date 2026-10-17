import { baccaratCardValue } from "./cards";

export interface StudioDeal {
  playerCards: number[];
  bankerCards: number[];
  playerTotal: number;
  bankerTotal: number;
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
  natural: boolean;
}
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
export type Side = "player" | "banker";
export type StudioPhase = "betting" | "reveal" | "settling" | null;
export const IDLE = { start: 4.3, end: 17.7 };
// Seconds in dealer-studio.mp4, whose source begins at recording second 13.
// The two optional third cards reuse an individual physical delivery, so a
// standing hand never receives a phantom third card from the recorded coup.
export const TAKES = [
  { start: 18.9, end: 20.55, face: 19.93, release: 20.4, side: "player" },
  { start: 20.55, end: 21.65, face: 21.12, release: 21.5, side: "banker" },
  { start: 21.65, end: 22.95, face: 22.12, release: 22.7, side: "player" },
  { start: 22.95, end: 25.3, face: 23.52, release: 24.6, side: "banker" },
] as const;

export function orderedCards(deal: StudioDeal | null) {
  if (!deal) return [];
  const cards: { card: number; side: Side; index: number; take: number }[] = [
    { card: deal.playerCards[0], side: "player", index: 0, take: 0 },
    { card: deal.bankerCards[0], side: "banker", index: 0, take: 1 },
    { card: deal.playerCards[1], side: "player", index: 1, take: 2 },
    { card: deal.bankerCards[1], side: "banker", index: 1, take: 3 },
  ];
  if (deal.playerCards.length === 3)
    cards.push({
      card: deal.playerCards[2],
      side: "player",
      index: 2,
      take: 2,
    });
  if (deal.bankerCards.length === 3)
    cards.push({
      card: deal.bankerCards[2],
      side: "banker",
      index: 2,
      take: 3,
    });
  return cards;
}

export function studioCue(
  phase: StudioPhase,
  elapsedMs: number,
  revealMs: number,
  deal: StudioDeal | null,
) {
  const sequence = orderedCards(deal);
  const total = sequence.reduce(
    (sum, c) => sum + TAKES[c.take].end - TAKES[c.take].start,
    0,
  );
  const rate = total
    ? Math.max(1, total / Math.max(0.5, (revealMs - 600) / 1000))
    : 1;
  if (!sequence.length || phase === "betting" || phase == null) {
    const elapsed = Math.max(0, elapsedMs / 1000),
      duration = IDLE.end - IDLE.start;
    return {
      key: `idle-${Math.floor(elapsed / duration)}`,
      take: -1,
      index: -1,
      time: IDLE.start + (elapsed % duration),
      end: IDLE.end,
      rate: 1,
      completed: 0,
    };
  }
  let at = Math.max(0, elapsedMs / 1000) * rate;
  if (phase !== "settling")
    for (let index = 0; index < sequence.length; index++) {
      const take = sequence[index].take,
        t = TAKES[take],
        duration = t.end - t.start;
      if (at < duration)
        return {
          key: `card-${index}`,
          take,
          index,
          time: t.start + at,
          end: t.end,
          rate,
          completed: index,
        };
      at -= duration;
    }
  return {
    key: "hold",
    take: -1,
    index: sequence.length,
    time: IDLE.start + (Math.max(0, at) % (IDLE.end - IDLE.start)),
    end: IDLE.end,
    rate: 1,
    completed: sequence.length,
  };
}

export function presentedCount(
  cue: ReturnType<typeof studioCue>,
  decodedTime: number,
) {
  return (
    cue.completed +
    (cue.take >= 0 && decodedTime >= TAKES[cue.take].release ? 1 : 0)
  );
}
export function visibleHand(
  deal: StudioDeal | null,
  count: number,
  side: Side,
) {
  return orderedCards(deal)
    .slice(0, count)
    .filter((c) => c.side === side)
    .map((c) => c.card);
}
export function handTotal(cards: number[]) {
  return cards.reduce((v, c) => v + baccaratCardValue(c), 0) % 10;
}

export function restingQuad(side: Side, index: number): Quad {
  const x = (side === "player" ? 434 : 654) + index * 39;
  return [x + 5, 438, x + 38, 438, x + 41, 464, x, 464];
}
export function movingQuad(
  take: number,
  time: number,
  index: number,
): Quad | null {
  const t = TAKES[take];
  if (time < t.face) return null;
  const q = restingQuad(t.side, Math.min(index, 1));
  const p = Math.min(1, Math.max(0, (time - t.face) / (t.release - t.face)));
  // Card travels with the fingers before lying flat on the felt.
  const startX = take === 0 ? 23 : take === 1 ? -30 : take === 2 ? 24 : -12;
  return q.map(
    (value, i) =>
      value +
      (i % 2 ? -18 * (1 - p) : startX * (1 - p)) +
      (index === 2 && i % 2 === 0 ? 39 * p : 0),
  ) as Quad;
}
