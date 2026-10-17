import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { access, unlink } from "node:fs/promises";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(repo, "artifacts/api-server/package.json"));
const { WebSocket } = require("ws");
const prefix = `lunarx-render-test-${process.pid}`;
const network = `${prefix}-net`;
const containers = [];
const password = randomBytes(24).toString("hex");
const adminEmail = "render-smoke@local.invalid";
let networkCreated = false;
const reuseLocalFrontends = process.argv.includes("--reuse-local-frontends");
const template = path.join(repo, "tmp", `${prefix}.conf.template`);
const webMounts = [];

if (reuseLocalFrontends) {
  // Checks routing/API behavior using existing outputs, not a fresh UI build.
  for (const [artifact, target] of [["3d-game", "web"], ["horse-riding", "web/horse-riding"],
    ["admin-panel", "admin"], ["agent-panel", "operator"]]) {
    const source = path.join(repo, "artifacts", artifact, "dist/public");
    await access(path.join(source, "index.html"));
    webMounts.push("--mount", `type=bind,source=${source},target=/srv/lunarx/${target},readonly`);
  }
  const generated = spawnSync(process.execPath, [path.join(repo, "deploy/render/prepare-nginx.mjs"), template],
    { encoding: "utf8", windowsHide: true });
  assert.equal(generated.status, 0, generated.stderr);
  webMounts.push("--mount", `type=bind,source=${template},target=/etc/nginx/templates/default.conf.template,readonly`);
  console.log("Using existing local frontend builds; fresh frontend compilation is not covered by this run.");
}

function docker(args, tolerateFailure = false) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 120_000, windowsHide: true });
  if (!tolerateFailure && (result.error || result.status !== 0)) {
    // Arguments may contain ephemeral credentials, so do not log the command.
    throw new Error(`Docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }
  return { ok: result.status === 0, output: (result.stdout ?? "").trim() };
}

function launch(suffix, args) {
  const name = `${prefix}-${suffix}`;
  docker(["run", "-d", "--name", name, "--network", network, ...args]);
  containers.push(name);
  return name;
}

async function eventually(action, attempts = 60) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try { return await action(); } catch (error) { lastError = error; }
    await delay(1000);
  }
  throw lastError;
}

try {
  docker(["network", "create", network]);
  networkCreated = true;
  const db = launch("db", ["--network-alias", "db", "--tmpfs", "/var/lib/postgresql/data",
    "-e", "POSTGRES_USER=lunarx", "-e", "POSTGRES_DB=lunarx_render_test",
    "-e", `POSTGRES_PASSWORD=${password}`, "postgres:16-alpine"]);
  await eventually(() => assert(docker(["exec", db, "pg_isready", "-U", "lunarx", "-d", "lunarx_render_test"], true).ok));
  launch("api", ["--network-alias", "api", "--tmpfs", "/var/data",
    "-e", `DATABASE_URL=postgresql://lunarx:${password}@db:5432/lunarx_render_test`,
    "-e", `SUPER_ADMIN_EMAIL=${adminEmail}`, "-e", `SUPER_ADMIN_PASSWORD=${password}`,
    "-e", "COOKIE_SECURE=true", "-e", "TRUST_PROXY=2",
    "-e", "B2B_HOSTS=b2b.lunarx.live", "-e", "OPERATOR_HOSTS=panel.lunarx.live",
    "-e", "CORS_ORIGINS=https://lunarx.live,https://admin.lunarx.live,https://panel.lunarx.live,https://b2b.lunarx.live",
    "-e", "WINGO_DB=/var/data/wingo.sqlite", "-e", "FOREX_DB=/var/data/forex.sqlite",
    "-e", "VIRTUAL_SPORTS_DB=/var/data/virtual-sports.sqlite", "lunarx-render-api:verify"]);
  const web = launch("web", ["-p", "127.0.0.1::10000", "-e", "API_UPSTREAM=api:4000",
    "-e", "PORT=10000", "-e", "NGINX_ENVSUBST_FILTER=^(PORT|API_UPSTREAM)$", ...webMounts,
    reuseLocalFrontends ? "nginx:stable-alpine" : "lunarx-render-web:verify"]);
  const address = docker(["port", web, "10000/tcp"]).output;
  const base = `http://${address}`;
  const request = (route, host = "lunarx.live", options = {}) => fetch(base + route, {
    ...options, redirect: "manual", headers: { Host: host, ...options.headers }, signal: AbortSignal.timeout(5000),
  });

  await eventually(async () => assert.equal((await request("/api/healthz")).status, 200));
  const pages = [["lunarx.live", "/"], ["b2b.lunarx.live", "/"], ["admin.lunarx.live", "/admin/"],
    ["panel.lunarx.live", "/agent/"], ["panel.lunarx.live", "/master/"], ["lunarx.live", "/horse-riding/"]];
  for (const [host, route] of pages) {
    const response = await request(route, host);
    assert.equal(response.status, 200, `${host}${route}`);
    const html = await response.text();
    const asset = html.match(/src="([^"]+\.js)"/);
    assert(asset, `Built JavaScript missing: ${host}${route}`);
    const js = await request(asset[1], host);
    assert.equal(js.status, 200, `${host}${asset[1]}`);
    assert.match(js.headers.get("content-type"), /javascript/);
    console.log(`PASS page + JavaScript: ${host}${route}`);
  }
  for (const [host, target] of [["admin.lunarx.live", "/admin/"], ["panel.lunarx.live", "/agent/"]]) {
    const redirect = await request("/", host);
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), target);
  }
  assert.equal((await request("/.env")).status, 404);
  assert.equal((await request("/unity-sports/missing-file.wasm")).status, 404);
  assert.equal((await request("/api/auth/signup", "b2b.lunarx.live", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).status, 403, "B2B host must reach API unchanged");

  const login = await eventually(async () => {
    const response = await request("/api/auth/login", "admin.lunarx.live", {
      method: "POST", headers: { "Content-Type": "application/json", Origin: "https://admin.lunarx.live" },
      body: JSON.stringify({ email: adminEmail, password }),
    });
    assert.equal(response.status, 200, "Fresh database admin login");
    return response;
  }, 8);
  const setCookie = login.headers.get("set-cookie");
  assert.match(setCookie, /; Secure/i);
  assert.match(setCookie, /; HttpOnly/i);
  const cookie = setCookie.split(";")[0];
  console.log("PASS migrations, admin bootstrap, secure login cookie, host isolation and missing assets");

  await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace("http:", "ws:") + "/ws", {
      headers: { Host: "admin.lunarx.live", Origin: "https://admin.lunarx.live", Cookie: cookie },
    });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("WebSocket welcome timeout")); }, 5000);
    ws.once("error", reject);
    ws.once("message", data => {
      try { assert.equal(JSON.parse(String(data)).op, "welcome"); clearTimeout(timer); ws.close(); resolve(); }
      catch (error) { clearTimeout(timer); ws.terminate(); reject(error); }
    });
  });
  console.log("PASS authenticated WebSocket upgrade through Render gateway");
  console.log("Render deployment smoke tests passed using an isolated temporary database.");
} finally {
  for (const container of containers.reverse()) docker(["rm", "-f", container], true);
  if (networkCreated) docker(["network", "rm", network], true);
  if (reuseLocalFrontends) await unlink(template).catch(() => {});
}
