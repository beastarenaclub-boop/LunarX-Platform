import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import cookieParser from "cookie-parser";
import { WebSocket } from "ws";
import {
  db,
  usersTable,
  walletsTable,
  walletLedgerTable,
  betsTable,
  sessionsTable,
  passwordResetsTable,
  auditLogTable,
  wingoRoundsTable,
  wingoBetsTable,
  virtualSportsRoundsTable,
  virtualSportsBetsTable,
} from "@workspace/db";
import { ready, memory } from "../../demo/database";
import { eq, sql } from "drizzle-orm";
import profile from "../profile";
import reports, { reportKinds } from "../reports";
import { loadSession } from "../../middlewares/auth";
import { csrfProtect } from "../../middlewares/csrf";
import { errorHandler } from "../../middlewares/error";
import { hashPassword, verifyPassword } from "../../lib/password";
import { createSession, getActiveSession } from "../../services/auth";
import { attachRealtime } from "../../realtime/gateway";
import { demoRouteAllowed } from "../../demo/policy";

let origin: string,
  sid: string,
  other: string,
  secondUserSid: string,
  oldHash: string;
const app = express();
app.use(express.json(), cookieParser(), loadSession, csrfProtect);
app.use("/api/profile", profile);
app.use("/api/reports", reports);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
const sockets = attachRealtime(server);
async function request(
  path: string,
  body?: unknown,
  session = sid,
  extra: Record<string, string> = {},
) {
  const response = await fetch(origin + "/api/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie: `sid=${session}`,
      origin,
      "content-type": "application/json",
      "x-test-bypass": "account-tests",
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    data: (await response.json()) as any,
    headers: response.headers,
  };
}
async function ok(path: string, body?: unknown) {
  const r = await request(path, body);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  await ready;
  if (!server.listening) await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  oldHash = await hashPassword("Old-password-123!");
  for (const id of ["alice", "bob"]) {
    await db
      .insert(usersTable)
      .values({
        id,
        email: `${id}@example.test`,
        emailNormalized: `${id}@example.test`,
        passwordHash: oldHash,
      });
    await db.insert(walletsTable).values({ id: `wallet-${id}`, userId: id });
    await db
      .insert(walletLedgerTable)
      .values({
        id: `ledger-${id}`,
        userId: id,
        walletId: `wallet-${id}`,
        type: "deposit",
        amount: 12345n,
        balanceAfter: 12345n,
        createdAt: new Date("2026-10-18T18:29:59.000Z"),
      });
    await db
      .insert(auditLogTable)
      .values({
        actorId: id,
        action: "auth.login",
        before: { password: "must-not-leak" },
      });
    await db
      .insert(betsTable)
      .values({
        id: `pending-${id}`,
        userId: id,
        gameCode: "roulette",
        stakeAmount: 10000n,
        status: "placed",
      });
  }
  for (const id of ["won-a", "won-b", "won-c"])
    await db
      .insert(betsTable)
      .values({
        id,
        userId: "alice",
        gameCode: "dice",
        stakeAmount: 10000n,
        payoutAmount: 20000n,
        status: "won",
        placedAt: new Date("2026-10-18T12:00:00Z"),
        metadata: { serverSeed: "must-not-leak" },
      });
  // Sub-millisecond database timestamps must not skip records at page boundaries.
  await db.execute(
    sql`UPDATE bets SET placed_at = '2026-10-18T12:00:00.000987Z' WHERE id LIKE 'won-%'`,
  );
  await db
    .insert(wingoRoundsTable)
    .values({
      period: "test-period",
      duration: 60,
      start: Date.now(),
      ends: Date.now() + 60000,
      number: 7,
      secret: "must-not-leak",
      commitment: "test-commitment",
      settled: false,
    });
  await db
    .insert(wingoBetsTable)
    .values({
      id: "wingo-test",
      userId: "alice",
      period: "test-period",
      pick: "red",
      stake: 10000,
      created: Date.now(),
      request: "wingo-test",
    });
  await db
    .insert(virtualSportsRoundsTable)
    .values({
      id: "virtual-test",
      sport: "cricket" as never,
      starts: Date.now(),
      data: {
        winner: 2,
        fixture: {},
        score: [],
        events: [],
        odds: [],
      } as never,
    });
  await db
    .insert(virtualSportsBetsTable)
    .values({
      id: "sports-test",
      userId: "alice",
      requestId: "sports-test",
      roundId: "virtual-test",
      sport: "cricket" as never,
      choice: 0,
      oddsHundredths: 200,
      amount: 10000,
      created: Date.now(),
    });
  sid = (await createSession("alice", "127.0.0.1", "Current test device")).id;
  other = (await createSession("alice", "127.0.0.2", "Other test device")).id;
  secondUserSid = (await createSession("bob", "127.0.0.3", "Bob device")).id;
  await db
    .insert(passwordResetsTable)
    .values({
      id: "reset-alice",
      userId: "alice",
      expiresAt: new Date(Date.now() + 60000),
    });
});
after(async () => {
  for (const ws of sockets.clients) ws.terminate();
  sockets.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await memory.close();
});

test("all reports require auth, isolate users, and exclude private data", async () => {
  for (const kind of reportKinds) {
    assert.equal((await request(`reports/${kind}`, undefined, "")).status, 401);
    const data = await ok(`reports/${kind}`);
    assert.ok(Array.isArray(data.items));
    assert.doesNotMatch(
      JSON.stringify(data),
      /must-not-leak|pending-bob|ledger-bob|winner|serverSeed/,
    );
    assert.equal(demoRouteAllowed("GET", `/api/reports/${kind}`), true);
    assert.equal(demoRouteAllowed("POST", `/api/reports/${kind}`), false);
  }
  const bets = await ok("reports/currentbets");
  assert.equal(bets.items.length, 3);
  assert.ok(bets.items.every((r: any) => r.status === "placed"));
  const sports = await ok("reports/sportbookresult");
  assert.equal(sports.items.length, 1);
  assert.equal(sports.items[0].stake, "10000");
  const live = await ok("reports/livecasinoresult");
  assert.equal(live.items.length, 1);
  assert.equal(live.items[0].game, "roulette");
});
test("report pagination, IST day boundaries and invalid input", async () => {
  const seen: string[] = [];
  let cursor = "";
  do {
    const page = await ok(
      `reports/casinoresult?limit=1${cursor ? `&cursor=${cursor}` : ""}`,
    );
    seen.push(...page.items.map((r: any) => r.id));
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(new Set(seen).size, 3);
  assert.equal(seen.length, 3);
  const statement = await ok(
    "reports/accountstatement?from=2026-10-18&to=2026-10-18",
  );
  assert.equal(statement.items.length, 1);
  assert.equal(statement.items[0].balance, "12345");
  assert.equal(
    (await ok("reports/accountstatement?from=2026-10-19&to=2026-10-19")).items
      .length,
    0,
  );
  for (const query of [
    "from=2026-99-99",
    "from=2026-02-30",
    "from=2026-10-20&to=2026-10-18",
    "cursor=bad",
    "limit=10000",
  ])
    assert.equal(
      (await request(`reports/currentbets?${query}`)).status,
      400,
      query,
    );
});
test("security hides tokens, verifies password and rejects cross-site mutations", async () => {
  const data = await ok("profile/security");
  assert.equal(data.sessions.length, 2);
  assert.equal(data.sessions.filter((s: any) => s.current).length, 1);
  for (const token of [sid, other, secondUserSid])
    assert.ok(!JSON.stringify(data).includes(token));
  assert.equal(
    (await request("profile/security/verify", { currentPassword: "incorrect" }))
      .status,
    400,
  );
  assert.equal(
    (
      await ok("profile/security/verify", {
        currentPassword: "Old-password-123!",
      })
    ).verified,
    true,
  );
  assert.equal(
    (
      await request(
        "profile/security/revoke-others",
        { currentPassword: "Old-password-123!" },
        sid,
        { origin: "https://attacker.invalid" },
      )
    ).status,
    403,
  );
});
test("revoke others keeps current user session and closes the other socket", async () => {
  const ws = new WebSocket(origin.replace("http", "ws") + "/ws", {
    headers: { cookie: `sid=${other}` },
  });
  await once(ws, "open");
  const closed = once(ws, "close");
  await ok("profile/security/revoke-others", {
    currentPassword: "Old-password-123!",
  });
  assert.equal((await closed)[0], 4001);
  assert.ok(await getActiveSession(sid));
  assert.equal(await getActiveSession(other), null);
  assert.ok(await getActiveSession(secondUserSid));
});
test("password change rejects bad inputs, revokes sessions/resets and old credentials", async () => {
  const body = {
    currentPassword: "Old-password-123!",
    newPassword: "New-password-456!",
    confirmPassword: "New-password-456!",
  };
  for (const invalid of [
    { ...body, currentPassword: "incorrect" },
    { ...body, confirmPassword: "mismatch" },
    { ...body, newPassword: "tiny", confirmPassword: "tiny" },
    { ...body, newPassword: "😀".repeat(30), confirmPassword: "😀".repeat(30) },
  ])
    assert.equal((await request("profile/password", invalid)).status, 400);
  assert.ok(await getActiveSession(sid));
  const result = await request("profile/password", body);
  assert.equal(result.status, 200);
  assert.match(result.headers.get("set-cookie") || "", /sid=;/);
  assert.equal(await getActiveSession(sid), null);
  assert.ok(await getActiveSession(secondUserSid));
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, "alice"));
  assert.equal(
    await verifyPassword(body.newPassword, user!.passwordHash),
    true,
  );
  assert.equal(
    await verifyPassword(body.currentPassword, user!.passwordHash),
    false,
  );
  const [reset] = await db
    .select()
    .from(passwordResetsTable)
    .where(eq(passwordResetsTable.id, "reset-alice"));
  assert.ok(reset!.usedAt);
  await assert.rejects(
    createSession("alice", null, null, undefined, undefined, oldHash),
  );
  assert.equal((await request("profile/security")).status, 401);
  sid = (
    await createSession(
      "alice",
      null,
      null,
      undefined,
      undefined,
      user!.passwordHash,
    )
  ).id;
  const activity = await ok("reports/activity");
  assert.ok(
    activity.items.some((r: any) => r.action === "security.password_changed"),
  );
  assert.doesNotMatch(
    JSON.stringify(activity),
    /New-password|Old-password|password_hash/,
  );
});
