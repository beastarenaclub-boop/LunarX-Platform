import { RETIRED_GAME_CODES } from "../lib/retiredGames";
import { legacyChecks } from "./legacy";
import { RESULT_ENGINE_GAMES, usesResultEngine } from "../services/resultEngine/scope";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  gameConfigTable,
  gameEngineConfigTable,
  gameBankLedgerTable,
  roundDecisionTable,
  tableRoundsTable,
  tableRoundBetsTable,
  betsTable,
} from "@workspace/db";
import { ready, memory } from "../demo/database";
import { ensureGameConfigDefaults } from "../lib/bootstrap";
import {
  createTableRound,
  revealTableRound,
  settleTableRound,
  finishTableRound,
  placeTableBets,
  ADAPTERS,
  TABLE_GAME_CODES,
  type RoundConfigSnapshot,
} from "../services/tableRounds";
import {
  engineStateFor,
  settleBank,
  setForcedResult,
} from "../services/resultEngine/engine";
import { tableOutcomeSpace } from "../services/resultEngine/tableSpace";
import {
  writeBankBudget,
  bankBudgetView,
} from "../services/resultEngine/bankBudget";
import { getBalanceByUser, postEntry } from "../services/wallet";
import { pendingWinFor, takePendingWin } from "../services/pendingWins";
import gameControl from "../routes/gameControl";
import handoffGames from "../routes/handoffGames";
import rummyRouter from "../games/rummy/routes";
import { createRound, getRound, act } from "../games/rummy/service";
import { errorHandler } from "../middlewares/error";
import { invalidateConfigCache } from "../services/rtp";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import walletRouter from "../routes/wallet";
import gameRouter from "../routes/game";
import managedResultVerification from "../routes/managedResultVerification";
import { browserChecks } from "./browser";
import { demoRouteAllowed } from "../demo/policy";
import { ALLOWED_ROLES_PER_TOPIC } from "../realtime/protocol";

test("New game routes work in isolated demo sessions while admin controls stay private",()=>{
  for(const code of ["roulette-american","roulette-mini","fun-target","rummy-royale"]) {
    assert.equal(demoRouteAllowed("GET",`/api/${code}/config`),true);
    assert.equal(demoRouteAllowed("POST",`/api/${code}/place`),true);
    assert.ok(ALLOWED_ROLES_PER_TOPIC[`game-config:${code}`]?.includes("player"));
    if(code!=="rummy-royale")assert.ok(ALLOWED_ROLES_PER_TOPIC[`table-rounds:${code}`]?.includes("player"));
  }
  assert.equal(demoRouteAllowed("PUT","/api/admin/game-control/fun-target"),false);
});

after(async () => {
  await memory.close();
});
test("Migrations preserve settings and budget headroom through withdrawal and engine reconnection", async () => {
  const prior = new PGlite();
  try {
    await prior.exec(
      await readFile(resolve("../../tmp/handoff-previous-schema.sql"), "utf8"),
    );
    await prior.exec(
      "INSERT INTO game_config(id,game_code,house_edge,max_stake_paise) VALUES ('existing','roulette',0.027,123456);",
    );
    await prior.exec(
      await readFile(
        resolve("../../lib/db/drizzle/0065_handoff_game_control.sql"),
        "utf8",
      ),
    );
    const saved = await prior.query<{
      game_code: string;
      house_edge: number;
      max_stake_paise: number;
      ft_digit_return: number;
    }>(
      "SELECT game_code,house_edge,max_stake_paise,ft_digit_return FROM game_config WHERE id='existing'",
    );
    assert.equal(saved.rows[0].game_code, "roulette");
    assert.equal(saved.rows[0].house_edge, 0.027);
    assert.equal(String(saved.rows[0].max_stake_paise), "123456");
    assert.equal(saved.rows[0].ft_digit_return, 9);
    await prior.query(
      "SELECT * FROM game_engine_config, game_bank_ledger, round_decision, engine_bank_budget, pending_wins, rummy_rounds LIMIT 0",
    );
    await prior.exec(`
      INSERT INTO game_config(id,game_code,enabled) VALUES ('retire-rummy','rummy-royale',true),('retire-speed','speed-auto-roulette',true);
      INSERT INTO game_engine_config(stream_key,game_code,bank_paise,mode) VALUES
        ('roulette-american','roulette-american',1000,'rtp'),('roulette-mini','roulette-mini',2000,'normal'),('roulette','roulette',9000,'collect');
      INSERT INTO engine_bank_budget(scope,mode,floor_paise) VALUES ('local','combined',2000),('other-scope','same_each',1500);
    `);
    const settingsBefore = (await prior.query("SELECT * FROM game_engine_config ORDER BY stream_key")).rows;
    await prior.exec(await readFile(resolve("../../lib/db/drizzle/0067_four_selected_games.sql"), "utf8"));
    assert.deepEqual((await prior.query("SELECT * FROM game_engine_config ORDER BY stream_key")).rows, settingsBefore);
    const budgets = await prior.query<{scope:string;floor_paise:bigint}>("SELECT scope,floor_paise FROM engine_bank_budget ORDER BY scope");
    assert.equal(String(budgets.rows[0].floor_paise), "-7000");
    assert.equal(3000n - BigInt(budgets.rows[0].floor_paise), 10000n, "Combined budget headroom survives removal of legacy banks");
    assert.equal(String(budgets.rows[1].floor_paise), "1500");
    assert.equal((await prior.query<{count:number}>("SELECT count(*)::int AS count FROM game_config WHERE game_code IN ('rummy-royale','speed-auto-roulette') AND enabled")).rows[0].count, 0);
    const reconnect = await readFile(resolve("../../lib/db/drizzle/0068_restore_table_engines.sql"), "utf8");
    await prior.exec("BEGIN; SAVEPOINT before_reconnect;");
    await prior.exec(reconnect);
    const combined = (await prior.query<{floor_paise:bigint}>("SELECT floor_paise FROM engine_bank_budget WHERE scope='local'")).rows[0];
    assert.equal(String(combined.floor_paise), "2000");
    assert.equal(12000n - BigInt(combined.floor_paise), 10000n, "Reconnected banks must not add or remove shared headroom");
    assert.deepEqual((await prior.query("SELECT * FROM game_engine_config WHERE stream_key IN ('roulette','roulette-american','roulette-mini') ORDER BY stream_key")).rows, settingsBefore);
    assert.equal((await prior.query<{count:number}>("SELECT count(*)::int AS count FROM game_config WHERE game_code IN ('rummy-royale','speed-auto-roulette') AND enabled")).rows[0].count, 0);
    await prior.exec("ROLLBACK TO SAVEPOINT before_reconnect; UPDATE engine_bank_budget SET mode='same_each',floor_paise=1500 WHERE scope='local';");
    await prior.exec(reconnect);
    const restoredFloor = (await prior.query<{min_bank_floor_paise:bigint}>("SELECT min_bank_floor_paise FROM game_engine_config WHERE stream_key='roulette'")).rows[0];
    assert.equal(String(restoredFloor.min_bank_floor_paise), "7500");
    assert.equal((await prior.query<{min_bank_floor_paise:bigint}>("SELECT min_bank_floor_paise FROM game_engine_config WHERE stream_key='roulette-american'")).rows[0].min_bank_floor_paise.toString(), "0");
    assert.equal((await prior.query<{count:number}>("SELECT count(*)::int AS count FROM game_engine_config")).rows[0].count, 16);
    await prior.exec("ROLLBACK;");
  } finally {
    await prior.close();
  }
});
test("Game Control: real SQL, accepted prices, result selection, restart-safe settlement, authenticated API and new games", async () => {
  await ready;
  await db
    .insert(usersTable)
    .values(
      ["admin", "player", "support"].map((id) => ({
        id,
        email: `${id}@handoff.test`,
        emailNormalized: `${id}@handoff.test`,
        passwordHash: "test",
        role: id as "admin" | "player" | "support",
        displayName: id,
      })),
    );
  await ensureGameConfigDefaults();
  await postEntry({
    userId: "player",
    type: "deposit",
    amount: 1_000_000n,
    refType: "test",
    refId: "fund",
  });
  const supported = RESULT_ENGINE_GAMES;
  assert.equal(supported.length, RESULT_ENGINE_GAMES.length);
  for (const code of supported) {
    const state = await engineStateFor(code, null);
    assert.equal(state.mode, "normal");
    assert.equal(state.bankPaise, 0n);
    const cfg = await db
      .select()
      .from(gameConfigTable)
      .where(eq(gameConfigTable.gameCode, code));
    assert.ok(cfg[0], `Missing config: ${code}`);
    const sample = await createTableRound(code),
      adapter = ADAPTERS[code];
    const space = tableOutcomeSpace(code, (seed) =>
      adapter.derive(
        seed.serverSeed,
        seed.clientSeed,
        seed.nonce,
        sample.config as RoundConfigSnapshot,
      ),
    );
    assert.ok(
      space.choices().length > 1,
      `${code} must expose meaningful result choices`,
    );
    assert.ok(
      space
        .candidates(sample)
        .every((candidate) => candidate.choiceId !== "draw"),
      `${code} must classify actual outcomes`,
    );
  }
  const users = new Map(
    (await db.select().from(usersTable)).map((u) => [u.id, u]),
  );
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = users.get(String(req.headers["x-actor"]));
    next();
  });
  app.get("/api/auth/me", (req, res) => req.user ? res.json(req.user) : res.status(401).json({error:"Unauthenticated"}));
  app.use("/api/game", gameRouter);
  app.get("/api/network/website", (_req, res) => res.json(null));
  app.get("/api/auth/site", (_req, res) =>
    res.json({ channel: "b2c", signupEnabled: true }),
  );
  app.use("/api/wallet", walletRouter);
  app.use("/api/admin/game-control", gameControl);
  app.use("/api", managedResultVerification);
  app.use("/api", handoffGames);
  app.use("/api/rummy-royale", rummyRouter);
  app.use(errorHandler);
  if (process.env.HANDOFF_BROWSER) {
    app.use("/admin", express.static(resolve("../admin-panel/dist/public")));
    app.get("/admin/{*path}", (_req, res) =>
      res.sendFile(resolve("../admin-panel/dist/public/index.html")),
    );
    app.use(express.static(resolve(process.env.TABLE_ENGINES_BROWSER ? "../../tmp/table-engines-release-web" : process.env.FOUR_GAMES_BROWSER ? "../../tmp/four-games-release-web" : "../3d-game/dist/public")));
    app.get(/^(?!\/api\/).*/, (_req, res) =>
      res.sendFile(resolve(process.env.TABLE_ENGINES_BROWSER ? "../../tmp/table-engines-release-web/index.html" : process.env.FOUR_GAMES_BROWSER ? "../../tmp/four-games-release-web/index.html" : "../3d-game/dist/public/index.html")),
    );
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = async (
    path: string,
    actor = "admin",
    method = "GET",
    body?: unknown,
  ) =>
    fetch(base + path, {
      method,
      headers: { "x-actor": actor, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    for (const role of ["player", "support", ""])
      assert.equal(
        (await request("/api/admin/game-control", role)).status,
        role ? 403 : 401,
      );
    const listing: any = await (
      await request("/api/admin/game-control")
    ).json();
    assert.ok(
      listing.games.some(
        (g: any) => g.game.gameCode === "rummy-royale" && !g.supported,
      ),
    );
    assert.ok(
      listing.games.some(
        (g: any) => g.game.gameCode === "jetx" && !g.supported,
      ),
    );
    const target = listing.games.find(
      (g: any) => g.game.gameCode === "fun-target",
    );
    assert.deepEqual(listing.games.filter((g:any)=>g.supported).map((g:any)=>g.game.gameCode).sort(), [...RESULT_ENGINE_GAMES].sort());
    await legacyChecks(request);
    assert.equal(
      (
        await request("/api/admin/game-control/fun-target", "admin", "PUT", {
          revision: target.engine.revision,
          params: { noiseRate: 0 },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/admin/game-control/jetx", "admin", "PUT", {
          revision: "x",
          mode: "collect",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await request("/api/admin/game-control/fun-target", "admin", "PUT", {
          revision: target.engine.revision,
          mode: "rtp",
          budgetPaise: "100000",
          params: { rtpHoldBps: 1000 },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/api/admin/game-control/fun-target", "admin", "PUT", {
          revision: target.engine.revision,
          mode: "collect",
        })
      ).status,
      409,
    );
    for (const code of [
      "roulette-american",
      "roulette-mini",
      "fun-target",
    ] as const) {
      await db
        .update(gameConfigTable)
        .set({ maxPerSpotPaise: 2000n })
        .where(eq(gameConfigTable.gameCode, code));
      invalidateConfigCache(code);
      const cfg: any = await (
        await request(`/api/${code}/config`, "player")
      ).json();
      assert.equal(cfg.enabled, true);
      if (code !== "fun-target")
        assert.equal(cfg.wheel.pocketCount, code === "roulette-mini" ? 19 : 38);
      const round = await createTableRound(code);
      const bet = [{ type: "straight", selection: [5], amountPaise: "1000" }];
      const before = (await getBalanceByUser("player")).balance;
      const placed = await placeTableBets({
        gameCode: code,
        userId: "player",
        roundId: round.id,
        bets: bet,
        idempotencyKey: `key-${code}`,
      });
      const replay = await placeTableBets({
        gameCode: code,
        userId: "player",
        roundId: round.id,
        bets: [{ amountPaise: "1000", selection: [5], type: "straight" }],
        idempotencyKey: `key-${code}`,
      });
      assert.equal(replay.betId, placed.betId);
      assert.equal((await getBalanceByUser("player")).balance, before - 1000n);
      await assert.rejects(
        placeTableBets({
          gameCode: code,
          userId: "player",
          roundId: round.id,
          bets: [{ ...bet[0], amountPaise: "1001" }],
        }),
        /SPOT_LIMIT_EXCEEDED/,
      );
      assert.equal((await getBalanceByUser("player")).balance, before - 1000n);
      await assert.rejects(
        placeTableBets({
          gameCode: code,
          userId: "player",
          roundId: round.id,
          bets: [{ ...bet[0], selection: [6] }],
          idempotencyKey: `key-${code}`,
        }),
        /IDEMPOTENCY_KEY_REUSED/,
      );
      await setForcedResult({
        gameCode: code,
        partnerId: null,
        choiceId: "5",
        space: tableOutcomeSpace(code, () => ({ pocket: 0 })),
      });
      const revealed = await revealTableRound(round);
      assert.equal((revealed.outcome as { pocket: number }).pocket, 5);
      assert.equal(revealed.resultSource, "admin");
      await assert.rejects(
        placeTableBets({
          gameCode: code,
          userId: "player",
          roundId: round.id,
          bets: bet,
        }),
        /BETTING_CLOSED/,
      );
      // An admin cap edit after acceptance must not reprice this slip.
      await db
        .update(gameConfigTable)
        .set({ maxMultiplier: 1 })
        .where(eq(gameConfigTable.gameCode, code));
      invalidateConfigCache(code);
      await settleTableRound(revealed);
      const done = await finishTableRound(revealed);
      assert.ok(done);
      assert.equal(
        (await request(`/api/${code}/${done.id}/verify`, "player")).status,
        409,
      );
      const expected =
        code === "roulette-american"
          ? 36000n
          : code === "roulette-mini"
            ? 18000n
            : 9000n;
      assert.equal(done.totalPayout, expected);
      assert.equal(
        (await getBalanceByUser("player")).balance,
        before - 1000n + expected,
      );
      const bank = await engineStateFor(code, null);
      assert.equal(bank.bankPaise, 1000n - expected);
      await settleBank({
        gameCode: code,
        partnerId: null,
        roundId: done.id,
        totalStakePaise: 1000n,
        totalPayoutPaise: expected,
      });
      assert.equal(
        (await engineStateFor(code, null)).bankPaise,
        bank.bankPaise,
      );
      assert.equal(await finishTableRound(revealed), null);
      const pending = await pendingWinFor("player", code);
      assert.equal(pending?.amountPaise, String(expected));
      await takePendingWin({
        userId: "player",
        gameCode: code,
        takeKey: "take",
      });
      await takePendingWin({
        userId: "player",
        gameCode: code,
        takeKey: "take",
      });
      assert.equal(
        (await getBalanceByUser("player")).balance,
        before - 1000n + expected,
      );
      assert.equal(
        (
          await db
            .select()
            .from(roundDecisionTable)
            .where(eq(roundDecisionTable.roundId, round.id))
        ).length,
        1,
      );
    }
    await writeBankBudget({
      partnerId: null,
      mode: "same_each",
      budgetPaise: "50000",
      updatedBy: "admin",
    });
    assert.equal((await engineStateFor("roulette",null)).bankPaise - (await engineStateFor("roulette",null)).minBankFloorPaise, 50000n, "Shared budgets must include reconnected games");
    assert.equal((await engineStateFor("speed-auto-roulette",null)).minBankFloorPaise, 0n, "Withdrawn games stay outside shared controls");
    assert.deepEqual((await bankBudgetView(null)).games.map(g=>g.gameCode).sort(), [...RESULT_ENGINE_GAMES].sort());
    const before = await engineStateFor("fun-target", null);
    await settleBank({
      gameCode: "fun-target",
      partnerId: null,
      roundId: "budget-test",
      totalStakePaise: 1000n,
      totalPayoutPaise: 2000n,
    });
    const after = await engineStateFor("fun-target", null);
    assert.equal(after.minBankFloorPaise, before.minBankFloorPaise);
    assert.equal(after.bankPaise - after.minBankFloorPaise, 49000n);
    await writeBankBudget({
      partnerId: null,
      mode: "combined",
      budgetPaise: "100000",
      updatedBy: "admin",
    });
    assert.equal((await bankBudgetView(null)).budgetPaise, "100000");
    // Model a hand funded BEFORE the rollback, then retire the game. Existing
    // actions must still settle; no new deal may debit another stake.
    (RETIRED_GAME_CODES as Set<string>).delete("rummy-royale");
    await db.update(gameConfigTable).set({enabled:true}).where(eq(gameConfigTable.gameCode,"rummy-royale"));
    invalidateConfigCache("rummy-royale");
    let rummy;
    try { rummy = await createRound({ userId: "player", stakeAmount: 1000n }); }
    finally {
      (RETIRED_GAME_CODES as Set<string>).add("rummy-royale");
      await db.update(gameConfigTable).set({enabled:false}).where(eq(gameConfigTable.gameCode,"rummy-royale"));
      invalidateConfigCache("rummy-royale");
    }
    await assert.rejects(createRound({userId:"player",stakeAmount:1000n}), /GAME_DISABLED/);
    assert.ok(rummy.round);
    const active = await getRound({
      userId: "player",
      roundId: rummy.round.id,
    });
    assert.ok(active);
    const dropped = await act({
      roundId: rummy.round.id,
      userId: "player",
      action: { type: "drop" },
    });
    assert.notEqual(dropped.round.status, "active");
    const rummyBank = await engineStateFor("rummy-royale", null);
    await getRound({ userId: "player", roundId: rummy.round.id });
    assert.equal(
      (await engineStateFor("rummy-royale", null)).bankPaise,
      rummyBank.bankPaise,
    );
    assert.equal(
      (await request("/api/admin/game-control/rummy-royale/choices")).status,
      400,
    );
    assert.equal(
      (await request("/api/admin/game-control/fun-target/history")).status,
      200,
    );
    assert.equal((await request("/api/admin/game-control/export")).status, 200);
    if (process.env.HANDOFF_BROWSER) {
      for (const code of [
        "roulette-american",
        "roulette-mini",
        "fun-target",
      ] as const) {
        await db
          .update(gameConfigTable)
          .set({
            maxMultiplier:
              code === "roulette-american"
                ? 36
                : code === "roulette-mini"
                  ? 18
                  : 10,
            bettingWindowMs: 600_000,
          })
          .where(eq(gameConfigTable.gameCode, code));
        invalidateConfigCache(code);
        await createTableRound(code);
      }
      await browserChecks(base);
    }
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
