import { strict as assert } from "node:assert";
import { after, test } from "node:test";
import { eq } from "drizzle-orm";
import { db, pool, gameConfigTable, tableRoundsTable } from "@workspace/db";
import {
  AB_TIMING,
  andarBaharRevealMs,
} from "@workspace/api-zod/andar-bahar-live";
import {
  createTableRound,
  revealTableRound,
  isOutcomeDisclosed,
} from "../tableRounds";
import { deriveAndarBaharDeal } from "../andarBahar";
import { invalidateConfigCache, sha256Hex } from "../rtp";

// Never run lifecycle tests against a live game database.
const isolated =
  process.env.AB_TIMING_TEST_DATABASE === "1" &&
  new URL(process.env.DATABASE_URL!).pathname.startsWith(
    "/andar_bahar_timing_test",
  );
after(() => pool.end());

test("each card has a complete hand opening, even at 49 cards", () => {
  assert.equal(AB_TIMING.bettingWindowMs, 30_000);
  for (let n = 1; n <= 49; n++)
    assert.equal(andarBaharRevealMs(n), 1900 + 1700 * n + 900);
  for (const n of [0, 50, 2.5, NaN]) assert.throws(() => andarBaharRevealMs(n));
});

test(
  "publishes count-dependent deadlines atomically after betting closes",
  { skip: !isolated },
  async () => {
    await db
      .insert(gameConfigTable)
      .values({
        gameCode: "andar-bahar",
        enabled: true,
        bettingWindowMs: 30_000,
        revealDurationMs: 5000,
        settleDurationMs: 5000,
      })
      .onConflictDoNothing();
    invalidateConfigCache("andar-bahar");
    const results: number[] = [];
    for (const wantLong of [false, true]) {
      let seed = "",
        deal;
      for (let i = 0; i < 10000; i++) {
        seed = `andar-hand-timing-${i}`;
        deal = deriveAndarBaharDeal(seed, "timing-client", 0);
        if (wantLong ? deal.cardsDealt >= 30 : deal.cardsDealt === 1) break;
      }
      assert.ok(deal);
      assert.ok(wantLong ? deal.cardsDealt >= 30 : deal.cardsDealt === 1);
      const created = await createTableRound("andar-bahar");
      const end = new Date(Date.now() - 10);
      const [round] = await db
        .update(tableRoundsTable)
        .set({
          serverSeed: seed,
          serverSeedHash: sha256Hex(seed),
          clientSeed: "timing-client",
          bettingEndsAt: end,
          revealEndsAt: new Date(end.getTime() + 5000),
          settleEndsAt: new Date(end.getTime() + 10000),
        })
        .where(eq(tableRoundsTable.id, created.id))
        .returning();
      assert.equal((round.config as any).bettingWindowMs, 30_000);
      assert.equal((round.config as any).revealDurationMs, 5000);
      assert.equal(round.outcome, null);
      assert.equal(isOutcomeDisclosed(round), false);
      const revealed = await revealTableRound(round);
      assert.equal(revealed.phase, "reveal");
      const duration = andarBaharRevealMs(deal.cardsDealt);
      assert.equal(revealed.revealEndsAt.getTime(), end.getTime() + duration);
      assert.equal(
        revealed.settleEndsAt.getTime(),
        end.getTime() + duration + 5000,
      );
      assert.equal((revealed.config as any).revealDurationMs, duration);
      assert.deepEqual(revealed.outcome, deal);
      const repeated = await revealTableRound(round);
      assert.equal(
        repeated.revealEndsAt.getTime(),
        revealed.revealEndsAt.getTime(),
      );
      const [stored] = await db
        .select()
        .from(tableRoundsTable)
        .where(eq(tableRoundsTable.id, round.id));
      assert.equal(stored.phase, "reveal");
      assert.equal(
        stored.revealEndsAt.getTime(),
        revealed.revealEndsAt.getTime(),
      );
      results.push(duration);
    }
    assert.ok(results[1] > results[0]);
  },
);
