import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import {
  PRIZE_DEFAULTS,
  REWARD_IDS,
  prizeBucketResult,
  prizePurchaseSchema,
  prizeSettingsSchema,
} from "@workspace/api-zod/prize-lotto";
import { prizeCommitment, prizeResult } from "../prizeLottoMath";

test("all published RTP settings have exact 10x expected reward value, equal chances and a no-prize outcome", () => {
  for (let rtp = 50; rtp <= 95; rtp++) {
    const counts = new Map<string, number>();
    for (let bucket = 0; bucket < 10000; bucket++) {
      const result = prizeBucketResult(bucket, rtp);
      counts.set(result, (counts.get(result) ?? 0) + 1);
    }
    for (const reward of REWARD_IDS) {
      assert.equal(counts.get(reward), rtp * 10);
      assert.equal((counts.get(reward)! * 10) / 100, rtp);
    }
    assert.equal(counts.get("none"), 10000 - rtp * 80);
  }
  for (const amount of [100, 1000, 20000])
    assert.ok(Math.abs((amount * 10 * 0.085) / amount - 0.85) < 1e-12);
});
test("results reproduce, commitments bind rules regardless of JSON key ordering, and input cannot supply prices or odds", () => {
  const seed = "published-test-seed",
    id = "PRIZE-9999999999999";
  assert.equal(prizeResult(seed, id, 85), prizeResult(seed, id, 85));
  const reordered = Object.fromEntries(
    Object.entries(PRIZE_DEFAULTS).reverse(),
  ) as typeof PRIZE_DEFAULTS;
  assert.equal(
    prizeCommitment(seed, id, PRIZE_DEFAULTS),
    prizeCommitment(seed, id, reordered),
  );
  assert.notEqual(
    prizeCommitment(seed, id, PRIZE_DEFAULTS),
    prizeCommitment(seed, id, { ...PRIZE_DEFAULTS, rtp: 90 }),
  );
  const valid = { drawId: id, reward: "travel", amount: 1000 };
  assert.equal(prizePurchaseSchema.safeParse(valid).success, true);
  for (const patch of [
    { amount: 100.5 },
    { amount: -100 },
    { amount: 0 },
    { amount: 20001 },
    { reward: "fake" },
    { payout: 1e9 },
    { rtp: 1 },
    { winner: "travel" },
  ])
    assert.equal(
      prizePurchaseSchema.safeParse({ ...valid, ...patch }).success,
      false,
    );
  assert.equal(
    prizeSettingsSchema.safeParse({ ...PRIZE_DEFAULTS, maxLiability: 1000 })
      .success,
    false,
  );
  assert.equal(
    prizeSettingsSchema.safeParse({ ...PRIZE_DEFAULTS, rtp: 100 }).success,
    false,
  );
});

test(
  "PostgreSQL: atomic wallet, retries, exposure caps, cutoff, recovery, private voucher delivery and operator authorization",
  { skip: !process.env.PRIZE_LOTTO_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_prize_lotto_test"),
      "Only an isolated test database is allowed",
    );
    const {
      db,
      pool,
      usersTable,
      prizeDrawsTable: draws,
      prizeTicketsTable: tickets,
      walletsTable,
      walletLedgerTable,
      betsTable,
    } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");
    const {
      prizeState,
      buyPrizeTicket: buy,
      cancelPrizeTicket: cancel,
      claimPrize,
      fulfillPrize,
      prizeAdminState,
      updatePrizeSettings,
      tickPrizeLotto,
      startPrizeLottoEngine,
    } = await import("../prizeLotto");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { hashPassword } = await import("../../lib/password");
    const { createSession } = await import("../auth");
    const { default: app } = await import("../../app");
    const [alice, bob, admin] = [randomUUID(), randomUUID(), randomUUID()];
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    let stop: (() => void) | undefined;
    try {
      const passwordHash = await hashPassword("PrizeTest@12345");
      for (const id of [alice, bob, admin])
        await db
          .insert(usersTable)
          .values({
            id,
            email: `${id}@example.test`,
            emailNormalized: `${id}@example.test`,
            passwordHash,
            role: id === admin ? "admin" : "player",
            displayName: "Prize test",
          });
      assert.equal((await prizeState(alice)).balance, 0);
      await postEntry({
        userId: alice,
        type: "adjustment",
        amount: 10_000_000n,
      });
      await postEntry({ userId: bob, type: "adjustment", amount: 15_000n });
      let sequence = 0;
      async function knownDraw(winner: string, config = PRIZE_DEFAULTS) {
        const ends = Date.now() + 300000 + sequence++ * 60000,
          id = `PRIZE-${ends}`;
        let seed = "",
          attempt = 0;
        do {
          seed = `test-seed-${attempt++}`;
        } while (prizeResult(seed, id, config.rtp) !== winner);
        await db
          .insert(draws)
          .values({
            id,
            ends,
            closes: ends - 5000,
            seed,
            commitment: prizeCommitment(seed, id, config),
            config,
          });
        return id;
      }
      const cashDraw = await knownDraw("cashback"),
        voucherDraw = await knownDraw("travel");
      const input = { drawId: cashDraw, reward: "cashback", amount: 1000 },
        request = randomUUID();
      const [cash, duplicate] = await Promise.all([
        buy(alice, input, request),
        buy(alice, input, request),
      ]);
      assert.equal(cash.id, duplicate.id);
      assert.equal((await getBalanceByUser(alice)).balance, 9_900_000n);
      assert.equal(
        (
          await db
            .select()
            .from(walletsTable)
            .where(eq(walletsTable.userId, alice))
        ).length,
        1,
      );
      await assert.rejects(
        buy(alice, { ...input, reward: "travel" }, request),
        /another ticket/,
      );
      const refundable = await buy(alice, input, randomUUID());
      await Promise.all([
        cancel(alice, refundable.id),
        cancel(alice, refundable.id),
      ]);
      assert.equal((await getBalanceByUser(alice)).balance, 9_900_000n);
      await assert.rejects(cancel(bob, cash.id), /not found/);
      const contest = await Promise.allSettled([
        buy(bob, { ...input, amount: 100 }, randomUUID()),
        postEntry({ userId: bob, scope: "dice", type: "bet", amount: -10000n }),
      ]);
      assert.equal(contest.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await getBalanceByUser(bob)).balance, 5000n);
      const beforeRows = (
        await db.select().from(tickets).where(eq(tickets.userId, bob))
      ).length;
      await assert.rejects(buy(bob, input, randomUUID()), /balance/);
      assert.equal(
        (await db.select().from(tickets).where(eq(tickets.userId, bob))).length,
        beforeRows,
      );
      const capped = await knownDraw("gold", {
        ...PRIZE_DEFAULTS,
        maxTicket: 100,
        maxLiability: 1000,
      });
      await buy(
        alice,
        { drawId: capped, reward: "gold", amount: 100 },
        randomUUID(),
      );
      const beforeCap = (await getBalanceByUser(alice)).balance;
      await assert.rejects(
        buy(
          alice,
          { drawId: capped, reward: "gold", amount: 100 },
          randomUUID(),
        ),
        /draw limit/,
      );
      assert.equal((await getBalanceByUser(alice)).balance, beforeCap);
      const voucher = await buy(
        alice,
        { drawId: voucherDraw, reward: "travel", amount: 1000 },
        randomUUID(),
      );
      await assert.rejects(claimPrize(alice, voucher.id), /no voucher/);
      const visible = await prizeState(alice);
      assert.ok(
        visible.draws
          .filter((d) => d.status === "open")
          .every((d) => !("seed" in d) && d.result === null),
      );
      assert.ok(
        (await prizeAdminState()).draws
          .filter((d) => d.status === "open")
          .every((d) => !("seed" in d) && d.result === null),
      );
      let config = await prizeAdminState();
      await updatePrizeSettings(admin, {
        version: config.version,
        settings: { ...config.settings, salesEnabled: false, rtp: 90 },
      });
      await assert.rejects(buy(alice, input, randomUUID()), /paused/);
      await assert.rejects(
        updatePrizeSettings(admin, {
          version: config.version,
          settings: config.settings,
        }),
        /changed/,
      );
      assert.equal(
        (await prizeState(alice)).draws.find((d) => d.id === cashDraw)!.config
          .rtp,
        85,
      );
      await updatePrizeSettings(admin, {
        version: config.version + 1,
        settings: PRIZE_DEFAULTS,
      });
      // Hold the common wallet across a sales deadline. Both ticket and debit must roll back.
      const lateDraw = await knownDraw("none");
      const walletId = (await getBalanceByUser(alice)).walletId;
      let release!: () => void, locked!: () => void;
      const hold = new Promise<void>((resolve) => {
          release = resolve;
        }),
        acquired = new Promise<void>((resolve) => {
          locked = resolve;
        });
      const blocker = db.transaction(async (tx) => {
        await tx
          .select()
          .from(walletsTable)
          .where(eq(walletsTable.id, walletId))
          .for("update");
        locked();
        await hold;
      });
      await acquired;
      await db
        .update(draws)
        .set({ closes: Date.now() + 400 })
        .where(eq(draws.id, lateDraw));
      const beforeLate = (await getBalanceByUser(alice)).balance;
      const late = assert.rejects(
        buy(alice, { ...input, drawId: lateDraw }, randomUUID()),
        /closed/,
      );
      await new Promise((resolve) => setTimeout(resolve, 650));
      release();
      await blocker;
      await late;
      assert.equal((await getBalanceByUser(alice)).balance, beforeLate);
      // Background recovery requires no open player page and credits exactly once.
      for (const id of [cashDraw, voucherDraw, capped])
        await db
          .update(draws)
          .set({ ends: Date.now() - 1, closes: Date.now() - 5001 })
          .where(eq(draws.id, id));
      stop = startPrizeLottoEngine();
      for (
        let n = 0;
        n < 50 &&
        (await getBalanceByUser(alice)).balance !== beforeLate + 1_000_000n;
        n++
      )
        await new Promise((resolve) => setTimeout(resolve, 100));
      stop();
      stop = undefined;
      await Promise.all([tickPrizeLotto(), tickPrizeLotto()]);
      assert.equal(
        (await getBalanceByUser(alice)).balance,
        beforeLate + 1_000_000n,
      );
      const replay = await buy(alice, input, request);
      assert.equal(replay.claimStatus, "credited");
      assert.equal(replay.prize, 10000);
      await assert.rejects(cancel(alice, cash.id), /Cancellation/);
      const [voucherBet] = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.id, voucher.id));
      assert.equal(
        voucherBet.payoutAmount,
        0n,
        "voucher awards are never falsely reported as wallet cash",
      );
      await assert.rejects(claimPrize(bob, voucher.id), /not found/);
      await Promise.all([
        claimPrize(alice, voucher.id),
        claimPrize(alice, voucher.id),
      ]);
      const delivery = {
        merchant: "Test travel issuer",
        code: `TEST-${randomUUID()}`,
        instructions: "Test voucher; not valid outside this test.",
        expiresAt: new Date(Date.now() + 86400000 * 30).toISOString(),
      };
      await assert.rejects(
        fulfillPrize(admin, voucher.id, {
          ...delivery,
          expiresAt: new Date().toISOString(),
        }),
        /24 hours/,
      );
      await fulfillPrize(admin, voucher.id, delivery);
      await fulfillPrize(admin, voucher.id, delivery);
      await assert.rejects(
        fulfillPrize(admin, voucher.id, { ...delivery, code: "ANOTHER" }),
        /already fulfilled/,
      );
      assert.equal(
        (await prizeState(alice)).tickets.find((t) => t.id === voucher.id)
          ?.delivery?.code,
        delivery.code,
      );
      assert.ok((await prizeState(bob)).tickets.every((t) => t.userId === bob));
      assert.ok(
        (await prizeAdminState()).tickets.every((t) => t.delivery === null),
      );
      const entries = await db
        .select()
        .from(walletLedgerTable)
        .where(
          and(
            eq(walletLedgerTable.userId, alice),
            eq(walletLedgerTable.refType, "prize_lotto_cashback"),
          ),
        );
      assert.equal(entries.length, 1);
      const playerSession = await createSession(alice, null, null),
        adminSession = await createSession(admin, null, null);
      const http = (path: string, sid?: string, init: RequestInit = {}) =>
        fetch(origin + path, {
          ...init,
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            ...(sid ? { Cookie: `sid=${sid}` } : {}),
            ...init.headers,
          },
        });
      assert.equal((await http("/api/prize-lotto/state")).status, 401);
      assert.equal(
        (await http("/api/prize-lotto/admin", playerSession.id)).status,
        403,
      );
      assert.equal(
        (await http("/api/prize-lotto/admin", adminSession.id)).status,
        200,
      );
      config = await prizeAdminState();
      const body = JSON.stringify({
        version: config.version,
        settings: PRIZE_DEFAULTS,
      });
      assert.equal(
        (
          await http("/api/prize-lotto/admin/settings", adminSession.id, {
            method: "PUT",
            body,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await http("/api/prize-lotto/admin/settings", adminSession.id, {
            method: "PUT",
            body,
            headers: { "X-Confirm-Password": "PrizeTest@12345" },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await http(
            `/api/prize-lotto/admin/tickets/${voucher.id}/fulfill`,
            playerSession.id,
            { method: "POST", body: JSON.stringify(delivery) },
          )
        ).status,
        403,
      );
    } finally {
      stop?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    }
  },
);
