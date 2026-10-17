// Offline local deployment: reuse installed runtime dependencies and compiled assets.
// Run the normal API/admin/agent/player builds before this script.
import { cp, mkdir, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (!process.argv.includes("--verified-builds"))
  throw new Error(
    "Finish the API, admin, agent and player builds, then pass --verified-builds",
  );
const stage = resolve(root, "tmp/network-local-build");
async function run(args, output = false) {
  return await new Promise((ok, fail) => {
    let text = "";
    const p = spawn("docker", args, {
      cwd: root,
      stdio: output ? ["ignore", "pipe", "inherit"] : "inherit",
    });
    p.stdout?.on("data", (c) => (text += c));
    p.on("error", fail);
    p.on("exit", (code) =>
      code === 0
        ? ok(text.trim())
        : fail(new Error(`docker ${args[0]} failed: ${code}`)),
    );
  });
}
await mkdir(stage, { recursive: true });
for (const service of ["api", "web"]) {
  const container = await run(["compose", "ps", "-q", service], true);
  const image = await run(
    ["inspect", container, "--format", "{{.Image}}"],
    true,
  );
  await run(["tag", image, `aviator-network-base-${service}:local`]);
}
const api = resolve(stage, "api");
await mkdir(api, { recursive: true });
await cp(resolve(root, "artifacts/api-server/dist"), resolve(api, "dist"), {
  recursive: true,
});
await cp(resolve(root, "lib/db/drizzle"), resolve(api, "drizzle"), {
  recursive: true,
});
await cp(resolve(root, "lib/db/src"), resolve(api, "db-src"), {
  recursive: true,
});
await writeFile(
  resolve(api, "Dockerfile"),
  "FROM aviator-network-base-api:local\nCOPY dist /app/artifacts/api-server/dist\nCOPY drizzle /app/lib/db/drizzle\nCOPY db-src /app/lib/db/src\n",
);
await run(["build", "--pull=false", "-t", "aviator-game-api", api]);
for (const service of ["admin", "operator"]) {
  const name = service === "admin" ? "admin-panel" : "agent-panel";
  const target = resolve(stage, service);
  await mkdir(target, { recursive: true });
  await cp(
    resolve(root, `artifacts/${name}/dist/public`),
    resolve(target, "public"),
    { recursive: true },
  );
  await cp(
    resolve(root, `artifacts/${name}/nginx.conf`),
    resolve(target, "nginx.conf"),
  );
  await writeFile(
    resolve(target, "Dockerfile"),
    "FROM nginx:1.27-alpine\nCOPY nginx.conf /etc/nginx/conf.d/default.conf\nCOPY public /usr/share/nginx/html\n",
  );
  await run(["build", "--pull=false", "-t", `aviator-game-${service}`, target]);
}
// Media assets remain in the current web image; code/style files are the only changed assets for this task.
const web = resolve(stage, "web"),
  publicDir = resolve(root, "artifacts/3d-game/dist/public");
await mkdir(resolve(web, "public"), { recursive: true });
async function copyCode(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "assets") await copyCode(file);
    } else if (/\.(html|js|css)$/.test(entry.name)) {
      const out = resolve(web, "public", relative(publicDir, file));
      await mkdir(resolve(out, ".."), { recursive: true });
      await cp(file, out);
    }
  }
}
await copyCode(publicDir);
await writeFile(
  resolve(web, "Dockerfile"),
  "FROM aviator-network-base-web:local\nCOPY public /usr/share/nginx/html\n",
);
await run(["build", "--pull=false", "-t", "aviator-game-web", web]);
console.log(
  "Local images are ready. Start with: docker compose up -d --no-build --wait api admin operator web b2b",
);
