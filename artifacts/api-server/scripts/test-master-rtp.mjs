// Isolated financial/game regression suite. All database calls use volatile PGlite.
import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, ".master-rtp-tests");
const files = ["masterRtp.integration"];
await mkdir(out, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: files.map(name => `./src/services/__tests__/${name}.test.ts`),
  outdir: out, bundle: true, platform: "node", format: "esm", packages: "external",
  outExtension: { ".js": ".mjs" }, loader: { ".sql": "text" },
  define: { __DEMO_WORKER__: "false" },
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  plugins: [{ name: "volatile-database", setup(b) {
    b.onResolve({ filter: /^@workspace\/db$/ }, () => ({ path: path.join(root, "src/demo/database.ts") }));
    b.onResolve({ filter: /^@workspace\/db\/schema$/ }, () => ({ path: path.resolve(root, "../../lib/db/src/schema/index.ts") }));
    b.onResolve({ filter: /^drizzle-zod$/ }, () => ({ path: createRequire(path.resolve(root, "../../lib/db/package.json")).resolve("drizzle-zod") }));
    b.onResolve({ filter: /(?:^|\/)rouletteAdmission$/ }, () => ({ path: path.join(root, "src/demo/rouletteAdmission.ts") }));
    b.onResolve({ filter: /^@workspace\/api-zod(?:\/|$)/ }, args => ({ path: path.resolve(root, "../../lib/api-zod/src", args.path === "@workspace/api-zod" ? "index.ts" : `${args.path.split('/').at(-1)}.ts`) }));
  } }],
});
const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...files.map(name => path.join(out, `${name}.test.mjs`))], {
  cwd: root, stdio: "inherit", windowsHide: true,
  env: { ...process.env, NODE_ENV: "test", LOG_LEVEL: "silent", COOKIE_SECURE: "false", DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden" },
});
process.exit(result.status ?? 1);
