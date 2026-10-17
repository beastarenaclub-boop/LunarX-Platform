import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool, usersTable } from "@workspace/db";
import { hashPassword } from "../src/lib/password";
import { postEntry } from "../src/services/wallet";

// Browser checks must never fund an account in the application's real database.
assert.ok(new URL(process.env.DATABASE_URL!).pathname.endsWith("_shared_wallet_test"));
try {
  const email = `wallet-browser-${randomUUID()}@example.test`;
  const password = "Wallet-browser-test-12345";
  const [user] = await db.insert(usersTable).values({ email, emailNormalized: email,
    passwordHash: await hashPassword(password), displayName: "Wallet browser test" }).returning();
  await postEntry({ userId: user.id, type: "adjustment", amount: 1_000_000n, refType: "browser_test_fixture" });
  process.stdout.write(JSON.stringify({ email, password }));
} finally {
  await pool.end();
}
