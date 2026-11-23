import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test("withdrawal approval serializes retries and retains uncertain payouts for reconciliation", { skip: !process.env.NETWORK_INTEGRATION }, async () => {
  assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"));
  const { db, pool, usersTable, withdrawalsTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  const { postEntry, getBalanceByUser } = await import("../wallet");
  const { createSession } = await import("../auth");
  const { getPaymentProvider, isGatewayEnabled } = await import("../payment-gateway");
  const originalProvider = process.env.PAYMENT_PROVIDER;
  process.env.PAYMENT_PROVIDER = "misspelled-provider";
  assert.equal(isGatewayEnabled(), false);
  process.env.PAYMENT_PROVIDER = "stub";
  const provider = getPaymentProvider(), originalPayout = provider.createPayout;
  const { default: app } = await import("../../app");
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  try {
    const adminId = randomUUID(), userId = randomUUID();
    for (const [id, role] of [[adminId, "super_admin"], [userId, "player"]] as const)
      await db.insert(usersTable).values({ id, email: `${id}@release.test`, emailNormalized: `${id}@release.test`, passwordHash: "unused", role });
    const session = await createSession(adminId, "127.0.0.1", "release-test");
    await postEntry({ userId, type: "adjustment", amount: 10000n });
    const makeWithdrawal = async (claimed = false) => (await db.insert(withdrawalsTable).values({ userId, amount: 100n, destination: "test@example", ...(claimed ? { reviewedBy: adminId, reviewedAt: new Date(Date.now() - 3600000) } : {}) }).returning())[0]!;
    const decide = (id: string) => fetch(`http://127.0.0.1:${port}/api/admin/withdrawals/${id}/decision`, { method: "POST", headers: { origin: `http://127.0.0.1:${port}`, cookie: `sid=${session.id}`, "content-type": "application/json" }, body: JSON.stringify({ decision: "approve" }) });
    const first = await makeWithdrawal();
    const replies = await Promise.all([decide(first.id), decide(first.id)]);
    assert.deepEqual(replies.map(r => r.status).sort(), [200, 400], JSON.stringify(await Promise.all(replies.map(r => r.text()))));
    assert.equal((await getBalanceByUser(userId)).balance, 9900n);
    const stale = await makeWithdrawal(true);
    assert.equal((await decide(stale.id)).status, 400);
    assert.equal((await getBalanceByUser(userId)).balance, 9900n);

    // No external provider is contacted: the test stub throws after dispatch.
    let calls = 0;
    provider.createPayout = async () => { calls++; throw new Error("Simulated timeout after dispatch"); };
    process.env.PAYMENT_PROVIDER = "cashfree";
    const uncertain = await makeWithdrawal();
    const response = await decide(uncertain.id);
    assert.equal(response.status, 200, await response.text());
    const [saved] = await db.select().from(withdrawalsTable).where(eq(withdrawalsTable.id, uncertain.id));
    assert.equal(saved!.gatewayStatus, "outcome_unknown");
    assert.equal(saved!.status, "approved");
    assert.equal((await getBalanceByUser(userId)).balance, 9800n);
    assert.equal((await decide(uncertain.id)).status, 400);
    assert.equal(calls, 1);
  } finally {
    provider.createPayout = originalPayout;
    if (originalProvider === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = originalProvider;
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
