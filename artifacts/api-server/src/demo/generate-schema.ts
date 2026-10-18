import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import * as schema from "@workspace/db/schema";

const require = createRequire(new URL("../../../../lib/db/package.json", import.meta.url));
const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
const snapshot = JSON.parse(JSON.stringify(generateDrizzleJson(schema), (_key, value) =>
  typeof value === "bigint" ? value.toString() : value));
const statements: string[] = await generateMigration(generateDrizzleJson({}), snapshot);
// This schema is used ONLY in volatile memory. Cascading teardown removes all
// gameplay linked to a temporary ID; production foreign keys are untouched.
const sql = statements.join("\n").replace(/ON DELETE (?:no action|restrict|set null)/gi, "ON DELETE cascade");
await writeFile(new URL("./schema.generated.sql", import.meta.url), sql);
