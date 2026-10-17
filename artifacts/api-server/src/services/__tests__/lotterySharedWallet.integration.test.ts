import { strict as assert } from "node:assert";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { lotteryPurchaseSchema, lotteryResults, lotteryPayout, LOTTERY_DEFAULTS } from "../lotteryMath";

test("lottery validates fixed-price selections and reproduces all published results", () => {
  const seed = "fixed lottery test seed", result = lotteryResults(seed);
  assert.deepEqual(result, lotteryResults(seed));
  assert.equal(Object.keys(result).length, 10);
  for (const row of Object.values(result)) {
    assert.match(row["2D"], /^\d{2}$/); assert.match(row["3D"], /^\d{3}$/); assert.match(row.Titli, /^\d$/);
  }
  assert.equal(lotteryPayout([{ series: "JP19", number: result.JP19["3D"], quantity: 2, unitPrice: 10000 }], "3D", LOTTERY_DEFAULTS, result), 1_600_000_000n);
  const body = { drawId: "NICE-123", game: "2D", lines: [{ series: "JP10", number: "07", quantity: 1 }] };
  assert.equal(lotteryPurchaseSchema.safeParse(body).success, true);
  for (const change of [
    { lines: [{ series: "JP10", number: "7", quantity: 1 }] },
    { lines: [{ series: "JP10", number: "07", quantity: 1, unitPrice: 1 }] },
    { lines: [...body.lines, ...body.lines] },
    { lines: [{ series: "JP20", number: "07", quantity: 1 }] },
    { lines: [{ series: "JP10", number: "07", quantity: 0.5 }] },
    { payout: 1000000 },
  ]) assert.equal(lotteryPurchaseSchema.safeParse({ ...body, ...change }).success, false);
});

test("lottery shares one ledger, protects draws, refunds once and recovers prizes without players online", {
  skip: !process.env.LOTTERY_INTEGRATION,
}, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_lottery_test"));
  const { db, pool, usersTable, walletsTable, walletLedgerTable, betsTable, gameConfigTable,
    lotteryDrawsTable: draws, lotteryTicketsTable: tickets } = await import("@workspace/db");
  const { eq, and } = await import("drizzle-orm");
  const { lotteryState, buyLotteryTicket: buy, cancelLotteryTicket: cancel, lotteryAdminState, updateLotterySettings,
    tickLottery, startLotteryEngine } = await import("../lottery");
  const { postEntry, getBalanceByUser, getAllScopeBalances } = await import("../wallet");
  const { createSession } = await import("../auth");
  const { hashPassword } = await import("../../lib/password");
  const { default: app } = await import("../../app");
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const [alice, bob, admin] = ids;
  let stop: (() => void) | undefined;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const passwordHash = await hashPassword("LotteryTest@12345");
    for (const id of ids) await db.insert(usersTable).values({ id, email: `${id}@example.test`, emailNormalized: `${id}@example.test`, passwordHash,
      displayName: "Lottery integration", role: id === admin ? "admin" : "player" });
    assert.equal((await lotteryState(alice)).account.balance, 0, "no extra funds are created when opening lottery");
    await postEntry({ userId: alice, type: "adjustment", amount: 2_000_000n });
    await postEntry({ userId: bob, type: "adjustment", amount: 15_000n });
    const initial = await lotteryState(alice);
    const draw = initial.draws.filter(d => d.status === "open")[1];
    assert.ok(!("seed" in draw)); assert.equal(draw.results, null);
    const [raw] = await db.select().from(draws).where(eq(draws.id, draw.id));
    const winning = lotteryResults(raw.seed).JP10["2D"];
    const input = { drawId: draw.id, game: "2D", lines: [{ series: "JP10", number: winning, quantity: 1 }] };
    const request = randomUUID();
    const simultaneous = await Promise.all([buy(alice, input, request), buy(alice, input, request)]);
    const ticket = simultaneous[0];
    assert.equal(simultaneous[1].id, ticket.id);
    assert.equal((await getBalanceByUser(alice, "lottery")).balance, 1_990_000n);
    assert.equal((await db.select().from(walletsTable).where(eq(walletsTable.userId, alice))).length, 1);
    assert.ok(Object.values(await getAllScopeBalances(alice)).every(amount => amount === "1990000"));
    await assert.rejects(buy(alice, { ...input, game: "3D", lines: [{ series: "JP10", number: "123", quantity: 1 }] }, request), /another ticket/);
    await assert.rejects(buy(alice, { ...input, lines: [{ ...input.lines[0], unitPrice: 1 }] }, randomUUID()));
    const beforeFailed = (await getBalanceByUser(alice)).balance;
    await assert.rejects(buy(alice, { ...input, lines: [{ series: "JP19", number: "07", quantity: 3 }] }, randomUUID()), /limit/);
    assert.equal((await getBalanceByUser(alice)).balance, beforeFailed);
    await assert.rejects(cancel(bob, ticket.id), /not found/);
    assert.equal((await lotteryState(bob)).tickets.length, 0);
    const refundable = await buy(alice, input, randomUUID());
    await Promise.all([cancel(alice, refundable.id), cancel(alice, refundable.id)]);
    assert.equal((await getBalanceByUser(alice)).balance, beforeFailed);
    const contest = await Promise.allSettled([buy(bob, input, randomUUID()), postEntry({ userId: bob, scope: "dice", type: "bet", amount: -10000n })]);
    assert.equal(contest.filter(r => r.status === "fulfilled").length, 1);
    assert.equal((await getBalanceByUser(bob)).balance, 5000n);
    const countBefore = (await db.select().from(tickets).where(eq(tickets.userId, bob))).length;
    await assert.rejects(buy(bob, input, randomUUID()), /balance/);
    assert.equal((await db.select().from(tickets).where(eq(tickets.userId, bob))).length, countBefore, "failed wallet debit rolls back the ticket");
    let config = await lotteryAdminState();
    assert.ok(config.draws.filter(d => d.status === "open").every(d => !("seed" in d) && d.results === null));
    const edit = { version: config.version, interval: 15, maxTicket: 20000, salesEnabled: false };
    await updateLotterySettings(admin, edit);
    await assert.rejects(buy(alice, input, randomUUID()), /paused/);
    await assert.rejects(updateLotterySettings(admin, edit), /another session/);
    await updateLotterySettings(admin, { ...edit, version: edit.version + 1, salesEnabled: true });
    await db.update(gameConfigTable).set({ enabled: false }).where(eq(gameConfigTable.gameCode, "lottery"));
    await assert.rejects(buy(alice, input, randomUUID()), /paused/);
    assert.equal((await lotteryState(alice)).settings.salesEnabled, false);
    await db.update(gameConfigTable).set({ enabled: true }).where(eq(gameConfigTable.gameCode, "lottery"));

    // A competing game's wallet lock crosses the draw cutoff: ticket + debit must roll back.
    const lateDraw = initial.draws.filter(d => d.status === "open")[2];
    let release!: () => void, locked!: () => void;
    const acquired = new Promise<void>(resolve => { locked = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const walletId = (await getBalanceByUser(alice)).walletId;
    const blocker = db.transaction(async tx => { await tx.select().from(walletsTable).where(eq(walletsTable.id, walletId)).for("update"); locked(); await hold; });
    await acquired;
    await db.update(draws).set({ closes: Date.now() + 500 }).where(eq(draws.id, lateDraw.id));
    const late = buy(alice, { ...input, drawId: lateDraw.id }, randomUUID());
    const lateResult = assert.rejects(late, /closed/);
    await new Promise(resolve => setTimeout(resolve, 750)); release(); await blocker; await lateResult;
    assert.equal((await getBalanceByUser(alice)).balance, beforeFailed);
    await db.update(draws).set({ ends: Date.now() - 1, closes: Date.now() - 10001 }).where(eq(draws.id, draw.id));
    stop = startLotteryEngine();
    for (let n = 0; n < 60 && (await getBalanceByUser(alice)).balance !== beforeFailed + 800000n; n++) await new Promise(resolve => setTimeout(resolve, 100));
    stop(); stop = undefined;
    await Promise.all([tickLottery(), tickLottery()]);
    assert.equal((await getBalanceByUser(alice)).balance, beforeFailed + 800000n);
    const replay = await buy(alice, input, request);
    assert.equal(replay.id, ticket.id); assert.equal(replay.status, "claimed"); assert.equal(replay.payout, 8000);
    await assert.rejects(cancel(alice, ticket.id), /open-draw/);
    const [bet] = await db.select().from(betsTable).where(eq(betsTable.id, ticket.id));
    assert.equal(bet.status, "won"); assert.equal(bet.payoutAmount, 800000n);
    const entries = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.userId, alice));
    assert.equal(entries.filter(e => e.refType === "lottery_payout").length, 1);
    assert.equal(entries.filter(e => e.refType === "lottery_refund").length, 1);
    assert.ok(entries.every(e => e.walletId === walletId));

    const playerSession = await createSession(alice, null, null), adminSession = await createSession(admin, null, null);
    const http = (path: string, session?: string, init: RequestInit = {}) => fetch(origin + path, { ...init, headers: {
      "Content-Type": "application/json", Origin: origin, ...(session ? { Cookie: `sid=${session}` } : {}), ...init.headers } });
    assert.equal((await http("/api/lottery/bootstrap")).status, 401);
    assert.equal((await http("/api/lottery/admin", playerSession.id, { headers: { "X-Lottery-Role": "admin" } })).status, 403);
    assert.equal((await http("/api/lottery/admin", adminSession.id)).status, 200);
    config = await lotteryAdminState();
    const settingsBody = JSON.stringify({ version: config.version, interval: 15, maxTicket: 20000, salesEnabled: true });
    assert.equal((await http("/api/lottery/admin/settings", adminSession.id, { method: "PUT", body: settingsBody })).status, 403);
    assert.equal((await http("/api/lottery/admin/settings", adminSession.id, { method: "PUT", body: settingsBody,
      headers: { "X-Confirm-Password": "LotteryTest@12345" } })).status, 200);
    const generic = await http(`/api/bets/${ticket.id}/cashout`, playerSession.id, { method: "POST", body: JSON.stringify({ multiplier: 1000 }) });
    assert.ok(generic.status >= 400, "generic cashout cannot mint lottery prizes");
    const visible = await (await http("/api/lottery/bootstrap", playerSession.id)).json() as Awaited<ReturnType<typeof lotteryState>>;
    assert.equal(visible.account.id, alice); assert.equal(visible.mode, "wallet");
    assert.equal(visible.tickets.find((t: { id: string }) => t.id === ticket.id)?.payout, 8000);
  } finally {
    stop?.();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await pool.end();
  }
});
