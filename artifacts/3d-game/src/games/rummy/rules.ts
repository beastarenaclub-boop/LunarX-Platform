/**
 * Rummy Royale — the rules, pure.
 *
 * Thirteen-card Indian rummy on two decks (106 physical cards, one printed
 * joker each), four seats: the player and three computer seats. Nothing here
 * touches money, a clock or the database; the server's `service.ts` owns the
 * round and this file answers "what does this action do to the table".
 *
 * DUPLICATED VERBATIM on the client (`3d-game/src/games/rummy/rules.ts`),
 * which needs the same solver for hints, auto-grouping and the declare
 * pre-check. `rummyRulesParity.test.ts` pins the two files byte-identical, the
 * way `configUnits` is pinned across the panels — edit both or neither.
 *
 * Ported from the practice kit's `engine.ts` (2026-09-29) with the money
 * (balance, pot, history) and the local `round` counter taken OUT: the wallet
 * is the balance, the bet row is the stake, and the DB is the history.
 */
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

/** Two decks: 52 suited cards plus one printed joker each, 106 unique ids. */
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

/** Fisher-Yates over `random() in [0, 1)`; the server hands in a seeded source. */
export function shuffle<T>(cards: readonly T[], random: () => number): T[] {
  const copy = [...cards];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
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
        ranks.at(-1)! - ranks[0]! < size &&
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
  // A meld is one suit (a run) or one rank (a set) among its natural cards,
  // and has at least three cards. Most of the 2^n subsets are neither, and
  // `meldKind` allocates on every call — so the suit and rank bits are
  // OR-ed per subset first and the impossible ones never reach it. Pure
  // pruning: nothing a subset could be classified as is skipped. Measured on
  // the bot-vs-bot classifier: ~580 ms per deal before, well under 100 after.
  const suitBit = cards.map((c) => (isWild(c, wild) ? 0 : 1 << SUITS.indexOf(c.suit)));
  const rankBit = cards.map((c) => (isWild(c, wild) ? 0 : 1 << c.rank));
  for (let mask = 1; mask < size; mask++) {
    let n = 0;
    let suits = 0;
    let ranks = 0;
    for (let i = 0; i < cards.length; i++)
      if (mask & (1 << i)) {
        n++;
        suits |= suitBit[i]!;
        ranks |= rankBit[i]!;
      }
    if (n < 3 || suits === 0) continue;
    const oneSuit = (suits & (suits - 1)) === 0;
    const oneRank = (ranks & (ranks - 1)) === 0;
    if (!oneSuit && !oneRank) continue;
    if (!oneSuit && n > 4) continue;
    const subset: Card[] = [];
    for (let i = 0; i < cards.length; i++)
      if (mask & (1 << i)) subset.push(cards[i]!);
    const kind = meldKind(subset, wild);
    if (!kind) continue;
    const group = { mask, kind };
    for (let i = 0; i < cards.length; i++)
      if (mask & (1 << i)) groupsByCard[i]!.push(group);
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
      score: skipped.score - 100 - cardPoints(cards[index]!, wild),
      unmatched: skipped.unmatched | bit,
    };
    for (const group of groupsByCard[index]!) {
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
    const card = cards[i]!;
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

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export const SEATS = 4;
export const HAND_SIZE = 13;
/** Seat names; index 0 is always the player. */
export const BOT_NAMES = ["Arjun", "Meera", "Kabir"] as const;
/** A round with no declaration by then is drawn (the kit's figure). */
export const MAX_TURNS = 200;
/** Points a dropped or undeclared hand is scored at, at most. */
export const MAX_POINTS = 80;

export type Seat = { name: string; hand: Card[]; folded: boolean };
export type Phase = "playing" | "finished";
export type RoundResult = {
  /** 0 is the player, 1..3 the computer seats, null a drawn table. */
  winner: number | null;
  reason: string;
  points: number[];
};
export type TableState = {
  phase: Phase;
  players: Seat[];
  /** Face-down stock; cards are taken from the END. */
  stock: Card[];
  /** Open pile; the top card is the END. */
  discard: Card[];
  indicator: Card | null;
  /** The wild rank: the indicator's rank, or ace when a printed joker turned up. */
  wild: number;
  /** Whose turn: an index into `players`. */
  current: number;
  step: "draw" | "discard";
  /** The card picked from the open pile this turn — it cannot go straight back. */
  drawnFromOpen?: string;
  turns: number;
  result: RoundResult | null;
  message: string;
};

/**
 * Deal a shuffled deck: 13 cards to each seat in rotation (taken from the
 * end), then the indicator, then one open card; the rest is the stock.
 * `opener` is the seat that draws first.
 */
export function dealTable(
  deck: readonly Card[],
  opener: number,
  playerName = "You",
): TableState {
  if (deck.length !== 106 || new Set(deck.map((c) => c.id)).size !== 106)
    throw new Error("A rummy deal needs the full 106-card double deck.");
  if (!Number.isInteger(opener) || opener < 0 || opener >= SEATS)
    throw new Error("Invalid opening seat.");
  const stock = [...deck];
  const players: Seat[] = [playerName, ...BOT_NAMES].map((name) => ({
    name,
    hand: [],
    folded: false,
  }));
  for (let c = 0; c < HAND_SIZE; c++)
    for (const p of players) p.hand.push(stock.pop()!);
  const indicator = stock.pop()!;
  const open = stock.pop()!;
  return {
    phase: "playing",
    players,
    stock,
    discard: [open],
    indicator,
    wild: indicator.rank || 1,
    current: opener,
    step: "draw",
    drawnFromOpen: undefined,
    turns: 0,
    result: null,
    message: `${players[opener]!.name} starts. Draw from either pile.`,
  };
}

function finish(
  s: TableState,
  winner: number | null,
  reason: string,
): TableState {
  if (s.phase !== "playing") return s;
  const result: RoundResult = {
    winner,
    reason,
    points: s.players.map((p) =>
      p.folded ? MAX_POINTS : analyzeHand(p.hand, s.wild).points,
    ),
  };
  return {
    ...s,
    phase: "finished",
    result,
    message:
      winner === null ? reason : `${s.players[winner]!.name} wins! ${reason}`,
  };
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
    message: `${players[s.current]!.name} drew ${source === "stock" ? "from the closed deck" : cardLabel(top)}. Choose a discard.`,
  };
}

export function discardCard(
  s: TableState,
  id: string,
  declare = false,
): TableState {
  if (s.phase !== "playing" || s.step !== "discard" || s.drawnFromOpen === id)
    return s;
  const card = s.players[s.current]!.hand.find((c) => c.id === id);
  if (!card) return s;
  const hand = s.players[s.current]!.hand.filter((c) => c.id !== id);
  if (hand.length !== HAND_SIZE) return s;
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
  if (!next.stock.length || next.turns >= MAX_TURNS)
    return finish(
      next,
      null,
      "Table drawn. Entry chips returned to every player.",
    );
  let current = (s.current + 1) % players.length;
  while (players[current]!.folded) current = (current + 1) % players.length;
  return {
    ...next,
    current,
    step: "draw",
    message: `${players[s.current]!.name} discarded ${cardLabel(card)}. ${players[current]!.name}'s turn.`,
  };
}

/** One action by the seat to act, using only its own hand and the open card. */
export function autoStep(s: TableState): TableState {
  if (s.phase !== "playing") return s;
  const hand = s.players[s.current]!.hand;
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

/** The player sits the round out; the entry stays in the pot. Before drawing only. */
export function dropPlayer(s: TableState): TableState {
  if (
    s.phase !== "playing" ||
    s.current !== 0 ||
    s.step !== "draw" ||
    s.players[0]!.folded
  )
    return s;
  return {
    ...s,
    players: s.players.map((p, i) => (i === 0 ? { ...p, folded: true } : p)),
    current: 1,
    message: "You dropped this round. Your entry remains in the pot.",
  };
}
