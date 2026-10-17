import { test } from "node:test";
import assert from "node:assert/strict";
import { crashBetInput } from "../../lib/crashBetInput";

test("JetX accepts four distinct panels and rejects out-of-range IDs", () => {
  const input = { gameCode: "jetx", stakeAmount: "20000", roundId: "crash-test" };
  for (const panel of [0, 1, 2, 3]) assert.equal(crashBetInput.parse({ ...input, panel }).panel, panel);
  for (const panel of [-1, 4, 1.5, "3"]) assert.equal(crashBetInput.safeParse({ ...input, panel }).success, false);
});

test("extra JetX panels cannot place hidden bets in a two-panel game", () => {
  for (const gameCode of ["lunar", "aviator", "fury"]) {
    for (const panel of [0, 1]) assert.equal(crashBetInput.safeParse({ gameCode, stakeAmount: "20000", panel }).success, true);
    for (const panel of [2, 3]) assert.equal(crashBetInput.safeParse({ gameCode, stakeAmount: "20000", panel }).success, false);
  }
  assert.equal(crashBetInput.safeParse({ gameCode: "jetx", stakeAmount: "20000", autoCashOut: 1.005 }).success, false);
});
