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
  paymentRequestsTable,
  depositSettingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { createSession } from "../auth";
import { COIN_PACK_COUNT, listCoinPacks } from "../coinPacks";

/**
 * HTTP tests for the coin-pack catalog and the deposit routes that consume it.
 *
 * The point of the catalog is that the SERVER prices a purchase. These tests
 * drive the real Express app and pin:
 *
 *   1. GET /api/payments/coin-packs returns ten priced packs for a game.
 *   2. A deposit quoting a valid SKU stores the SKU + coin count and echoes
 *      them back through the serializer.
 *   3. A deposit whose amount does not match the SKU price is rejected — a
 *      client cannot buy 100,000 coins for ₹1.
 *   4. A SKU from another game is rejected (wallets are per-game).
 *   5. Deposits without a SKU (legacy clients, custom amounts) still work and
 *      serialize with null package fields.
 *
 * These share the live dev DB, so deposit settings are snapshotted and
 * restored, and every created row is cleaned up.
 */

const SKIP = !process.env.DATABASE_URL;
if (SKIP) {
  test("coin pack integration — skipped (no DATABASE_URL)", () => {});
}

const TEST_BYPASS = `coin_packs_test_${nanoid(8)}`;
process.env.TEST_RATE_LIMIT_BYPASS = TEST_BYPASS;

let server: Server;
let baseUrl = "";
let cookie = "";
let userId = "";
const createdPaymentIds: string[] = [];
let settingsSnapshot: {
  manualEnabled: boolean;
  minAmountPaise: bigint;
  maxAmountPaise: bigint;
} | null = null;

/** ₹1,000 pack — comfortably inside the default deposit range. */
const PACK = listCoinPacks("mines")[5]!;

type DepositBody = {
  id: string;
  amount: string;
  game: string;
  packageSku: string | null;
  coinQuantity: number | null;
};

async function postDeposit(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/payments/deposits`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-test-bypass": TEST_BYPASS,
      origin: baseUrl,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.ok && json?.id) createdPaymentIds.push(json.id as string);
  return { status: res.status, body: json, text };
}

before(async () => {
  if (SKIP) return;
  const app = (await import("../../app")).default;
  server = createServer(app);
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // Manual deposits must be on and the ₹1,000 pack must be inside the range;
  // the previous configuration is restored in `after`.
  const [current] = await db.select().from(depositSettingsTable).limit(1);
  if (current) {
    settingsSnapshot = {
      manualEnabled: current.manualEnabled,
      minAmountPaise: current.minAmountPaise,
      maxAmountPaise: current.maxAmountPaise,
    };
  }
  await db
    .insert(depositSettingsTable)
    .values({
      id: "singleton",
      manualEnabled: true,
      minAmountPaise: 10_000n,
      maxAmountPaise: 10_000_000n,
    })
    .onConflictDoUpdate({
      target: depositSettingsTable.id,
      set: {
        manualEnabled: true,
        minAmountPaise: 10_000n,
        maxAmountPaise: 10_000_000n,
      },
    });

  userId = nanoid();
  const email = `coinpack_${nanoid(10).toLowerCase()}@test.local`;
  await db.insert(usersTable).values({
    id: userId,
    email,
    emailNormalized: email.toLowerCase(),
    passwordHash: "x",
    role: "player",
    status: "active",
    displayName: "Coin Pack Tester",
  });
  const session = await createSession(userId, "127.0.0.1", "coin-pack-test");
  cookie = `sid=${session.id}`;
});

after(async () => {
  if (SKIP) return;
  try {
    for (const id of createdPaymentIds) {
      await db
        .delete(paymentRequestsTable)
        .where(eq(paymentRequestsTable.id, id));
    }
    if (userId) {
      await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
      await db.delete(usersTable).where(eq(usersTable.id, userId));
    }
    if (settingsSnapshot) {
      await db
        .update(depositSettingsTable)
        .set(settingsSnapshot)
        .where(eq(depositSettingsTable.id, "singleton"));
    }
  } catch {
    /* best-effort */
  }
  if (server) {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
  await pool.end();
});

test("GET /payments/coin-packs returns ten priced packs for the game", async (t) => {
  if (SKIP) return t.skip();
  const res = await fetch(`${baseUrl}/api/payments/coin-packs?game=mines`, {
    headers: { cookie },
  });
  assert.equal(res.status, 200);
  const packs = (await res.json()) as Array<{
    sku: string;
    game: string;
    coins: number;
    amount: string;
    chipValue: number;
  }>;
  assert.equal(packs.length, COIN_PACK_COUNT);
  assert.equal(packs.length, 10);
  for (const pack of packs) {
    assert.equal(pack.game, "mines");
    assert.match(pack.sku, /^COINS-MINES-\d+$/);
    // ₹1 per coin, priced in paise, as a JSON-safe string.
    assert.equal(pack.amount, String(pack.coins * 100));
    assert.equal(pack.coins, pack.chipValue * 10);
  }
  assert.deepEqual(
    packs.map((p) => p.coins),
    [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000],
  );
});

test("GET /payments/coin-packs rejects an unknown game", async (t) => {
  if (SKIP) return t.skip();
  const res = await fetch(`${baseUrl}/api/payments/coin-packs?game=poker`, {
    headers: { cookie },
  });
  assert.equal(res.status, 400);
});

test("a deposit quoting a valid SKU stores and returns the package", async (t) => {
  if (SKIP) return t.skip();
  const created = await postDeposit({
    amount: PACK.amountPaise.toString(),
    game: PACK.game,
    upiRef: `UTR${nanoid(9)}`,
    packageSku: PACK.sku,
    coinQuantity: PACK.coins,
  });
  assert.equal(created.status, 200, created.text);
  const body = created.body as DepositBody;
  assert.equal(body.packageSku, PACK.sku);
  assert.equal(body.coinQuantity, PACK.coins);
  assert.equal(body.game, PACK.game);
  assert.equal(body.amount, PACK.amountPaise.toString());

  // …and it survives a round-trip through the history serializer.
  const listRes = await fetch(`${baseUrl}/api/payments/deposits`, {
    headers: { cookie },
  });
  const rows = (await listRes.json()) as DepositBody[];
  const found = rows.find((r) => r.id === body.id);
  assert.ok(found, "new deposit should appear in history");
  assert.equal(found!.packageSku, PACK.sku);
  assert.equal(found!.coinQuantity, PACK.coins);
});

test("a deposit whose amount undercuts its SKU is rejected", async (t) => {
  if (SKIP) return t.skip();
  const res = await postDeposit({
    // ₹100 for a ₹1,000 pack — the classic tampered-price attempt.
    amount: "10000",
    game: PACK.game,
    upiRef: `UTR${nanoid(9)}`,
    packageSku: PACK.sku,
    coinQuantity: PACK.coins,
  });
  assert.equal(res.status, 400, res.text);
  assert.match(res.text, /costs/);
});

test("a SKU from another game is rejected", async (t) => {
  if (SKIP) return t.skip();
  const lunarPack = listCoinPacks("lunar")[5]!;
  const res = await postDeposit({
    amount: lunarPack.amountPaise.toString(),
    game: "mines",
    upiRef: `UTR${nanoid(9)}`,
    packageSku: lunarPack.sku,
  });
  assert.equal(res.status, 400, res.text);
  assert.match(res.text, /belongs to lunar/);
});

test("an unknown SKU is rejected", async (t) => {
  if (SKIP) return t.skip();
  const res = await postDeposit({
    amount: PACK.amountPaise.toString(),
    game: PACK.game,
    upiRef: `UTR${nanoid(9)}`,
    packageSku: "COINS-MINES-13",
  });
  assert.equal(res.status, 400, res.text);
  assert.match(res.text, /Unknown coin pack/);
});

test("a legacy deposit without a SKU still works", async (t) => {
  if (SKIP) return t.skip();
  const res = await postDeposit({
    amount: "123400",
    game: "mines",
    upiRef: `UTR${nanoid(9)}`,
  });
  assert.equal(res.status, 200, res.text);
  const body = res.body as DepositBody;
  assert.equal(body.packageSku, null);
  assert.equal(body.coinQuantity, null);
  assert.equal(body.amount, "123400");
});
