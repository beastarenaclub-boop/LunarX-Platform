import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const api = resolve(root, "artifacts/api-server");
const require = createRequire(resolve(api, "package.json"));
const { build } = require("esbuild");
const schema = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/demo/generate-schema.ts"],
  { cwd: api, stdio: "inherit" },
);
if (schema.status !== 0)
  throw new Error("Could not prepare the in-memory test schema");
const outfile = resolve(api, "node_modules/.cache/operator-insights.test.mjs");
await mkdir(resolve(api, "node_modules/.cache"), { recursive: true });
// All database access in this test process is redirected to volatile PGlite.
// No DATABASE_URL, disk database, development database or production is used.
await build({
  entryPoints: [resolve(api, "src/report-tests/operatorInsights.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".sql": "text" },
  plugins: [
    {
      name: "memory-only-db",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: resolve(api, "src/demo/database.ts"),
        }));
      },
    },
  ],
});
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", outfile],
  {
    cwd: api,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "",
      INSIGHTS_BROWSER: process.argv.includes("--browser") ? "1" : "",
    },
  },
);
process.exitCode = result.status ?? 1;
