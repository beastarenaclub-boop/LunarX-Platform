import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { nanoid } from "nanoid";
import {
  db,
  usersTable,
  betsTable,
  gameConfigTable,
  tableRoundsTable,
  tableRoundBetsTable,
  rouletteRoundsTable,
  blackjackRoundsTable,
  lucky7RoundsTable,
  teenPattiLiveRoundsTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import {
  createTableRound,
  isOutcomeDisclosed,
  outcomeDiscloseAt,
  revealTableRound,
  settleTableRound,
  finishTableRound,
  settlePendingSlips,
  placeTableBets,
  getTableRoundSnapshot,
  recoverTableRound,
  recoverTableRounds,
  type TableGameCode,
} from "../tableRounds";
import { settleRouletteBets, type RouletteBetInput } from "../rouletteMath";
import {
  lucky7Payouts,
  lucky7Result,
  settleLucky7Bets,
  type Lucky7BetType,
} from "../lucky7Math";
import { verifyLucky7Round } from "../lucky7";
import {
  settleTeenPattiBets,
  type TeenPattiBetInput,
  type TeenPattiDeal,
} from "../teenPattiMath";
import {
  deriveTeenPattiLiveDeal,
  verifyTeenPattiLiveRound,
} from "../teenPattiLive";
import {
  deriveLucky7Outcome,
  deriveRouletteOutcome,
  invalidateConfigCache,
  sha256Hex,
} from "../rtp";
import { postEntry, getBalanceByUser } from "../wallet";

/**
 * DB-backed integration tests for the shared table-round engine. Phase
 * transitions are invoked directly (no timer sleeps) so the 55/5/5 cycle can
 * be exercised in milliseconds. Each test uses fresh users; created rounds
 * are deleted afterwards so a concurrently running dev server isn't left
 * pointing at half-finished test rounds.
 */
const SKIP = !process.env.DATABASE_URL;
if (SKIP) {
  test("table rounds integration — skipped (no DATABASE_URL)", () => {});
}

// ── Outcome disclosure gate (pure — no database) ──────────────────────────
// The roulette wheel has to be handed its pocket before it can decelerate onto
// it, so the engine keeps that pocket (and the server seed) out of every
// payload until exactly that moment: a player watching the REST/WebSocket
// traffic can never read the number before the wheel has shown it.

const REVEAL_ROUND = {
  gameCode: "roulette",
  phase: "reveal",
  outcome: { pocket: 17 },
  bettingEndsAt: new Date(1_000_000),
  revealEndsAt: new Date(1_005_000),
};

test("roulette holds its pocket back until the wheel needs it to land", () => {
  const discloseAt = outcomeDiscloseAt(REVEAL_ROUND);
  // Somewhere inside the reveal window: after the spin starts, before it ends.
  assert.ok(discloseAt > REVEAL_ROUND.bettingEndsAt.getTime());
  assert.ok(discloseAt < REVEAL_ROUND.revealEndsAt.getTime());

  // Blind for the visible part of the spin…
  assert.equal(
    isOutcomeDisclosed(REVEAL_ROUND, REVEAL_ROUND.bettingEndsAt.getTime()),
    false,
  );
  assert.equal(isOutcomeDisclosed(REVEAL_ROUND, discloseAt - 1), false);
  // …open for the landing itself and everything after it.
  assert.equal(isOutcomeDisclosed(REVEAL_ROUND, discloseAt), true);
  assert.equal(
    isOutcomeDisclosed(
      { ...REVEAL_ROUND, phase: "settling" },
      REVEAL_ROUND.bettingEndsAt.getTime(),
    ),
    true,
  );

  // Betting never discloses, and a round with no outcome has nothing to give.
  assert.equal(
    isOutcomeDisclosed({ ...REVEAL_ROUND, phase: "betting" }, discloseAt),
    false,
  );
  assert.equal(
    isOutcomeDisclosed(
      { ...REVEAL_ROUND, outcome: null },
      discloseAt + 10_000,
    ),
    false,
  );
});

test("games that animate from the outcome disclose at reveal start", () => {
  const round = { ...REVEAL_ROUND, gameCode: "baccarat", outcome: { x: 1 } };
  assert.equal(outcomeDiscloseAt(round), round.bettingEndsAt.getTime());
  assert.equal(isOutcomeDisclosed(round, round.bettingEndsAt.getTime()), true);
});

const createdUserIds: string[] = [];
const createdRoundIds: string[] = [];

async function makeFundedUser(scope: TableGameCode, paise: bigint): Promise<string> {
  const id = nanoid();
  const email = `tr_${id}@example.test`;
  await db.insert(usersTable).values({
    id,
    email,
    emailNormalized: email.toLowerCase(),
    passwordHash: "x",
    displayName: `tr_${id.slice(0, 6)}`,
  } as never);
  createdUserIds.push(id);
  await postEntry({
    userId: id,
    type: "adjustment",
    amount: paise,
    memo: "table-rounds test funding",
    scope,
  });
  return id;
}

function track(roundId: string): string {
  createdRoundIds.push(roundId);
  return roundId;
}

type Round = Awaited<ReturnType<typeof createTableRound>>;

/**
 * Push a round's betting deadline into the past before force-revealing it.
 *
 * The scheduler only reveals a round once `bettingEndsAt` has passed, and the
 * outcome-disclosure gate keys off that same timestamp. A test that reveals a
 * freshly created round without rewinding the clock is asking for the outcome
 * while its own betting window is still open, so the snapshot rightly withholds
 * it — use this wherever a test asserts on the revealed outcome or seed.
 */
async function expireBettingWindow(round: Round): Promise<Round> {
  const bettingEndsAt = new Date(Date.now() - 1);
  await db
    .update(tableRoundsTable)
    .set({ bettingEndsAt })
    .where(eq(tableRoundsTable.id, round.id));
  return { ...round, bettingEndsAt };
}

async function setCfg(
  gameCode: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const before = (
    await db
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, gameCode))
      .limit(1)
  )[0]!;
  await db
    .update(gameConfigTable)
    .set(patch as never)
    .where(eq(gameConfigTable.gameCode, gameCode));
  invalidateConfigCache(gameCode);
  return before as unknown as Record<string, unknown>;
}

after(async () => {
  if (SKIP) return;
  if (createdRoundIds.length > 0) {
    await db
      .delete(tableRoundsTable)
      .where(inArray(tableRoundsTable.id, createdRoundIds));
  }
  // Test users are left in place: their wallet ledger / bets / audit rows
  // reference them with restrictive FKs, and unique nanoid emails keep them
  // from colliding with anything.
});

if (!SKIP) {
  test("round lifecycle: betting → reveal → settling → settled with correct clocks", async () => {
    const round = await createTableRound("roulette");
    track(round.id);
    assert.equal(round.phase, "betting");
    assert.equal(round.serverSeedHash, sha256Hex(round.serverSeed));
    assert.ok(round.bettingEndsAt < round.revealEndsAt);
    assert.ok(round.revealEndsAt < round.settleEndsAt);
    assert.equal(round.outcome, null);

    const revealed = await revealTableRound(round);
    assert.equal(revealed.phase, "reveal");
    const expected = deriveRouletteOutcome(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
    );
    assert.deepEqual(revealed.outcome, JSON.parse(JSON.stringify(expected)));

    const settling = await settleTableRound(revealed);
    assert.equal(settling.phase, "settling");
    const done = await finishTableRound(settling);
    assert.equal(done?.phase, "settled");
    // Double-finish is a no-op (CAS).
    assert.equal(await finishTableRound(settling), null);
  });

  test("bets are accepted during the window, rejected after it closes", async () => {
    const userId = await makeFundedUser("roulette", 100_000n);
    const round = await createTableRound("roulette");
    track(round.id);

    // A delayed countdown request must not silently join a newer round.
    await assert.rejects(placeTableBets({
      gameCode: "roulette", userId, roundId: "expired-selection-round",
      bets: [{ type: "straight", numbers: [17], amountPaise: "1000" }],
    }), /BETTING_CLOSED/);
    assert.equal((await getBalanceByUser(userId, "roulette")).balance, 100_000n);

    const placed = await placeTableBets({
      gameCode: "roulette",
      roundId: round.id,
      userId,
      bets: [{ type: "straight", numbers: [17], amountPaise: "1000" }],
    });
    assert.equal(placed.roundId, round.id);
    assert.equal(placed.totalStake, "1000");
    assert.equal((await getBalanceByUser(userId, "roulette")).balance, 99_000n);

    // Close the window (simulate the clock firing) and try again.
    await revealTableRound(round);
    await assert.rejects(
      placeTableBets({
        gameCode: "roulette",
        userId,
        bets: [{ type: "straight", numbers: [5], amountPaise: "1000" }],
      }),
      /BETTING_CLOSED/,
    );
    // Late rejection must not debit the wallet.
    assert.equal((await getBalanceByUser(userId, "roulette")).balance, 99_000n);
  });

  test("settlement credits winners per the provably-fair outcome and writes audit rows", async () => {
    const userId = await makeFundedUser("roulette", 4_000_000n);
    const round = await createTableRound("roulette");
    track(round.id);

    // Cover every pocket with straights so the player always wins exactly one.
    const bets = Array.from({ length: 37 }, (_, n) => ({
      type: "straight",
      numbers: [n],
      amountPaise: "100",
    }));
    await placeTableBets({ gameCode: "roulette", userId, bets });
    assert.equal((await getBalanceByUser(userId, "roulette")).balance, 3_996_300n);

    const revealed = await revealTableRound(round);
    const { pocket } = revealed.outcome as { pocket: number };
    const expected = settleRouletteBets(
      bets.map((b) => ({ ...b, amountPaise: 100n }) as RouletteBetInput),
      pocket,
      36,
    );
    await settleTableRound(revealed);

    // Wallet credited exactly the expected payout (straight: 100 × 35 = 3500).
    assert.equal(
      (await getBalanceByUser(userId, "roulette")).balance,
      3_996_300n + expected.totalPayout,
    );

    // Slip settled + audit row written for the existing verify endpoints.
    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, round.id));
    assert.equal(slip!.status, "settled");
    assert.equal(slip!.payoutAmount, expected.totalPayout);
    assert.ok(slip!.auditRoundId);
    const [audit] = await db
      .select()
      .from(rouletteRoundsTable)
      .where(eq(rouletteRoundsTable.id, slip!.auditRoundId!));
    assert.equal(audit!.pocket, pocket);
    assert.equal(audit!.serverSeed, round.serverSeed);
    assert.equal(audit!.payoutAmount, expected.totalPayout);

    // Settlement is idempotent — a re-run must not double-credit.
    await settlePendingSlips(revealed);
    assert.equal(
      (await getBalanceByUser(userId, "roulette")).balance,
      3_996_300n + expected.totalPayout,
    );
    await finishTableRound(revealed);
  });

  test("phase durations and min stake come from live config on round creation", async () => {
    const before = await setCfg("baccarat", {
      bettingWindowMs: 12_000,
      revealDurationMs: 3_000,
      settleDurationMs: 2_000,
      minStakePaise: 500n,
    });
    try {
      const round = await createTableRound("baccarat");
      track(round.id);
      const cfg = round.config as Record<string, unknown>;
      assert.equal(cfg.bettingWindowMs, 12_000);
      assert.equal(cfg.revealDurationMs, 3_000);
      assert.equal(cfg.settleDurationMs, 2_000);
      const span = round.settleEndsAt.getTime() - round.createdAt.getTime();
      assert.ok(Math.abs(span - 17_000) < 1_500, `span=${span}`);

      // Min-stake enforcement from the same snapshot.
      const userId = await makeFundedUser("baccarat", 100_000n);
      await assert.rejects(
        placeTableBets({
          gameCode: "baccarat",
          userId,
          bets: [{ type: "player", amountPaise: "100" }],
        }),
        /STAKE_TOO_SMALL/,
      );
      await revealTableRound(round);
      await settleTableRound(round);
      await finishTableRound(round);
    } finally {
      await setCfg("baccarat", {
        bettingWindowMs: before.bettingWindowMs,
        revealDurationMs: before.revealDurationMs,
        settleDurationMs: before.settleDurationMs,
        minStakePaise: before.minStakePaise,
      });
    }
  });

  test("snapshot shows correct phase, deadlines and hides the outcome until reveal", async () => {
    const userId = await makeFundedUser("teen-patti", 100_000n);
    const round = await createTableRound("teen-patti");
    track(round.id);
    await placeTableBets({
      gameCode: "teen-patti",
      userId,
      bets: [{ type: "playerA", amountPaise: "2000" }],
    });

    let snap = await getTableRoundSnapshot("teen-patti", userId);
    assert.equal(snap!.roundId, round.id);
    assert.equal(snap!.phase, "betting");
    assert.equal(snap!.outcome, null);
    assert.equal(snap!.serverSeed, null);
    assert.equal(snap!.serverSeedHash, round.serverSeedHash);
    assert.equal(snap!.bettingEndsAt, round.bettingEndsAt.getTime());
    assert.equal(snap!.liveBets.length, 1);
    assert.equal(snap!.myBets.length, 1);

    await revealTableRound(await expireBettingWindow(round));
    snap = await getTableRoundSnapshot("teen-patti", userId);
    assert.equal(snap!.phase, "reveal");
    assert.ok(snap!.outcome);
    assert.equal(snap!.serverSeed, round.serverSeed);

    const settling = await settleTableRound(round);
    await finishTableRound(settling);
  });

  test("snapshot myBets expose settled status + payout during the settling phase (client settlement-sync contract)", async () => {
    const userId = await makeFundedUser("roulette", 100_000n);
    const round = await createTableRound("roulette");
    track(round.id);
    // Cover every pocket with straights so exactly one bet always pays out.
    const bets = Array.from({ length: 37 }, (_, n) => ({
      type: "straight",
      numbers: [n],
      amountPaise: "100",
    }));
    await placeTableBets({ gameCode: "roulette", userId, bets });
    const balanceAfterBets = (await getBalanceByUser(userId, "roulette"))
      .balance;

    const revealed = await revealTableRound(round);
    // Immediately after the settling phase begins (but before slips are
    // paid), the snapshot still shows the slip as pending — this is the
    // window the client polls through.
    const settling = await settleTableRound(revealed);
    assert.equal(settling.phase, "settling");
    await settlePendingSlips(revealed);

    // While the round is STILL in the settling phase (not yet finished),
    // the snapshot must expose the settled status and payout so clients
    // can render the result before the next round replaces the snapshot.
    const snap = await getTableRoundSnapshot("roulette", userId);
    assert.equal(snap!.roundId, round.id);
    assert.equal(snap!.phase, "settling");
    assert.equal(snap!.myBets.length, 1);
    const slip = snap!.myBets[0]!;
    assert.equal(slip.status, "settled");
    const { pocket } = snap!.outcome as { pocket: number };
    const expected = settleRouletteBets(
      bets.map((b) => ({ ...b, amountPaise: 100n }) as RouletteBetInput),
      pocket,
      36,
    );
    assert.equal(BigInt(slip.payoutAmount), expected.totalPayout);
    assert.ok(BigInt(slip.payoutAmount) > 0n, "covering all pockets must pay");

    // Wallet was credited at settlement, before the round finished.
    assert.equal(
      (await getBalanceByUser(userId, "roulette")).balance,
      balanceAfterBets + expected.totalPayout,
    );

    await finishTableRound(settling);
  });

  test("blackjack: stake queues in the window, hand deals at reveal, force-finish settles", async () => {
    const userId = await makeFundedUser("blackjack", 1_000_000n);
    const round = await createTableRound("blackjack");
    track(round.id);
    await placeTableBets({
      gameCode: "blackjack",
      userId,
      bets: [{ amountPaise: "10000" }],
    });
    // Only one hand per player per round.
    await assert.rejects(
      placeTableBets({
        gameCode: "blackjack",
        userId,
        bets: [{ amountPaise: "10000" }],
      }),
      /ROUND_IN_PROGRESS/,
    );
    assert.equal((await getBalanceByUser(userId, "blackjack")).balance, 990_000n);

    await revealTableRound(round);
    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, round.id));
    assert.ok(slip!.auditRoundId, "hand must be dealt at reveal");
    const [hand] = await db
      .select()
      .from(blackjackRoundsTable)
      .where(eq(blackjackRoundsTable.id, slip!.auditRoundId!));
    assert.equal(hand!.serverSeed, round.serverSeed);
    assert.equal(hand!.clientSeed, `${round.clientSeed}:${userId}`);

    // Player never acts — settlement deadline auto-stands and settles.
    const settling = await settleTableRound(round);
    const [settledHand] = await db
      .select()
      .from(blackjackRoundsTable)
      .where(eq(blackjackRoundsTable.id, slip!.auditRoundId!));
    assert.equal(settledHand!.status, "settled");
    const [settledSlip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.id, slip!.id));
    assert.equal(settledSlip!.status, "settled");
    assert.equal(settledSlip!.payoutAmount, settledHand!.payoutAmount);
    assert.equal(
      (await getBalanceByUser(userId, "blackjack")).balance,
      990_000n + settledHand!.payoutAmount,
    );
    await finishTableRound(settling);
  });

  test("restart recovery: betting rounds are voided with refunds; revealed rounds settle", async () => {
    // Case 1: interrupted during betting → void + refund.
    const u1 = await makeFundedUser("andar-bahar", 100_000n);
    const r1 = await createTableRound("andar-bahar");
    track(r1.id);
    await placeTableBets({
      gameCode: "andar-bahar",
      userId: u1,
      bets: [{ type: "andar", amountPaise: "5000" }],
    });
    assert.equal((await getBalanceByUser(u1, "andar-bahar")).balance, 95_000n);

    // Case 2: interrupted after reveal → settle from stored outcome.
    const u2 = await makeFundedUser("andar-bahar", 100_000n);
    const r2 = await createTableRound("andar-bahar");
    track(r2.id);
    await placeTableBets({
      gameCode: "andar-bahar",
      userId: u2,
      bets: [{ type: "andar", amountPaise: "5000" }],
    });
    const r2Revealed = await revealTableRound(r2);
    // …and left behind long enough that its own clock has run out: only then
    // may recovery finish it (a round still inside its window is resumed, see
    // the roulette case below).
    const expired = new Date(Date.now() - 1000);
    await db
      .update(tableRoundsTable)
      .set({
        bettingEndsAt: expired,
        revealEndsAt: expired,
        settleEndsAt: expired,
      })
      .where(eq(tableRoundsTable.id, r2.id));

    await recoverTableRounds("andar-bahar");

    const [v1] = await db
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, r1.id));
    assert.equal(v1!.phase, "voided");
    assert.equal((await getBalanceByUser(u1, "andar-bahar")).balance, 100_000n);
    const [b1] = await db
      .select()
      .from(betsTable)
      .where(
        and(eq(betsTable.userId, u1), eq(betsTable.gameCode, "andar-bahar")),
      );
    assert.equal(b1!.status, "voided");

    const [v2] = await db
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, r2.id));
    assert.equal(v2!.phase, "settled");
    const [s2] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, r2.id));
    assert.equal(s2!.status, "settled");
    const outcome = r2Revealed.outcome as { winner: string };
    const bal2 = (await getBalanceByUser(u2, "andar-bahar")).balance;
    if (outcome.winner === "andar") {
      assert.ok(bal2 > 95_000n, `winner must be credited, bal=${bal2}`);
    } else {
      assert.equal(bal2, 95_000n);
    }
  });

  test("restart recovery: a roulette round mid-blind-reveal is resumed with its pocket still hidden", async () => {
    const round = await createTableRound("roulette");
    track(round.id);
    const revealed = await revealTableRound(round);
    assert.equal(revealed.phase, "reveal");
    // The wheel has only just been sent round, so the pocket is withheld.
    assert.equal(isOutcomeDisclosed(revealed), false);

    // Recovery must hand a round whose clock is still running back to the
    // engine. Settling it here would disclose the pocket mid-spin — the very
    // thing the disclosure lead exists to prevent — and cut the round short.
    const resumed = await recoverTableRound(revealed);
    assert.ok(resumed, "a running round must be resumed, not settled");
    assert.equal(resumed!.id, round.id);

    const [row] = await db
      .select()
      .from(tableRoundsTable)
      .where(eq(tableRoundsTable.id, round.id));
    assert.equal(row!.phase, "reveal", "recovery ended the round early");
    assert.equal(isOutcomeDisclosed(row!), false);

    const snap = await getTableRoundSnapshot("roulette");
    if (snap?.roundId === round.id) {
      assert.equal(snap.outcome, null, "recovery leaked the pocket");
      assert.equal(snap.serverSeed, null, "recovery leaked the server seed");
    }
  });

  // ── Lucky 7 (7 Up / 7 Down) ──────────────────────────────────────────────

  test("lucky-7 runs the shared lifecycle and reveals a two-dice outcome", async () => {
    const round = await createTableRound("lucky-7");
    track(round.id);
    assert.equal(round.phase, "betting");
    assert.equal(round.serverSeedHash, sha256Hex(round.serverSeed));
    assert.equal(round.outcome, null);
    // Payout economics are snapshotted with the round, not read live.
    const cfg = round.config as Record<string, unknown>;
    assert.equal(typeof cfg.houseEdge, "number");
    assert.equal(typeof cfg.maxMultiplier, "number");
    assert.equal(cfg.lucky7PayoutVersion, 3);

    const revealed = await revealTableRound(round);
    assert.equal(revealed.phase, "reveal");
    const expected = deriveLucky7Outcome(
      round.serverSeed,
      round.clientSeed,
      round.nonce,
    );
    assert.deepEqual(revealed.outcome, JSON.parse(JSON.stringify(expected)));
    const { dice, total } = revealed.outcome as {
      dice: [number, number];
      total: number;
    };
    assert.ok(dice[0] >= 1 && dice[0] <= 6);
    assert.ok(dice[1] >= 1 && dice[1] <= 6);
    assert.equal(total, dice[0] + dice[1]);

    const done = await finishTableRound(await settleTableRound(revealed));
    assert.equal(done?.phase, "settled");
  });

  test("lucky-7 commits its seed before betting and settles against that exact tuple", async () => {
    // Lucky 7 has no per-user seed: the round owns the committed tuple. This
    // test pins the contract a player relies on — the hash they see BEFORE
    // betting is the hash of the seed the dice come from, and that same tuple
    // is what lands in their audit row and what /verify replays.
    const userId = await makeFundedUser("lucky-7", 100_000n);
    const round = await createTableRound("lucky-7");
    track(round.id);

    // 1) Commitment is public while betting is open; the seed itself is not.
    const betting = await getTableRoundSnapshot("lucky-7", userId);
    assert.equal(betting!.roundId, round.id);
    assert.equal(betting!.phase, "betting");
    assert.equal(betting!.serverSeed, null, "seed must stay hidden pre-reveal");
    assert.equal(betting!.outcome, null);
    const committedHash = betting!.serverSeedHash;
    const committedClientSeed = betting!.clientSeed;
    const committedNonce = betting!.nonce;

    await placeTableBets({
      gameCode: "lucky-7",
      userId,
      bets: [{ type: "under" as Lucky7BetType, amountPaise: "1000" }],
    });

    // 2) Reveal publishes a seed that hashes to the pre-betting commitment.
    const revealed = await revealTableRound(await expireBettingWindow(round));
    const atReveal = await getTableRoundSnapshot("lucky-7", userId);
    assert.equal(atReveal!.serverSeedHash, committedHash);
    assert.equal(atReveal!.clientSeed, committedClientSeed);
    assert.equal(atReveal!.nonce, committedNonce);
    assert.ok(atReveal!.serverSeed, "seed must be revealed at reveal");
    assert.equal(sha256Hex(atReveal!.serverSeed!), committedHash);
    // ...and it is the tuple the dice were actually derived from.
    assert.deepEqual(
      atReveal!.outcome,
      JSON.parse(
        JSON.stringify(
          deriveLucky7Outcome(
            atReveal!.serverSeed!,
            committedClientSeed,
            committedNonce,
          ),
        ),
      ),
    );

    await settleTableRound(revealed);

    // 3) The audit row stores that same tuple — no second, private seed.
    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, round.id));
    const [audit] = await db
      .select()
      .from(lucky7RoundsTable)
      .where(eq(lucky7RoundsTable.id, slip!.auditRoundId!));
    assert.equal(audit!.serverSeed, atReveal!.serverSeed);
    assert.equal(audit!.serverSeedHash, committedHash);
    assert.equal(audit!.clientSeed, committedClientSeed);
    assert.equal(audit!.nonce, committedNonce);
    assert.equal(verifyLucky7Round(audit!).verified, true);
    // A seed that doesn't match the published commitment fails the replay.
    assert.equal(
      verifyLucky7Round({ ...audit!, serverSeed: "not-the-committed-seed" })
        .hashMatch,
      false,
    );
    await finishTableRound(revealed);
  });

  test("lucky-7 settles the winning spot, writes an audit row and verifies", async () => {
    const userId = await makeFundedUser("lucky-7", 100_000n);
    const round = await createTableRound("lucky-7");
    track(round.id);
    const cfg = round.config as { houseEdge: number; maxMultiplier: number };

    // Back all three spots: exactly one of them always wins.
    const bets = (["under", "exactly", "over"] as Lucky7BetType[]).map(
      (type) => ({ type, amountPaise: "1000" }),
    );
    const placed = await placeTableBets({ gameCode: "lucky-7", userId, bets });
    assert.equal(placed.totalStake, "3000");
    assert.equal((await getBalanceByUser(userId, "lucky-7")).balance, 97_000n);

    // A duplicate spot on one slip is rejected (and must not debit).
    await assert.rejects(
      placeTableBets({
        gameCode: "lucky-7",
        userId,
        bets: [
          { type: "under", amountPaise: "1000" },
          { type: "under", amountPaise: "1000" },
        ],
      }),
      /DUPLICATE_BET_TYPE/,
    );
    assert.equal((await getBalanceByUser(userId, "lucky-7")).balance, 97_000n);

    const revealed = await revealTableRound(round);
    const roll = revealed.outcome as { dice: [number, number]; total: number };
    const expected = settleLucky7Bets(
      bets.map((b) => ({ type: b.type, amountPaise: 1_000n })),
      roll,
      cfg.houseEdge,
      cfg.maxMultiplier,
    );
    // Exactly one spot pays at the fixed return for that spot.
    const winner = lucky7Result(roll.total);
    const payouts = lucky7Payouts(cfg.houseEdge, cfg.maxMultiplier);
    assert.equal(expected.totalPayout, BigInt(Math.floor(payouts[winner] * 1000)));

    await settleTableRound(revealed);
    assert.equal(
      (await getBalanceByUser(userId, "lucky-7")).balance,
      97_000n + expected.totalPayout,
    );

    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, round.id));
    assert.equal(slip!.status, "settled");
    assert.equal(slip!.payoutAmount, expected.totalPayout);
    assert.ok(slip!.auditRoundId);

    const [audit] = await db
      .select()
      .from(lucky7RoundsTable)
      .where(eq(lucky7RoundsTable.id, slip!.auditRoundId!));
    assert.equal(audit!.die1, roll.dice[0]);
    assert.equal(audit!.die2, roll.dice[1]);
    assert.equal(audit!.total, roll.total);
    assert.equal(audit!.serverSeed, round.serverSeed);
    assert.equal(audit!.payoutAmount, expected.totalPayout);
    // Legacy metadata is retained alongside the explicit payout version.
    assert.equal(audit!.houseEdge, cfg.houseEdge);
    assert.equal((audit!.bets as { payoutVersion: number }).payoutVersion, 3);

    // /verify replays the dice AND the payout from the stored seeds.
    const verification = verifyLucky7Round(audit!);
    assert.equal(verification.verified, true);
    assert.equal(verification.hashMatch, true);
    assert.equal(verification.rollMatch, true);
    assert.equal(verification.payoutMatch, true);
    assert.equal(verification.betsMatch, true);
    assert.deepEqual(verification.computedDice, roll.dice);
    assert.equal(verification.computedResult, winner);
    assert.equal(verification.computedPayout, expected.totalPayout.toString());

    // A tampered payout must fail the replay.
    const tampered = verifyLucky7Round({
      ...audit!,
      payoutAmount: audit!.payoutAmount + 1n,
    });
    assert.equal(tampered.payoutMatch, false);
    assert.equal(tampered.verified, false);

    // Settlement stays idempotent for the new game too.
    await settlePendingSlips(revealed);
    assert.equal(
      (await getBalanceByUser(userId, "lucky-7")).balance,
      97_000n + expected.totalPayout,
    );
    await finishTableRound(revealed);
  });

  // ── Teen Patti 20-20 Live (separate game, shared maths) ──────────────────

  test("teen-patti-live runs its own round clock, separate from the flat table", async () => {
    const live = await createTableRound("teen-patti-live");
    track(live.id);
    assert.equal(live.phase, "betting");
    assert.equal(live.serverSeedHash, sha256Hex(live.serverSeed));
    assert.equal(live.outcome, null);

    // The two games are independent rounds — a live round is never the flat
    // table's round and vice versa.
    const flat = await createTableRound("teen-patti");
    track(flat.id);
    assert.notEqual(live.id, flat.id);
    assert.equal(
      (await getTableRoundSnapshot("teen-patti-live"))!.roundId,
      live.id,
    );
    assert.equal((await getTableRoundSnapshot("teen-patti"))!.roundId, flat.id);

    // The deal comes from the live round's own committed tuple.
    const revealed = await revealTableRound(live);
    assert.equal(revealed.phase, "reveal");
    const expected = deriveTeenPattiLiveDeal(
      live.serverSeed,
      live.clientSeed,
      live.nonce,
    );
    assert.deepEqual(revealed.outcome, JSON.parse(JSON.stringify(expected)));
    const deal = revealed.outcome as TeenPattiDeal;
    assert.equal(deal.handACards.length, 3);
    assert.equal(deal.handBCards.length, 3);
    // Single deck dealt A,B,A,B,A,B — six distinct cards.
    assert.equal(new Set([...deal.handACards, ...deal.handBCards]).size, 6);
    assert.ok(["playerA", "playerB", "tie"].includes(deal.winner));

    assert.equal(
      (await finishTableRound(await settleTableRound(revealed)))?.phase,
      "settled",
    );
    await finishTableRound(await settleTableRound(await revealTableRound(flat)));
  });

  test("teen-patti-live settles the five markets into its own wallet and audit row", async () => {
    const userId = await makeFundedUser("teen-patti-live", 100_000n);
    const round = await createTableRound("teen-patti-live");
    track(round.id);
    const cfg = round.config as { maxMultiplier: number };

    const betTypes = [
      "playerA",
      "playerB",
      "tie",
      "pairPlusA",
      "pairPlusB",
    ] as const satisfies readonly TeenPattiBetInput["type"][];
    const bets = betTypes.map((type) => ({ type, amountPaise: "1000" }));
    const placed = await placeTableBets({
      gameCode: "teen-patti-live",
      userId,
      bets,
    });
    assert.equal(placed.totalStake, "5000");
    assert.equal(
      (await getBalanceByUser(userId, "teen-patti-live")).balance,
      95_000n,
    );
    // Fully separate wallet: the flat table's balance is untouched.
    assert.equal((await getBalanceByUser(userId, "teen-patti")).balance, 95_000n);

    // Same guards as the flat table: one bet per spot, at most five.
    await assert.rejects(
      placeTableBets({
        gameCode: "teen-patti-live",
        userId,
        bets: [
          { type: "playerA", amountPaise: "1000" },
          { type: "playerA", amountPaise: "1000" },
        ],
      }),
      /DUPLICATE_BET_TYPE/,
    );
    assert.equal(
      (await getBalanceByUser(userId, "teen-patti-live")).balance,
      95_000n,
    );

    const revealed = await revealTableRound(round);
    const deal = revealed.outcome as TeenPattiDeal;
    const expected = settleTeenPattiBets(
      betTypes.map((type) => ({ type, amountPaise: 1_000n })),
      deal,
      cfg.maxMultiplier,
      2,
    );

    await settleTableRound(revealed);
    assert.equal(
      (await getBalanceByUser(userId, "teen-patti-live")).balance,
      95_000n + expected.totalPayout,
    );
    // A tie pushes the two main bets — the shared maths, unchanged.
    if (deal.winner === "tie") {
      const mains = expected.settled.filter(
        (b) => b.type === "playerA" || b.type === "playerB",
      );
      for (const m of mains) assert.equal(BigInt(m.payoutPaise), 1_000n);
    }

    const [slip] = await db
      .select()
      .from(tableRoundBetsTable)
      .where(eq(tableRoundBetsTable.roundId, round.id));
    assert.equal(slip!.status, "settled");
    assert.equal(slip!.payoutAmount, expected.totalPayout);
    assert.ok(slip!.auditRoundId);

    const [audit] = await db
      .select()
      .from(teenPattiLiveRoundsTable)
      .where(eq(teenPattiLiveRoundsTable.id, slip!.auditRoundId!));
    assert.ok(audit, "settled live deal must write a per-player audit row");
    assert.deepEqual(audit!.handACards, deal.handACards);
    assert.deepEqual(audit!.handBCards, deal.handBCards);
    assert.equal(audit!.handACategory, deal.handA.category);
    assert.equal(audit!.handBCategory, deal.handB.category);
    assert.equal(audit!.winner, deal.winner);
    assert.equal(audit!.serverSeed, round.serverSeed);
    assert.equal(audit!.payoutAmount, expected.totalPayout);
    assert.equal(audit!.maxMultiplier, cfg.maxMultiplier);

    // /verify replays the shuffle AND the payouts from the stored seeds.
    const verification = verifyTeenPattiLiveRound(audit!);
    assert.equal(verification.verified, true);
    assert.equal(verification.hashMatch, true);
    assert.equal(verification.dealMatch, true);
    assert.equal(verification.payoutMatch, true);
    assert.equal(verification.computedWinner, deal.winner);
    assert.equal(verification.computedPayout, expected.totalPayout.toString());

    const tampered = verifyTeenPattiLiveRound({
      ...audit!,
      payoutAmount: audit!.payoutAmount + 1n,
    });
    assert.equal(tampered.payoutMatch, false);
    assert.equal(tampered.verified, false);

    // Settlement is idempotent — a retry must not pay twice.
    await settlePendingSlips(revealed);
    assert.equal(
      (await getBalanceByUser(userId, "teen-patti-live")).balance,
      95_000n + expected.totalPayout,
    );
    await finishTableRound(revealed);
  });

  test("teen-patti-live round timings come from its own config row", async () => {
    const beforeLive = await setCfg("teen-patti-live", {
      bettingWindowMs: 12_000,
      revealDurationMs: 3_000,
      settleDurationMs: 2_000,
    });
    try {
      const round = await createTableRound("teen-patti-live");
      track(round.id);
      const cfg = round.config as Record<string, number>;
      assert.equal(cfg.bettingWindowMs, 12_000);
      assert.equal(cfg.revealDurationMs, 3_000);
      assert.equal(cfg.settleDurationMs, 2_000);
      assert.equal(
        round.revealEndsAt.getTime() - round.bettingEndsAt.getTime(),
        3_000,
      );
      assert.equal(
        round.settleEndsAt.getTime() - round.revealEndsAt.getTime(),
        2_000,
      );

      // The flat table keeps its own timings — the two rows are independent.
      const flat = await createTableRound("teen-patti");
      track(flat.id);
      const flatCfg = flat.config as Record<string, number>;
      const [flatConfig] = await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode,"teen-patti"));
      assert.equal(flatCfg.bettingWindowMs, flatConfig.bettingWindowMs);
      assert.notEqual(flatCfg.revealDurationMs, 3_000);
      await finishTableRound(
        await settleTableRound(await revealTableRound(flat)),
      );
      await finishTableRound(
        await settleTableRound(await revealTableRound(round)),
      );
    } finally {
      await setCfg("teen-patti-live", {
        bettingWindowMs: beforeLive.bettingWindowMs,
        revealDurationMs: beforeLive.revealDurationMs,
        settleDurationMs: beforeLive.settleDurationMs,
      });
    }
  });

  test("lucky-7 credits the fixed Rs 1 returns and loses both sides on seven", async () => {
    for (const total of [6, 7, 8]) {
      const userId = await makeFundedUser("lucky-7", 10_000n);
      const round = await createTableRound("lucky-7");
      track(round.id);
      // Choose a known test outcome BEFORE accepting bets in this isolated DB.
      let nonce = 0;
      while (deriveLucky7Outcome(round.serverSeed, round.clientSeed, nonce).total !== total) nonce++;
      await db.update(tableRoundsTable).set({ nonce }).where(eq(tableRoundsTable.id, round.id));
      round.nonce = nonce;
      await placeTableBets({
        gameCode: "lucky-7", userId,
        bets: (["under", "exactly", "over"] as Lucky7BetType[]).map(type => ({ type, amountPaise: "100" })),
      });
      if (total === 7) {
        await placeTableBets({ gameCode: "lucky-7", userId, bets: [
          { type: "under", amountPaise: "100" }, { type: "over", amountPaise: "100" },
        ] });
      }
      const revealed = await revealTableRound(round);
      await settleTableRound(revealed);
      const expectedBalance = total === 7 ? 10_000n - 500n + 510n : 10_000n - 300n + 204n;
      assert.equal((await getBalanceByUser(userId, "lucky-7")).balance, expectedBalance);
      const audits = await db.select().from(lucky7RoundsTable).where(eq(lucky7RoundsTable.userId, userId));
      assert.equal(audits.length, total === 7 ? 2 : 1);
      for (const audit of audits) {
        assert.equal(verifyLucky7Round(audit).verified, true);
        const stored = audit.bets as { payoutVersion: number; bets: { type: Lucky7BetType; payoutPaise: string; didWin: boolean }[] };
        assert.equal(stored.payoutVersion, 3);
        if (total === 7) {
          for (const bet of stored.bets) {
            assert.equal(bet.payoutPaise, bet.type === "exactly" ? "510" : "0");
            assert.equal(bet.didWin, bet.type === "exactly");
          }
        }
      }
      await settlePendingSlips(revealed);
      assert.equal((await getBalanceByUser(userId, "lucky-7")).balance, expectedBalance);
      await finishTableRound(revealed);
    }
  });

  test("lucky-7 resumes legacy rounds at their committed price and verifies old bare-array audits", async () => {
    const userId = await makeFundedUser("lucky-7", 10_000n);
    const round = await createTableRound("lucky-7");
    track(round.id);
    const legacyConfig: Record<string, unknown> = { ...(round.config as Record<string, unknown>), houseEdge: 0.2 };
    delete legacyConfig.lucky7PayoutVersion;
    await db.update(tableRoundsTable).set({ config: legacyConfig }).where(eq(tableRoundsTable.id, round.id));
    round.config = legacyConfig;
    await placeTableBets({
      gameCode: "lucky-7", userId,
      bets: (["under", "exactly", "over"] as Lucky7BetType[]).map(type => ({ type, amountPaise: "100" })),
    });
    const revealed = await revealTableRound(round);
    const total = (revealed.outcome as { total: number }).total;
    await settleTableRound(revealed);
    assert.equal((await getBalanceByUser(userId, "lucky-7")).balance, 9_700n + (total === 7 ? 480n : 192n));
    const [audit] = await db.select().from(lucky7RoundsTable).where(eq(lucky7RoundsTable.userId, userId));
    assert.equal(verifyLucky7Round(audit!).verified, true);
    const stored = audit!.bets as { payoutVersion: number; bets: unknown[] };
    assert.equal(stored.payoutVersion, 1);
    assert.equal(verifyLucky7Round({ ...audit!, bets: stored.bets }).verified, true);
    await finishTableRound(revealed);
  });

  test("lucky-7 fixed payouts ignore old house-edge settings and mid-round edits", async () => {
    const before = await setCfg("lucky-7", { houseEdge: 0.2 });
    try {
      const userId = await makeFundedUser("lucky-7", 100_000n);
      const round = await createTableRound("lucky-7");
      track(round.id);
      const cfg = round.config as { houseEdge: number; maxMultiplier: number };
      assert.equal(cfg.houseEdge, 0.2);

      await placeTableBets({
        gameCode: "lucky-7",
        userId,
        bets: (["under", "exactly", "over"] as Lucky7BetType[]).map((type) => ({
          type,
          amountPaise: "1000",
        })),
      });

      // Mid-round edge change must NOT affect the in-flight round.
      await setCfg("lucky-7", { houseEdge: 0.03 });

      const revealed = await revealTableRound(round);
      const roll = revealed.outcome as { total: number };
      const winner = lucky7Result(roll.total);
      // Fixed returns do not depend on the old house-edge field.
      const fat = lucky7Payouts(0.2, cfg.maxMultiplier);
      assert.deepEqual(fat, { under: 2.04, exactly: 5.1, over: 2.04 });

      await settleTableRound(revealed);
      assert.equal(
        (await getBalanceByUser(userId, "lucky-7")).balance,
        97_000n + BigInt(Math.floor(fat[winner] * 1000)),
      );
      await finishTableRound(revealed);
    } finally {
      await setCfg("lucky-7", { houseEdge: before.houseEdge });
    }
  });
}
