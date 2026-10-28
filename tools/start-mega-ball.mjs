// Local preview uses the existing isolated, in-memory demo worker. No production DB.
import { spawn, execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import http from "node:http";
import { fileURLToPath } from "node:url";
const cwd = fileURLToPath(new URL("..", import.meta.url));
if (!process.argv.includes("--no-build")) execFileSync(process.execPath, ["artifacts/api-server/build.mjs"], { cwd, stdio: "inherit", windowsHide: true });
const secret = randomUUID(), now = Date.now();
const session = { token: `demo_${randomBytes(32).toString("hex")}`, id: `demo-${randomUUID()}`, createdAt: now, lastSeen: now, expiresAt: now + 3600000 };
const worker = new Worker(new URL("../artifacts/api-server/dist/demo-worker.mjs", import.meta.url), {
  execArgv: [], env: { NODE_ENV: "production", LOG_LEVEL: "error", DATABASE_URL: "postgresql://invalid@127.0.0.1:1/isolated-preview" }, workerData: { secret, configs: [] },
});
const workerPort = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Demo worker did not start")), 60000); worker.once("error", reject); worker.on("message", m => { if (m.ready) { clearTimeout(timer); resolve(m.port); } }); });
await new Promise((resolve, reject) => { const requestId = randomUUID(); const timer = setTimeout(() => reject(new Error("Demo registration failed")), 10000); worker.on("message", m => { if (m.reply === requestId) { clearTimeout(timer); m.ok ? resolve() : reject(new Error("Demo registration failed")); } }); worker.postMessage({ requestId, action: "register", session }); });
const apiPort = Number(process.env.MEGA_BALL_API_PORT ?? 5341), webPort = Number(process.env.MEGA_BALL_WEB_PORT ?? 5340);
let active = true;
const user = { id: session.id, email: "", displayName: "Mega Ball Preview", role: "player", status: "active", channel: "b2c", isDemo: true, demoExpiresAt: new Date(session.expiresAt).toISOString(), createdAt: new Date(now).toISOString() };
const headers = source => ({ ...source, host: `127.0.0.1:${workerPort}`, cookie: `sid=${session.token}`, "x-demo-worker-key": secret, "x-demo-token": session.token });
const server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const json = (body, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (req.url === "/api/network/website") return json(null);
  if (req.url?.startsWith("/api/banners")) return json([]);
  if (req.url === "/api/auth/logout") { active = false; return json({ ok: true }); }
  if (req.url === "/api/auth/demo-login") { active = true; return json({ user }); }
  if (!active) return json({ message: "Start a demo to play" }, 401);
  if (req.url === "/api/auth/me") return json(user);
  if (req.url === "/api/auth/demo-heartbeat") return json({ serverNow: Date.now() });
  const proxy = http.request({ hostname: "127.0.0.1", port: workerPort, path: req.url, method: req.method, headers: headers(req.headers) }, response => { res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res); });
  proxy.on("error", () => { if (!res.headersSent) json({ message: "Preview server unavailable" }, 502); else res.destroy(); }); req.pipe(proxy);
});
server.on("upgrade", (req, socket, head) => {
  if (!active) return socket.destroy();
  const proxy = http.request({ hostname: "127.0.0.1", port: workerPort, path: req.url, headers: headers(req.headers) });
  proxy.on("upgrade", (response, upstream, upstreamHead) => {
    const raw = response.rawHeaders.reduce((out, value, i, array) => i % 2 === 0 ? out + `${value}: ${array[i + 1]}\r\n` : out, "");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${raw}\r\n`); if (upstreamHead.length) socket.write(upstreamHead); if (head.length) upstream.write(head);
    upstream.pipe(socket); socket.pipe(upstream); socket.on("error", () => upstream.destroy()); upstream.on("error", () => socket.destroy());
  }); proxy.on("error", () => socket.destroy()); proxy.on("response", () => socket.destroy()); proxy.end();
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(apiPort, "127.0.0.1", resolve); });
const vite = spawn(process.execPath, ["artifacts/3d-game/node_modules/vite/bin/vite.js", "--config", "artifacts/3d-game/vite.mega-ball.config.ts", "--host", "127.0.0.1"], { cwd, windowsHide: true, stdio: "inherit", env: { ...process.env, PORT: String(webPort), API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` } });
console.log(`Mega Ball demo: http://127.0.0.1:${webPort}/mega-ball`);
let stopping = false;
async function stop() { if (stopping) return; stopping = true; vite.kill(); server.closeAllConnections(); server.close(); await worker.terminate(); }
process.once("SIGINT", () => void stop()); process.once("SIGTERM", () => void stop()); vite.once("exit", () => void stop());
