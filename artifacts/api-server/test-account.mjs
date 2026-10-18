// Run security/report integration tests against volatile PGlite, never DATABASE_URL.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { unlink } from "node:fs/promises";
const root = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(root, ".account-tests.mjs");
try {
  await build({
    absWorkingDir: root,
    entryPoints: ["src/routes/__tests__/account.test.ts"],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    loader: { ".sql": "text" },
    external: ["@electric-sql/pglite", "pino", "pg-native"],
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    plugins: [
      {
        name: "volatile-test-database",
        setup(builder) {
          builder.onResolve({ filter: /^@workspace\/db$/ }, () => ({
            path: path.join(root, "src/demo/database.ts"),
          }));
        },
      },
    ],
  });
  execFileSync(process.execPath, ["--test", output], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      COOKIE_SECURE: "false",
      DATABASE_URL: "postgresql://invalid@127.0.0.1:1/forbidden",
      TEST_RATE_LIMIT_BYPASS: "account-tests",
    },
  });
} finally {
  await unlink(output).catch(() => {});
}
