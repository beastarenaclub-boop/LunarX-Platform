import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  POKER_CONFIG,
  HAND_NAMES,
  SEVEN_CARD_BONUS,
  playerName,
  selectionDebit,
  type PokerGame,
  type PokerQuote,
  type PokerSelection,
  type PokerAccepted,
  type PokerPublicRound,
  type PokerOutcome,
} from "@workspace/api-zod/poker";

// Card encoding matches the existing table artwork: A,2,...,K in S,H,D,C.
const rank = (card: number) => (card % 13 === 0 ? 14 : (card % 13) + 1);
function straight(ranks: number[]): number {
  const values = new Set(ranks);
  if (values.has(14)) values.add(1);
  for (let high = 14; high >= 5; high--) {
    if ([0, 1, 2, 3, 4].every((offset) => values.has(high - offset)))
      return high;
  }
  return 0;
}
/** Best five from five to seven cards, including all tie-breaking kickers. */
export function evaluate(cards: number[]) {
  if (
    cards.length < 5 ||
    cards.length > 7 ||
    new Set(cards).size !== cards.length ||
    cards.some((c) => !Number.isInteger(c) || c < 0 || c >= 52)
  )
    throw new Error("Invalid poker hand");
  const ranks = cards.map(rank).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = [0, 1, 2, 3]
    .map((s) =>
      cards
        .filter((c) => Math.floor(c / 13) === s)
        .map(rank)
        .sort((a, b) => b - a),
    )
    .find((c) => c.length >= 5);
  const straightFlush = flush ? straight(flush) : 0;
  let category = 0,
    kickers: number[] = [];
  if (straightFlush) {
    category = straightFlush === 14 ? 9 : 8;
    kickers = [straightFlush];
  } else if (groups[0][1] === 4) {
    category = 7;
    kickers = [
      groups[0][0],
      ...ranks.filter((r) => r !== groups[0][0]).slice(0, 1),
    ];
  } else if (groups[0][1] === 3 && groups[1]?.[1] >= 2) {
    category = 6;
    kickers = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
    kickers = flush.slice(0, 5);
  } else if (straight(ranks)) {
    category = 4;
    kickers = [straight(ranks)];
  } else if (groups[0][1] === 3) {
    category = 3;
    kickers = [
      groups[0][0],
      ...ranks.filter((r) => r !== groups[0][0]).slice(0, 2),
    ];
  } else if (groups[0][1] === 2 && groups[1]?.[1] === 2) {
    category = 2;
    kickers = [
      groups[0][0],
      groups[1][0],
      ranks.find((r) => r !== groups[0][0] && r !== groups[1][0])!,
    ];
  } else if (groups[0][1] === 2) {
    category = 1;
    kickers = [
      groups[0][0],
      ...ranks.filter((r) => r !== groups[0][0]).slice(0, 3),
    ];
  } else kickers = ranks.slice(0, 5);
  const score = [
    category,
    ...Array.from({ length: 5 }, (_, i) => kickers[i] ?? 0),
  ].reduce((n, v) => n * 15 + v, 0);
  return { category, score, name: HAND_NAMES[category] };
}
export function outcome(hands: number[][], board: number[]): PokerOutcome {
  const ranked = hands.map((hand) => evaluate([...hand, ...board]));
  const best = Math.max(...ranked.map((h) => h.score));
  return {
    winners: ranked.flatMap((h, i) => (h.score === best ? [i] : [])),
    categories: ranked.map((h) => h.category),
  };
}
export function commitment(
  game: PokerGame,
  hands: number[][],
  board: number[],
  nonce: string,
) {
  return createHash("sha256")
    .update(JSON.stringify([game, hands, board, nonce]))
    .digest("hex");
}
export function twoCardProfit(hand: number[]) {
  const [a, b] = hand.map(rank).sort((x, y) => y - x);
  if (a === b) return a === 14 ? 30 : a >= 11 ? 10 : 3;
  if (a !== 14 || b < 11) return 0;
  const suited = Math.floor(hand[0] / 13) === Math.floor(hand[1] / 13);
  return b === 13 ? (suited ? 25 : 15) : suited ? 20 : 5;
}
/** Deterministic pricing from PUBLIC hole cards only, never the secret board. */
export function sixPlayerOdds(hands: number[][], trials = 2500): number[] {
  let seed =
    createHash("sha256")
      .update(JSON.stringify(hands))
      .digest()
      .readUInt32LE(0) || 1;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const known = new Set(hands.flat());
  const available = Array.from({ length: 52 }, (_, i) => i).filter(
    (c) => !known.has(c),
  );
  const equity = hands.map(() => 0);
  for (let n = 0; n < trials; n++) {
    const deck = [...available];
    for (let i = 0; i < 5; i++) {
      const j = i + Math.floor(next() * (deck.length - i));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const { winners } = outcome(hands, deck.slice(0, 5));
    winners.forEach((w) => (equity[w] += 1 / winners.length));
  }
  return equity.map((e) =>
    Math.max(
      101,
      Math.min(
        10000,
        Math.floor(
          (POKER_CONFIG.sixPlayerReturn * trials * 100) / Math.max(e, 1),
        ),
      ),
    ),
  );
}
export function quotesFor(game: PokerGame, hands: number[][]): PokerQuote[] {
  if (game === "poker-six-players")
    return sixPlayerOdds(hands).map((odds, player) => ({
      id: `p${player}-back`,
      player,
      kind: "back",
      label: playerName(game, player),
      odds,
    }));
  return [0, 1].flatMap((player) => {
    const base: PokerQuote = {
      id: `p${player}-back`,
      player,
      kind: "back",
      label: `${playerName(game, player)} Winner`,
      odds: POKER_CONFIG.backOdds,
    };
    return game === "poker-one-day"
      ? [
          base,
          {
            ...base,
            id: `p${player}-lay`,
            kind: "lay" as const,
            label: `${playerName(game, player)} Lay`,
            odds: POKER_CONFIG.layOdds,
          },
          {
            ...base,
            id: `p${player}-bonus2`,
            kind: "bonus2" as const,
            label: `${playerName(game, player)} 2 Cards Bonus`,
            odds: 0,
          },
          {
            ...base,
            id: `p${player}-bonus7`,
            kind: "bonus7" as const,
            label: `${playerName(game, player)} 7 Cards Bonus`,
            odds: 0,
          },
        ]
      : [
          base,
          ...Array.from({ length: 8 }, (_, i) => ({
            ...base,
            id: `p${player}-hand${i + 1}`,
            kind: "category" as const,
            category: i + 1,
            label: `${playerName(game, player)} ${HAND_NAMES[i + 1]}`,
            odds: POKER_CONFIG.categoryOdds[i + 1],
          })),
        ];
  });
}
export function draw(game: PokerGame) {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const players = game === "poker-six-players" ? 6 : 2;
  const hands = Array.from({ length: players }, (_, i) =>
    deck.slice(i * 2, i * 2 + 2),
  );
  const board = deck.slice(players * 2, players * 2 + 5),
    nonce = randomBytes(32).toString("hex");
  return {
    hands,
    board,
    nonce,
    commitment: commitment(game, hands, board, nonce),
    quotes: quotesFor(game, hands),
  };
}
export function lockSelections(
  selections: PokerSelection[],
  quotes: PokerQuote[],
  previous = 0n,
) {
  if (
    !selections.length ||
    selections.length > 18 ||
    new Set(selections.map((s) => s.market)).size !== selections.length
  )
    throw new Error("Select distinct betting markets.");
  const accepted: PokerAccepted[] = selections.map((selection) => {
    if (!/^[1-9]\d{0,6}$/.test(selection.amountPaise))
      throw new Error("Invalid stake.");
    const quote = quotes.find((q) => q.id === selection.market);
    if (!quote) throw new Error("This market is unavailable.");
    const amount = BigInt(selection.amountPaise);
    if (
      amount < BigInt(POKER_CONFIG.minStakePaise) ||
      amount > BigInt(POKER_CONFIG.maxStakePaise)
    )
      throw new Error("Stake must be between ₹10 and ₹5,000.");
    return {
      ...selection,
      quote,
      debitPaise: String(selectionDebit(amount, quote)),
    };
  });
  const debit = accepted.reduce((sum, s) => sum + BigInt(s.debitPaise), 0n);
  if (debit + previous > BigInt(POKER_CONFIG.maxStakePaise))
    throw new Error("Maximum round stake/liability is ₹5,000.");
  return { selections: accepted, debit };
}
export function payout(
  selections: PokerAccepted[],
  hands: number[][],
  board: number[],
) {
  const result = outcome(hands, board);
  return selections.reduce((sum, bet) => {
    const { quote: q } = bet,
      amount = BigInt(bet.amountPaise),
      debit = BigInt(bet.debitPaise);
    const won = result.winners.includes(q.player);
    if (q.kind === "bonus2" || q.kind === "bonus7") {
      const profit =
        q.kind === "bonus2"
          ? twoCardProfit(hands[q.player])
          : (SEVEN_CARD_BONUS.find(
              (b) => b.category === result.categories[q.player],
            )?.profit ?? 0);
      return sum + (profit ? amount * BigInt(profit + 1) : 0n);
    }
    if (q.kind === "category") {
      const hit =
        result.categories[q.player] === q.category ||
        (q.category === 8 && result.categories[q.player] === 9);
      return sum + (hit ? (amount * BigInt(q.odds)) / 100n : 0n);
    }
    if (hands.length === 2 && result.winners.length === 2) return sum + debit; // main back/lay push on tie
    if (q.kind === "lay") return sum + (!won ? debit + amount : 0n);
    return (
      sum +
      (won
        ? (amount * BigInt(q.odds)) / BigInt(100 * result.winners.length)
        : 0n)
    );
  }, 0n);
}
export interface StoredPokerRound {
  id: number;
  game: PokerGame;
  hands: number[][];
  board: number[];
  nonce: string;
  commitment: string;
  closesAt: Date;
  revealsAt: Date;
  endsAt: Date;
}
export function publicRound(
  r: StoredPokerRound,
  now: number,
): PokerPublicRound {
  const closes = r.closesAt.getTime(),
    reveals = r.revealsAt.getTime();
  // Street boundaries are persisted implicitly relative to the result deadline.
  const flop = reveals - 3 * POKER_CONFIG.streetMs,
    turn = reveals - 2 * POKER_CONFIG.streetMs,
    river = reveals - POKER_CONFIG.streetMs;
  const phase =
    now < closes
      ? "betting"
      : now < flop
        ? "deal"
        : now < turn
          ? "flop"
          : now < river
            ? "turn"
            : now < reveals
              ? "river"
              : "result";
  const shown =
    phase === "flop"
      ? 3
      : phase === "turn"
        ? 4
        : phase === "river" || phase === "result"
          ? 5
          : 0;
  return {
    id: r.id,
    game: r.game,
    phase,
    closesAt: closes,
    revealsAt: reveals,
    endsAt: r.endsAt.getTime(),
    commitment: r.commitment,
    phaseEndsAt:
      phase === "betting"
        ? closes
        : phase === "deal"
          ? flop
          : phase === "flop"
            ? turn
            : phase === "turn"
              ? river
              : phase === "river"
                ? reveals
                : r.endsAt.getTime(),
    hands: r.hands.map((h) =>
      phase !== "betting" || r.game === "poker-six-players" ? h : [null, null],
    ),
    board: r.board.map((c, i) => (i < shown ? c : null)),
    ...(phase === "result"
      ? { nonce: r.nonce, outcome: outcome(r.hands, r.board) }
      : {}),
  };
}
