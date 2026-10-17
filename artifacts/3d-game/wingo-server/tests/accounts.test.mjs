import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { createStore } from "../store.mjs";

test("platform accounts keep separate balances across login sessions and restarts", () => {
  const root = resolve("tmp/wingo-tests");
  mkdirSync(root, { recursive: true });
  const filename = resolve(
    mkdtempSync(resolve(root, "accounts-")),
    "game.sqlite",
  );
  let time = 1801000;
  let store = createStore(filename, { now: () => time, draw: () => 7 });
  const alice = store.accountSession("platform-alice");
  const bob = store.accountSession("platform-bob");
  assert.notEqual(alice, bob);
  assert.equal(store.accountSession("platform-alice"), alice);
  const round = store.state(alice).round;
  store.placeBet(alice, {
    duration: 30,
    period: round.period,
    pick: "7",
    stake: 1000,
    request: randomUUID(),
  });
  assert.equal(store.state(bob).player.balance, 1000000);
  assert.equal(store.state(bob).bets.length, 0);
  store.close();
  time = round.ends;
  store = createStore(filename, { now: () => time });
  try {
    assert.equal(store.accountSession("platform-alice"), alice);
    assert.equal(store.state(alice).player.balance, 1008000);
    assert.equal(
      store.state(store.accountSession("platform-bob")).player.balance,
      1000000,
    );
    assert.throws(() => store.accountSession(""), /Invalid account/);
    assert.throws(() => store.accountSession(null), /Invalid account/);
  } finally {
    store.close();
  }
});
