import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, ".ludo-tests");
const serve = process.argv.includes("--serve"),
  postgres = serve || process.argv.includes("--postgres");
let admin, database;
if (postgres) {
  const { Pool } = createRequire(
    path.resolve(root, "../../lib/db/package.json"),
  )("pg");
  const url = new URL(
    process.env.LUDO_TEST_PG_URL ??
      "postgresql://aviator:aviator_local@127.0.0.1:5449/aviator_network_test",
  );
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    !url.pathname.endsWith("_network_test")
  )
    throw new Error("Only the local isolated test Postgres is allowed");
  admin = new Pool({ connectionString: url.href });
  database = `ludo_test_${Date.now()}`;
  await admin.query(`CREATE DATABASE ${database}`);
  url.pathname = `/${database}`;
  process.env.DATABASE_URL = url.href;
}
await mkdir(out, { recursive: true });
const generated = postgres
  ? { status: 0 }
  : spawnSync(
      process.execPath,
      ["--import", "tsx", "src/demo/generate-schema.ts"],
      { cwd: root, stdio: "inherit" },
    );
if (generated.status !== 0) process.exit(generated.status ?? 1);
await build({
  entryPoints: (serve
    ? ["ludoBrowserServer.ts"]
    : ["ludo.test.ts", "ludo.integration.test.ts"]
  ).map((file) => path.join(root, "src/services/__tests__", file)),
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
      name: "isolated-ludo-test-store",
      setup(build) {
        build.onResolve({ filter: /^@workspace\/api-zod$/ }, () => ({
          path: path.resolve(root, "../../lib/api-zod/src/index.ts"),
        }));
        build.onResolve({ filter: /^pg$/ }, () => ({
          path: pathToFileURL(
            createRequire(
              path.resolve(root, "../../lib/db/package.json"),
            ).resolve("pg"),
          ).href,
          external: true,
        }));
        if (postgres)
          build.onResolve({ filter: /demo\/database$/ }, () => ({
            path: path.join(
              root,
              "src/services/__tests__/ludoPostgresStore.ts",
            ),
          }));
        build.onResolve({ filter: /^drizzle-zod$/ }, () => ({
          path: createRequire(
            path.resolve(root, "../../lib/db/package.json"),
          ).resolve("drizzle-zod"),
        }));
        build.onResolve({ filter: /^@workspace\/db$/ }, () => ({
          path: postgres
            ? path.resolve(root, "../../lib/db/src/index.ts")
            : path.join(root, "src/demo/database.ts"),
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
if (serve) {
  const child = spawn(
    process.execPath,
    [path.join(out, "ludoBrowserServer.mjs")],
    {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
      env: { ...process.env, COOKIE_SECURE: "false", LOG_LEVEL: "silent" },
    },
  );
  let cleaning;
  const cleanup = () =>
    (cleaning ??= (async () => {
      child.kill();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    })());
  process.on("SIGINT", () => void cleanup().finally(() => process.exit()));
  process.on("SIGTERM", () => void cleanup().finally(() => process.exit()));
  await new Promise((resolve) => child.once("exit", resolve));
  await cleanup();
} else {
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      path.join(out, "ludo.test.mjs"),
      path.join(out, "ludo.integration.test.mjs"),
    ],
    {
      cwd: root,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: "production" },
    },
  );
  if (admin) {
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
  process.exitCode = result.status ?? 1;
}
