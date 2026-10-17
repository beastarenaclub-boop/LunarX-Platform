import { db, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { hashPassword } from "../src/lib/password";
import { normalizeEmail } from "../src/services/auth";

const TARGET_EMAILS = ["admin@aviator.dev", "deptest@test.com"];

async function main() {
  const password = process.argv[2] ?? process.env.RESET_PASSWORD;
  if (!password) {
    console.error(
      "Usage: tsx scripts/reset-admin-passwords.ts <new-password>\n" +
        "   or: RESET_PASSWORD=... tsx scripts/reset-admin-passwords.ts",
    );
    process.exit(1);
  }

  const normalizedTargets = TARGET_EMAILS.map(normalizeEmail);
  const passwordHash = await hashPassword(password);

  let updated = 0;
  for (const normalized of normalizedTargets) {
    const result = await db
      .update(usersTable)
      .set({
        passwordHash,
        role: "super_admin",
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(usersTable.emailNormalized, normalized))
      .returning({ id: usersTable.id, email: usersTable.email });
    if (result.length === 0) {
      console.warn(`No user found for ${normalized}`);
    } else {
      updated += result.length;
      console.log(`Updated ${result[0]!.email} (id=${result[0]!.id})`);
    }
  }

  const verify = await db
    .select({
      email: usersTable.email,
      role: usersTable.role,
      status: usersTable.status,
    })
    .from(usersTable)
    .where(inArray(usersTable.emailNormalized, normalizedTargets));
  console.log("Final state:", verify);
  console.log(`Rows updated: ${updated}`);
  if (updated !== TARGET_EMAILS.length) {
    console.error(
      `Expected to update ${TARGET_EMAILS.length} rows but updated ${updated}`,
    );
    process.exit(2);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
