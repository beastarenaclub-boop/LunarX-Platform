import { expect, test } from "@playwright/test";
import {
  analyzeHand,
  autoStep,
  beginPlay,
  bestDiscard,
  createDeck,
  discardCard,
  drawCard,
  initialTable,
  meldKind,
  startRound,
  type Card,
  type Suit,
  type TableState,
} from "../src/game/rummy/engine";

function cards(input: string): Card[] {
  const used = new Map<string, number>();
  return input.split(" ").map((token) => {
    const suit = token[0] as Suit;
    const rank = Number(token.slice(1));
    const deck = used.get(token) ?? 0;
    used.set(token, deck + 1);
    return { id: `${deck}-${suit}-${rank}`, suit, rank };
  });
}
const winning = "H3 H4 H5 S7 S8 S9 D11 C11 H11 C1 C2 C3 C4";
function rigged(hand: Card[], extra: Partial<TableState> = {}): TableState {
  const s = beginPlay(startRound(({ ...initialTable(), balance: 10000 }), 50, () => 0.37));
  return {
    ...s,
    step: hand.length === 14 ? "discard" : "draw",
    players: s.players.map((p, i) => (i ? p : { ...p, hand })),
    ...extra,
  };
}

test("two decks have distinct physical cards; ace runs never wrap; sets reject duplicate suits", () => {
  const deck = createDeck();
  expect(deck).toHaveLength(106);
  expect(new Set(deck.map((c) => c.id)).size).toBe(106);
  expect(meldKind(cards("H1 H2 H3"), 7)).toBe("pure");
  expect(meldKind(cards("H12 H13 H1"), 7)).toBe("pure");
  expect(meldKind(cards("H13 H1 H2"), 7)).toBeNull();
  expect(meldKind(cards("H8 H8 D8"), 7)).toBeNull();
  expect(meldKind(cards("H8 C8 D8 S8"), 7)).toBe("set");
});

test("joker substitution and natural wild cards follow sequence rules", () => {
  expect(meldKind(cards("H3 H4 H5"), 4)).toBe("pure");
  expect(meldKind(cards("H3 C4 H5"), 4)).toBe("sequence");
  expect(meldKind(cards("H3 J0 H5"), 8)).toBe("sequence");
  expect(meldKind(cards("H3 J0 H7"), 8)).toBeNull();
  expect(meldKind(cards("H8 D8 J0"), 3)).toBe("set");
});

test("declaration needs all 13 unique cards and two sequences, including one pure", () => {
  const analysis = analyzeHand(cards(winning), 10);
  expect(analysis.valid).toBe(true);
  expect(analysis.points).toBe(0);
  expect(
    new Set(analysis.groups.flatMap((g) => g.cards.map((c) => c.id))).size,
  ).toBe(13);
  expect(
    analyzeHand(cards("H3 J0 H5 S7 J0 S9 D11 C11 H11 D2 C2 H2 S2"), 10).valid,
  ).toBe(false);
  expect(
    analyzeHand(cards("H3 H4 H5 D7 C7 S7 D11 C11 H11 D8 C8 H8 S8"), 10).valid,
  ).toBe(false);
  expect(analyzeHand([...cards(winning), ...cards("D2")], 10).valid).toBe(
    false,
  );
  const duplicate = cards(winning);
  duplicate[12] = duplicate[11];
  expect(() => analyzeHand(duplicate, 10)).toThrow();
});

test("best discard finds a valid declaration without re-discarding the open pickup", () => {
  const hand = cards(`${winning} D13`);
  const choice = bestDiscard(hand, 10);
  expect(choice.card.id).toBe("0-D-13");
  expect(choice.analysis.valid).toBe(true);
  expect(bestDiscard(hand, 10, "0-D-13").card.id).not.toBe("0-D-13");
});

test("entry, draws and discards cannot be applied twice; invalid declaration cannot settle", () => {
  const ready = ({ ...initialTable(), balance: 10000 });
  expect(startRound(ready, -1)).toBe(ready);
  expect(startRound({ ...ready, balance: 20 }, 25).phase).toBe("ready");
  const dealing = startRound(ready, 50, () => 0.31);
  expect(dealing.balance).toBe(9950);
  expect(startRound(dealing, 50)).toBe(dealing);
  expect(dealing.players.every((p) => p.hand.length === 13)).toBe(true);
  const playing = beginPlay(dealing);
  expect(discardCard(playing, playing.players[0].hand[0].id)).toBe(playing);
  const drawn = drawCard(playing, "stock");
  expect(drawn.players[0].hand).toHaveLength(14);
  expect(drawCard(drawn, "stock")).toBe(drawn);
  const invalid = discardCard(drawn, drawn.players[0].hand[0].id, true);
  expect(invalid.phase).toBe("playing");
  expect(invalid.balance).toBe(9950);
  expect(invalid.players[0].hand).toHaveLength(14);
  const next = discardCard(drawn, drawn.players[0].hand[0].id);
  expect(next.players[0].hand).toHaveLength(13);
  expect(next.current).toBe(1);
  expect(discardCard(next, next.players[0].hand[0].id)).toBe(next);
});

test("open joker is locked, and a taken open card must stay for one turn", () => {
  const s = rigged(cards(winning), { wild: 10, discard: cards("H10") });
  expect(drawCard(s, "open")).toBe(s);
  const open = drawCard({ ...s, discard: cards("D13") }, "open");
  expect(open.drawnFromOpen).toBe("0-D-13");
  expect(discardCard(open, "0-D-13")).toBe(open);
});

test("winner receives the pot once; exhausted deck returns exactly one entry", () => {
  const s = rigged(cards(`${winning} D13`), { wild: 10 });
  const won = discardCard(s, "0-D-13", true);
  expect(won.phase).toBe("finished");
  expect(won.balance).toBe(10150);
  expect(won.result).toMatchObject({ winner: 0, payout: 200, net: 150 });
  expect(discardCard(won, "0-D-13", true)).toBe(won);
  expect(autoStep(won)).toBe(won);
  const drawn = discardCard({ ...s, stock: [] }, "0-D-13");
  expect(drawn.balance).toBe(10000);
  expect(drawn.result).toMatchObject({ winner: null, payout: 50, net: 0 });
});

test("automated full rounds conserve every card and terminate with a validated result", () => {
  test.setTimeout(60000);
  for (let seed = 1; seed <= 3; seed++) {
    let value = seed;
    const random = () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
    let s = beginPlay(startRound(({ ...initialTable(), balance: 10000 }), 100, random));
    let steps = 0;
    while (s.phase === "playing" && steps++ < 410) {
      s = autoStep(s);
      const all = [
        ...s.players.flatMap((p) => p.hand),
        ...s.stock,
        ...s.discard,
        s.indicator!,
      ];
      expect(all).toHaveLength(106);
      expect(new Set(all.map((c) => c.id)).size).toBe(106);
      expect(
        s.players.every(
          (p, i) =>
            p.hand.length ===
            (s.phase === "playing" && s.step === "discard" && i === s.current
              ? 14
              : 13),
        ),
      ).toBe(true);
    }
    expect(s.phase).toBe("finished");
    expect(s.history).toHaveLength(1);
    if (s.result!.winner !== null)
      expect(analyzeHand(s.players[s.result!.winner].hand, s.wild).valid).toBe(
        true,
      );
    expect(s.balance).toBe(
      s.result!.winner === null ? 10000 : s.result!.winner === 0 ? 10300 : 9900,
    );
  }
});
