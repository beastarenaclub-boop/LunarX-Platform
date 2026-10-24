/** Only loaded by the isolated Ludo test runner, never by the application. */
import { db, pool } from "@workspace/db";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
if (!/^\/ludo_test_\d+$/.test(new URL(process.env.DATABASE_URL!).pathname))
  throw new Error("Refusing a non-test database");
export const ready = migrate(db, {
  migrationsFolder: path.resolve("../../lib/db/drizzle"),
});
export const memory = { close: () => pool.end() };
