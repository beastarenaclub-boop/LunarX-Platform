import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LUCKY7_BET_TYPES,
  lucky7Payouts as versionedPayouts,
  parseStoredLucky7Bets,
  settleLucky7Bets as versionedSettlement,
} from "../lucky7Math";

const lucky7Payouts = (edge:number,cap:number) => versionedPayouts(edge,cap,2);
const settleLucky7Bets = (...args: Parameters<typeof versionedSettlement>) => versionedSettlement(args[0],args[1],args[2],args[3],args[4] ?? 2);
const oneRupeeEach = LUCKY7_BET_TYPES.map(type => ({ type, amountPaise: 100n }));

test("fixed paytable returns Rs 2 / Rs 12 / Rs 2 regardless of legacy edge or cap", () => {
  for (const edge of [0, 0.03, 0.2, 0.99]) {
    for (const cap of [2, 6, 12, 100]) {
      assert.deepEqual(lucky7Payouts(edge, cap), { under: 2, exactly: 12, over: 2 });
    }
  }
});

test("all 36 rolls pay exactly one spot and exclude seven from both sides", () => {
  for (let first = 1; first <= 6; first++) {
    for (let second = 1; second <= 6; second++) {
      const total = first + second;
      const result = settleLucky7Bets(oneRupeeEach, { dice: [first, second], total }, 0.03, 12);
      const winner = total < 7 ? "under" : total > 7 ? "over" : "exactly";
      assert.equal(result.totalStake, 300n);
      assert.equal(result.totalPayout, total === 7 ? 1200n : 200n);
      for (const bet of result.settled) {
        assert.equal(bet.didWin, bet.type === winner);
        assert.equal(bet.payoutPaise, bet.type !== winner ? "0" : total === 7 ? "1200" : "200");
      }
    }
  }
});

test("Under and Over together both lose on seven; no stake is refunded", () => {
  const result = settleLucky7Bets(oneRupeeEach.filter(b => b.type !== "exactly"), { dice: [3, 4], total: 7 }, 0.03, 12);
  assert.equal(result.totalStake, 200n);
  assert.equal(result.totalPayout, 0n);
  assert.ok(result.settled.every(b => !b.didWin && b.payoutPaise === "0"));
});

test("returns include the original stake and preserve paise on larger bets", () => {
  for (const stake of [1n, 100n, 12_345n, 50_000_000n]) {
    const exact = settleLucky7Bets([{ type: "exactly", amountPaise: stake }], { dice: [1, 6], total: 7 }, 0.03, 12);
    assert.equal(exact.totalPayout, stake * 12n);
    const over = settleLucky7Bets([{ type: "over", amountPaise: stake }], { dice: [6, 6], total: 12 }, 0.03, 12);
    assert.equal(over.totalPayout, stake * 2n);
  }
});

test("stored versions distinguish old edge-scaled audits from fixed paytable audits", () => {
  const roll = { dice: [3, 4] as [number, number], total: 7 };
  const legacy = settleLucky7Bets(oneRupeeEach, roll, 0.03, 12, 1);
  const fixed = settleLucky7Bets(oneRupeeEach, roll, 0.03, 12);
  for (const payload of [legacy.settled, { payoutVersion: 1, bets: legacy.settled }, { payoutVersion: 2, bets: fixed.settled }]) {
    const stored = parseStoredLucky7Bets(payload);
    const replay = settleLucky7Bets(stored.bets.map(b => ({ type: b.type, amountPaise: BigInt(b.amountPaise) })), roll, 0.03, 12, stored.payoutVersion);
    assert.deepEqual(replay.settled, stored.bets);
    assert.equal(replay.totalPayout, stored.payoutVersion === 1 ? 582n : 1200n);
  }
  assert.throws(() => parseStoredLucky7Bets({ payoutVersion: 99, bets: [] }), /INVALID_LUCKY7_STORED_BETS/);
});
