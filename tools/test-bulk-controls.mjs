import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)), api = resolve(root, "artifacts/api-server");
const require = createRequire(resolve(api, "package.json"));
const outfile = resolve(api, "node_modules/.cache/bulk-controls.test.mjs");
await mkdir(resolve(outfile, ".."), { recursive: true });
await require("esbuild").build({ entryPoints: [resolve(api, "src/services/__tests__/bulkGameControl.integration.ts")], outfile,
  bundle: true, platform: "node", format: "esm", packages: "external", loader: { ".sql": "text" },
  plugins: [{ name: "isolated-bulk-control-tests", setup(build) {
    build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: resolve(api, "src/demo/database.ts") }));
    build.onResolve({ filter: /rouletteAdmission$/ }, () => ({ path: resolve(api, "src/demo/rouletteAdmission.ts") }));
  } }],
});
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", outfile], {
  cwd: api, stdio: "inherit", env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: "" },
});
process.exitCode = result.status ?? 1;
