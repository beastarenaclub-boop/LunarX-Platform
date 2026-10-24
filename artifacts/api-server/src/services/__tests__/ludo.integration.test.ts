import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  ludoMatches,
  ludoMembers,
  ludoActions,
  walletLedgerTable,
  betsTable,
  gameConfigTable,
  networkNodesTable,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { joinLudo, actLudo, ludoTable, tickLudo, ludoProof } from "../ludo";
import { postEntry, getBalanceByUser } from "../wallet";
import type { LudoState, LudoTable } from "@workspace/api-zod/ludo";
import express from "express";
import router from "../../routes/ludo";
import { errorHandler } from "../../middlewares/error";
import { bus } from "../../realtime/eventBus";
before(async () => {
  await ready;
});
after(async () => {
  await memory.close();
});
afterEach(async () => {
  await db
    .update(ludoMatches)
    .set({ deadline: new Date(0) })
    .where(eq(ludoMatches.status, "waiting"));
  await tickLudo();
  await db
    .update(ludoMatches)
    .set({ deadline: new Date(0), startedAt: new Date(0) })
    .where(eq(ludoMatches.status, "playing"));
  await tickLudo();
  await db.delete(gameConfigTable).where(eq(gameConfigTable.gameCode, "ludo"));
});
async function user(amount = 100000n, channel: "b2c" | "b2b" = "b2c") {
  let b2bAgentId: string | null = null;
  if (channel === "b2b") {
    const owner = await user(0n),
      agent = await user(0n),
      masterId = randomUUID();
    b2bAgentId = randomUUID();
    await db.insert(networkNodesTable).values({
      id: masterId,
      userId: owner,
      kind: "master",
      name: "Test master",
      createdBy: owner,
    });
    await db.insert(networkNodesTable).values({
      id: b2bAgentId,
      userId: agent,
      kind: "agent",
      parentId: masterId,
      name: "Test agent",
      createdBy: owner,
    });
  }
  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    email: `${id}@test.invalid`,
    emailNormalized: `${id}@test.invalid`,
    passwordHash: "test-only",
    displayName: "Test Player",
    channel,
    b2bAgentId,
  });
  if (amount) await postEntry({ userId: id, type: "adjustment", amount });
  return id;
}
const input = (capacity: 2 | 4 = 2, entryPaise = 1000) => ({
  capacity,
  entryPaise,
  requestId: randomUUID(),
});
const action = (
  t: LudoTable,
  type: "roll" | "move" | "leave",
  token?: number,
) => ({ type, token, version: t.match!.version, requestId: randomUUID() });
const balance = async (id: string) => (await getBalanceByUser(id)).balance;
async function expire(id: string) {
  await db
    .update(ludoMatches)
    .set({ deadline: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(ludoMatches.id, id));
  await tickLudo();
}
test("repeated concurrent join debits once, one account cannot fill extra seats", async () => {
  const u = await user(),
    join = input();
  const results = await Promise.all([
    joinLudo(u, join),
    joinLudo(u, join),
    joinLudo(u, input(4, 5000)),
  ]);
  assert.ok(results.every((t) => t.match!.id === results[0].match!.id));
  assert.equal(await balance(u), 99000n);
  const seats = await db
    .select()
    .from(ludoMembers)
    .where(and(eq(ludoMembers.userId, u), isNull(ludoMembers.endedAt)));
  assert.equal(seats.length, 1);
  await assert.rejects(
    joinLudo(u, { ...join, entryPaise: 5000 }),
    /different match/,
  );
});
test("two independent IDs see one board, own seat, human labels and immediate full-room start", async () => {
  const a = await user(),
    b = await user();
  const first = await joinLudo(a, input()),
    second = await joinLudo(b, input());
  const recovered = await ludoTable(a);
  assert.equal(first.match!.id, second.match!.id);
  assert.equal(second.match!.status, "playing");
  assert.equal(recovered.match!.version, second.match!.version);
  assert.equal(recovered.match!.you, 0);
  assert.equal(second.match!.you, 1);
  assert.deepEqual(recovered.match!.state, second.match!.state);
  assert.ok(second.match!.state.players.every((p) => p?.kind === "human"));
  assert.equal(second.match!.prizePaise, "1800");
  assert.equal(second.match!.commissionPaise, "200");
  assert.equal(second.match!.seed, null);
});
test("four real IDs share a four-seat match; modes, fees and channels stay separate", async () => {
  const ids = await Promise.all([user(), user(), user(), user()]);
  const tables = [];
  for (const id of ids) tables.push(await joinLudo(id, input(4)));
  assert.equal(new Set(tables.map((t) => t.match!.id)).size, 1);
  assert.equal(tables[3].match!.status, "playing");
  assert.equal(tables[3].match!.prizePaise, "3600");
  const c = await user(),
    d = await user(),
    e = await user(100000n, "b2b");
  const separate = await Promise.all([
    joinLudo(c, input()),
    joinLudo(d, input(2, 5000)),
    joinLudo(e, input()),
  ]);
  assert.equal(new Set(separate.map((t) => t.match!.id)).size, 3);
});
test("empty seats automatically become labelled computers at the queue deadline", async () => {
  const u = await user();
  const t = await joinLudo(u, input(4));
  await expire(t.match!.id);
  const started = await ludoTable(u);
  assert.equal(started.match!.status, "playing");
  assert.equal(
    started.match!.state.players.filter((p) => p?.kind === "computer").length,
    3,
  );
  assert.equal(await balance(u), 99000n);
  const v = await user();
  const next = await joinLudo(v, input(4));
  assert.notEqual(next.match!.id, started.match!.id);
});
test("queue cancellation refunds exactly once even after retry or joining a new room", async () => {
  const u = await user(),
    t = await joinLudo(u, input()),
    a = action(t, "leave");
  await actLudo(u, t.match!.id, a);
  await actLudo(u, t.match!.id, a);
  assert.equal(await balance(u), 100000n);
  const again = await joinLudo(u, input());
  await actLudo(u, t.match!.id, a);
  assert.equal(await balance(u), 99000n);
  assert.notEqual(again.match!.id, t.match!.id);
});
test("insufficient balance rolls back room/seat/ledger, paused game prevents new joins", async () => {
  const u = await user(0n);
  await assert.rejects(joinLudo(u, input()), /INSUFFICIENT_FUNDS/);
  assert.equal((await ludoTable(u)).match, null);
  const rich = await user();
  await db.insert(gameConfigTable).values({ gameCode: "ludo", enabled: false });
  await assert.rejects(joinLudo(rich, input()), /unavailable/);
  assert.equal(await balance(rich), 100000n);
});
test("ownership, turn, version and replay checks protect dice and wallet", async () => {
  const a = await user(),
    b = await user(),
    stranger = await user();
  await joinLudo(a, input());
  await joinLudo(b, input());
  const t = await ludoTable(a),
    id = t.match!.id,
    cmd = action(t, "roll");
  await assert.rejects(actLudo(stranger, id, cmd), /not your match/);
  await assert.rejects(ludoTable(stranger, id), /not your match/);
  await assert.rejects(ludoProof(a, id), /after/);
  await assert.rejects(actLudo(b, id, cmd), /Wait for/);
  const [r1, r2] = await Promise.all([
    actLudo(a, id, cmd),
    actLudo(a, id, cmd),
  ]);
  assert.equal(r1.match!.version, r2.match!.version);
  assert.equal(r2.match!.state.rollNonce, 1);
  await assert.rejects(
    actLudo(a, id, { ...cmd, requestId: randomUUID() }),
    /board changed/,
  );
  await assert.rejects(
    actLudo(a, id, { ...cmd, type: "move", token: 0 }),
    /another action/,
  );
  assert.equal(await balance(a), 99000n);
});
test("human winning move credits 90% pool once and produces verifiable audit history", async () => {
  const a = await user(),
    b = await user();
  await joinLudo(a, input(2, 5000));
  await joinLudo(b, input(2, 5000));
  let t = await ludoTable(a),
    s = t.match!.state;
  s.players[0]!.tokens = [56, 56, 56, 55];
  s.turn = 0;
  s.phase = "move";
  s.dice = 1;
  await db
    .update(ludoMatches)
    .set({ state: s })
    .where(eq(ludoMatches.id, t.match!.id));
  t = await ludoTable(a);
  const cmd = action(t, "move", 3);
  const won = await actLudo(a, t.match!.id, cmd);
  await actLudo(a, t.match!.id, cmd);
  await tickLudo();
  assert.equal(won.match!.status, "finished");
  assert.equal(await balance(a), 104000n);
  assert.equal(await balance(b), 95000n);
  assert.equal(won.recent[0].payoutPaise, "9000");
  assert.equal(won.recent[0].result, "won");
  assert.ok(won.match!.seed);
  const proof = await ludoProof(a, t.match!.id);
  assert.ok(proof.events.length >= 3);
  const wins = await db
    .select()
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.userId, a),
        eq(walletLedgerTable.refType, "ludo_won"),
      ),
    );
  assert.equal(wins.length, 1);
});
test("human timeouts auto-play; reconnect preserves identity and turn; long outage resets timer", async () => {
  const u = await user(),
    t = await joinLudo(u, input());
  await expire(t.match!.id);
  await expire(t.match!.id);
  let r = (await ludoTable(u)).match!;
  assert.equal(r.state.rollNonce, 1);
  assert.equal(r.you, 0);
  assert.equal(r.state.players[0]!.auto, true);
  const nonce = r.state.rollNonce;
  await db
    .update(ludoMatches)
    .set({ deadline: new Date(Date.now() - 180000) })
    .where(eq(ludoMatches.id, r.id));
  await tickLudo();
  r = (await ludoTable(u)).match!;
  assert.equal(r.state.rollNonce, nonce);
  assert.ok(r.deadline > Date.now());
  assert.match(r.state.last!.text, /timer restarted/);
});
test("forfeit loses entry; a Computer win has no phantom user payout", async () => {
  const u = await user(),
    t = await joinLudo(u, input());
  await expire(t.match!.id);
  const playing = await ludoTable(u);
  const end = await actLudo(u, t.match!.id, action(playing, "leave"));
  assert.equal(end.match!.status, "finished");
  assert.equal(
    end.match!.state.players[end.match!.state.winner!]!.kind,
    "computer",
  );
  assert.equal(await balance(u), 99000n);
  assert.equal(end.recent[0].result, "lost");
});
test("two-hour safety cancellation refunds all unsettled players once", async () => {
  const a = await user(),
    b = await user();
  const t = await joinLudo(a, input(4));
  await joinLudo(b, input(4));
  await expire(t.match!.id);
  await db
    .update(ludoMatches)
    .set({
      deadline: sql`clock_timestamp() + interval '25 seconds'`,
      startedAt: new Date(0),
    })
    .where(eq(ludoMatches.id, t.match!.id));
  await Promise.all([tickLudo(), tickLudo()]);
  assert.equal(await balance(a), 100000n);
  assert.equal(await balance(b), 100000n);
  assert.equal((await ludoTable(a)).match!.status, "cancelled");
});
test("committed state publishes private invalidations to both account IDs", async () => {
  const a = await user(),
    b = await user();
  await joinLudo(a, input());
  let count = 0;
  const offA = bus.subscribe(`ludo:${a}`, () => count++),
    offB = bus.subscribe(`ludo:${b}`, () => count++);
  try {
    await joinLudo(b, input());
    assert.equal(count, 2);
  } finally {
    offA();
    offB();
  }
});
test("HTTP rejects anonymous access and forged dice/payout; valid requests never leak seed", async () => {
  const u = await user(),
    [account] = await db.select().from(usersTable).where(eq(usersTable.id, u));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers["x-test-user"] === u) req.user = account;
    next();
  });
  app.use("/api/ludo", router);
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/ludo`,
    headers = { "x-test-user": u, "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/state`)).status, 401);
    for (const body of [
      { ...input(), dice: 6 },
      { ...input(), capacity: 3 },
      { ...input(), entryPaise: -1 },
      { ...input(), requestId: "x" },
    ])
      assert.equal(
        (
          await fetch(`${base}/join`, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
        400,
      );
    const response = await fetch(`${base}/join`, {
      method: "POST",
      headers,
      body: JSON.stringify(input()),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const t = (await response.json()) as LudoTable;
    assert.equal(t.match!.seed, null);
    assert.equal(
      (
        await fetch(`${base}/${t.match!.id}/action`, {
          method: "POST",
          headers,
          body: JSON.stringify({ ...action(t, "roll"), payout: 900000 }),
        })
      ).status,
      400,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
