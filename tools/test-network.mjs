import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(resolve(root, "lib/db/package.json"));
const { Pool } = require("pg");
const { drizzle } = require("drizzle-orm/node-postgres");
const { migrate } = require("drizzle-orm/node-postgres/migrator");
const url =
  process.env.NETWORK_TEST_DATABASE_URL ??
  "postgresql://aviator:aviator_local@127.0.0.1:5449/aviator_network_test";
if (!new URL(url).pathname.endsWith("_network_test"))
  throw new Error("Only a dedicated _network_test database is allowed");
const pool = new Pool({ connectionString: url });
try {
  await migrate(drizzle(pool), {
    migrationsFolder: resolve(root, "lib/db/drizzle"),
  });
} finally {
  await pool.end();
}
const child = spawn(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "src/services/__tests__/networkMath.test.ts",
    "src/services/__tests__/networkReportRange.test.ts",
    "src/services/__tests__/transactionFilters.test.ts",
    "src/services/__tests__/network.integration.test.ts",
    "src/services/__tests__/paymentHistory.integration.test.ts",
    "src/services/__tests__/accountSecurity.integration.test.ts",
    "src/services/__tests__/masterManualPayments.integration.test.ts",
  ],
  {
    cwd: resolve(root, "artifacts/api-server"),
    stdio: "inherit",
    env: {
      ...process.env,
      DATABASE_URL: url,
      NETWORK_INTEGRATION: "1",
      COOKIE_SECURE: "false",
      LOG_LEVEL: "silent",
      NODE_ENV: "test",
    },
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
