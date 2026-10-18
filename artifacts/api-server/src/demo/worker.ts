import { parentPort, workerData } from "node:worker_threads";
import express from "express";
import { eq, lt, sql } from "drizzle-orm";
import { db, memory, ready, usersTable, sessionsTable, gameConfigTable, tableRoundsTable } from "./database";
import gameplayRouter from "../routes/gameplay";
import { startGameEngines } from "../lib/gameEngines";
import { attachRealtime } from "../realtime/gateway";
import { errorHandler } from "../middlewares/error";
import { ensureGameConfigDefaults } from "../lib/bootstrap";
import { demoRouteAllowed } from "./policy";
import { demoPublicUser, type DemoSession } from "./sessions";
import { invalidateConfigCache } from "../services/rtp";

if (!parentPort || !workerData.secret) throw new Error("Demo worker requires its private parent channel");
await ready;
// Older gameplay tables intentionally lack user foreign keys in production.
// In the volatile store, every identity column must cascade on expiry too.
const identities = await memory.query<{ table_name: string; column_name: string }>(`
  SELECT table_name, column_name FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name IN ('user_id', 'actor_id')`);
for (const column of identities.rows) {
  const table = column.table_name.replaceAll('"', '""');
  const field = column.column_name.replaceAll('"', '""');
  await memory.exec(`ALTER TABLE "${table}" ADD FOREIGN KEY ("${field}") REFERENCES users(id) ON DELETE CASCADE`);
}
await ensureGameConfigDefaults();

async function configure(configs: (typeof gameConfigTable.$inferSelect)[]) {
  for (const config of configs) {
    const { id: _id, updatedBy: _updatedBy, ...fields } = config;
    await db.insert(gameConfigTable).values({ ...fields, updatedBy: null })
      .onConflictDoUpdate({ target: gameConfigTable.gameCode, set: { ...fields, updatedBy: null } });
  }
  invalidateConfigCache();
}
await configure(workerData.configs);
const sessions = new Map<string, DemoSession>();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "64kb" }));
app.use(async (req, res, next) => {
  if (req.headers["x-demo-worker-key"] !== workerData.secret) {
    res.sendStatus(403); return;
  }
  const token = req.headers["x-demo-token"];
  const session = typeof token === "string" ? sessions.get(token) : undefined;
  if (!session || session.expiresAt <= Date.now()) {
    res.status(401).json({ error: { code: "DEMO_EXPIRED", message: "Demo expired. Start a new demo." } }); return;
  }
  if (!demoRouteAllowed(req.method, req.path)) { res.sendStatus(403); return; }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, session.id));
  const [auth] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, session.token));
  if (!user || !auth) { res.sendStatus(401); return; }
  req.user = user;
  req.session = auth;
  next();
});
app.use("/api", gameplayRouter);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
// Only the authenticated parent proxy may upgrade a connection.
server.on("upgrade", (req, socket) => {
  if (req.headers["x-demo-worker-key"] !== workerData.secret) socket.destroy();
});
attachRealtime(server);

async function discard(session: DemoSession) {
  sessions.delete(session.token);
  await db.delete(tableRoundsTable).where(sql`${tableRoundsTable.config}->>'owner' = ${session.id}`);
  await db.delete(usersTable).where(eq(usersTable.id, session.id));
}

parentPort.on("message", async (message) => {
  try {
    if (message.action === "register") {
      const session: DemoSession = message.session;
      if (session.expiresAt <= Date.now()) throw new Error("Expired session");
      const publicUser = demoPublicUser(session);
      await db.insert(usersTable).values({ id: session.id,
        email: `demo_${session.id}@demo.lunar.local`,
        emailNormalized: `demo_${session.id}@demo.lunar.local`,
        passwordHash: "!anonymous-no-password", displayName: publicUser.displayName,
        role: "player", channel: "b2c", createdAt: new Date(session.createdAt) });
      await db.insert(sessionsTable).values({ id: session.token, userId: session.id,
        expiresAt: new Date(session.expiresAt), ip: null, userAgent: null });
      sessions.set(session.token, session);
    } else if (message.action === "remove") {
      const session = sessions.get(message.token);
      if (session) await discard(session);
    } else if (message.action === "configure") {
      await configure(message.configs);
    }
    parentPort!.postMessage({ reply: message.requestId, ok: true });
  } catch {
    // Never send SQL, seeds, cookies or session details to the main logger.
    parentPort!.postMessage({ reply: message.requestId, ok: false });
  }
});

let sweeping = false;
let lastHistorySweep = 0;
setInterval(async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const session of sessions.values())
      if (session.expiresAt <= Date.now()) await discard(session);
    if (Date.now() - lastHistorySweep > 60_000) {
      // Shared worlds also stay bounded when there are visitors around the clock.
      const cutoff = Date.now() - 3_600_000;
      await db.delete(tableRoundsTable).where(lt(tableRoundsTable.settleEndsAt, new Date(cutoff)));
      await memory.query('DELETE FROM virtual_sports_rounds WHERE settled = true AND starts < $1', [cutoff]);
      await memory.query('DELETE FROM wingo_rounds WHERE settled = true AND ends < $1', [cutoff]);
      await memory.query("DELETE FROM lottery_draws WHERE status = 'settled' AND ends < $1", [cutoff]);
      await memory.query("DELETE FROM prize_draws WHERE status = 'settled' AND ends < $1", [cutoff]);
      await memory.query('DELETE FROM dragon_tiger_rounds WHERE settled_at IS NOT NULL AND ends_at < $1', [new Date(cutoff)]);
      await memory.query('DELETE FROM dragon_tiger_one_day_rounds WHERE settled_at IS NOT NULL AND ends_at < $1', [new Date(cutoff)]);
      await memory.query('DELETE FROM audit_log WHERE actor_id IS NULL AND created_at < $1', [new Date(cutoff)]);
      lastHistorySweep = Date.now();
    }
  } catch {
    // Retry teardown on the next tick, without retaining error/game payloads.
  } finally { sweeping = false; }
}, 1000).unref();

startGameEngines();
await new Promise<void>((resolve) => server.listening ? resolve() : server.once("listening", resolve));
const address = server.address();
parentPort.postMessage({ ready: true, port: typeof address === "object" && address ? address.port : 0 });
