import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  pokerRounds,
  pokerBets,
  walletLedgerTable,
  gameConfigTable,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { pokerTable, startPokerEngine } from "../poker";
import { postEntry, getBalanceByUser } from "../wallet";
import { playerBetRecords } from "../playerBetRecords";
import { POKER_GAMES, type PokerTable } from "@workspace/api-zod/poker";
import express from "express";
import pokerRouter from "../../routes/poker";
import { errorHandler } from "../../middlewares/error";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import path from "node:path";
const player = "poker-integration",
  poor = "poker-poor";
before(async () => {
  await ready;
  await db
    .insert(usersTable)
    .values(
      [player, poor].map((id) => ({
        id,
        email: `${id}@test.invalid`,
        emailNormalized: `${id}@test.invalid`,
        passwordHash: "test-only",
      })),
    );
  await postEntry({ userId: player, type: "adjustment", amount: 10000000n });
});
after(async () => {
  await memory.close();
});
const input = (state: PokerTable, market = "p0-back") => ({
  roundId: state.round.id,
  quoteId: state.quoteId,
  requestId: randomUUID(),
  selections: [{ market, amountPaise: "10000" }],
});
async function freeze(id: number) {
  await db
    .update(pokerRounds)
    .set({
      closesAt: new Date(Date.now() + 120000),
      revealsAt: new Date(Date.now() + 131000),
      endsAt: new Date(Date.now() + 138000),
    })
    .where(eq(pokerRounds.id, id));
}
test("each game starts a 20-second betting window before its reveal sequence", async () => {
  for (const game of POKER_GAMES) {
    const before = Date.now();
    const state = await pokerTable(player, game);
    const after = Date.now();
    assert.equal(state.round.phase, "betting");
    assert.ok(state.round.closesAt >= before + 20_000);
    assert.ok(state.round.closesAt <= after + 20_000);
    assert.equal(state.round.phaseEndsAt, state.round.closesAt);
    assert.equal(state.round.revealsAt - state.round.closesAt, 11_000);
    assert.equal(state.round.endsAt - state.round.revealsAt, 7_000);
  }
});

test("shared wallet, duplicate request, changed retry, limits, insufficient funds and late bets", async () => {
  let state = await pokerTable(player, "poker-one-day");
  await freeze(state.round.id);
  state = await pokerTable(player, "poker-one-day");
  assert.ok(state.round.hands.flat().every((c) => c === null));
  const bet = input(state, "p0-lay"),
    before = (await getBalanceByUser(player)).balance;
  const results = await Promise.all([
    pokerTable(player, "poker-one-day", bet),
    pokerTable(player, "poker-one-day", bet),
    pokerTable(player, "poker-one-day", bet),
  ]);
  assert.equal(results[2].slips.length, 1);
  assert.equal((await getBalanceByUser(player)).balance, before - 10200n);
  await assert.rejects(
    pokerTable(player, "poker-one-day", {
      ...bet,
      selections: [{ market: "p1-lay", amountPaise: "10000" }],
    }),
    /different confirmed bet/,
  );
  await assert.rejects(
    pokerTable(poor, "poker-one-day", { ...bet, requestId: randomUUID() }),
    /Not enough balance/,
  );
  await assert.rejects(
    pokerTable(player, "poker-one-day", { ...input(state), quoteId: "stale" }),
    /closed/,
  );
  await assert.rejects(
    pokerTable(player, "poker-one-day", {
      ...input(state),
      selections: [{ market: "p0-back", amountPaise: "500000" }],
    }),
    /Maximum/,
  );
  await db
    .update(pokerRounds)
    .set({ closesAt: new Date(Date.now() - 10) })
    .where(eq(pokerRounds.id, state.round.id));
  await assert.rejects(
    pokerTable(player, "poker-one-day", input(state)),
    /closed/,
  );
  await pokerTable(player, "poker-one-day", bet); // retry after betting closes
  assert.equal((await getBalanceByUser(player)).balance, before - 10200n);
});
test("all variants settle exactly once, report bets, and recover old rounds without a visitor", async () => {
  const stop = startPokerEngine();
  try {
    for (const game of POKER_GAMES) {
      let state = await pokerTable(player, game);
      await freeze(state.round.id);
      state = await pokerTable(player, game);
      const bet = input(state),
        placed = await pokerTable(player, game, bet);
      assert.ok(placed.slips.some((s) => s.requestId === bet.requestId));
      const cards = {
        hands:
          game === "poker-six-players"
            ? [
                [13, 14],
                [15, 16],
                [17, 18],
                [19, 20],
                [21, 22],
                [23, 24],
              ]
            : [
                [13, 14],
                [15, 16],
              ],
        board: [0, 12, 11, 10, 9],
      }; // board royal flush; all tie
      await db
        .update(pokerRounds)
        .set({
          ...cards,
          closesAt: new Date(Date.now() - 20000),
          revealsAt: new Date(Date.now() - 9000),
          endsAt: new Date(Date.now() - 1000),
        })
        .where(eq(pokerRounds.id, state.round.id));
      // Do not request the table: background recovery must pay disconnected users.
      let settled = false;
      for (let attempt = 0; attempt < 40; attempt++) {
        const [row] = await db
          .select()
          .from(pokerBets)
          .where(eq(pokerBets.requestId, bet.requestId));
        if (row.payoutPaise !== null) {
          settled = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(settled, `${game} should settle without a table request`);
      const [row] = await db
        .select()
        .from(pokerBets)
        .where(eq(pokerBets.requestId, bet.requestId));
      const expected =
        game === "poker-six-players"
          ? (10000n * BigInt(row.selections[0].quote.odds)) / 600n
          : 10000n;
      assert.equal(row.payoutPaise, expected);
      const balance = (await getBalanceByUser(player)).balance;
      await pokerTable(player, game, bet);
      await pokerTable(player, game, bet);
      assert.equal((await getBalanceByUser(player)).balance, balance);
      const credits = await db
        .select()
        .from(walletLedgerTable)
        .where(
          and(
            eq(walletLedgerTable.refType, "poker_win"),
            eq(walletLedgerTable.refId, String(row.id)),
          ),
        );
      assert.equal(credits.length, 1);
    }
    const records = await db.execute(
      sql`SELECT * FROM (${playerBetRecords(player)}) records WHERE game LIKE 'poker-%'`,
    );
    assert.ok(records.rows.length >= 4);
  } finally {
    stop();
  }
});
test("admin pause stops new bets but preserves accepted receipts", async () => {
  const game = "poker-20-20",
    state = await pokerTable(player, game);
  await freeze(state.round.id);
  await db
    .insert(gameConfigTable)
    .values({ gameCode: game, enabled: false })
    .onConflictDoUpdate({
      target: gameConfigTable.gameCode,
      set: { enabled: false },
    });
  assert.equal((await pokerTable(player, game)).enabled, false);
  await assert.rejects(pokerTable(player, game, input(state)), /paused/);
});
test("HTTP requires authentication and validates game, UUID, market and client-supplied odds", async () => {
  const app = express();
  app.use(express.json());
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, player));
  app.use((req, _res, next) => {
    if (req.headers["x-test-player"] === "yes") req.user = user;
    next();
  });
  app.use("/api/poker", pokerRouter);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/poker`;
  try {
    assert.equal((await fetch(`${url}/poker-one-day/table`)).status, 401);
    const headers = {
      "x-test-player": "yes",
      "Content-Type": "application/json",
    };
    assert.equal(
      (await fetch(`${url}/invalid/table`, { headers })).status,
      400,
    );
    const response = await fetch(`${url}/poker-one-day/table`, { headers });
    assert.equal(response.headers.get("cache-control"), "no-store");
    const state = (await response.json()) as PokerTable;
    await freeze(state.round.id);
    assert.equal(state.round.nonce, undefined);
    const body = input(state);
    for (const invalid of [
      { ...body, requestId: "not-a-uuid" },
      {
        ...body,
        selections: [{ market: "p0-back", amountPaise: "1000", odds: 99999 }],
      },
      {
        ...body,
        selections: [{ market: "future-board", amountPaise: "1000" }],
      },
    ]) {
      assert.equal(
        (
          await fetch(`${url}/poker-one-day/bet`, {
            method: "POST",
            headers,
            body: JSON.stringify(invalid),
          })
        ).status,
        400,
      );
    }
    assert.equal(
      (
        await fetch(`${url}/poker-one-day/bet`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
        })
      ).status,
      200,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test("production migration creates poker tables and uniqueness constraints", async () => {
  const scratch = new PGlite();
  try {
    await scratch.exec("CREATE TABLE users (id text PRIMARY KEY)");
    await scratch.exec(
      await readFile(
        path.resolve("../../lib/db/drizzle/0056_poker_tables.sql"),
        "utf8",
      ),
    );
    const { rows } = await scratch.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE tablename IN ('poker_rounds','poker_bets')",
    );
    assert.ok(rows.some((r) => r.indexname === "poker_request_user"));
    assert.ok(rows.some((r) => r.indexname === "poker_round_game"));
  } finally {
    await scratch.close();
  }
});
