import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const api = resolve(root, "artifacts/api-server");
const require = createRequire(resolve(api, "package.json"));
const outfile = resolve(api, "node_modules/.cache/lobby-layout.test.mjs");
await mkdir(resolve(outfile, ".."), { recursive: true });
console.log("Building isolated lobby layout tests…");
await require("esbuild").build({
  entryPoints: [resolve(api, "src/routes/__tests__/lobbyLayout.test.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  loader: { ".sql": "text" },
  plugins: [
    {
      name: "isolated-lobby-layout-database",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: resolve(api, "src/demo/database.ts"),
        }));
      },
    },
  ],
});
console.log("Testing with an in-memory PostgreSQL database…");
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
    },
  },
);
process.exitCode = result.status ?? 1;
