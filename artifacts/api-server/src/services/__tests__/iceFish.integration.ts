import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import express from "express";
import { eq } from "drizzle-orm";
import {
  db,
  usersTable,
  gameConfigTable,
  gameEngineConfigTable,
  engineBankBudgetTable,
  tableRoundBetsTable,
  tableRoundsTable,
  gameBankLedgerTable,
  type User,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import {
  ICE_FISH_WHEEL,
  ICE_FISH_COUNTS,
  ICE_FISH_SPOTS,
  ICE_FISH_VALUES,
  ICE_FISH_WEIGHTS,
  isFish,
  settleIceFish,
  type IceFishOutcome,
} from "@workspace/api-zod/ice-fish";
import { deriveIceFish } from "../iceFish";
import {
  createTableRound,
  placeTableBets,
  revealTableRound,
  settleTableRound,
  finishTableRound,
  getTableRoundSnapshot,
  recoverTableRound,
} from "../tableRounds";
import { getBalanceByUser, postEntry } from "../wallet";
import { placeBet, cashOutBet, settleLoss } from "../bets";
import { updateB2cRtp } from "../b2cRtp";
import { engineStateFor, setForcedResult } from "../resultEngine/engine";
import { tableOutcomeSpace } from "../resultEngine/tableSpace";
import { previewBulkControls } from "../bulkGameControl";
import { demoRouteAllowed } from "../../demo/policy";
import { ALLOWED_ROLES_PER_TOPIC } from "@workspace/api-zod";
import router from "../../routes/iceFish";
import { errorHandler } from "../../middlewares/error";
let player: User, admin: User;
let lastRound = "";
before(async () => {
  await ready;
  for (const role of ["player", "admin"] as const) {
    const id = randomUUID();
    const [u] = await db
      .insert(usersTable)
      .values({
        id,
        email: `${id}@test.invalid`,
        emailNormalized: `${id}@test.invalid`,
        passwordHash: "unused",
        role,
        channel: "b2c",
      })
      .returning();
    if (role === "player") player = u;
    else admin = u;
  }
  await db
    .insert(gameConfigTable)
    .values({
      gameCode: "existing-test-game",
      houseEdge: 0.27,
      maxStakePaise: 12345n,
    });
  const old = await db.select().from(gameConfigTable);
  const migration = await readFile(
    "../../lib/db/drizzle/0069_ice_fish.sql",
    "utf8",
  );
  await memory.exec(migration);
  await memory.exec(migration);
  assert.deepEqual(
    (await db.select().from(gameConfigTable)).filter(
      (g) => g.gameCode !== "ice-fish",
    ),
    old,
  );
  await postEntry({
    userId: player.id,
    type: "adjustment",
    amount: 10_000_000n,
    memo: "Isolated Ice Fish tests",
  });
});
after(async () => {
  await memory.close();
});
test("45 positions and exact natural payout expectation at original and custom RTP", () => {
  for (const spot of ICE_FISH_SPOTS)
    assert.equal(
      ICE_FISH_WHEEL.filter((s) => s === spot).length,
      ICE_FISH_COUNTS[spot],
    );
  const amount = 100_000_000n;
  for (const target of [0.955, 0.85, 0.25, 1])
    for (const spot of ICE_FISH_SPOTS) {
      const segment = ICE_FISH_WHEEL.indexOf(spot);
      const payout = (boost: number, fishValue: number) => {
        const boosts = Array(45).fill(1);
        boosts[segment] = boost;
        return (
          Number(
            settleIceFish(
              [{ type: spot, amountPaise: String(amount) }],
              { version: 1, segment, boosts, fishValue },
              1 - target,
            ).totalPayout,
          ) / Number(amount)
        );
      };
      let conditional = 0;
      if (isFish(spot))
        for (let i = 0; i < 6; i++) {
          const w = ICE_FISH_WEIGHTS[i] / 100,
            v = ICE_FISH_VALUES[spot][i];
          conditional += w * 0.9 * payout(1, v);
          for (let boost = 2; boost <= 10; boost++)
            conditional += ((w * 0.1) / 9) * payout(boost, v);
        }
      else {
        conditional = payout(1, 0) * (1 - 199 / 4180);
        for (let boost = 3; boost <= 10; boost++)
          conditional += (payout(boost, 0) * 199) / 4180 / 8;
      }
      assert.ok(
        Math.abs((conditional * ICE_FISH_COUNTS[spot]) / 45 - target) < 1e-8,
        `${spot} return ${target}`,
      );
    }
});
test("seed replay, valid bonuses, validation, caps and wallet endpoint protection", async () => {
  for (let i = 0; i < 1000; i++) {
    const result = deriveIceFish(`seed-${i}`, "client", 7);
    assert.deepEqual(result, deriveIceFish(`seed-${i}`, "client", 7));
    assert.ok(result.segment >= 0 && result.segment < 45);
    assert.equal(result.boosts.length, 45);
    const spot = ICE_FISH_WHEEL[result.segment];
    if (isFish(spot))
      assert.ok(
        (ICE_FISH_VALUES[spot] as readonly number[]).includes(result.fishValue),
      );
    else assert.equal(result.fishValue, 0);
  }
  for (const bets of [
    [],
    [{ type: "fake", amountPaise: "100" }],
    [{ type: "blue", amountPaise: "-1" }],
    [{ type: "red", amountPaise: "1.5" }],
  ])
    assert.throws(() => settleIceFish(bets, deriveIceFish("a", "b", 0)));
  await assert.rejects(
    placeBet({ gameCode: "ice-fish", userId: player.id, stakeAmount: 100n }),
  );
});
test("real bets retain accepted prices, duplicate placement and settlement cannot charge or pay twice", async () => {
  const round = await createTableRound("ice-fish");
  lastRound = round.id;
  const snapshot = await getTableRoundSnapshot("ice-fish", player.id);
  assert.equal(snapshot!.outcome, null);
  assert.equal(snapshot!.serverSeed, null);
  const before = (await getBalanceByUser(player.id)).balance;
  const input = {
    gameCode: "ice-fish" as const,
    userId: player.id,
    roundId: round.id,
    pricingVersion: snapshot!.config.pricingVersion,
    idempotencyKey: randomUUID(),
    bets: ICE_FISH_SPOTS.map((type) => ({ type, amountPaise: "1000" })),
  };
  const receipt = await placeTableBets(input);
  assert.equal((await placeTableBets(input)).betId, receipt.betId);
  assert.equal((await getBalanceByUser(player.id)).balance, before - 5000n);
  await assert.rejects(
    cashOutBet({ userId: player.id, betId: receipt.betId, multiplier: 5000 }),
  );
  await assert.rejects(settleLoss(receipt.betId, player.id));
  await updateB2cRtp(admin, "ice-fish", { playerRtpBps: 5000, revision: 0 });
  const revealed = await revealTableRound(round),
    outcome = revealed.outcome as IceFishOutcome;
  assert.deepEqual(
    outcome,
    deriveIceFish(round.serverSeed, round.clientSeed, round.nonce),
  );
  assert.equal(revealed.resultSource, "drawn");
  const expected = settleIceFish(input.bets, outcome, 0.045).totalPayout;
  const settling = await settleTableRound(revealed);
  await finishTableRound(settling);
  await settleTableRound(revealed);
  assert.equal(await finishTableRound(settling), null);
  assert.equal(
    (await getBalanceByUser(player.id)).balance,
    before - 5000n + expected,
  );
  const [slip] = await db
    .select()
    .from(tableRoundBetsTable)
    .where(eq(tableRoundBetsTable.id, receipt.slipId));
  assert.equal(slip.payoutAmount, expected);
  const rows = await db
    .select()
    .from(gameBankLedgerTable)
    .where(eq(gameBankLedgerTable.roundId, round.id));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].deltaPaise, 5000n - expected);
});
test("round stake limit, late bets and stale prices reject without taking funds", async () => {
  const round = await createTableRound("ice-fish"),
    snap = await getTableRoundSnapshot("ice-fish", player.id),
    before = (await getBalanceByUser(player.id)).balance;
  const input = {
    gameCode: "ice-fish" as const,
    userId: player.id,
    roundId: round.id,
    pricingVersion: snap!.config.pricingVersion,
    idempotencyKey: randomUUID(),
    bets: [{ type: "white", amountPaise: "500001" }],
  };
  await assert.rejects(placeTableBets(input));
  await assert.rejects(
    placeTableBets({
      ...input,
      pricingVersion: "stale",
      bets: [{ type: "blue", amountPaise: "1000" }],
    }),
  );
  assert.equal((await getBalanceByUser(player.id)).balance, before);
  await placeTableBets({
    ...input,
    bets: [{ type: "white", amountPaise: "500000" }],
  });
  await assert.rejects(
    placeTableBets({
      ...input,
      idempotencyKey: randomUUID(),
      bets: [{ type: "blue", amountPaise: "100" }],
    }),
  );
  const revealed = await revealTableRound(round);
  await assert.rejects(
    placeTableBets({
      ...input,
      idempotencyKey: randomUUID(),
      bets: [{ type: "grey", amountPaise: "100" }],
    }),
  );
  await settleTableRound(revealed);
  await finishTableRound(revealed);
});
test("result controls cover Ice Fish; next-result selection and restart recovery preserve money", async () => {
  const plan = await previewBulkControls(admin, {
    kind: "rtp",
    channel: "both",
    playerRtpBps: 8500,
    includeTables: true,
  });
  assert.ok(plan.b2cGames.includes("ice-fish"));
  assert.ok(plan.tableGames.includes("ice-fish"));
  const state = await engineStateFor("ice-fish", null);
  assert.equal(state.mode, "normal");
  const round = await createTableRound("ice-fish"),
    snap = await getTableRoundSnapshot("ice-fish", player.id);
  const space = tableOutcomeSpace("ice-fish", (s) =>
    deriveIceFish(s.serverSeed, s.clientSeed, s.nonce),
  );
  assert.deepEqual(
    space.choices().map((c) => c.id),
    [...ICE_FISH_SPOTS],
  );
  await setForcedResult({
    gameCode: "ice-fish",
    partnerId: null,
    choiceId: "green",
    space,
  });
  const bets = [{ type: "green", amountPaise: "1000" }],
    before = (await getBalanceByUser(player.id)).balance;
  await placeTableBets({
    gameCode: "ice-fish",
    userId: player.id,
    roundId: round.id,
    pricingVersion: snap!.config.pricingVersion,
    idempotencyKey: randomUUID(),
    bets,
  });
  const revealed = await revealTableRound(round);
  assert.equal(
    ICE_FISH_WHEEL[(revealed.outcome as IceFishOutcome).segment],
    "green",
  );
  assert.equal(revealed.resultSource, "admin");
  assert.equal(revealed.revealEndsAt.getTime() - revealed.bettingEndsAt.getTime(), 42000);
  assert.equal(revealed.settleEndsAt.getTime() - revealed.revealEndsAt.getTime(), 4000);
  assert.equal((await getTableRoundSnapshot("ice-fish", player.id))!.config.revealDurationMs, 42000);
  assert.equal((await recoverTableRound(revealed, revealed.bettingEndsAt.getTime() + 30000))!.id, revealed.id);
  assert.equal((await getBalanceByUser(player.id)).balance, before - 1000n, "Rejoining before the catch cannot settle early");
  assert.equal((await db.select().from(gameConfigTable).where(eq(gameConfigTable.gameCode, "ice-fish")))[0].revealDurationMs, 14000, "Bonus timing does not overwrite operator settings");
  const expired = {
    ...revealed,
    bettingEndsAt: new Date(Date.now() - 30000),
    revealEndsAt: new Date(Date.now() - 16000),
    settleEndsAt: new Date(Date.now() - 1000),
  };
  await db
    .update(tableRoundsTable)
    .set({
      bettingEndsAt: expired.bettingEndsAt,
      revealEndsAt: expired.revealEndsAt,
      settleEndsAt: expired.settleEndsAt,
    })
    .where(eq(tableRoundsTable.id, round.id));
  await recoverTableRound(expired);
  const recovered = (await getBalanceByUser(player.id)).balance;
  assert.equal(
    recovered,
    before -
      1000n +
      settleIceFish(bets, revealed.outcome as IceFishOutcome, 0.5).totalPayout,
  );
  await recoverTableRound(expired);
  assert.equal((await getBalanceByUser(player.id)).balance, recovered);
});
test("every fish bonus gets a persisted full clock; anchors and legacy rounds retain their timing", async () => {
  const settingsBefore = await db.select().from(gameConfigTable);
  const seededRound = async (choiceId: string) => {
    const round = await createTableRound("ice-fish");
    let i = 0;
    while (ICE_FISH_WHEEL[deriveIceFish(`bonus-timing-${i}`, round.clientSeed, round.nonce).segment] !== choiceId) i++;
    const serverSeed = `bonus-timing-${i}`, serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");
    await db.update(tableRoundsTable).set({serverSeed, serverSeedHash}).where(eq(tableRoundsTable.id, round.id));
    return {...round, serverSeed, serverSeedHash};
  };
  for (const choiceId of ["blue", "green", "red", "white"] as const) {
    const round = await seededRound(choiceId);
    assert.equal(round.revealEndsAt.getTime() - round.bettingEndsAt.getTime(), 14000, "Pre-bet clocks must not disclose the result");
    const revealed = await revealTableRound(round);
    assert.equal(ICE_FISH_WHEEL[(revealed.outcome as IceFishOutcome).segment], choiceId);
    const duration = choiceId === "white" ? 14000 : 42000;
    assert.equal(revealed.revealEndsAt.getTime() - revealed.bettingEndsAt.getTime(), duration);
    const [saved] = await db.select().from(tableRoundsTable).where(eq(tableRoundsTable.id, round.id));
    assert.equal(saved.revealEndsAt.getTime(), revealed.revealEndsAt.getTime());
    const resumed = await recoverTableRound(saved, round.bettingEndsAt.getTime() + 10000);
    assert.equal(resumed!.revealEndsAt.getTime(), saved.revealEndsAt.getTime());
    await finishTableRound(await settleTableRound(revealed));
  }
  const legacy = await seededRound("blue");
  const oldConfig = {...legacy.config as Record<string, unknown>};
  delete oldConfig.iceFishMotionVersion;
  await db.update(tableRoundsTable).set({config:oldConfig}).where(eq(tableRoundsTable.id,legacy.id));
  const oldReveal = await revealTableRound({...legacy, config:oldConfig});
  assert.equal(oldReveal.revealEndsAt.getTime() - oldReveal.bettingEndsAt.getTime(), 14000);
  await finishTableRound(await settleTableRound(oldReveal));
  assert.deepEqual(await db.select().from(gameConfigTable), settingsBefore);
});

test("authenticated routes expose public config, own history and valid seed proofs; demo and realtime are wired", async () => {
  assert.ok(demoRouteAllowed("GET", "/api/ice-fish/round"));
  assert.ok(demoRouteAllowed("POST", "/api/ice-fish/bet"));
  assert.ok(
    ALLOWED_ROLES_PER_TOPIC["table-rounds:ice-fish"].includes("player"),
  );
  const app = express();
  app.use(express.json());
  let loggedIn = false;
  app.use((req, _res, next) => {
    if (loggedIn) req.user = player;
    next();
  });
  app.use("/api/ice-fish", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/ice-fish`;
  try {
    assert.equal((await fetch(base + "/config")).status, 401);
    loggedIn = true;
    const cfg = await fetch(base + "/config");
    assert.equal(cfg.status, 200);
    assert.equal(((await cfg.json()) as any).houseEdge, 0.5);
    const history = await fetch(base + "/recent");
    assert.equal(history.status, 200);
    assert.ok(((await history.json()) as unknown[]).length >= 1);
    const verify = await fetch(base + `/${lastRound}/verify`);
    assert.equal(verify.status, 200);
    assert.equal(((await verify.json()) as any).verified, true);
    assert.equal(
      (
        await fetch(base + "/bet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            roundId: lastRound,
            bets: [],
            idempotencyKey: randomUUID(),
          }),
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
