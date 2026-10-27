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
  ludoMessages,
  walletLedgerTable,
  betsTable,
  gameConfigTable,
  networkNodesTable,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import {
  joinLudo,
  actLudo,
  ludoTable,
  tickLudo,
  ludoProof,
  previewLudoRoom,
} from "../ludo";
import { postEntry, getBalanceByUser } from "../wallet";
import { ludoChat, sendLudoChat } from "../ludoChat";
import { LUDO } from "@workspace/api-zod/ludo";
import type { LudoState, LudoTable } from "@workspace/api-zod/ludo";
import express from "express";
import router from "../../routes/ludo";
import { errorHandler } from "../../middlewares/error";
import { bus } from "../../realtime/eventBus";
import { claimLudoDailyReward, ludoDailyReward } from "../ludoRewards";
import { ludoSocial, requestLudoFriend, updateLudoFriend, ludoDirectChat, sendLudoDirectMessage } from "../ludoSocial";
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

test("private rooms preview terms without charging, isolate channels and public queues, reject changed terms and start only when full", async () => {
  const a = await user(),
    b = await user(),
    outsider = await user(100000n, "b2b"),
    publicUser = await user();
  const create = {
    ...input(),
    mode: "private" as const,
    variant: "quick" as const,
  };
  const created = await joinLudo(a, create),
    code = created.match!.state.roomCode!;
  assert.match(code, /^\d{8}$/);
  assert.equal((await joinLudo(a, create)).match!.id, created.match!.id);
  assert.equal(await balance(a), 99000n);
  assert.equal((await previewLudoRoom(b, code)).variant, "quick");
  assert.equal(await balance(b), 100000n);
  await assert.rejects(previewLudoRoom(outsider, code));
  assert.notEqual(
    (await joinLudo(publicUser, { ...input(), variant: "quick" })).match!.id,
    created.match!.id,
  );
  for (const change of [
    { entryPaise: 5000 },
    { variant: "classic" as const },
    { capacity: 4 as const },
  ]) {
    await assert.rejects(
      joinLudo(b, {
        ...input(),
        mode: "private",
        variant: "quick",
        roomCode: code,
        ...change,
      }),
    );
    assert.equal(await balance(b), 100000n);
  }
  const join = {
    ...input(),
    mode: "private" as const,
    variant: "quick" as const,
    roomCode: code,
  };
  const joined = await joinLudo(b, join);
  assert.equal(joined.match!.status, "playing");
  assert.ok(
    joined.match!.state.players.every(
      (p) => p?.kind === "human" && p.tokens[0] === 0,
    ),
  );
  assert.equal((await joinLudo(b, join)).match!.id, created.match!.id);
  assert.equal(await balance(b), 99000n);
  await assert.rejects(previewLudoRoom(b, code));
  const tooLate = await user();
  await assert.rejects(joinLudo(tooLate, { ...join, requestId: randomUUID() }));
  assert.equal(await balance(tooLate), 100000n);
});

test("private guest cancellation refunds only guest; host cancellation and expiry refund everyone exactly once without bots", async () => {
  for (const expires of [false, true]) {
    const a = await user(),
      b = await user();
    const created = await joinLudo(a, { ...input(4), mode: "private" });
    const id = created.match!.id,
      code = created.match!.state.roomCode!;
    let guest = await joinLudo(b, {
      ...input(4),
      mode: "private",
      roomCode: code,
    });
    await actLudo(b, id, action(guest, "leave"));
    assert.equal((await ludoTable(b)).match!.status, "cancelled");
    assert.equal((await ludoTable(a)).match!.status, "waiting");
    assert.equal(await balance(b), 100000n);
    assert.equal(await balance(a), 99000n);
    guest = await joinLudo(b, { ...input(4), mode: "private", roomCode: code });
    if (expires) {
      await db
        .update(ludoMatches)
        .set({ deadline: new Date(0) })
        .where(eq(ludoMatches.id, id));
      await tickLudo();
      await tickLudo();
    } else {
      const request = action(await ludoTable(a), "leave");
      await actLudo(a, id, request);
      await actLudo(a, id, request);
    }
    assert.equal((await ludoTable(a)).match!.status, "cancelled");
    assert.equal(await balance(a), 100000n);
    assert.equal(await balance(b), 100000n);
    assert.ok(
      (await ludoTable(a)).match!.state.players.every(
        (p) => !p || p.kind === "human",
      ),
    );
    await assert.rejects(previewLudoRoom(b, code));
  }
});

test("variants never mix queues, Team Up requires four seats and a retry cannot switch variant", async () => {
  const a = await user(),
    b = await user(),
    c = await user();
  const classic = await joinLudo(a, input());
  const request = { ...input(), variant: "quick" as const };
  const quick = await joinLudo(b, request);
  assert.notEqual(classic.match!.id, quick.match!.id);
  await assert.rejects(joinLudo(b, { ...request, variant: "classic" }));
  await assert.rejects(joinLudo(c, { ...input(), variant: "team" }));
  assert.equal(await balance(c), 100000n);
});

test("Team Up pays both partners once and team forfeit pays opponents without refunding entries", async () => {
  for (const forfeits of [false, true]) {
    const ids = await Promise.all([user(), user(), user(), user()]);
    for (const id of ids) await joinLudo(id, { ...input(4), variant: "team" });
    let table = await ludoTable(ids[0]),
      id = table.match!.id;
    if (!forfeits) {
      const s = table.match!.state;
      s.players[0]!.tokens = [56, 56, 56, 55];
      s.players[2]!.tokens = [56, 56, 56, 56];
      s.phase = "move";
      s.dice = 1;
      await db
        .update(ludoMatches)
        .set({ state: s, deadline: new Date(Date.now() + 30000) })
        .where(eq(ludoMatches.id, id));
      table = await ludoTable(ids[0]);
    }
    const command = action(
      table,
      forfeits ? "leave" : "move",
      forfeits ? undefined : 3,
    );
    const ended = await actLudo(ids[0], id, command);
    await actLudo(ids[0], id, command);
    await tickLudo();
    assert.deepEqual(ended.match!.state.winners, forfeits ? [1, 3] : [0, 2]);
    for (let seat = 0; seat < 4; seat++)
      assert.equal(
        await balance(ids[seat]),
        ended.match!.state.winners!.includes(seat) ? 100800n : 99000n,
      );
  }
});

test("48 players in 24 rooms receive private committed snapshots and cannot move each other's tokens", async (t) => {
  const rooms: { a: string; b: string; table: LudoTable }[] = [];
  for (let i = 0; i < 24; i++) {
    const a = await user(),
      b = await user();
    await joinLudo(a, input());
    const table = await joinLudo(b, input());
    rooms.push({ a, b, table });
  }
  const loadStarted = performance.now();
  const results = await Promise.all(
    rooms.map(async ({ a, b, table }) => {
      const own = await ludoTable(a);
      const request = action(own, "roll");
      const events: any[] = [];
      const stop = bus.subscribe(`ludo:${a}`, (event) => events.push(event));
      try {
        const [first, repeat] = await Promise.all([
          actLudo(a, table.match!.id, request),
          actLudo(a, table.match!.id, request),
        ]);
        assert.equal(first.match!.state.rollNonce, 1);
        assert.equal(repeat.match!.state.rollNonce, 1);
        assert.ok(events.length >= 1);
        assert.ok(
          events.every(
            (event) =>
              event.match.id === table.match!.id &&
              event.match.you === 0 &&
              event.match.seed === null,
          ),
        );
        assert.ok(
          events.some((event) => event.requestId === request.requestId),
        );
        assert.ok(
          first.match!.state.players.every((p) =>
            p!.tokens.every((pos) => pos === -1),
          ),
        );
        if (first.match!.state.dice !== 6)
          assert.deepEqual(first.match!.legalTokens, []);
        await assert.rejects(
          actLudo(
            b,
            rooms[(rooms.findIndex((room) => room.a === a) + 1) % rooms.length]
              .table.match!.id,
            action(first, "move", 0),
          ),
        );
        return table.match!.id;
      } finally {
        stop();
      }
    }),
  );
  assert.equal(new Set(results).size, 24);
  t.diagnostic(
    `24 concurrent rooms / 48 players: roll and idempotent replay checks completed in ${Math.round(performance.now() - loadStarted)} ms`,
  );
  await db
    .update(ludoMatches)
    .set({ deadline: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(ludoMatches.status, "playing"));
  await tickLudo();
  for (const { a, b } of rooms) {
    assert.equal(await balance(a), 99000n);
    assert.equal(await balance(b), 99000n);
  }
});
test("rejoining a waiting room sends only the user's current seat in private snapshots", async () => {
  const [a, b, c, d] = await Promise.all([user(), user(), user(), user()]);
  await joinLudo(a, input(4));
  await joinLudo(b, input(4));
  let table = await ludoTable(a);
  const id = table.match!.id;
  await actLudo(a, id, action(table, "leave"));
  await joinLudo(c, input(4));
  table = await joinLudo(a, input(4));
  assert.equal(table.match!.you, 2);
  const events: any[] = [];
  const stop = bus.subscribe(`ludo:${a}`, (event) => events.push(event));
  try {
    await joinLudo(d, input(4));
    assert.equal(events.length, 1);
    assert.equal(events[0].match.you, 2);
    assert.equal(events[0].match.state.players[2].kind, "human");
  } finally {
    stop();
  }
});
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

test("Computer mode starts private 2/4-seat games immediately and retries cannot debit twice or change mode", async () => {
  for (const capacity of [2, 4] as const) {
    const waitingUser = await user(),
      owner = await user(),
      other = await user();
    const waiting = await joinLudo(waitingUser, input(capacity));
    const request = { ...input(capacity), mode: "computer" as const };
    const first = await joinLudo(owner, request);
    assert.equal(first.match!.status, "playing");
    assert.equal(first.match!.you, 0);
    assert.equal(
      first.match!.state.players.filter((p) => p?.kind === "computer").length,
      capacity - 1,
    );
    assert.notEqual(first.match!.id, waiting.match!.id);
    assert.equal((await ludoTable(waitingUser)).match!.status, "waiting");
    const separate = await joinLudo(other, {
      ...input(capacity),
      mode: "computer",
    });
    assert.notEqual(first.match!.id, separate.match!.id);
    assert.equal((await joinLudo(owner, request)).match!.id, first.match!.id);
    assert.equal(await balance(owner), 99000n);
    await assert.rejects(
      joinLudo(owner, { ...request, mode: "online" }),
      /different match/,
    );
    assert.equal(first.match!.prizePaise, String(capacity * 900));
    assert.equal(first.match!.commissionPaise, String(capacity * 100));
    await actLudo(owner, first.match!.id, action(first, "leave"));
    assert.equal((await ludoTable(owner)).match!.status, "finished");
    assert.equal(await balance(owner), 99000n);
  }
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
test("ten-minute cutoff splits equal home scores once, regardless of progress or future turn deadline", async () => {
  const a = await user(),
    b = await user();
  const t = await joinLudo(a, input(4));
  await joinLudo(b, input(4));
  await expire(t.match!.id);
  const s = (await ludoTable(a)).match!.state;
  s.players[0]!.tokens = [56, 50, 40, 30];
  s.players[1]!.tokens = [56, -1, -1, -1];
  await db
    .update(ludoMatches)
    .set({
      deadline: sql`clock_timestamp() + interval '25 seconds'`,
      startedAt: new Date(0),
      state: s,
    })
    .where(eq(ludoMatches.id, t.match!.id));
  await Promise.all([tickLudo(), tickLudo()]);
  assert.equal(await balance(a), 100800n);
  assert.equal(await balance(b), 100800n);
  const ended = (await ludoTable(a)).match!;
  assert.equal(ended.status, "finished");
  assert.deepEqual(ended.state.winners, [0, 1]);
  assert.equal(ended.payoutPaise, "1800");
  await tickLudo();
  assert.equal(await balance(a), 100800n);
});

test("ten seconds per action, fixed ten-minute match clock, and a late action settles the best home count", async () => {
  const a = await user(),
    b = await user();
  await joinLudo(a, input());
  await joinLudo(b, input());
  const t = await ludoTable(a),
    m = t.match!;
  assert.equal(m.endsAt! - m.startedAt!, 600000);
  assert.ok(
    m.deadline - t.serverNow <= 10000 && m.deadline - t.serverNow > 8000,
  );
  const s = m.state;
  s.players[0]!.tokens = [56, 56, -1, -1];
  s.players[1]!.tokens = [56, 55, 55, 55];
  await db
    .update(ludoMatches)
    .set({
      state: s,
      startedAt: new Date(Date.now() - LUDO.maxMatchMs - 10),
      deadline: new Date(Date.now() + 10000),
    })
    .where(eq(ludoMatches.id, m.id));
  const finished = await actLudo(b, m.id, action(t, "roll"));
  assert.equal(finished.match!.status, "finished");
  assert.deepEqual(finished.match!.state.winners, [0]);
  assert.equal(finished.match!.state.rollNonce, 0);
  assert.equal(await balance(a), 100800n);
  assert.equal(await balance(b), 99000n);
});

test("five missed rolls are allowed, manual dice resets the count, moves do not reset it and sixth miss forfeits once", async () => {
  const a = await user(),
    b = await user();
  await joinLudo(a, input());
  await joinLudo(b, input());
  let t = await ludoTable(a),
    s = t.match!.state;
  const id = t.match!.id;
  for (let count = 1; count <= 5; count++) {
    s = (await ludoTable(a)).match!.state;
    s.turn = 0;
    s.phase = "roll";
    s.dice = null;
    await db
      .update(ludoMatches)
      .set({ state: s })
      .where(eq(ludoMatches.id, id));
    await expire(id);
    const p = (await ludoTable(a)).match!.state.players[0]!;
    assert.equal(p.missedRolls, count);
    assert.equal(p.forfeited, false);
  }
  s = (await ludoTable(a)).match!.state;
  s.turn = 0;
  s.phase = "move";
  s.dice = 1;
  s.players[0]!.tokens = [0, -1, -1, -1];
  await db
    .update(ludoMatches)
    .set({ state: s, deadline: new Date(Date.now() + 10000) })
    .where(eq(ludoMatches.id, id));
  t = await ludoTable(a);
  await actLudo(a, id, action(t, "move", 0));
  assert.equal((await ludoTable(a)).match!.state.players[0]!.missedRolls, 5);
  s = (await ludoTable(a)).match!.state;
  s.turn = 0;
  s.phase = "roll";
  s.dice = null;
  await db
    .update(ludoMatches)
    .set({ state: s, deadline: new Date(Date.now() + 10000) })
    .where(eq(ludoMatches.id, id));
  t = await ludoTable(a);
  await actLudo(a, id, action(t, "roll"));
  assert.equal((await ludoTable(a)).match!.state.players[0]!.missedRolls, 0);
  s = (await ludoTable(a)).match!.state;
  s.turn = 0;
  s.phase = "roll";
  s.dice = null;
  s.players[0]!.missedRolls = 5;
  await db.update(ludoMatches).set({ state: s }).where(eq(ludoMatches.id, id));
  await Promise.all([expire(id), expire(id)]);
  const ended = (await ludoTable(a)).match!;
  assert.equal(ended.state.players[0]!.exitReason, "inactive");
  assert.equal(ended.status, "finished");
  assert.equal(ended.state.winner, 1);
  assert.equal(await balance(a), 99000n);
  assert.equal(await balance(b), 100800n);
});

test("chat is private, free text stays free, and concurrent emoji retries charge exactly ₹5 without changing the turn", async () => {
  const a = await user(),
    b = await user(),
    outsider = await user();
  await joinLudo(a, input());
  await joinLudo(b, input());
  const t = await ludoTable(a),
    id = t.match!.id;
  await assert.rejects(ludoChat(outsider, id), /Only players/);
  await assert.rejects(
    sendLudoChat(outsider, id, {
      requestId: randomUUID(),
      kind: "text",
      text: "Intruder",
    }),
    /Only players/,
  );
  await sendLudoChat(a, id, {
    requestId: randomUUID(),
    kind: "text",
    text: "Good game <script>alert(1)</script>",
  });
  assert.equal(await balance(a), 99000n);
  const cmd = {
    requestId: randomUUID(),
    kind: "emoji" as const,
    emojiId: "fire",
  };
  const replies = await Promise.all([
    sendLudoChat(b, id, cmd),
    sendLudoChat(b, id, cmd),
  ]);
  assert.equal(await balance(b), 98500n);
  assert.equal(
    replies[0].messages.filter((m) => m.emojiId === "fire").length,
    1,
  );
  const after = (await ludoTable(a)).match!;
  assert.equal(after.version, t.match!.version);
  assert.equal(after.deadline, t.match!.deadline);
  await assert.rejects(
    sendLudoChat(b, id, { ...cmd, emojiId: "crown" }),
    /different message/,
  );
  await assert.rejects(
    sendLudoChat(a, id, { requestId: randomUUID(), kind: "text", text: "😎" }),
    /tray/,
  );
  const ledger = await db
    .select()
    .from(walletLedgerTable)
    .where(
      and(
        eq(walletLedgerTable.userId, b),
        eq(walletLedgerTable.refType, "ludo_emoji"),
      ),
    );
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0].amount, -500n);
  const left = await actLudo(a, id, action(await ludoTable(a), "leave"));
  assert.equal(left.match!.status, "finished");
  assert.equal((await ludoChat(a, id)).canSend, false);
  await assert.rejects(
    sendLudoChat(a, id, {
      requestId: randomUUID(),
      kind: "text",
      text: "After leaving",
    }),
    /closed/,
  );
  await sendLudoChat(b, id, cmd); // A completed match still confirms the original paid request.
  assert.equal((await ludoChat(b, id)).messages.length, 2);
});

test("insufficient emoji balance rolls back the message and debit", async () => {
  const a = await user(1000n),
    b = await user();
  await joinLudo(a, input());
  const t = await joinLudo(b, input());
  await assert.rejects(
    sendLudoChat(a, t.match!.id, {
      requestId: randomUUID(),
      kind: "emoji",
      emojiId: "trophy",
    }),
    /INSUFFICIENT_FUNDS/,
  );
  assert.equal(await balance(a), 0n);
  assert.equal((await ludoChat(a, t.match!.id)).messages.length, 0);
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


test("daily reward credits exactly 100 rupees under concurrent clicks and uses an IST day", async () => {
  const id = await user(0n);
  const results = await Promise.all(Array.from({length:8}, () => claimLudoDailyReward(id)));
  assert.equal(results.filter(r=>r.credited).length,1);
  assert.equal((await getBalanceByUser(id)).balance,10000n);
  const status=await ludoDailyReward(id);
  assert.equal(status.claimed,true);assert.equal(status.history.length,1);
  assert.equal(status.amountPaise,"10000");
  assert.equal(new Date(status.resetsAt).toISOString().slice(11,19),"18:30:00");
  assert.equal((await claimLudoDailyReward(id)).credited,false);
  assert.equal((await getBalanceByUser(id)).balance,10000n);
});

test("daily reward rejects inactive and operator accounts without crediting them", async () => {
  const id=await user(0n);
  await db.update(usersTable).set({status:"suspended"}).where(eq(usersTable.id,id));
  await assert.rejects(()=>claimLudoDailyReward(id),/active player/);
  await db.update(usersTable).set({status:"active",role:"agent"}).where(eq(usersTable.id,id));
  await assert.rejects(()=>claimLudoDailyReward(id),/active player/);
  assert.equal((await getBalanceByUser(id)).balance,0n);
});

test("friends require recipient consent; direct chat is private, free and retry-safe", async () => {
  const a=await user(),b=await user(),outsider=await user();
  const ap=await ludoSocial(a),bp=await ludoSocial(b);
  assert.match(ap.friendCode,/^[A-F0-9]{12}$/);
  assert.equal((await ludoSocial(a)).friendCode,ap.friendCode);
  const sent=await requestLudoFriend(a,bp.friendCode),id=sent.friends[0].id;
  await assert.rejects(()=>updateLudoFriend(a,id,"accept"),/recipient/);
  await assert.rejects(()=>ludoDirectChat(a,id),/Accept/);
  await updateLudoFriend(b,id,"accept");
  const message={requestId:randomUUID(),text:"Hello! Ready for a game?"};
  await Promise.all([sendLudoDirectMessage(a,id,message),sendLudoDirectMessage(a,id,message)]);
  const received=await ludoDirectChat(b,id);
  assert.equal(received.messages.length,1);assert.equal(received.messages[0].mine,false);
  assert.equal(received.messages[0].text,message.text);
  await assert.rejects(()=>sendLudoDirectMessage(a,id,{...message,text:"different"}),/different/);
  await assert.rejects(()=>ludoDirectChat(outsider,id),/not found/);
  assert.equal((await getBalanceByUser(a)).balance,100000n);
  await updateLudoFriend(b,id,"block");
  await assert.rejects(()=>sendLudoDirectMessage(a,id,{requestId:randomUUID(),text:"Blocked"}),/Accept/);
  assert.equal((await ludoSocial(a)).friends.length,0);
  assert.equal((await ludoSocial(b)).friends[0].blockedByYou,true);
  await updateLudoFriend(b,id,"unblock");
  await assert.rejects(()=>ludoDirectChat(a,id),/Accept/);
});

test("friend codes respect account channel boundaries and room invites require membership", async () => {
  const a=await user(),b=await user(),otherChannel=await user(100000n,"b2b");
  const bp=await ludoSocial(b),cp=await ludoSocial(otherChannel);
  await assert.rejects(()=>requestLudoFriend(a,cp.friendCode),/not found/);
  const sent=await requestLudoFriend(a,bp.friendCode),id=sent.friends[0].id;
  await updateLudoFriend(b,id,"accept");
  const room=await joinLudo(a,{...input(),mode:"private"});
  const code=room.match!.state.roomCode!;
  await assert.rejects(()=>sendLudoDirectMessage(b,id,{requestId:randomUUID(),roomCode:code}),/Join or create/);
  await sendLudoDirectMessage(a,id,{requestId:randomUUID(),roomCode:code});
  assert.equal((await ludoDirectChat(b,id)).messages[0].roomCode,code);
  await assert.rejects(()=>sendLudoDirectMessage(a,id,{requestId:randomUUID(),roomCode:"00000000"}),/not found/);
  assert.equal((await getBalanceByUser(b)).balance,100000n);
});
