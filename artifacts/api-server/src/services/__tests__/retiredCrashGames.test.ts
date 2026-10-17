import assert from "node:assert/strict";
import { test } from "node:test";
import { placeBet } from "../bets";
import { currentCrashRound } from "../crashRounds";
import { generateRound, updateGameConfig } from "../rtp";

// These calls must reject before any database query or wallet mutation.
for (const gameCode of ["lunar", "aviator"]) {
  test(`${gameCode} rejects new play and cannot be re-enabled`, async () => {
    const unavailable = /This game is no longer available/;
    for (const funding of [{}, { useBonus: true }, { useFreeBet: true }]) {
      await assert.rejects(placeBet({
        userId: "retired-game-test", gameCode, stakeAmount: 100n, ...funding,
      }), unavailable);
    }
    await assert.rejects(currentCrashRound("retired-game-test", gameCode), unavailable);
    await assert.rejects(generateRound({ gameCode }), unavailable);
    await assert.rejects(updateGameConfig(gameCode, { enabled: true }, "test-admin"), unavailable);
  });
}
