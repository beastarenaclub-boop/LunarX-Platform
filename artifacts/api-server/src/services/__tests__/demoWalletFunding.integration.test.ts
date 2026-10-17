import { strict as assert } from "node:assert";
import { test, before, after } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { nanoid } from "nanoid";
import {
  db,
  pool,
  usersTable,
  sessionsTable,
  walletsTable,
  walletLedgerTable,
  betsTable,
  minesRoundsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  DEMO_STARTING_BALANCE,
  WALLET_SCOPES,
  ensureDemoScopeFunded,
} from "../wallet";
import { createSession } from "../auth";
import { DEMO_EMAIL_PREFIX, DEMO_EMAIL_DOMAIN } from "../../lib/serialize";

/**
 * HTTP integration tests guarding demo wallet funding across ALL games.
 *
 * Demo/instant accounts have a FULLY separate wallet per game scope
 * (lunar, mines, plinko, dice). A regression where only "lunar" is funded
 * leaves the other scopes empty and silently breaks demo onboarding for
 * Mines/Plinko/Dice (bets fail with INSUFFICIENT_FUNDS). These tests pin:
 *
 *   1. A brand-new demo account (POST /api/auth/demo-login) starts with a
 *      non-zero balance in EVERY scope, and re-reading does not double-credit.
 *   2. A legacy demo account funded only in "lunar" gets the other scopes
 *      backfilled on first balance read (GET /api/wallet/balance?game=mines
 *      and GET /api/wallet/balances), idempotently.
 *   3. POST /api/mines/place succeeds for a funded demo account and debits
 *      the mines-scoped balance by exactly the stake.
 *
 * Tests boot the real Express app on an ephemeral port and exercise the
 * routes over HTTP so the route-level demo backfill gating is covered too.
 */

const SKIP = !process.env.DATABASE_URL;
if (SKIP) {
  test("demo wallet funding integration — skipped (no DATABASE_URL)", () => {});
}

// Bypass the demo-login rate limiters / daily cap for the one demo-login we
// perform. The rate-limit middleware reads this env var at module load, so it
// MUST be set before the app (and therefore the middleware) is imported — hence
// the dynamic import of the app inside `before`.
const TEST_BYPASS = `demo_wallet_test_${nanoid(8)}`;
process.env.TEST_RATE_LIMIT_BYPASS = TEST_BYPASS;

let server: Server;
let baseUrl = "";
const createdUserIds: string[] = [];

function sidFromSetCookie(setCookie: string | null): string | null {
  if (!setCookie) return null;
  return /sid=([^;]+)/.exec(setCookie)?.[1] ?? null;
}

async function makeDemoUser(): Promise<string> {
  const id = nanoid();
  const email = `${DEMO_EMAIL_PREFIX}${nanoid(10).toLowerCase()}${DEMO_EMAIL_DOMAIN}`;
  await db.insert(usersTable).values({
    id,
    email,
    emailNormalized: email.toLowerCase(),
    passwordHash: "x",
    role: "player",
    status: "active",
    displayName: "Demo Player",
  });
  createdUserIds.push(id);
  return id;
}

async function loginCookieFor(userId: string): Promise<string> {
  const session = await createSession(userId, "127.0.0.1", "demo-wallet-test");
  return `sid=${session.id}`;
}

async function cleanupUser(userId: string) {
  await db
    .delete(minesRoundsTable)
    .where(eq(minesRoundsTable.userId, userId));
  await db.delete(betsTable).where(eq(betsTable.userId, userId));
  await db
    .delete(walletLedgerTable)
    .where(eq(walletLedgerTable.userId, userId));
  await db.delete(walletsTable).where(eq(walletsTable.userId, userId));
  await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
}

before(async () => {
  if (SKIP) return;
  const app = (await import("../../app")).default;
  server = createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  if (SKIP) return;
  for (const uid of createdUserIds) {
    try {
      await cleanupUser(uid);
    } catch {
      /* best-effort */
    }
  }
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await pool.end();
});

/* ──────────────────────────────────────────────────────────────────
 * 1. Brand-new demo account is funded in EVERY scope; idempotent.
 * ────────────────────────────────────────────────────────────────── */

test("demo-login: new account starts funded in all game scopes", async (t) => {
  if (SKIP) return t.skip();
  const res = await fetch(`${baseUrl}/api/auth/demo-login`, {
    method: "POST",
    headers: { "x-test-bypass": TEST_BYPASS },
  });
  assert.equal(res.status, 200, `demo-login should succeed: ${res.status}`);
  const cookie = sidFromSetCookie(res.headers.get("set-cookie"));
  assert.ok(cookie, "demo-login must set a session cookie");
  const body = (await res.json()) as { user: { id: string } };
  createdUserIds.push(body.user.id);

  const balancesRes = await fetch(`${baseUrl}/api/wallet/balances`, {
    headers: { cookie: `sid=${cookie}` },
  });
  assert.equal(balancesRes.status, 200);
  const { balances } = (await balancesRes.json()) as {
    balances: Record<string, string>;
  };

  // Every scope must be funded with the demo starting balance — not just lunar.
  for (const scope of WALLET_SCOPES) {
    assert.equal(
      balances[scope],
      DEMO_STARTING_BALANCE.toString(),
      `scope ${scope} should start at the demo balance`,
    );
    assert.ok(BigInt(balances[scope]!) > 0n, `scope ${scope} must be non-zero`);
  }

  // Idempotent: re-reading balances must NOT double-credit any scope.
  const reread = await fetch(`${baseUrl}/api/wallet/balances`, {
    headers: { cookie: `sid=${cookie}` },
  });
  const { balances: balances2 } = (await reread.json()) as {
    balances: Record<string, string>;
  };
  for (const scope of WALLET_SCOPES) {
    assert.equal(
      balances2[scope],
      DEMO_STARTING_BALANCE.toString(),
      `scope ${scope} must be unchanged on re-read (no double credit)`,
    );
  }
});

/* ──────────────────────────────────────────────────────────────────
 * 2. Legacy demo account (only lunar funded) is backfilled on read.
 * ────────────────────────────────────────────────────────────────── */

test("legacy demo: non-lunar scopes are backfilled on first balance read", async (t) => {
  if (SKIP) return t.skip();
  const userId = await makeDemoUser();
  // Simulate a pre-per-game-funding account: only the lunar wallet is funded.
  await ensureDemoScopeFunded(userId, "lunar");
  const cookie = await loginCookieFor(userId);

  // Single-scope read of an empty scope must backfill just that scope.
  const minesRes = await fetch(
    `${baseUrl}/api/wallet/balance?game=mines`,
    { headers: { cookie } },
  );
  assert.equal(minesRes.status, 200);
  const minesBody = (await minesRes.json()) as {
    scope: string;
    balance: string;
  };
  assert.equal(minesBody.scope, "mines");
  assert.equal(minesBody.balance, DEMO_STARTING_BALANCE.toString());

  // Reading all balances backfills any remaining scopes (plinko, dice).
  const allRes = await fetch(`${baseUrl}/api/wallet/balances`, {
    headers: { cookie },
  });
  const { balances } = (await allRes.json()) as {
    balances: Record<string, string>;
  };
  for (const scope of WALLET_SCOPES) {
    assert.equal(
      balances[scope],
      DEMO_STARTING_BALANCE.toString(),
      `legacy scope ${scope} should be funded after backfill`,
    );
  }

  // Idempotent: a second full read must not double-credit any scope.
  const allRes2 = await fetch(`${baseUrl}/api/wallet/balances`, {
    headers: { cookie },
  });
  const { balances: balances2 } = (await allRes2.json()) as {
    balances: Record<string, string>;
  };
  for (const scope of WALLET_SCOPES) {
    assert.equal(
      balances2[scope],
      DEMO_STARTING_BALANCE.toString(),
      `legacy scope ${scope} must be unchanged on re-read`,
    );
  }
});

/* ──────────────────────────────────────────────────────────────────
 * 3. A funded demo account can actually place a mines bet, and the
 *    mines-scoped balance debits by exactly the stake.
 * ────────────────────────────────────────────────────────────────── */

test("mines/place: funded demo can bet and the mines scope debits by the stake", async (t) => {
  if (SKIP) return t.skip();
  const userId = await makeDemoUser();
  const cookie = await loginCookieFor(userId);

  // Trigger the backfill so all scopes (incl. mines) are funded.
  await fetch(`${baseUrl}/api/wallet/balances`, { headers: { cookie } });

  const stake = 10_000n; // ₹100 in paise
  const placeRes = await fetch(`${baseUrl}/api/mines/place`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ stakeAmount: stake.toString(), mineCount: 3 }),
  });
  assert.equal(
    placeRes.status,
    200,
    `mines/place should succeed for a funded demo: ${placeRes.status} ${await placeRes
      .clone()
      .text()}`,
  );

  // Mines scope debited by exactly the stake.
  const minesRes = await fetch(
    `${baseUrl}/api/wallet/balance?game=mines`,
    { headers: { cookie } },
  );
  const minesBody = (await minesRes.json()) as { balance: string };
  assert.equal(
    minesBody.balance,
    (DEMO_STARTING_BALANCE - stake).toString(),
    "mines balance should drop by the stake",
  );

  // Other scopes are independent and untouched.
  const lunarRes = await fetch(
    `${baseUrl}/api/wallet/balance?game=lunar`,
    { headers: { cookie } },
  );
  const lunarBody = (await lunarRes.json()) as { balance: string };
  assert.equal(
    lunarBody.balance,
    DEMO_STARTING_BALANCE.toString(),
    "lunar balance must be unaffected by a mines bet",
  );
});
