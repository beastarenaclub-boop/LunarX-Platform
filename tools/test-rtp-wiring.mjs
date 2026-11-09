import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url)), api = resolve(root, "artifacts/api-server");
const require = createRequire(resolve(api, "package.json"));
const files = ["src/demo/__tests__/configuration.integration.ts", "src/services/__tests__/masterRtp.integration.test.ts"];
for (const [i, entry] of files.entries()) {
  const outfile = resolve(api, `node_modules/.cache/rtp-wiring-${i}.test.mjs`);
  await mkdir(resolve(outfile, ".."), { recursive: true });
  await require("esbuild").build({ entryPoints: [resolve(api, entry)], outfile,
    bundle: true, platform: "node", format: "esm", packages: "external", loader: { ".sql": "text" },
    plugins: [{ name: "isolated-rtp-tests", setup(build) {
      build.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: resolve(api, "src/demo/database.ts") }));
      build.onResolve({ filter: /rouletteAdmission$/ }, () => ({ path: resolve(api, "src/demo/rouletteAdmission.ts") }));
    } }],
  });
  const result = spawnSync(process.execPath, ["--import", "tsx", "--test", outfile], {
    cwd: api, stdio: "inherit", env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", DATABASE_URL: "" },
  });
  if (result.status !== 0) { process.exitCode = result.status ?? 1; break; }
}
