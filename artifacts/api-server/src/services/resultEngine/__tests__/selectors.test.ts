/**
 * The result engine's decision logic.
 *
 * Everything here is pure, so none of it needs a database — which is the point
 * of the split. The load-bearing tests are E3 (the noise roll happens BEFORE
 * anything is ranked), E5 (the bank floor outranks every target), E9 (the
 * streak guard's absolute floor of 6, which was 3 and fired on half of all fair
 * windows) and E10 (a guard read against each class's OWN odds, which is what
 * lets one engine serve a wheel and a card table).
 *
 * The exposure is built through roulette's real space and real settle, so a
 * change to either shows up here rather than in production.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SeededRng } from "../rng";
import { DEFAULT_PARAMS, toEngineMode, type EngineParams } from "../params";
import { computeExposure, type ExposureCandidate, type ExposureSlip } from "../exposure";
import { decide, eligible, streaking, weightedPick } from "../selectors";
import type { BankState } from "../selectors";
import { CLASSIC } from "../../../games/roulette/wheel";
import { rouletteOutcomeSpace } from "../../../games/roulette/outcomes";
import { settleRouletteBets } from "../../../games/roulette/math";

const rupees = (n: number) => BigInt(n) * 100n;
const SPACE = rouletteOutcomeSpace(CLASSIC);
const SEED = { serverSeed: "s", clientSeed: "c", nonce: 1 };

const CANDIDATES: ExposureCandidate[] = SPACE.candidates(SEED).map((c) => {
  const choice = SPACE.choices().find((x) => x.id === c.choiceId)!;
  return { ...choice, outcome: c.outcome };
});

const payoutFor = (bets: unknown, outcome: unknown) =>
  settleRouletteBets(
    CLASSIC,
    bets as Parameters<typeof settleRouletteBets>[1],
    (outcome as { pocket: number }).pocket,
    36,
  ).totalPayout;

function params(over: Partial<EngineParams> = {}): EngineParams {
  return { ...DEFAULT_PARAMS, ...over };
}

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
    ...over,
  };
}

function book(slips: ExposureSlip[], whale = 0.6) {
  return computeExposure(CANDIDATES, slips, whale, payoutFor);
}

const slip = (userId: string, bets: unknown, stake: bigint): ExposureSlip => ({
  userId,
  bets,
  stakePaise: stake,
});

/** One player, one straight-up chip on 17. */
const ON_17 = [
  slip("u1", [{ type: "straight", selection: [17], amountPaise: rupees(100) }], rupees(100)),
];

const at = (e: ReturnType<typeof book>, pocket: number) =>
  e.outcomes.find((o) => o.choiceId === String(pocket))!;

test("E1 exposure is priced by the game's own settle, on every outcome", () => {
  const e = book([
    slip("u1", [{ type: "red", selection: [], amountPaise: rupees(100) }], rupees(100)),
  ]);
  assert.equal(e.totalStakedPaise, rupees(100));
  assert.equal(e.betCount, 1);
  // A red pocket pays 2x, stake included, so the house is down its own stake.
  assert.equal(at(e, 1).payoutPaise, rupees(200));
  assert.equal(at(e, 1).houseNetPaise, rupees(100) - rupees(200));
  // A black pocket and both zeros: the house keeps the lot.
  assert.equal(at(e, 2).houseNetPaise, rupees(100));
  assert.equal(at(e, 0).houseNetPaise, rupees(100));
  assert.equal(at(e, CLASSIC.doubleZero!).houseNetPaise, rupees(100));
});

test("E2 normal mode reads nothing and never steers", () => {
  const e = book(ON_17);
  for (let i = 0; i < 50; i++) {
    const rng = new SeededRng(`seed-${i}`);
    const d = decide("normal", e, params(), bank(), rng, `seed-${i}`);
    // The whole point of the rewrite, and of the rename: normal does not pick
    // from the candidate list, it declines to steer and lets the game draw.
    // Picking uniformly here would flatten every game whose outcomes are not
    // equally likely.
    assert.equal(d.choiceIndex, null, "random mode steered");
    assert.equal(d.candidates.length, 0, "random ranks nothing");
    assert.equal(d.noise, false);
  }
});

test("E3 the noise roll happens BEFORE anything is ranked", () => {
  // At noiseRate 1 every round is noise, and a noise round must leave the game
  // to its own draw rather than ranking and then discarding.
  const e = book(ON_17);
  for (let i = 0; i < 25; i++) {
    const rng = new SeededRng(`n-${i}`);
    const d = decide("collect", e, params({ noiseRate: 1 }), bank(), rng, `n-${i}`);
    assert.equal(d.noise, true);
    assert.equal(d.choiceIndex, null);
    assert.equal(d.candidates.length, 0, "a noise round ranked candidates anyway");
  }
});

test("E4 collect prefers the pockets the house wins on", () => {
  const e = book(ON_17);
  let steered = 0;
  for (let i = 0; i < 2000; i++) {
    const rng = new SeededRng(`c-${i}`);
    const d = decide("collect", e, params({ noiseRate: 0.02 }), bank(), rng, `c-${i}`);
    if (d.choiceIndex === null) continue;
    steered += 1;
    // 17 is the one pocket that costs the house money, so collect must avoid it.
    assert.notEqual(d.choiceId, "17", "collect chose the one losing pocket");
  }
  assert.ok(steered > 40, `expected mostly steered rounds, got ${steered}`);
});

test("E5 the bank floor outranks every target and still resolves", () => {
  const e = book(ON_17);
  const alerts: string[] = [];
  // A floor nothing can satisfy: the pool collapses to the single best outcome
  // rather than emptying, because a stranded round holds every stake.
  const pool = eligible(
    e,
    bank({ bankPaise: 0n, minBankFloorPaise: rupees(1_000_000) }),
    params(),
    alerts as never,
  );
  assert.equal(pool.length, 1);
  assert.ok(alerts.includes("BANK_FLOOR_UNREACHABLE"));
  assert.equal(pool[0]!.houseNetPaise, rupees(100));
});

test("E6 an empty book steers nowhere", () => {
  const e = book([]);
  const rng = new SeededRng("empty");
  const d = decide("collect", e, params(), bank(), rng, "empty");
  assert.equal(d.choiceIndex, null);
  assert.match(d.reason, /No bets/u);
});

test("E7 weightedPick leaves every candidate reachable", () => {
  const e = book(ON_17);
  const { candidates } = weightedPick(
    new SeededRng("w"),
    e.outcomes,
    (p) => Number(p.houseNetPaise),
  );
  // The shift is what stops the worst candidate having zero weight. A pool
  // holding an unreachable option would be a lie about what could have happened.
  assert.equal(candidates.length, e.outcomes.length);
  assert.ok(candidates.every((c) => c.weight > 0), "a candidate could never be drawn");
});

test("E8 distribute paces a sparse high-multiplier book instead of paying every round", () => {
  const e = book(ON_17);
  let sawLoser = 0;
  for (let i = 0; i < 2000; i++) {
    const rng = new SeededRng(`d-${i}`);
    const d = decide(
      "distribute",
      e,
      params({ noiseRate: 0.02, targetBankPaise: 0n }),
      bank({ bankPaise: rupees(10_000) }),
      rng,
      `d-${i}`,
    );
    if (d.choiceId === "17") sawLoser += 1;
  }
  // 17 is the only pocket on the book that loses money, so a giving round has
  // nowhere else to go.
  assert.ok(sawLoser > 100 && sawLoser < 260, `paced distribution paid ${sawLoser}/2000 rounds`);
});

test("E9 the streak guard's floor of 6 — at 3 it fired on half of all fair windows", () => {
  const uniform = Object.fromEntries(
    SPACE.choices().map((c) => [c.id, 1 / CLASSIC.pocketCount]),
  );
  const five = ["7", "7", "7", "7", "7", "1", "2", "3", "4", "5"];
  assert.equal(streaking(five, CLASSIC.pocketCount, uniform), false, "fired at five");
  const six = ["7", "7", "7", "7", "7", "7", "1", "2", "3", "4"];
  assert.equal(streaking(six, CLASSIC.pocketCount, uniform), true, "missed at six");
  // Under 8 results there is no pattern to see, only a short sample.
  assert.equal(streaking(["7", "7", "7", "7", "7", "7"], CLASSIC.pocketCount, uniform), false);
});

test("E10 the guard reads each class's OWN odds, so a near-even game is not a pattern", () => {
  // The generalisation that lets one engine serve a wheel and a card table.
  // Banker six times in twenty is BELOW its natural rate and must not fire;
  // the same six on a wheel is far past chance and must.
  const cards = ["banker", "banker", "banker", "banker", "banker", "banker",
                 "player", "player", "player", "tie"];
  const cardOdds = { player: 0.4462, banker: 0.4585, tie: 0.0953 };
  assert.equal(streaking(cards, 3, cardOdds), false, "fired on an ordinary banker run");

  const wheel = ["7", "7", "7", "7", "7", "7", "1", "2", "3", "4"];
  const wheelOdds = Object.fromEntries(
    SPACE.choices().map((c) => [c.id, 1 / CLASSIC.pocketCount]),
  );
  assert.equal(streaking(wheel, CLASSIC.pocketCount, wheelOdds), true, "missed a real wheel pattern");
});

test("E12 the old mode name still reads, because a decision's meta keeps it for ever", () => {
  // `round_decision.meta` is a frozen snapshot no migration rewrites, so rows
  // decided before the rename say "random" and mean "normal".
  assert.equal(toEngineMode("random"), "normal");
  assert.equal(toEngineMode("normal"), "normal");
  assert.equal(toEngineMode("collect"), "collect");
  assert.equal(toEngineMode("nonsense"), null);
});

test("E11 roulette's parity run is caught by its own space, not by the generic rule", () => {
  // A window of one parity is a pattern the count rule cannot see, and it has
  // no analogue on a card table — so it lives on the wheel's space.
  const odd = ["1", "3", "5", "7", "9", "11", "13", "15", "17", "19",
               "21", "23", "25", "27", "29", "31", "33", "35", "13", "1"];
  assert.equal(SPACE.extraStreak!(odd), true, "missed a full window of one parity");
  // A zero is SKIPPED, not treated as breaking the run. "00" is not an even
  // number so it cannot extend a run of evens, but nineteen odds and one zero
  // is still the pattern this exists to break — and disarming on any zero made
  // the guard almost unreachable, since a fair window of twenty holds no zero
  // only about a third of the time, and `collect` favours the zeros heavily.
  assert.equal(SPACE.extraStreak!(["0", ...odd.slice(1)]), true);
  // A genuine parity break still ends it.
  const mixed = [...odd.slice(0, 19), "2"];
  assert.equal(SPACE.extraStreak!(mixed), false);
  // And a window that is mostly zeros cannot trip it on a few samples.
  const sparse = ["1", "3", "5", "7", "0", "0", "0", "0", "0", "0"];
  assert.equal(SPACE.extraStreak!(sparse), false);
});
