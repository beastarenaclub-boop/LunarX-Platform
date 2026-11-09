/**
 * The bank floor's three modes, DB-free (operator request, 2026-09-23).
 *
 *   F1  the floor test reads the stream's own bank and floor when the scope
 *       has no budget — the shipped behaviour, unchanged
 *   F2  a floor override swaps the FIGURE only: still each game's own bank
 *   F3  `combined` swaps BOTH: the scope's summed bank against one figure,
 *       which is the only mode that changes what the engine may pick
 *   F4  every steering mode honours it — a result legal per game and illegal
 *       against the shared budget is refused in collect, distribute, auto
 *       and rtp alike, and the reverse is allowed
 *   F5  negative controls: each probe can fail, and nothing but the floor
 *       moved (the record's bankBefore is still the STREAM's own bank)
 *
 * A ten-pocket synthetic game, as `partyBalance.test.ts` uses: one slip is
 * one pocket at 10×, so what each result costs the house is obvious.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeExposure, type ExposureSlip } from "../exposure";
import {
  aboveFloor,
  decide,
  effectiveBankPaise,
  effectiveFloorPaise,
  type BankState,
} from "../selectors";
import { DEFAULT_PARAMS, type EngineParams } from "../params";
import { SeededRng } from "../rng";

const POCKETS = 10;
type Bet = { pocket: number; stake: bigint };
const payoutFor = (bets: unknown, outcome: unknown) => {
  const b = bets as Bet;
  return b.pocket === outcome ? b.stake * 10n : 0n;
};
const candidates = Array.from({ length: POCKETS }, (_, i) => ({
  id: String(i),
  label: String(i),
  outcome: i,
}));
const slip = (pocket: number, stake: bigint): ExposureSlip => ({
  userId: `u${pocket}`,
  bets: { pocket, stake },
  stakePaise: stake,
});
const exposureOf = (slips: ExposureSlip[]) =>
  computeExposure(candidates, slips, 0.6, payoutFor, true);

function bank(over: Partial<BankState> = {}): BankState {
  return {
    bankPaise: 0n,
    minBankFloorPaise: 0n,
    zeroBetStreak: 0,
    beneficiaryStreak: 0,
    lastBeneficiaryUserId: null,
    recentChoiceIds: [],
    windowStakedPaise: 0n,
    windowHouseNetPaise: 0n,
    cumulativeStakedPaise: 0n,
    cumulativePayoutPaise: 0n,
    ...over,
  };
}
const params = (over: Partial<EngineParams> = {}): EngineParams => ({
  ...DEFAULT_PARAMS,
  rtpMaxRepeat: 50,
  rtpTieBandPct: 0,
  noiseRate: 0.02,
  ...over,
});

test("F1 with no budget the floor test is the stream's own bank against its own floor", () => {
  const b = bank({ bankPaise: 1_000n, minBankFloorPaise: -500n });
  assert.equal(effectiveBankPaise(b), 1_000n);
  assert.equal(effectiveFloorPaise(b), -500n);
  // −1,499 leaves it at −499, a whisker above the floor; −1,501 breaches it.
  assert.equal(aboveFloor(b, -1_499n), true);
  assert.equal(aboveFloor(b, -1_501n), false);
  assert.equal(aboveFloor(b, -1_500n), true, "exactly ON the floor is allowed, as it always was");
});

/**
 * A floor override on its own swaps the FIGURE and leaves the bank alone.
 *
 * Only `combined` sends one now: `same_each` is written into each game's own
 * floor at the save instead (`bankBudget.integration` G4 is why — a budget
 * re-derived per decision follows the bank down and stops being cumulative).
 * The selector-level property is still worth pinning: it is what `combined`
 * rests on, and what a third shared mode would rest on.
 */
test("F2 a floor override swaps the figure and nothing else", () => {
  const b = bank({ bankPaise: 1_000n, minBankFloorPaise: -500n, budgetFloorPaise: -5_000n });
  assert.equal(effectiveBankPaise(b), 1_000n, "still measured against THIS game's bank");
  assert.equal(effectiveFloorPaise(b), -5_000n, "but against the overriding figure");
  assert.equal(aboveFloor(b, -5_999n), true, "the shared floor is looser here, so this now passes");
  assert.equal(aboveFloor(b, -6_001n), false);
});

test("F3 combined swaps both: the scope's summed bank against one figure", () => {
  // This game is deep in the red; the others are up, so the group is fine.
  const b = bank({
    bankPaise: -40_000n,
    minBankFloorPaise: 0n,
    budgetFloorPaise: -50_000n,
    budgetBankPaise: 10_000n,
  });
  assert.equal(effectiveBankPaise(b), 10_000n);
  assert.equal(effectiveFloorPaise(b), -50_000n);
  assert.equal(aboveFloor(b, -59_999n), true, "the group has the room even though this game does not");
  assert.equal(aboveFloor(b, -60_001n), false, "and the group's budget is what stops it");
  // Per game, with its own floor of 0, every one of those would have been refused.
  const own = bank({ bankPaise: -40_000n, minBankFloorPaise: 0n });
  assert.equal(aboveFloor(own, -1n), false);
});

/**
 * F4 — the modes, not just the helper.
 *
 * EVERY pocket is backed, at a different stake, so every result costs the
 * house a different amount and there is no free pocket for a mode to escape
 * to. Result 0 (the smallest stake) keeps the most; set the shared budget
 * exactly there and it is the only result that clears, so every steering mode
 * has to take it however much it wanted another. The floor outranking the
 * mode is old behaviour — what is new is that it reads the SCOPE's budget
 * rather than this stream's own bank and floor.
 *
 * Several seeds per mode, because a round can roll noise and steer nothing:
 * that is not the floor being ignored, so it is skipped — but at least one
 * round has to steer or the assertion proves nothing.
 */
const LADDER = Array.from({ length: POCKETS }, (_, k) => slip(k, BigInt(100 * (k + 1))));
/** Distribute does nothing without a target; the others do not read one. */
const paramsFor = (mode: string) =>
  mode === "distribute" ? params({ targetBankPaise: -99_999_999n }) : params();

test("F4 every steering mode honours a shared budget, against a bank this stream does not have", () => {
  const e = exposureOf(LADDER);
  const best = e.outcomes.find((o) => o.index === 0)!.houseNetPaise;
  assert.ok(
    e.outcomes.every((o) => o.index === 0 || o.houseNetPaise < best),
    "fixture: result 0 must be the single best for the house",
  );

  for (const mode of ["collect", "distribute", "auto", "rtp"] as const) {
    let steered = 0;
    for (let i = 0; i < 8; i++) {
      const seed = `tight-${mode}-${i}`;
      const d = decide(
        mode,
        e,
        paramsFor(mode),
        // This stream's OWN floor is bottomless, so anything refused here is
        // refused by the scope's budget alone.
        bank({
          bankPaise: -9_999_999n,
          minBankFloorPaise: -99_999_999n,
          budgetBankPaise: 0n,
          budgetFloorPaise: best,
          // Auto reads the window and does nothing without turnover in it;
          // holding far below its target makes it collect, so it steers.
          windowStakedPaise: 1_000_000n,
          windowHouseNetPaise: -1_000_000n,
        }),
        new SeededRng(seed),
        seed,
      );
      if (d.choiceIndex === null) continue;
      steered++;
      assert.equal(
        d.choiceIndex,
        0,
        `${mode}: the shared budget was ignored — it picked ${d.choiceIndex}, which breaches it`,
      );
    }
    assert.ok(steered > 0, `${mode}: never steered on any seed, so this proves nothing`);
  }
});

test("F5 negative controls", () => {
  const e = exposureOf(LADDER);
  const best = e.outcomes.find((o) => o.index === 0)!.houseNetPaise;

  // Without the budget the modes go where they wanted, and distribute wants
  // the OTHER end of the ladder — so F4 is not passing merely because every
  // mode happens to agree with the floor.
  let away = 0;
  for (let i = 0; i < 8; i++) {
    const seed = `free-${i}`;
    const d = decide(
      "distribute",
      e,
      paramsFor("distribute"),
      bank({ bankPaise: -9_999_999n, minBankFloorPaise: -99_999_999n }),
      new SeededRng(seed),
      seed,
    );
    if (d.choiceIndex !== null && d.choiceIndex !== 0) away++;
  }
  assert.ok(away > 0, "distribute never picked anything but the best-for-the-house result");

  // The budget moves the FLOOR only: the record still reports this stream's
  // own bank before the round, not the scope's.
  const d = decide(
    "collect",
    e,
    params(),
    bank({ bankPaise: 777n, minBankFloorPaise: -99_999_999n, budgetBankPaise: 0n, budgetFloorPaise: best }),
    new SeededRng("record"),
    "record",
  );
  assert.equal(
    d.bankBeforePaise,
    "777",
    "the decision record took the scope's combined bank as this stream's own",
  );

  // And an unset budget really is unset, rather than defaulting to zero.
  const b = bank({ bankPaise: 5n, minBankFloorPaise: -5n });
  assert.equal(b.budgetFloorPaise, undefined);
  assert.equal(b.budgetBankPaise, undefined);
  assert.equal(effectiveFloorPaise(b), -5n);
  assert.equal(effectiveBankPaise(b), 5n);
});
