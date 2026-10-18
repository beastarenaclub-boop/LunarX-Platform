import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";
import { deviceDetails, normalizeIp } from "../accountDevice";

test("device descriptions preserve unknown models and distinguish browser families", () => {
  assert.equal(normalizeIp("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(normalizeIp("1.2.3.4, 8.8.8.8"), null);
  const reduced =
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36";
  assert.equal(deviceDetails(reduced).model, null);
  assert.equal(deviceDetails(reduced).browser, "Chrome");
  assert.equal(
    deviceDetails(reduced, {
      model: '"Pixel 9"',
      platform: '"Android"',
      platformVersion: '"15.0.0"',
    }).model,
    "Pixel 9",
  );
  assert.equal(deviceDetails(reduced + " EdgA/131.0").browser, "Edge");
  assert.equal(
    deviceDetails(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1",
    ).osVersion,
    "18.1",
  );
  assert.equal(deviceDetails(null).type, "unknown");
});

test(
  "account controls enforce privileges, revoke credentials, audit previews and protect session secrets",
  { skip: !process.env.NETWORK_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"),
    );
    const {
      db,
      pool,
      usersTable,
      sessionsTable,
      passwordResetsTable,
      auditLogTable,
    } = await import("@workspace/db");
    const { eq, and, sql } = await import("drizzle-orm");
    const { createSession } = await import("../auth");
    const { hashPassword, verifyPassword } = await import("../../lib/password");
    const { default: app } = await import("../../app");
    const prefix = "security-" + randomUUID(),
      original = "Original@Test1234",
      changed = "Changed@Test5678",
      hash = await hashPassword(original);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    async function user(
      name: string,
      role: "admin" | "super_admin" | "support" | "agent" | "player",
    ) {
      const email = `${prefix}-${name}@example.test`;
      const [u] = await db
        .insert(usersTable)
        .values({
          email,
          emailNormalized: email,
          passwordHash: hash,
          role,
          channel: "b2c",
        })
        .returning();
      const session = await createSession(
        u!.id,
        "203.0.113.10",
        "Legacy Browser",
      );
      return { user: u!, session };
    }
    type Client = Awaited<ReturnType<typeof user>>;
    async function call(
      client: Client | null,
      path: string,
      body?: unknown,
      confirmation?: string,
      expected = 200,
      extraHeaders: Record<string, string> = {},
    ) {
      const result = await new Promise<{
        status: number;
        body: string;
        headers: Record<string, unknown>;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api" + path,
            method: body === undefined ? "GET" : "POST",
            headers: {
              host: "localhost:5175",
              origin: "http://localhost:5175",
              "content-type": "application/json",
              ...(client ? { cookie: `sid=${client.session.id}` } : {}),
              ...(confirmation ? { "x-confirm-password": confirmation } : {}),
              ...extraHeaders,
            },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (v) => (text += v));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                body: text,
                headers: res.headers,
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
      assert.equal(result.status, expected, `${path}: ${result.body}`);
      return { ...result, json: JSON.parse(result.body) };
    }
    try {
      const admin = await user("admin", "admin"),
        superAdmin = await user("super", "super_admin"),
        otherAdmin = await user("other-admin", "admin"),
        support = await user("support", "support"),
        agent = await user("agent", "agent"),
        player = await user("player", "player");
      const path = `/admin/users/${player.user.id}/password`,
        input = { newPassword: changed, reason: "Requested account recovery" };
      for (const actor of [support, agent, player])
        await call(actor, path, input, original, 403);
      await call(null, path, input, undefined, 401);
      await call(admin, path, input, undefined, 403);
      await call(admin, path, input, "incorrect", 403);
      await call(
        admin,
        path,
        { ...input, newPassword: "short" },
        original,
        400,
      );
      await call(
        admin,
        path,
        { ...input, newPassword: "🙂".repeat(30) },
        original,
        400,
      );
      await call(
        admin,
        `/admin/users/${superAdmin.user.id}/password`,
        input,
        original,
        403,
      );
      await call(
        admin,
        `/admin/users/${otherAdmin.user.id}/password`,
        input,
        original,
        403,
      );
      await call(support, `/admin/users/${player.user.id}`); // Existing support read access remains intact.
      const countSessions = async () =>
        Number(
          (
            await db.execute(
              sql`SELECT count(*) AS n FROM sessions WHERE user_id=${player.user.id}`,
            )
          ).rows[0]!.n,
        );
      const beforeCount = await countSessions();
      const preview = await call(
        admin,
        `/admin/users/${player.user.id}/support-view`,
        { reason: "Review a customer support request" },
        original,
      );
      assert.equal(preview.json.mode, "read_only");
      assert.equal(preview.json.user.id, player.user.id);
      assert.equal(preview.headers["set-cookie"], undefined);
      assert.equal(await countSessions(), beforeCount);
      assert.equal((await call(admin, "/auth/me")).json.id, admin.user.id);
      assert.ok(!preview.body.includes("passwordHash"));
      const reduced =
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/132.0.0.0 Mobile Safari/537.36";
      await call(player, "/auth/me", undefined, undefined, 200, {
        "x-forwarded-for": "8.8.8.8",
        "user-agent": reduced,
        "sec-ch-ua-model": '"Pixel 9"',
        "sec-ch-ua-platform": '"Android"',
        "sec-ch-ua-platform-version": '"15.0.0"',
      });
      for (let i = 0; i < 30; i++) {
        const [s] = await db
          .select()
          .from(sessionsTable)
          .where(eq(sessionsTable.id, player.session.id));
        if (s?.lastSeenAt) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      const history = await call(
        admin,
        `/admin/access-history?userId=${player.user.id}`,
      );
      assert.equal(history.json.total, 1);
      assert.equal(history.json.items[0].ip, "127.0.0.1");
      assert.equal(history.json.items[0].device.model, "Pixel 9");
      assert.equal(
        history.json.items[0].location.status,
        "database_unavailable",
      );
      assert.ok(!history.body.includes(player.session.id));
      assert.equal(history.headers["cache-control"], "no-store");
      assert.equal(
        (
          await call(
            admin,
            `/admin/access-history?userId=${player.user.id}&status=recent`,
          )
        ).json.total,
        1,
      );
      assert.equal(
        (await call(admin, "/admin/access-history?q=%25")).json.total,
        0,
      );
      for (const actor of [support, agent, player])
        await call(actor, "/admin/access-history", undefined, undefined, 403);
      await call(null, "/admin/access-history", undefined, undefined, 401);
      const [reset] = await db
        .insert(passwordResetsTable)
        .values({
          userId: player.user.id,
          expiresAt: new Date(Date.now() + 3600000),
        })
        .returning();
      const result = await call(admin, path, input, original);
      assert.equal(result.json.revokedSessions, 1);
      assert.equal(result.json.self, false);
      const [updated] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, player.user.id));
      assert(await verifyPassword(changed, updated!.passwordHash));
      assert.equal(
        (
          await db
            .select()
            .from(passwordResetsTable)
            .where(eq(passwordResetsTable.id, reset!.id))
        )[0]!.usedAt !== null,
        true,
      );
      await call(player, "/auth/me", undefined, undefined, 401);
      await call(
        null,
        "/auth/password-reset/confirm",
        { token: reset!.id, password: "StaleToken@Test1234" },
        undefined,
        400,
      );
      await call(
        null,
        "/auth/login",
        { email: player.user.email, password: original },
        undefined,
        401,
      );
      await call(null, "/auth/login", {
        email: player.user.email,
        password: changed,
      });
      const audit = await db
        .select()
        .from(auditLogTable)
        .where(
          and(
            eq(auditLogTable.targetId, player.user.id),
            eq(auditLogTable.action, "account.password_reset"),
          ),
        );
      assert.equal(audit.length, 1);
      assert.equal(audit[0]!.actorId, admin.user.id);
      assert.equal(normalizeIp(audit[0]!.ip), "127.0.0.1");
      for (const secret of [changed, original, hash, player.session.id])
        assert.ok(!JSON.stringify(audit).includes(secret));
      await call(
        superAdmin,
        `/admin/users/${agent.user.id}/password`,
        input,
        original,
      );
      await call(
        superAdmin,
        `/admin/users/${otherAdmin.user.id}/password`,
        input,
        original,
      );
      await call(otherAdmin, "/auth/me", undefined, undefined, 401);
      const self = await call(
        admin,
        `/admin/users/${admin.user.id}/password`,
        input,
        original,
      );
      assert.equal(self.json.self, true);
      await call(admin, "/auth/me", undefined, undefined, 401);
    } finally {
      await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
      await pool.end();
    }
  },
);
