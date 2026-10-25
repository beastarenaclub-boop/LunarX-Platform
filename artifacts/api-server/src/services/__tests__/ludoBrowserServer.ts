/** Local, disposable PostgreSQL fixture exercising real cookies, HTTP, WS and game services. */
import { ready } from "./ludoPostgresStore";
import express from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db, usersTable, ludoMatches } from "@workspace/db";
import { createSession } from "../auth";
import { postEntry, getBalanceByUser } from "../wallet";
import { loadSession } from "../../middlewares/auth";
import { errorHandler } from "../../middlewares/error";
import { attachRealtime } from "../../realtime/gateway";
import { startLudoEngine, tickLudo } from "../ludo";
import { commitment, ludoDie } from "../ludoRules";
import ludoRouter from "../../routes/ludo";
import type { LudoState } from "@workspace/api-zod/ludo";
await ready;
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(loadSession);
app.get("/api/healthz", (_req, res) => res.json({ ok: true }));
app.get("/api/network/website", (_req, res) => res.json(null));
app.post("/api/test/ludo/login", async (req, res) => {
  const id = randomUUID();
  await db.insert(usersTable).values({
    id,
    email: `${id}@test.invalid`,
    emailNormalized: `${id}@test.invalid`,
    passwordHash: "fixture-no-password",
    displayName: String(req.body.name || "Player").slice(0, 24),
  });
  await postEntry({ userId: id, type: "adjustment", amount: 100000n });
  const s = await createSession(id, null, "ludo-test");
  res.cookie("sid", s.id, { httpOnly: true, sameSite: "lax" });
  res.json({ id });
});
app.get("/api/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: { message: "Sign in" } });
    return;
  }
  const { id, displayName, role, email, channel, status, createdAt } = req.user;
  res.json({
    id,
    displayName,
    role,
    email,
    channel,
    status,
    createdAt,
    isDemo: false,
  });
});
app.get("/api/wallet/balance", async (req, res) => {
  if (!req.user) {
    res.sendStatus(401);
    return;
  }
  const w = await getBalanceByUser(req.user.id);
  res.json({ balance: String(w.balance), currency: "INR", scope: "lunar" });
});
app.post("/api/test/ludo/advance", async (req, res) => {
  const id = String(req.body.id);
  await db
    .update(ludoMatches)
    .set({ deadline: sql`clock_timestamp() - interval '1 second'` })
    .where(eq(ludoMatches.id, id));
  await tickLudo();
  res.json({ ok: true });
});
app.post("/api/test/ludo/winning-move", async (req, res) => {
  const id = String(req.body.id),
    [r] = await db.select().from(ludoMatches).where(eq(ludoMatches.id, id));
  const s = r.state as LudoState;
  s.turn = Number(req.body.seat);
  s.phase = "move";
  s.dice = 1;
  s.players[s.turn]!.tokens = [56, 56, 56, 55];
  await db
    .update(ludoMatches)
    .set({
      state: s,
      version: r.version + 1,
      deadline: sql`clock_timestamp() + interval '25 seconds'`,
    })
    .where(eq(ludoMatches.id, id));
  res.json({ ok: true });
});
// Isolated fixture only: exercise all six real server outcomes through /action.
app.post("/api/test/ludo/roll-ready", async (req, res) => {
  const id = String(req.body.id),
    seat = Number(req.body.seat),
    face = Number(req.body.face);
  const [r] = await db.select().from(ludoMatches).where(eq(ludoMatches.id, id));
  if (
    !r ||
    ![1, 2, 3, 4, 5, 6].includes(face) ||
    seat < 0 ||
    seat >= r.capacity
  ) {
    res.sendStatus(400);
    return;
  }
  const s = r.state as LudoState;
  s.turn = seat;
  s.phase = "roll";
  s.dice = null;
  s.sixes = 0;
  s.last = null;
  s.players[seat]!.tokens = [0, -1, -1, -1];
  let seed: string;
  do {
    seed = randomUUID();
  } while (ludoDie(seed, id, s.rollNonce) !== face);
  await db
    .update(ludoMatches)
    .set({
      state: s,
      seed,
      commitment: commitment(seed),
      version: r.version + 1,
      deadline: sql`clock_timestamp() + interval '25 seconds'`,
    })
    .where(eq(ludoMatches.id, id));
  res.json({ ok: true, version: r.version + 1 });
});
app.use("/api/ludo", ludoRouter);
app.use(errorHandler);
const server = app.listen(5214, "127.0.0.1", () =>
  console.log("Ludo isolated browser server ready on 5214"),
);
attachRealtime(server);
startLudoEngine();
