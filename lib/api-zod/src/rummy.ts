/** Pure rummy rules shared by server settlement and browser hand analysis. */
export type Suit = "S" | "H" | "D" | "C" | "J";
export type Card = { id: string; suit: Suit; rank: number };
export type MeldKind = "pure" | "sequence" | "set";
export type Meld = { cards: Card[]; kind: MeldKind };
export type Analysis = {
  groups: Meld[];
  unmatched: Card[];
  pure: number;
  sequences: number;
  points: number;
  valid: boolean;
  score: number;
};
export const STAKES = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000] as const;
export const SUITS: Suit[] = ["S", "H", "D", "C"];
export const SYMBOLS: Record<Suit, string> = {
  S: "♠",
  H: "♥",
  D: "♦",
  C: "♣",
  J: "★",
};
export const rankLabel = (rank: number) =>
  ({ 0: "JK", 1: "A", 11: "J", 12: "Q", 13: "K" })[rank] ?? String(rank);
export const cardLabel = (c: Card) =>
  c.rank === 0 ? "Printed joker" : `${rankLabel(c.rank)}${SYMBOLS[c.suit]}`;
export const isWild = (c: Card, wild: number) =>
  c.rank === 0 || c.rank === wild;
export const cardPoints = (c: Card, wild: number) =>
  isWild(c, wild) ? 0 : c.rank === 1 ? 10 : Math.min(c.rank, 10);

export function createDeck(): Card[] {
  return [0, 1].flatMap((deck) => [
    ...SUITS.flatMap((suit) =>
      Array.from({ length: 13 }, (_, i) => ({
        id: `${deck}-${suit}-${i + 1}`,
        suit,
        rank: i + 1,
      })),
    ),
    { id: `${deck}-J-0`, suit: "J" as Suit, rank: 0 },
  ]);
}

export function shuffle<T>(
  cards: readonly T[],
  random: () => number = secureRandom,
): T[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function secureRandom() {
  const values = new Uint32Array(1);
  (globalThis as unknown as { crypto: { getRandomValues(v: Uint32Array): Uint32Array } }).crypto.getRandomValues(values);
  return values[0] / 4294967296;
}

/** Ace may be low or high, never wrap K-A-2. Wild ranks in their natural
 * position are allowed in a pure run; printed jokers are always substitutes. */
export function meldKind(
  cards: readonly Card[],
  wild: number,
): MeldKind | null {
  if (
    cards.length < 3 ||
    cards.length > 13 ||
    new Set(cards.map((c) => c.id)).size !== cards.length
  )
    return null;
  const run = (natural: readonly Card[], size: number) => {
    if (!natural.length || new Set(natural.map((c) => c.suit)).size !== 1)
      return false;
    return [false, true].some((highAce) => {
      const ranks = natural
        .map((c) => (c.rank === 1 && highAce ? 14 : c.rank))
        .sort((a, b) => a - b);
      return (
        new Set(ranks).size === ranks.length &&
        ranks.at(-1)! - ranks[0] < size &&
        size <= 13
      );
    });
  };
  if (cards.every((c) => c.rank !== 0) && run(cards, cards.length))
    return "pure";
  const natural = cards.filter((c) => !isWild(c, wild));
  if (natural.length && run(natural, cards.length)) return "sequence";
  if (
    cards.length <= 4 &&
    natural.length &&
    new Set(natural.map((c) => c.rank)).size === 1 &&
    new Set(natural.map((c) => c.suit)).size === natural.length
  )
    return "set";
  return null;
}

type Candidate = { mask: number; kind: MeldKind };
type Solution = { score: number; groups: Candidate[]; unmatched: number };

/** Exact disjoint subset search, shared across all possible discards. No card
 * can be counted twice, even with two identical-looking cards in the deck. */
function solver(cards: Card[], wild: number) {
  const size = 1 << cards.length;
  const groupsByCard: Candidate[][] = cards.map(() => []);
  for (let mask = 1; mask < size; mask++) {
    const subset: Card[] = [];
    for (let i = 0; i < cards.length; i++)
      if (mask & (1 << i)) subset.push(cards[i]);
    const kind = meldKind(subset, wild);
    if (!kind) continue;
    const group = { mask, kind };
    for (let i = 0; i < cards.length; i++)
      if (mask & (1 << i)) groupsByCard[i].push(group);
  }
  const memo = new Map<number, Solution>();
  function visit(mask: number, pure: number, sequences: number): Solution {
    if (!mask)
      return {
        score: pure * 100000 + sequences * 10000,
        groups: [],
        unmatched: 0,
      };
    const key = mask * 6 + pure * 3 + sequences;
    const known = memo.get(key);
    if (known) return known;
    const bit = mask & -mask;
    const index = 31 - Math.clz32(bit);
    const skipped = visit(mask ^ bit, pure, sequences);
    let best: Solution = {
      ...skipped,
      score: skipped.score - 100 - cardPoints(cards[index], wild),
      unmatched: skipped.unmatched | bit,
    };
    for (const group of groupsByCard[index]) {
      if ((mask & group.mask) !== group.mask) continue;
      const next = visit(
        mask ^ group.mask,
        Math.min(1, pure + Number(group.kind === "pure")),
        Math.min(2, sequences + Number(group.kind !== "set")),
      );
      if (next.score > best.score)
        best = { ...next, groups: [group, ...next.groups] };
    }
    memo.set(key, best);
    return best;
  }
  return (mask = size - 1): Analysis => {
    const result = visit(mask, 0, 0);
    const fromMask = (m: number) => cards.filter((_, i) => m & (1 << i));
    const groups = result.groups.map((g) => ({
      kind: g.kind,
      cards: fromMask(g.mask),
    }));
    const unmatched = fromMask(result.unmatched);
    const pure = groups.filter((g) => g.kind === "pure").length;
    const sequences = groups.filter((g) => g.kind !== "set").length;
    const penaltyCards = !pure
      ? fromMask(mask)
      : sequences < 2
        ? [
            ...unmatched,
            ...groups.filter((g) => g.kind !== "pure").flatMap((g) => g.cards),
          ]
        : unmatched;
    return {
      groups,
      unmatched,
      pure,
      sequences,
      points: Math.min(
        80,
        penaltyCards.reduce((sum, c) => sum + cardPoints(c, wild), 0),
      ),
      valid:
        fromMask(mask).length === 13 &&
        pure >= 1 &&
        sequences >= 2 &&
        unmatched.length === 0,
      score: result.score,
    };
  };
}

export function analyzeHand(cards: Card[], wild: number): Analysis {
  if (
    cards.length > 14 ||
    new Set(cards.map((c) => c.id)).size !== cards.length
  )
    throw new Error("A hand must contain at most 14 unique cards.");
  return solver(cards, wild)();
}

export function bestDiscard(
  cards: Card[],
  wild: number,
  forbidden?: string,
): { card: Card; analysis: Analysis } {
  if (cards.length !== 14) throw new Error("Draw a card before discarding.");
  const solve = solver(cards, wild);
  let best: { card: Card; analysis: Analysis; weight: number } | undefined;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (card.id === forbidden) continue;
    const analysis = solve(((1 << cards.length) - 1) ^ (1 << i));
    const connections = cards.filter(
      (c) =>
        c.id !== card.id &&
        (c.rank === card.rank ||
          (c.suit === card.suit && Math.abs(c.rank - card.rank) <= 2)),
    ).length;
    const weight =
      analysis.score * 100 +
      cardPoints(card, wild) -
      connections * 3 -
      Number(isWild(card, wild)) * 50;
    if (!best || weight > best.weight) best = { card, analysis, weight };
  }
  return best!;
}

export type Player = { name: string; hand: Card[]; folded: boolean };
export type RoundResult = {
  round: number;
  winner: number | null;
  reason: string;
  payout: number;
  net: number;
  stake: number;
  points: number[];
};
export type TableState = {
  phase: "ready" | "dealing" | "playing" | "finished";
  round: number;
  balance: number;
  stake: number;
  pot: number;
  players: Player[];
  stock: Card[];
  discard: Card[];
  indicator: Card | null;
  wild: number;
  current: number;
  step: "draw" | "discard";
  drawnFromOpen?: string;
  turns: number;
  result: RoundResult | null;
  history: RoundResult[];
  message: string;
};
export function initialTable(name = "You"): TableState {
  return {
    phase: "ready",
    round: 0,
    balance: 0,
    stake: 50,
    pot: 0,
    players: [name, "Arjun", "Meera", "Kabir"].map((name) => ({
      name,
      hand: [],
      folded: false,
    })),
    stock: [],
    discard: [],
    indicator: null,
    wild: 0,
    current: 0,
    step: "draw",
    turns: 0,
    result: null,
    history: [],
    message: "Welcome to the table. Choose your entry and deal in.",
  };
}

export function startRound(
  s: TableState,
  stake: number,
  random?: () => number,
): TableState {
  if (
    (s.phase !== "ready" && s.phase !== "finished") ||
    !STAKES.includes(stake as (typeof STAKES)[number]) ||
    stake > s.balance
  )
    return s;
  const deck = shuffle(createDeck(), random);
  const players = s.players.map((p) => ({
    ...p,
    hand: [] as Card[],
    folded: false,
  }));
  for (let c = 0; c < 13; c++)
    for (const p of players) p.hand.push(deck.pop()!);
  const indicator = deck.pop()!;
  const open = deck.pop()!;
  return {
    ...s,
    phase: "dealing",
    round: s.round + 1,
    balance: s.balance - stake,
    stake,
    pot: stake * 4 * 85 / 100, // Published 15% table commission; skill affects individual RTP.
    players,
    stock: deck,
    discard: [open],
    indicator,
    wild: indicator.rank || 1,
    current: s.round % 4,
    step: "draw",
    drawnFromOpen: undefined,
    turns: 0,
    result: null,
    message: "Asha is dealing 13 cards to each player…",
  };
}

function finish(
  s: TableState,
  winner: number | null,
  reason: string,
): TableState {
  if (s.phase !== "playing") return s;
  const payout = winner === null ? s.stake : winner === 0 ? s.pot : 0;
  const result: RoundResult = {
    round: s.round,
    winner,
    reason,
    payout,
    net: payout - s.stake,
    stake: s.stake,
    points: s.players.map((p) =>
      p.folded ? 80 : analyzeHand(p.hand, s.wild).points,
    ),
  };
  return {
    ...s,
    phase: "finished",
    balance: s.balance + payout,
    result,
    history: [result, ...s.history].slice(0, 20),
    message:
      winner === null ? reason : `${s.players[winner].name} wins! ${reason}`,
  };
}

export function beginPlay(s: TableState): TableState {
  return s.phase === "dealing"
    ? {
        ...s,
        phase: "playing",
        message: `${s.players[s.current].name} starts. Draw from either pile.`,
      }
    : s;
}

export function drawCard(s: TableState, source: "stock" | "open"): TableState {
  if (s.phase !== "playing" || s.step !== "draw") return s;
  const top = source === "stock" ? s.stock.at(-1) : s.discard.at(-1);
  if (!top || (source === "open" && isWild(top, s.wild))) return s;
  const players = s.players.map((p, i) =>
    i === s.current ? { ...p, hand: [...p.hand, top] } : p,
  );
  return {
    ...s,
    players,
    stock: source === "stock" ? s.stock.slice(0, -1) : s.stock,
    discard: source === "open" ? s.discard.slice(0, -1) : s.discard,
    step: "discard",
    drawnFromOpen: source === "open" ? top.id : undefined,
    message: `${players[s.current].name} drew ${source === "stock" ? "from the closed deck" : cardLabel(top)}. Choose a discard.`,
  };
}

export function discardCard(
  s: TableState,
  id: string,
  declare = false,
): TableState {
  if (s.phase !== "playing" || s.step !== "discard" || s.drawnFromOpen === id)
    return s;
  const card = s.players[s.current].hand.find((c) => c.id === id);
  if (!card) return s;
  const hand = s.players[s.current].hand.filter((c) => c.id !== id);
  if (hand.length !== 13) return s;
  if (declare && !analyzeHand(hand, s.wild).valid)
    return {
      ...s,
      message:
        "Not ready: arrange all 13 cards with at least 2 sequences, including 1 pure sequence.",
    };
  const players = s.players.map((p, i) =>
    i === s.current ? { ...p, hand } : p,
  );
  const next = {
    ...s,
    players,
    discard: [...s.discard, card],
    drawnFromOpen: undefined,
    turns: s.turns + 1,
  };
  if (declare) return finish(next, s.current, "Valid 13-card declaration");
  if (!next.stock.length || next.turns >= 200)
    return finish(
      next,
      null,
      "Table drawn. Entry chips returned to every player.",
    );
  let current = (s.current + 1) % players.length;
  while (players[current].folded) current = (current + 1) % players.length;
  return {
    ...next,
    current,
    step: "draw",
    message: `${players[s.current].name} discarded ${cardLabel(card)}. ${players[current].name}'s turn.`,
  };
}

/** Bots decide using only their own hand and the public discard. */
export function autoStep(s: TableState): TableState {
  if (s.phase !== "playing") return s;
  const hand = s.players[s.current].hand;
  if (s.step === "discard") {
    const choice = bestDiscard(hand, s.wild, s.drawnFromOpen);
    return discardCard(s, choice.card.id, choice.analysis.valid);
  }
  const open = s.discard.at(-1);
  const current = analyzeHand(hand, s.wild);
  if (open && !isWild(open, s.wild)) {
    const proposed = bestDiscard([...hand, open], s.wild, open.id);
    if (proposed.analysis.score > current.score) return drawCard(s, "open");
  }
  return s.stock.length
    ? drawCard(s, "stock")
    : finish(s, null, "Deck exhausted. Entry chips returned.");
}

export function dropPlayer(s: TableState): TableState {
  if (
    s.phase !== "playing" ||
    s.current !== 0 ||
    s.step !== "draw" ||
    s.players[0].folded
  )
    return s;
  return {
    ...s,
    players: s.players.map((p, i) => (i === 0 ? { ...p, folded: true } : p)),
    current: 1,
    message: "You dropped this round. Your entry remains in the pot.",
  };
}
