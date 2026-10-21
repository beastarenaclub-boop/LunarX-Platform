import { strict as assert } from "node:assert";
import { test, after } from "node:test";
import { db, gameConfigTable, tableRoundsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GAME_TYPE_META, UpdateConfigBody } from "../../routes/game";
import { getGameConfig, updateGameConfig, invalidateConfigCache } from "../rtp";
import { getRoundCycleStatus } from "../tableRounds";
import { BACCARAT_ROUND_TIMING } from "@workspace/api-zod/baccarat-game";

/**
 * Admin per-game table settings (Task: per-game timing, bet limits, profit %).
 * Covers the load/save/validation paths backing the Game Settings page for
 * the fixed-paytable shared-round table games.
 */
const SKIP = !process.env.DATABASE_URL;
if (SKIP) {
  test("table game settings — skipped (no DATABASE_URL)", () => {});
}

const TABLE_GAMES = [
  "roulette",
  "baccarat",
  "blackjack",
  "teen-patti",
  // Teen Patti 20-20 Live is a separate game with its own config row: it must
  // be tunable exactly like the flat table, and just as edge-locked.
  "teen-patti-live",
  "andar-bahar",
] as const;

// snapshots to restore after mutation tests
const saved: Record<string, Awaited<ReturnType<typeof getGameConfig>>> = {};

// ── Metadata: which fields the admin UI may edit per engine ────────────────

test("engine metadata exposes timing + stake fields for every table game", { skip: SKIP }, () => {
  for (const code of TABLE_GAMES) {
    const meta = GAME_TYPE_META[code];
    assert.ok(meta, `${code} missing from GAME_TYPE_META`);
    assert.equal(meta.engineType, "card_fixed");
    for (const f of [
      ...(code === "baccarat" ? [] : ["bettingWindowMs", "revealDurationMs", "settleDurationMs"]),
      ...(code === "roulette" ? [] : ["minStakePaise"]),
      "maxStakePaise",
      "enabled",
    ]) {
      assert.ok(
        meta.editableFields.includes(f),
        `${code} should allow editing ${f}`,
      );
    }
    // Fixed-paytable games must NOT expose house edge as editable —
    // the UI shows read-only theoretical RTP instead.
    assert.ok(
      !meta.editableFields.includes("houseEdge"),
      `${code} must not allow houseEdge edits`,
    );
  }
});

test("horse racing exposes editable house edge (engine supports it)", { skip: SKIP }, () => {
  const meta = GAME_TYPE_META["horse-racing"];
  assert.ok(meta);
  assert.ok(meta.editableFields.includes("houseEdge"));
});

test("Lucky 7 locks its fixed payouts and protects the 12x cap", () => {
  const meta = GAME_TYPE_META["lucky-7"]!;
  assert.equal(meta.capFloors.maxMultiplier, 12);
  for (const field of ["houseEdge", "rtpMin", "rtpMax"]) {
    assert.equal(meta.editableFields.includes(field), false);
  }
});

test("Baccarat's 20-second betting window is fixed in engine metadata", () => {
  const meta = GAME_TYPE_META.baccarat;
  for (const key of Object.keys(BACCARAT_ROUND_TIMING)) assert.equal(meta.editableFields.includes(key), false);
  assert.equal(BACCARAT_ROUND_TIMING.bettingWindowMs, 20_000);
  assert.equal(Object.values(BACCARAT_ROUND_TIMING).reduce((a, b) => a + b, 0), 30_000);
});

// ── Load: each table game has a config row with sane round timings ─────────

test("each table game config loads with positive round timings", { skip: SKIP }, async () => {
  for (const code of TABLE_GAMES) {
    invalidateConfigCache(code);
    const cfg = await getGameConfig(code);
    assert.ok(cfg, `${code} config row missing`);
    saved[code] = cfg;
    assert.ok(cfg!.bettingWindowMs >= 1000, `${code} betting window too short`);
    assert.ok(cfg!.revealDurationMs >= 1000, `${code} reveal too short`);
    assert.ok(cfg!.settleDurationMs >= 1000, `${code} settle too short`);
    assert.ok(cfg!.minStakePaise <= cfg!.maxStakePaise, `${code} min > max stake`);
    assert.equal(typeof cfg!.enabled, "boolean");
  }
});

// ── Save: timings / bet limits round-trip and invalidate cache ─────────────

test("saving timings + bet limits round-trips per game", { skip: SKIP }, async () => {
  for (const code of TABLE_GAMES) {
    const before = saved[code] ?? (await getGameConfig(code));
    assert.ok(before);
    // Restore in the same iteration (not just in after()) so concurrently
    // running test files never observe mutated live config, and operator
    // values survive even if the process dies mid-suite.
    try {
      const updated = await updateGameConfig(
        code,
        {
          bettingWindowMs: 40_000,
          revealDurationMs: 7_000,
          settleDurationMs: 6_000,
          minStakePaise: 500n,
        },
        "test-admin",
      );
      const timing = code === "baccarat" ? BACCARAT_ROUND_TIMING : { bettingWindowMs: 40_000, revealDurationMs: 7_000, settleDurationMs: 6_000 };
      assert.equal(updated.bettingWindowMs, timing.bettingWindowMs, code);
      assert.equal(updated.revealDurationMs, timing.revealDurationMs, code);
      assert.equal(updated.settleDurationMs, timing.settleDurationMs, code);
      assert.equal(updated.minStakePaise, 500n, code);
      // fresh read (cache invalidated inside updateGameConfig)
      const fresh = await getGameConfig(code);
      assert.equal(fresh!.bettingWindowMs, timing.bettingWindowMs, code);
      assert.equal(fresh!.revealDurationMs, timing.revealDurationMs, code);
    } finally {
      await db
        .update(gameConfigTable)
        .set({
          bettingWindowMs: before!.bettingWindowMs,
          revealDurationMs: before!.revealDurationMs,
          settleDurationMs: before!.settleDurationMs,
          minStakePaise: before!.minStakePaise,
          updatedBy: before!.updatedBy,
          updatedAt: before!.updatedAt,
        })
        .where(eq(gameConfigTable.gameCode, code));
      invalidateConfigCache(code);
    }
  }
});

// ── Validation: request-body bounds match the admin UI's client checks ─────

test("zero/negative-length betting window is rejected", { skip: SKIP }, () => {
  assert.ok(!UpdateConfigBody.safeParse({ bettingWindowMs: 0 }).success);
  assert.ok(!UpdateConfigBody.safeParse({ bettingWindowMs: 999 }).success);
  assert.ok(!UpdateConfigBody.safeParse({ bettingWindowMs: -5000 }).success);
  assert.ok(UpdateConfigBody.safeParse({ bettingWindowMs: 55_000 }).success);
  assert.ok(!UpdateConfigBody.safeParse({ bettingWindowMs: 120_001 }).success);
});

test("reveal/settle durations bounded 1s..60s", { skip: SKIP }, () => {
  assert.ok(!UpdateConfigBody.safeParse({ revealDurationMs: 0 }).success);
  assert.ok(!UpdateConfigBody.safeParse({ settleDurationMs: 500 }).success);
  assert.ok(UpdateConfigBody.safeParse({ revealDurationMs: 5_000 }).success);
  assert.ok(UpdateConfigBody.safeParse({ settleDurationMs: 60_000 }).success);
  assert.ok(!UpdateConfigBody.safeParse({ revealDurationMs: 60_001 }).success);
});

test("stake fields must be digit strings", { skip: SKIP }, () => {
  assert.ok(!UpdateConfigBody.safeParse({ minStakePaise: "-100" }).success);
  assert.ok(!UpdateConfigBody.safeParse({ minStakePaise: "1.5" }).success);
  assert.ok(UpdateConfigBody.safeParse({ minStakePaise: "0" }).success);
  assert.ok(UpdateConfigBody.safeParse({ maxStakePaise: "50000000" }).success);
});

test("non-editable fields are rejected by engine metadata gating", { skip: SKIP }, () => {
  // Mirrors the PUT handler's per-engine gate: houseEdge and crash-only
  // timing fields are not editable for card_fixed games.
  for (const code of TABLE_GAMES) {
    const editable = new Set(GAME_TYPE_META[code]!.editableFields);
    assert.ok(!editable.has("houseEdge"), code);
    assert.ok(!editable.has("turboBettingWindowMs"), code);
    assert.ok(!editable.has("minAutoCashout"), code);
  }
});

test("cap floors protect the highest-paying bet per game", { skip: SKIP }, () => {
  assert.equal(GAME_TYPE_META["roulette"]!.capFloors.maxMultiplier, 36);
  assert.equal(GAME_TYPE_META["baccarat"]!.capFloors.maxMultiplier, 12);
  assert.equal(GAME_TYPE_META["blackjack"]!.capFloors.maxMultiplier, 3);
  assert.equal(GAME_TYPE_META["teen-patti"]!.capFloors.maxMultiplier, 876);
  // Same paytable as the flat table → same floor for the 875:1 tie bet.
  assert.equal(GAME_TYPE_META["teen-patti-live"]!.capFloors.maxMultiplier, 876);
  assert.equal(GAME_TYPE_META["andar-bahar"]!.capFloors.maxMultiplier, 130);
});

// ── Round-cycle status: bootstrap + next-round confirmation source ─────────

test("round-status reports phase, deadlines, and the round's config snapshot", { skip: SKIP }, async () => {
  // Insert the round row directly under a game code the shared round engine
  // (and the other integration tests) never uses, so no concurrently running
  // test can pick this round up as an open betting round.
  const now = Date.now();
  const snap = {
    houseEdge: 0.028,
    maxMultiplier: 181,
    maxStakePaise: "50000000",
    minStakePaise: "500",
    bettingWindowMs: 40_000,
    revealDurationMs: 7_000,
    settleDurationMs: 6_000,
  };
  const [round] = await db
    .insert(tableRoundsTable)
    .values({
      gameCode: "sic-bo",
      phase: "betting",
      serverSeed: "test-seed",
      serverSeedHash: "test-hash",
      clientSeed: "test-client",
      nonce: 0,
      bettingEndsAt: new Date(now + snap.bettingWindowMs),
      revealEndsAt: new Date(now + snap.bettingWindowMs + snap.revealDurationMs),
      settleEndsAt: new Date(
        now + snap.bettingWindowMs + snap.revealDurationMs + snap.settleDurationMs,
      ),
      config: snap,
    } as never)
    .returning();
  assert.ok(round);
  try {
    const status = await getRoundCycleStatus("sic-bo" as never);
    assert.ok(status);
    assert.equal(status!.roundId, round!.id);
    assert.equal(status!.phase, "betting");
    assert.ok(status!.bettingEndsAt > Date.now());
    assert.ok(status!.revealEndsAt > status!.bettingEndsAt);
    assert.ok(status!.settleEndsAt > status!.revealEndsAt);
    assert.equal(status!.config.bettingWindowMs, 40_000);
    assert.equal(status!.config.revealDurationMs, 7_000);
    assert.equal(status!.config.settleDurationMs, 6_000);
    assert.equal(status!.config.minStakePaise, "500");
  } finally {
    await db.delete(tableRoundsTable).where(eq(tableRoundsTable.id, round!.id));
  }
});

// ── Restore original rows so a dev server keeps operator values ────────────

after(async () => {
  if (SKIP) return;
  for (const code of TABLE_GAMES) {
    const orig = saved[code];
    if (!orig) continue;
    await db
      .update(gameConfigTable)
      .set({
        bettingWindowMs: orig.bettingWindowMs,
        revealDurationMs: orig.revealDurationMs,
        settleDurationMs: orig.settleDurationMs,
        minStakePaise: orig.minStakePaise,
        updatedBy: orig.updatedBy,
        updatedAt: orig.updatedAt,
      })
      .where(eq(gameConfigTable.gameCode, code));
    invalidateConfigCache(code);
  }
});
