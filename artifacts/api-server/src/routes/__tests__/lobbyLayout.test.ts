import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import express from "express";
import { db, usersTable, auditLogTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { ready, memory } from "../../demo/database";
import router from "../lobbyLayout";
import { csrfProtect } from "../../middlewares/csrf";
import { errorHandler } from "../../middlewares/error";
import {
  applyLobbyLayout,
  completeLobbyLayout,
  defaultLobbyLayout,
  moveLobbyGame,
  saveLobbyLayoutSchema,
} from "@workspace/api-zod/lobby-layout";
import { LOBBY_ENTRIES } from "@workspace/api-zod/lobby-catalog";

const app = express();
app.use(express.json());
// Only this isolated test server supplies an identity. The route's real role
// middleware and global CSRF middleware run unchanged.
app.use((req, _res, next) => {
  const role = req.get("x-test-role");
  if (role) {
    req.user = { id: "layout-admin", role } as typeof req.user;
    req.cookies = { sid: "isolated-test-session" };
  }
  next();
});
app.use(csrfProtect);
app.use("/api", router);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
let origin: string;
before(async () => {
  await ready;
  // Execute the real additive migration; the existing demo schema intentionally
  // does not need regeneration for this test.
  await memory.exec(
    await readFile("../../lib/db/drizzle/0070_lobby_layout.sql", "utf8"),
  );
  await db
    .insert(usersTable)
    .values({
      id: "layout-admin",
      email: "layout@example.test",
      emailNormalized: "layout@example.test",
      passwordHash: "unused-test-password-hash",
      role: "admin",
    });
  if (!server.listening) await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await memory.close();
});
async function request(
  path: string,
  role?: string,
  body?: unknown,
  requestOrigin?: string,
) {
  const result = await fetch(origin + path, {
    method: body ? "PUT" : "GET",
    headers: {
      origin: requestOrigin ?? origin,
      "content-type": "application/json",
      ...(role ? { "x-test-role": role } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: result.status,
    data: (await result.json()) as any,
    headers: result.headers,
  };
}

test("ordering preserves every game, independently across sections, and saved badges do not override availability", () => {
  const layout = defaultLobbyLayout();
  const original = [...layout.orders.casino];
  layout.orders.casino = moveLobbyGame(original, "dice", 1);
  layout.games.dice = { label: "HOT", tags: ["favourite"] };
  const rendered = applyLobbyLayout(
    LOBBY_ENTRIES.map((game) => ({ ...game, enabled: game.id !== "dice" })),
    layout,
    "casino",
  );
  assert.equal(rendered[0]!.id, "dice");
  assert.equal(rendered[0]!.label, "HOT");
  assert.equal(rendered[0]!.enabled, false);
  assert.equal(
    new Set(rendered.map((game) => game.id)).size,
    LOBBY_ENTRIES.length,
  );
  assert.notEqual(layout.orders.home[0], "dice");
  assert.deepEqual(
    completeLobbyLayout({
      ...layout,
      orders: { ...layout.orders, casino: ["dice"] },
    }).orders.casino[0],
    "dice",
  );
  assert.equal(
    completeLobbyLayout({
      ...layout,
      orders: { ...layout.orders, casino: ["dice"] },
    }).orders.casino.length,
    LOBBY_ENTRIES.length,
  );
  assert.deepEqual(original, defaultLobbyLayout().orders.casino);
});
test("invalid, duplicate and unknown game IDs and oversized badges are rejected", () => {
  for (const change of [
    (layout: ReturnType<typeof defaultLobbyLayout>) =>
      layout.orders.home.push(layout.orders.home[0]!),
    (layout: ReturnType<typeof defaultLobbyLayout>) =>
      layout.orders.home.push("unknown-game"),
    (layout: ReturnType<typeof defaultLobbyLayout>) => {
      layout.games.dice!.label = "x".repeat(21);
    },
    (layout: ReturnType<typeof defaultLobbyLayout>) => {
      layout.games.dice!.label = "<script>";
    },
  ]) {
    const layout = defaultLobbyLayout();
    change(layout);
    assert.equal(
      saveLobbyLayoutSchema.safeParse({ revision: 0, layout }).success,
      false,
    );
  }
});
test("public reads work; only admins can edit; cross-site writes and malformed payloads are rejected", async () => {
  const body = { revision: 0, layout: defaultLobbyLayout() };
  assert.equal((await request("/api/lobby/layout")).status, 200);
  for (const role of [undefined, "player", "agent", "support"]) {
    assert.equal(
      (await request("/api/admin/lobby-layout", role)).status,
      role ? 403 : 401,
    );
    assert.equal(
      (await request("/api/admin/lobby-layout", role, body)).status,
      role ? 403 : 401,
    );
  }
  assert.equal(
    (
      await request(
        "/api/admin/lobby-layout",
        "admin",
        body,
        "https://untrusted.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/lobby-layout", "admin", {
        ...body,
        revision: -1,
      })
    ).status,
    400,
  );
});
test("saving persists order, badges, featured games and tags, audits once, and rejects stale revisions", async () => {
  const layout = defaultLobbyLayout();
  layout.orders.home = moveLobbyGame(layout.orders.home, "dice", 1);
  layout.orders.casino = moveLobbyGame(layout.orders.casino, "plinko", 1);
  layout.featured = ["dice"];
  layout.games.dice = { label: "HOT", tags: ["Featured", "featured"] };
  layout.games.lunar = { label: "", tags: [] };
  const saved = await request("/api/admin/lobby-layout", "admin", {
    revision: 0,
    layout,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  assert.equal(saved.data.revision, 1);
  const published = await request("/api/lobby/layout");
  assert.deepEqual(published.data, saved.data);
  assert.equal(published.data.layout.orders.home[0], "dice");
  assert.equal(published.data.layout.orders.casino[0], "plinko");
  assert.deepEqual(published.data.layout.games.dice.tags, ["featured"]);
  assert.equal(published.data.layout.games.lunar.label, "");
  assert.equal(published.headers.get("cache-control"), "no-store");
  assert.equal(
    (
      await request("/api/admin/lobby-layout", "super_admin", {
        revision: 0,
        layout,
      })
    ).status,
    409,
  );
  const audits = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.action, "lobby_layout.update"));
  assert.equal(audits.length, 1);
  assert.equal((await request("/api/lobby/layout")).data.revision, 1);
});
