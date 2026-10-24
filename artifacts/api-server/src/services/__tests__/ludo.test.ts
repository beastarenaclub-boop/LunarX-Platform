import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ludoColors,
  ludoPosition,
  LUDO_PATH,
  type LudoState,
} from "@workspace/api-zod/ludo";
import {
  commitment,
  ludoDie,
  legalTokens,
  rollDie,
  moveToken,
  computerToken,
} from "../ludoRules";
const initial = (n = 2): LudoState => ({
  players: ludoColors(n).map((color, seat) => ({
    seat,
    color,
    name: `P${seat}`,
    kind: "human",
    tokens: [-1, -1, -1, -1],
    auto: false,
    forfeited: false,
  })),
  turn: 0,
  phase: "roll",
  dice: null,
  sixes: 0,
  winner: null,
  rollNonce: 0,
  last: null,
});
test("board has 52 unique cells, opposite two-player homes and isolated home lanes", () => {
  assert.equal(new Set(LUDO_PATH.map((p) => p.join(","))).size, 52);
  assert.deepEqual(ludoColors(2), ["red", "yellow"]);
  for (const color of ludoColors(4))
    for (let i = 0; i <= 55; i++) {
      const p = ludoPosition(color, i, 0);
      assert.ok(p.every((c) => c >= 0 && c < 15));
      if (i > 50) assert.ok(!LUDO_PATH.some((q) => q.join() === p.join()));
    }
});
test("six enters yard, earns extra turn, third six forfeits without moving", () => {
  const s = initial();
  rollDie(s, 2);
  assert.equal(s.turn, 1);
  rollDie(s, 6);
  assert.deepEqual(legalTokens(s), [0, 1, 2, 3]);
  moveToken(s, 0);
  assert.equal(s.players[1]!.tokens[0], 0);
  assert.equal(s.turn, 1);
  rollDie(s, 6);
  moveToken(s, 0);
  rollDie(s, 6);
  assert.equal(s.turn, 0);
  assert.equal(s.phase, "roll");
  assert.equal(s.players[1]!.tokens[0], 6);
  assert.match(s.last!.text, /third six/);
});
test("exact home roll, no finished-token movement, win only after four homes", () => {
  const s = initial();
  s.players[0]!.tokens = [56, 56, 56, 55];
  rollDie(s, 2);
  assert.equal(s.turn, 1);
  s.turn = 0;
  s.phase = "roll";
  rollDie(s, 1);
  assert.deepEqual(legalTokens(s), [3]);
  moveToken(s, 3);
  assert.equal(s.winner, 0);
});
test("unsafe landing captures all opposing stacked tokens; safe stars protect", () => {
  const s = initial();
  s.players[0]!.tokens = [30, -1, -1, -1];
  s.players[1]!.tokens = [5, 5, -1, -1];
  rollDie(s, 1);
  moveToken(s, 0);
  assert.deepEqual(s.players[1]!.tokens, [-1, -1, -1, -1]);
  assert.equal(s.last!.captured, 2);
  assert.equal(s.turn, 0);
  s.players[0]!.tokens[0] = 33;
  s.players[1]!.tokens[0] = 8;
  rollDie(s, 1);
  moveToken(s, 0);
  assert.equal(s.players[1]!.tokens[0], 8);
  assert.equal(s.turn, 1);
});
test("home lanes cannot capture; stacks do not block and illegal move cannot mutate", () => {
  const s = initial();
  s.players[0]!.tokens = [50, -1, -1, -1];
  s.players[1]!.tokens = [25, 25, -1, -1];
  rollDie(s, 1);
  const saved = structuredClone(s);
  assert.throws(() => moveToken(s, 1));
  assert.deepEqual(s, saved);
  moveToken(s, 0);
  assert.equal(s.players[0]!.tokens[0], 51);
  assert.deepEqual(s.players[1]!.tokens, [25, 25, -1, -1]);
});
test("forfeited players are skipped, finishing a token earns a bonus roll", () => {
  const s = initial(4);
  s.players[1]!.forfeited = true;
  rollDie(s, 2);
  assert.equal(s.turn, 2);
  s.players[2]!.tokens[0] = 55;
  rollDie(s, 1);
  moveToken(s, 0);
  assert.equal(s.turn, 2);
  assert.equal(s.phase, "roll");
});
test("dice reproduce from seed and nonce with no obvious frequency bias", () => {
  assert.equal(
    commitment("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  const counts = Array(6).fill(0);
  for (let nonce = 0; nonce < 12000; nonce++) {
    const d = ludoDie("fixed-seed", "match", nonce);
    assert.equal(d, ludoDie("fixed-seed", "match", nonce));
    counts[d - 1]++;
  }
  assert.ok(counts.every((n) => n > 1800 && n < 2200));
});
test("computer completes full 2- and 4-player matches with only legal moves", () => {
  for (const n of [2, 4])
    for (let game = 0; game < 30; game++) {
      const s = initial(n);
      let steps = 0;
      while (s.winner === null && steps++ < 10000) {
        if (s.phase === "roll")
          rollDie(s, ludoDie(`seed${game}`, "simulation", s.rollNonce));
        else {
          const token = computerToken(s);
          assert.ok(legalTokens(s).includes(token));
          moveToken(s, token);
        }
        for (const p of s.players)
          assert.ok(p!.tokens.every((pos) => pos >= -1 && pos <= 56));
      }
      assert.notEqual(s.winner, null);
      assert.ok(s.players[s.winner!]!.tokens.every((pos) => pos === 56));
    }
});
