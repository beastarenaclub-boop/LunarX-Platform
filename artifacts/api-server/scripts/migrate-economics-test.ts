import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@workspace/db";
if (new URL(process.env.DATABASE_URL!).pathname !== "/economics") throw new Error("Use the isolated economics test database.");
await migrate(db, { migrationsFolder: "../../lib/db/drizzle" });
await pool.end();
