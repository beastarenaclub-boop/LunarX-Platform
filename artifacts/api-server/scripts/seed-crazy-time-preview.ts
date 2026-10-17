/** Local-only preview account. Refuses to touch the main account database. */
import { db, pool, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/password";
import { postEntry } from "../src/services/wallet";

if (
  !new URL(process.env.DATABASE_URL ?? "").pathname.includes("crazy_time_test")
) {
  throw new Error(
    "Preview seeding requires the isolated crazy_time_test database",
  );
}
const email = "crazy-preview@local.test";
const [existing] = await db
  .select()
  .from(usersTable)
  .where(eq(usersTable.emailNormalized, email));
if (!existing) {
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      emailNormalized: email,
      displayName: "Crazy Time Preview",
      passwordHash: await hashPassword("CrazyTime@2026"),
      status: "active",
    })
    .returning();
  await postEntry({
    userId: user.id,
    type: "adjustment",
    amount: 1_000_000n,
    memo: "Isolated Crazy Time preview coins",
  });
}
console.log("Local preview account is ready with its separate test wallet.");
await pool.end();
