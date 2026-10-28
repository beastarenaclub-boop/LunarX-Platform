import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import {
  createStore,
  commitmentFor,
  colorsFor,
  multiplierFor,
} from "../store.mjs";

function fixture(t, result = 5) {
  let time = 1801000;
  const store = createStore(":memory:", {
    now: () => time,
    draw: () => result,
  });
  t.after(() => store.close());
  const token = store.session().token;
  const initial = store.state(token);
  const bet = (pick, stake = 1000, changes = {}) =>
    store.placeBet(token, {
      duration: 30,
      period: initial.round.period,
      pick,
      stake,
      request: randomUUID(),
      ...changes,
    });
  return {
    store,
    token,
    initial,
    bet,
    setTime: (value) => {
      time = value;
    },
  };
}

test("all ten outcomes follow colour, dual-violet, size and exact-number payout rules", () => {
  const expected = [
    [0, 1.5, 4.5, 0, 2],
    [2, 0, 0, 0, 2],
    [0, 2, 0, 0, 2],
    [2, 0, 0, 0, 2],
    [0, 2, 0, 0, 2],
    [1.5, 0, 4.5, 2, 0],
    [0, 2, 0, 2, 0],
    [2, 0, 0, 2, 0],
    [0, 2, 0, 2, 0],
    [2, 0, 0, 2, 0],
  ];
  for (let number = 0; number < 10; number++) {
    assert.deepEqual(
      ["green", "red", "violet", "big", "small"].map((p) =>
        multiplierFor(p, number),
      ),
      expected[number],
    );
    for (let pick = 0; pick < 10; pick++)
      assert.equal(
        multiplierFor(String(pick), number),
        pick === number ? 9 : 0,
      );
  }
  assert.deepEqual(colorsFor(0), ["red", "violet"]);
  assert.deepEqual(colorsFor(5), ["green", "violet"]);
});

test("30-second mode, hidden outcome, and a verifiable commitment after reveal", (t) => {
  const { store, token, initial, setTime } = fixture(t, 0);
  for (const duration of [30]) {
    const round = store.state(token, duration).round;
    assert.equal(round.duration, duration);
    assert.equal(round.ends - round.start, duration * 1000);
    assert.equal(round.number, undefined);
    assert.equal(round.secret, undefined);
    assert.match(round.commitment, /^[a-f0-9]{64}$/);
  }
  assert.equal(initial.history.length, 0);
  setTime(initial.round.ends);
  const revealed = store.state(token).history[0];
  assert.equal(revealed.number, 0);
  assert.equal(revealed.commitment, initial.round.commitment);
  assert.equal(
    commitmentFor(revealed.period, revealed.number, revealed.secret),
    revealed.commitment,
  );
});

test("settles multiple predictions exactly once and accounts for special number 5", (t) => {
  const { store, token, initial, bet, setTime } = fixture(t);
  for (const pick of ["green", "red", "violet", "big", "small", "5"]) bet(pick);
  assert.equal(store.state(token).player.balance, 1000000 - 6000);
  setTime(initial.round.ends);
  store.tick();
  store.tick();
  const settled = store.state(token);
  assert.equal(
    settled.player.balance,
    1000000 - 6000 + 1700 + 4250 + 1700 + 1980,
  );
  assert.equal(settled.summary.played, 6);
  assert.equal(settled.summary.won, 4);
  assert.equal(settled.summary.profit, 3630);
  assert.equal(settled.pending, 0);
  assert.deepEqual(
    settled.bets.map((b) => b.payout).sort((a, b) => a - b),
    [0, 0, 1700, 1700, 1980, 4250],
  );
});

test("request replay never charges twice, including retries after settlement", (t) => {
  const { store, token, initial, bet, setTime } = fixture(t);
  const request = randomUUID();
  bet("green", 1000, { request });
  bet("green", 1000, { request });
  assert.equal(store.state(token).bets.length, 1);
  assert.equal(store.state(token).player.balance, 999000);
  assert.throws(() => bet("red", 1000, { request }), /different prediction/);
  setTime(initial.round.ends);
  const retried = bet("green", 1000, { request });
  assert.equal(retried.player.balance, 1000700);
  assert.equal(retried.bets.length, 1);
});

test("locks exactly five seconds before close and rejects stale periods", (t) => {
  const { initial, bet, setTime } = fixture(t);
  setTime(initial.round.ends - 5001);
  bet("red");
  setTime(initial.round.ends - 5000);
  assert.throws(() => bet("red"), /locked/);
  setTime(initial.round.ends);
  assert.throws(() => bet("red"), /new round/);
});

test("rejects invalid picks, stakes, sessions, insufficient balance and unsupported timers", (t) => {
  const { store, token, initial, bet } = fixture(t);
  for (const pick of ["blue", "10", "-1", "", null, 4])
    assert.throws(() => bet(pick));
  for (const stake of [0, -100, 101, 1.5, NaN, Infinity, "100", 1000001])
    assert.throws(() => bet("green", stake));
  assert.throws(() => bet("green", 100, { duration: 15 }));
  assert.throws(() => store.state("unknown"), /expired/);
  assert.throws(() => store.state(token, 15), /supported/);
  bet("green", 1000000);
  assert.throws(() => bet("red", 100), /enough/);
  const state = store.state(token);
  assert.equal(state.player.balance, 0);
  assert.equal(state.bets.length, 1);
  assert.equal(state.bets[0].number, null);
  assert.equal(state.round.period, initial.round.period);
});

test("separate players have private wallets and bets but see the same rounds", (t) => {
  const { store, token, initial, bet } = fixture(t);
  const other = store.session().token;
  bet("green");
  assert.equal(store.state(other).round.commitment, initial.round.commitment);
  assert.equal(store.state(other).bets.length, 0);
  assert.equal(store.state(other).player.balance, 1000000);
  assert.equal(store.state(token).player.balance, 999000);
});

test("practice wallet settles only 30-second rounds", (t) => {
  const { store, token, setTime } = fixture(t);
  for (const duration of [30]) {
    const round = store.state(token, duration).round;
    store.placeBet(token, {
      duration,
      period: round.period,
      pick: "5",
      stake: 100,
      request: randomUUID(),
    });
  }
  assert.equal(store.state(token).pending, 1);
  assert.equal(store.state(token).player.balance, 999900);
  setTime(2100000);
  const after = store.state(token);
  assert.equal(after.pending, 0);
  assert.equal(after.player.balance, 1000098);
});

test("free refill requires low balance and no pending bets; it never erases history", (t) => {
  const { store, token, initial, bet, setTime } = fixture(t, 1);
  assert.throws(() => store.refill(token), /below 1,000/);
  bet("red", 1000000);
  assert.throws(() => store.refill(token), /active predictions/);
  setTime(initial.round.ends);
  const state = store.refill(token);
  assert.equal(state.player.balance, 1000000);
  assert.equal(state.bets.length, 1);
  assert.equal(state.summary.profit, -1000000);
  assert.throws(() => store.refill(token), /below 1,000/);
});

test("restart preserves commitment, settles overdue bets once, and does not fabricate history", () => {
  const tempRoot = resolve("tmp/wingo-tests");
  mkdirSync(tempRoot, { recursive: true });
  const filename = resolve(
    mkdtempSync(resolve(tempRoot, "restart-")),
    "game.sqlite",
  );
  let time = 1801000;
  let store = createStore(filename, { now: () => time, draw: () => 0 });
  const token = store.session().token,
    initial = store.state(token);
  store.placeBet(token, {
    duration: 30,
    period: initial.round.period,
    pick: "violet",
    stake: 1000,
    request: randomUUID(),
  });
  store.close();
  time = 2101000;
  store = createStore(filename, { now: () => time, draw: () => 9 });
  const next = store.state(token);
  store.close();
  assert.equal(next.player.balance, 1003250);
  assert.equal(next.history.length, 1);
  assert.equal(next.history[0].commitment, initial.round.commitment);
  assert.equal(next.history[0].number, 0);
  store = createStore(filename, { now: () => time });
  assert.equal(store.state(token).player.balance, 1003250);
  store.close();
});
