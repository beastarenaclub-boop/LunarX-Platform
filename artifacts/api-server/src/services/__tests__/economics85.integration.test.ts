import assert from "node:assert/strict";
import { test } from "node:test";

test(
  "85% rollout: server crash authority, wallet credits, reconnect and accepted table versions",
  { skip: !process.env.ECONOMICS_INTEGRATION },
  async () => {
    assert.equal(new URL(process.env.DATABASE_URL!).pathname, "/economics");
    const {
      db,
      pool,
      usersTable,
      betsTable,
      gameConfigTable,
      tableRoundsTable,
      blackjackRoundsTable,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { randomUUID } = await import("node:crypto");
    const { ensureGameConfigDefaults } = await import("../../lib/bootstrap");
    const { createSession } = await import("../auth");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { startCrashSettlement } = await import("../crashRounds");
    const { deriveCrashPoint, invalidateConfigCache } = await import("../rtp");
    const { placeBet } = await import("../bets");
    const { dealForTableRound, forceFinishRounds } =
      await import("../blackjack");
    const { default: app } = await import("../../app");
    await ensureGameConfigDefaults();
    invalidateConfigCache();
    const userId = randomUUID(),
      email = `economics-${userId}@example.test`;
    await db
      .insert(usersTable)
      .values({
        id: userId,
        email,
        emailNormalized: email,
        passwordHash: "test",
      });
    await postEntry({ userId, type: "adjustment", amount: 1000000n });
    const session = await createSession(userId, null, null);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
    const request = async (path: string, body?: unknown) => {
      const response = await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: `sid=${session.id}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, data: (await response.json()) as any };
    };
    let stopSweep: (() => void) | undefined;
    try {
      const config = (
        await db
          .select()
          .from(gameConfigTable)
          .where(eq(gameConfigTable.gameCode, "lunar"))
      )[0];
      assert.equal(config.houseEdge, 0.15);
      assert.equal(config.settlementMode, "house_edge");
      const round = (await request("/crash/lunar")).data;
      assert.equal(round.phase, "betting");
      assert.equal(round.serverSeed, null);
      assert.equal(round.crashPoint, null);
      assert.equal(round.nextRoundAt, null);
      assert.equal((await request("/crash/lunar")).data.id, round.id);
      assert.equal(
        (
          await request("/bets/place", {
            gameCode: "lunar",
            roundId: "fabricated",
            stakeAmount: "10000",
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request("/bets/place", {
            gameCode: "dice",
            roundId: round.id,
            stakeAmount: "10000",
          })
        ).status,
        400,
      );
      const a = await request("/bets/place", {
        gameCode: "lunar",
        roundId: round.id,
        stakeAmount: "10000",
        panel: 0,
        autoCashOut: 2,
      });
      const b = await request("/bets/place", {
        gameCode: "lunar",
        roundId: round.id,
        stakeAmount: "10000",
        panel: 1,
      });
      assert.equal(a.status, 200, JSON.stringify(a));
      assert.equal(b.status, 200, JSON.stringify(b));
      assert.equal((await getBalanceByUser(userId)).balance, 980000n);
      assert.equal(
        (await request(`/bets/${b.data.id}/cashout`, { multiplier: 1000 }))
          .status,
        400,
      );
      assert.equal(
        (await request(`/bets/${b.data.id}/lose`, {})).data.status,
        "placed",
      );
      const [raw] = await db
        .select()
        .from(tableRoundsTable)
        .where(eq(tableRoundsTable.id, round.id));
      assert.equal(
        deriveCrashPoint(
          raw.serverSeed,
          raw.clientSeed,
          raw.nonce,
          0.15,
          config.maxMultiplier,
          3,
        ),
        (raw.outcome as { crashPoint: number }).crashPoint,
      );
      // Set a deterministic flight clock/outcome in this isolated test only.
      await db
        .update(tableRoundsTable)
        .set({
          outcome: { crashPoint: 3 },
          bettingEndsAt: new Date(Date.now() - 8000),
          revealEndsAt: new Date(Date.now() + 3000),
          settleEndsAt: new Date(Date.now() + 5500),
        })
        .where(eq(tableRoundsTable.id, round.id));
      const live = (await request(`/crash/lunar?roundId=${round.id}`)).data;
      assert.equal(live.serverSeed, null);
      assert.equal(live.crashPoint, null);
      assert.equal(
        live.bets.find((x: any) => x.id === a.data.id).payoutAmount,
        "20000",
      );
      assert.equal(
        (await request(`/bets/${b.data.id}/cashout`, { multiplier: 1000 }))
          .status,
        400,
      );
      const wins = await Promise.all([
        request(`/bets/${b.data.id}/cashout`, { multiplier: 2.1 }),
        request(`/bets/${b.data.id}/cashout`, { multiplier: 2.1 }),
      ]);
      assert.ok(wins.some((w) => w.status === 200));
      assert.equal((await getBalanceByUser(userId)).balance, 1021000n);
      await request(`/bets/${b.data.id}/cashout`, { multiplier: 2.1 });
      assert.equal((await getBalanceByUser(userId)).balance, 1021000n);
      await db
        .update(tableRoundsTable)
        .set({
          revealEndsAt: new Date(Date.now() - 10),
          settleEndsAt: new Date(Date.now() - 1),
        })
        .where(eq(tableRoundsTable.id, round.id));
      const ended = (await request(`/crash/lunar?roundId=${round.id}`)).data;
      assert.equal(ended.serverSeed, raw.serverSeed);
      assert.equal(ended.crashPoint, 3);
      const next = (await request("/crash/lunar")).data;
      const auto = await request("/bets/place", {
        gameCode: "lunar",
        roundId: next.id,
        stakeAmount: "10000",
        panel: 0,
        autoCashOut: 2,
      });
      const loss = await request("/bets/place", {
        gameCode: "lunar",
        roundId: next.id,
        stakeAmount: "10000",
        panel: 1,
      });
      assert.equal(auto.status, 200);
      assert.equal(loss.status, 200);
      await db
        .update(tableRoundsTable)
        .set({
          outcome: { crashPoint: 2 },
          bettingEndsAt: new Date(Date.now() - 10000),
          revealEndsAt: new Date(Date.now() - 1000),
          settleEndsAt: new Date(Date.now() - 1),
        })
        .where(eq(tableRoundsTable.id, next.id));
      // No browser request is needed for either settlement, even exactly at the auto target.
      stopSweep = startCrashSettlement();
      for (let i = 0; i < 30; i++) {
        const rows = await db
          .select()
          .from(betsTable)
          .where(eq(betsTable.roundId, next.id));
        if (rows.every((b) => b.status !== "placed")) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const settled = await db
        .select()
        .from(betsTable)
        .where(eq(betsTable.roundId, next.id));
      assert.equal(
        settled.find((b) => b.id === auto.data.id)?.payoutAmount,
        20000n,
      );
      assert.equal(settled.find((b) => b.id === loss.data.id)?.status, "lost");
      assert.equal((await getBalanceByUser(userId)).balance, 1021000n);
      assert.equal(
        (await request(`/bets/${loss.data.id}/cashout`, { multiplier: 1.01 }))
          .status,
        400,
      );
      for (const payoutVersion of [1, 2]) {
        const bet = await placeBet({
          userId,
          gameCode: "blackjack",
          stakeAmount: 10001n,
          tableRoundPlacement: true,
        });
        const hand = await dealForTableRound({
          userId,
          betId: bet.id,
          stakeAmount: 10001n,
          serverSeed: "bj-acceptance",
          serverSeedHash: "test",
          clientSeed: "client",
          nonce: 0,
          maxMultiplier: 10,
          payoutVersion,
        });
        await forceFinishRounds([hand.id]);
        const [final] = await db
          .select()
          .from(blackjackRoundsTable)
          .where(eq(blackjackRoundsTable.id, hand.id));
        const [receipt] = await db
          .select()
          .from(betsTable)
          .where(eq(betsTable.id, bet.id));
        assert.equal(final.payoutVersion, payoutVersion);
        assert.equal(final.payoutAmount, receipt.payoutAmount);
      }
      const { wingoState, placeWingoBet, tickWingo } = await import("../wingo");
      const { forexState, placeForexTrade, tickForex } =
        await import("../forex");
      const {
        wingoRoundsTable,
        wingoBetsTable,
        forexMarketTable,
        forexTradesTable,
      } = await import("@workspace/db");
      const wingo = await wingoState(userId, 180);
      assert.equal(wingo.round.payoutVersion, 2);
      await db
        .update(wingoRoundsTable)
        .set({ ends: Date.now() + 60000 })
        .where(eq(wingoRoundsTable.period, wingo.round.period));
      const wingoBalance = (await getBalanceByUser(userId)).balance;
      for (const pick of ["red", "green"])
        await placeWingoBet(userId, {
          duration: 180,
          period: wingo.round.period,
          pick,
          stake: 1000,
          request: randomUUID(),
        });
      await db
        .update(wingoRoundsTable)
        .set({ ends: Date.now() - 1 })
        .where(eq(wingoRoundsTable.period, wingo.round.period));
      await tickWingo();
      const colourBets = await db
        .select()
        .from(wingoBetsTable)
        .where(eq(wingoBetsTable.userId, userId));
      assert.equal(
      colourBets.reduce((sum, b) => sum + (b.payout ?? 0), 0),
        1700,
      );
      assert.equal(
        (await getBalanceByUser(userId)).balance,
        wingoBalance - 300n,
      );
      await forexState(userId);
      const [market] = await db.select().from(forexMarketTable);
      const forexRound = {
        ...market.data,
        start: Date.now() - 1000,
        roundId: Math.floor(Date.now() / 60000) - 5,
      };
      await db
        .update(forexMarketTable)
        .set({ data: forexRound })
        .where(eq(forexMarketTable.id, 1));
      const forex = await forexState(userId);
      assert.equal(forex.round.returnMultiplier, 1.7);
      assert.equal((forex as any).outcomeSeed, undefined);
      const forexBalance = (await getBalanceByUser(userId)).balance;
      for (const side of ["buy", "sell"])
        await placeForexTrade(userId, {
          asset: "gold",
          side,
          amount: 100,
          roundId: forex.round.id,
          requestId: randomUUID(),
        });
      await db
        .update(forexMarketTable)
        .set({ data: { ...forexRound, start: Date.now() - 61000 } })
        .where(eq(forexMarketTable.id, 1));
      await tickForex();
      const trades = await db
        .select()
        .from(forexTradesTable)
        .where(eq(forexTradesTable.userId, userId));
      assert.equal(
        trades.reduce((sum, t) => sum + t.payout, 0),
        17000,
      );
      assert.equal(
        (await getBalanceByUser(userId)).balance,
        forexBalance - 3000n,
      );
      const completed = await forexState(userId);
      assert.equal(completed.results[0].outcomeSeed, forexRound.outcomeSeed);
    } finally {
      stopSweep?.();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
