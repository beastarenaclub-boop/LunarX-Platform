import { Worker } from "node:worker_threads";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { RequestHandler } from "express";
import { WebSocket, WebSocketServer } from "ws";
import { db, gameConfigTable } from "@workspace/db";
import { requestSite, sessionCookie } from "../middlewares/siteChannel";
import { demoSessions, demoPublicUser, isDemoToken, type DemoSession } from "./sessions";
import { demoRouteAllowed } from "./policy";

type Runtime = { worker: Worker; port: number; secret: string };
let runtime: Promise<Runtime> | undefined;
let creating = 0;
const replies = new Map<string, { resolve: () => void; reject: () => void }>();
const sockets = new Map<string, Set<WebSocket>>();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const secure = process.env.COOKIE_SECURE !== "false";
const cookieOptions = { httpOnly: true, secure, sameSite: secure ? "none" as const : "lax" as const, path: "/" };

async function startRuntime(): Promise<Runtime> {
  if (runtime) return runtime;
  runtime = (async () => {
    const configs = await db.select().from(gameConfigTable);
    const secret = randomBytes(32).toString("hex");
    const worker = new Worker(new URL(import.meta.url.endsWith(".ts")
      ? "../../dist/demo-worker.mjs" : "./demo-worker.mjs", import.meta.url), {
      // The demo process receives no database URL, payment keys or other secrets.
      env: { NODE_ENV: "production", LOG_LEVEL: "silent" }, execArgv: [],
      stdout: true, stderr: true,
      workerData: { secret, configs },
    });
    // Some shared engines use console.error. Never retain demo game logs.
    worker.stdout?.resume(); worker.stderr?.resume();
    const port = await new Promise<number>((resolve, reject) => {
      // A cold in-memory database can take over 30s on the local Docker stack.
      // Allow it to finish instead of discarding a healthy worker mid-startup.
      const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Demo startup timed out")); }, 60_000);
      worker.on("message", (message) => {
        if (message.ready) { clearTimeout(timer); resolve(message.port); }
        if (message.reply) {
          const reply = replies.get(message.reply);
          replies.delete(message.reply);
          if (message.ok) reply?.resolve(); else reply?.reject();
        }
      });
      worker.on("error", () => { clearTimeout(timer); reject(new Error("Demo runtime unavailable")); });
      worker.on("exit", () => {
        clearTimeout(timer);
        runtime = undefined;
        demoSessions.clear();
        for (const clients of sockets.values()) for (const ws of clients) ws.close(4001, "Demo ended");
        sockets.clear();
        for (const pending of replies.values()) pending.reject();
        replies.clear();
        reject(new Error("Demo runtime stopped"));
      });
    });
    return { worker, port, secret };
  })().catch((error) => { runtime = undefined; throw error; });
  return runtime;
}

async function command(target: Runtime, message: Record<string, unknown>) {
  const requestId = randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { replies.delete(requestId); reject(new Error("Demo request timed out")); }, 15_000);
    replies.set(requestId, {
      resolve: () => { clearTimeout(timer); resolve(); },
      reject: () => { clearTimeout(timer); reject(new Error("Demo request failed")); },
    });
    target.worker.postMessage({ ...message, requestId });
  });
}

export async function endDemo(token: string) {
  demoSessions.remove(token);
  for (const ws of sockets.get(token) ?? []) ws.close(4001, "Demo ended");
  sockets.delete(token);
  if (runtime) await command(await runtime, { action: "remove", token });
}

const expired = { error: { code: "DEMO_EXPIRED", message: "Your one-hour demo has ended. Start a new demo to play again." } };

/** Mounted before all normal routes. Every demo token is contained here. */
export const demoGateway: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[sessionCookie(req)];
  const demo = demoSessions.get(token);
  const isStart = req.method === "POST" && req.path === "/api/auth/demo-login";
  if (req.path === "/api/auth/demo-heartbeat" && req.method === "POST" && !demo) {
    res.status(401).json(expired); return;
  }
  const realAuth = req.method === "POST" && ["/api/auth/login", "/api/auth/signup"].includes(req.path);
  if (realAuth && isDemoToken(token)) {
    // A real account starts fresh; temporary wins are never migrated.
    delete req.cookies[sessionCookie(req)];
    res.on("finish", () => { if (res.statusCode < 300) void endDemo(token).catch(() => {}); });
    return next();
  }
  if (!isStart && !isDemoToken(token)) return next();
  res.setHeader("Cache-Control", "no-store");
  if (requestSite(req) !== "b2c") {
    res.status(403).json({ error: { code: "DEMO_B2C_ONLY", message: "Open the B2C website to try a demo." } }); return;
  }
  if (isStart) {
    if (req.user) { res.status(409).json({ error: { code: "ALREADY_SIGNED_IN", message: "Sign out before starting a demo." } }); return; }
    creating++;
    try {
      let session = demo;
      if (!session) {
        const target = await startRuntime();
        session = demoSessions.create();
        try { await command(target, { action: "register", session }); }
        catch (error) { demoSessions.remove(session.token); throw error; }
      }
      demoSessions.touch(session.token);
      res.cookie(sessionCookie(req), session.token, { ...cookieOptions, expires: new Date(session.expiresAt) });
      res.json({ user: demoPublicUser(session), expiresAt: new Date(session.expiresAt).toISOString() });
    } catch {
      res.status(503).json({ error: { code: "DEMO_UNAVAILABLE", message: "Demo is busy. Please try again shortly." } });
    } finally { creating--; }
    return;
  }
  if (req.path === "/api/auth/logout" && req.method === "POST") {
    await endDemo(token).catch(() => {});
    res.clearCookie(sessionCookie(req), cookieOptions);
    res.json({ ok: true }); return;
  }
  if (req.path === "/api/auth/site" && req.method === "GET") return next();
  if (!demo) { res.status(401).json(expired); return; }
  if (req.path === "/api/auth/me" && req.method === "GET") {
    demoSessions.touch(token); res.json(demoPublicUser(demo)); return;
  }
  if (req.path === "/api/auth/demo-heartbeat" && req.method === "POST") {
    demoSessions.touch(token);
    res.json({ expiresAt: new Date(demo.expiresAt).toISOString(), serverNow: Date.now() }); return;
  }
  // Public artwork does not depend on identity. No visitor data is written.
  if (req.method === "GET" && req.path === "/api/banners/active") return next();
  if (req.method === "GET" && req.path === "/api/notifications/unread-count") { res.json({ count: 0 }); return; }
  if (req.method === "GET" && req.path === "/api/free-bets") { res.json({ grants: [], count: 0, nextAmountPaise: "0" }); return; }
  if (req.method === "GET" && req.path === "/api/rain/active") { res.json({ rain: null }); return; }
  if (!demoRouteAllowed(req.method, req.path)) {
    res.status(403).json({ error: { code: "DEMO_ONLY", message: "Demo coins are for practice only. Deposits, withdrawals and transfers are unavailable." } }); return;
  }
  demoSessions.touch(token);
  try {
    const target = await startRuntime();
    const response = await fetch(`http://127.0.0.1:${target.port}${req.originalUrl}`, {
      method: req.method, redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { "content-type": "application/json", "x-demo-worker-key": target.secret, "x-demo-token": token,
        // Gameplay protocol headers only; never forward IP/UA/device data.
        ...Object.fromEntries(["x-sports-client", "x-sports-wallet", "idempotency-key"]
          .filter(key => typeof req.headers[key] === "string")
          .map(key => [key, String(req.headers[key])])),
      },
      ...(req.method === "POST" ? { body: JSON.stringify(req.body ?? {}) } : {}),
    });
    if (!demoSessions.get(token)) { res.status(401).json(expired); return; }
    res.status(response.status).type("application/json").send(await response.text());
  } catch {
    res.status(503).json({ error: { code: "DEMO_UNAVAILABLE", message: "Demo temporarily unavailable. Please retry." } });
  }
};

export const demoPresence: RequestHandler = (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ activeDemoUsers: demoSessions.liveCount(), sessionMinutes: 60 });
};

function cookie(header: string | undefined, key: string) {
  const part = header?.split(";").map(s => s.trim()).find(s => s.startsWith(`${key}=`));
  try { return part ? decodeURIComponent(part.slice(key.length + 1)) : ""; } catch { return ""; }
}

export function demoUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const token = cookie(req.headers.cookie, sessionCookie(req));
  if (!isDemoToken(token)) return false;
  const demo = demoSessions.get(token);
  if (!demo || requestSite(req) !== "b2c" || !runtime) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n"); socket.destroy(); return true;
  }
  void runtime.then(target => {
    if (!demoSessions.get(token) || socket.destroyed) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (client) => {
      const upstream = new WebSocket(`ws://127.0.0.1:${target.port}/ws`, { headers: {
        "x-demo-worker-key": target.secret, cookie: `sid=${token}`,
      } });
      const clients = sockets.get(token) ?? new Set<WebSocket>();
      clients.add(client); sockets.set(token, clients);
      const queue: { data: Buffer; binary: boolean }[] = [];
      const timer = setTimeout(() => { client.close(4001, "Demo expired"); upstream.close(); }, Math.max(0, demo.expiresAt - Date.now()));
      upstream.on("open", () => { for (const item of queue) upstream.send(item.data, { binary: item.binary }); queue.length = 0; });
      client.on("message", (data, binary) => {
        if (!demoSessions.get(token)) { client.close(4001, "Demo expired"); return; }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary });
        else if (queue.length < 32) queue.push({ data: data as Buffer, binary });
        else client.close(1008, "Too many messages");
      });
      upstream.on("message", (data, binary) => { if (client.readyState === WebSocket.OPEN) client.send(data, { binary }); });
      upstream.on("error", () => client.close(1011, "Demo unavailable"));
      upstream.on("close", () => client.close());
      client.on("error", () => upstream.close());
      client.on("close", () => { clearTimeout(timer); upstream.close(); clients.delete(client); if (!clients.size) sockets.delete(token); });
    });
  }).catch(() => socket.destroy());
  return true;
}

// Configuration changes apply to future demo rounds just as they do to real games.
setInterval(() => {
  if (runtime) void runtime.then(async target => {
    await command(target, { action: "configure", configs: await db.select().from(gameConfigTable) });
  }).catch(() => {});
}, 30_000).unref();

setInterval(() => {
  for (const session of demoSessions.prune()) void endDemo(session.token).catch(() => {});
  if (runtime && !demoSessions.size && !creating) void runtime.then(target => {
    if (!demoSessions.size && !creating) void target.worker.terminate();
  }).catch(() => {});
}, 1000).unref();
