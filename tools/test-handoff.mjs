import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)),
  api = resolve(root, "artifacts/api-server");
const require = createRequire(resolve(api, "package.json")),
  { build } = require("esbuild");
const dbRequire = createRequire(resolve(root, "lib/db/package.json"));
const { generateDrizzleJson, generateMigration } = dbRequire("drizzle-kit/api");
const previous = JSON.parse(
  await readFile(
    resolve(root, "lib/db/drizzle/meta/0064_snapshot.json"),
    "utf8",
  ),
);
await mkdir(resolve(root, "tmp"), { recursive: true });
await writeFile(
  resolve(root, "tmp/handoff-previous-schema.sql"),
  (await generateMigration(generateDrizzleJson({}), previous)).join("\n"),
);
const outfile = resolve(api, "node_modules/.cache/handoff.test.mjs");
await mkdir(resolve(outfile, ".."), { recursive: true });
await build({
  entryPoints: [resolve(api, "src/handoff-tests/integration.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".sql": "text" },
  plugins: [
    {
      name: "isolated-game-control-tests",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: resolve(api, "src/demo/database.ts"),
        }));
        // PGlite has one connection; real PostgreSQL admission locking is covered
        // by the production row-lock SQL, not an unrelated network pool in tests.
        build.onResolve({ filter: /rouletteAdmission$/ }, () => ({
          path: "admission",
          namespace: "test",
        }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents:
            "export async function withRouletteAdmission(_id,fn){return fn();}",
          loader: "js",
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
      HANDOFF_BROWSER: process.argv.includes("--browser") ? "1" : "",
    },
  },
);
process.exitCode = result.status ?? 1;
