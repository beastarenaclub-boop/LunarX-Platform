/**
 * Long-run simulation: derive 10,000 crash points using the production
 * `deriveCrashPoint` math at the configured house edge and verify the
 * empirical house margin lands inside the expected ±2% band.
 *
 * Run with:  pnpm --filter @workspace/api-server run simulate:house-edge
 *
 * The script intentionally does NOT touch the database — it imports the pure
 * crash-derivation function directly so it is safe to run anywhere.
 */
import { deriveCrashPoint, generateSeed } from "./rtp";

// Keep in lockstep with the live default (3% edge, real-Aviator style) in
// lib/db/src/schema/game.ts and lib/db/drizzle/0026_crash_rtp_backfill.sql.
const HOUSE_EDGE = 0.03;
const MAX_MULT = 1000;
const ROUNDS = 10_000;
// Player strategy: cash out at a fixed 1.5× target. The empirical margin is
// invariant to the chosen target above 1.0×, so any constant target works.
const CASHOUT_TARGET = 1.5;
const TOLERANCE = 0.02; // ±2%

function runSimulation(): { margin: number; rtp: number } {
  let totalStake = 0;
  let totalPayout = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const serverSeed = generateSeed(32);
    const clientSeed = generateSeed(16);
    const crash = deriveCrashPoint(serverSeed, clientSeed, i, HOUSE_EDGE, MAX_MULT);
    totalStake += 1;
    if (crash >= CASHOUT_TARGET) {
      totalPayout += CASHOUT_TARGET;
    }
  }
  const rtp = totalPayout / totalStake;
  const margin = 1 - rtp;
  return { margin, rtp };
}

function main() {
  const { margin, rtp } = runSimulation();
  // eslint-disable-next-line no-console
  console.log(
    `[house-edge sim] rounds=${ROUNDS} houseEdge=${HOUSE_EDGE} ` +
      `cashoutTarget=${CASHOUT_TARGET} empiricalMargin=${(margin * 100).toFixed(2)}% ` +
      `rtp=${(rtp * 100).toFixed(2)}%`,
  );
  const drift = Math.abs(margin - HOUSE_EDGE);
  if (drift > TOLERANCE) {
    // eslint-disable-next-line no-console
    console.error(
      `[house-edge sim] FAIL drift=${(drift * 100).toFixed(2)}% > tolerance=${(TOLERANCE * 100).toFixed(2)}%`,
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[house-edge sim] PASS drift=${(drift * 100).toFixed(2)}% within ±${(TOLERANCE * 100).toFixed(0)}%`,
  );
}

main();
