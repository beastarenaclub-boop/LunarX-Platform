import { AsyncLocalStorage } from "node:async_hooks";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import schemaSql from "./schema.generated.sql";

// No directory, IndexedDB, dump, socket, DATABASE_URL or production connection.
export const memory = new PGlite();
export const ready = memory.exec(schemaSql);
const root = drizzle(memory, { schema });
type Transaction = Parameters<Parameters<typeof root.transaction>[0]>[0];
const context = new AsyncLocalStorage<Transaction>();

// Some existing engines call a shared service from inside a transaction.
// Keep those calls on that transaction: PGlite has a single connection.
const routed = new Proxy(root, {
  get(_target, property) {
    const active = context.getStore() ?? root;
    if (property === "transaction") {
      return (callback: (tx: Transaction) => unknown) => active.transaction(async (tx) =>
        context.run(tx, () => callback(tx)));
    }
    const value = Reflect.get(active, property);
    return typeof value === "function" ? value.bind(active) : value;
  },
});
// Both drivers expose the same Drizzle query API and { rows } execute result.
export const db = routed as unknown as NodePgDatabase<typeof schema>;
export const pool = { end: () => memory.close() };
export * from "@workspace/db/schema";
