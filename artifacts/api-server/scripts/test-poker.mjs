import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, ".poker-tests");
await mkdir(out, { recursive: true });
const generated = spawnSync(
  process.execPath,
  ["--import", "tsx", "src/demo/generate-schema.ts"],
  { cwd: root, stdio: "inherit" },
);
if (generated.status !== 0) process.exit(generated.status ?? 1);
await build({
  entryPoints: ["poker.test.ts", "poker.integration.test.ts"].map((file) =>
    path.join(root, "src/services/__tests__", file),
  ),
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "node",
  packages: "external",
  outExtension: { ".js": ".mjs" },
  loader: { ".sql": "text" },
  define: { __DEMO_WORKER__: "false", "process.env.NODE_ENV": '"production"' },
  banner: {
    js: "import { createRequire as testRequire } from 'node:module'; const require = testRequire(import.meta.url);",
  },
  plugins: [
    {
      name: "isolated-poker-test-store",
      setup(build) {
        build.onResolve({ filter: /^drizzle-zod$/ }, () => ({
          path: createRequire(
            path.resolve(root, "../../lib/db/package.json"),
          ).resolve("drizzle-zod"),
        }));
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: path.join(root, "src/demo/database.ts"),
        }));
        build.onResolve({ filter: /^@workspace\/db\/schema$/ }, () => ({
          path: path.resolve(root, "../../lib/db/src/schema/index.ts"),
        }));
        build.onResolve({ filter: /^@workspace\/api-zod\// }, (args) => ({
          path: path.resolve(
            root,
            "../../lib/api-zod/src",
            args.path.split("/").at(-1) + ".ts",
          ),
        }));
      },
    },
  ],
});
const result = spawnSync(
  process.execPath,
  [
    "--test",
    path.join(out, "poker.test.mjs"),
    path.join(out, "poker.integration.test.mjs"),
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  },
);
process.exit(result.status ?? 1);
