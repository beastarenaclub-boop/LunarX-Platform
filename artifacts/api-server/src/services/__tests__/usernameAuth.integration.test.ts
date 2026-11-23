import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

test(
  "players sign up with a name-based username (5 letters + 3 digits) and log in with it",
  { skip: !process.env.NETWORK_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"),
    );
    const { db, pool, usersTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { hashPassword } = await import("../../lib/password");
    const { resetLoginThrottle } = await import("../loginThrottle");
    const { findUserByLogin, generateUsername, usernamePrefix } = await import("../auth");
    const { default: app } = await import("../../app");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const host = "localhost:5200";
    const password = "Crypto@Test123";

    async function call(
      path: string,
      body?: unknown,
      expected = 200,
      cookie?: string,
    ) {
      const response = await new Promise<{ status: number; body: string; cookie?: string }>(
        (resolve, reject) => {
          const outgoing = request(
            {
              hostname: "127.0.0.1",
              port,
              path: `/api${path}`,
              method: body === undefined ? "GET" : "POST",
              headers: {
                host,
                origin: `http://${host}`,
                "content-type": "application/json",
                ...(cookie ? { cookie } : {}),
              },
            },
            (incoming) => {
              let text = "";
              incoming.setEncoding("utf8");
              incoming.on("data", (c) => (text += c));
              incoming.on("end", () =>
                resolve({
                  status: incoming.statusCode!,
                  body: text,
                  cookie: incoming.headers["set-cookie"]?.[0]?.split(";")[0],
                }),
              );
            },
          );
          outgoing.on("error", reject);
          outgoing.end(body === undefined ? undefined : JSON.stringify(body));
        },
      );
      assert.equal(response.status, expected, `${path}: ${response.body}`);
      return { json: response.body ? JSON.parse(response.body) : null, cookie: response.cookie };
    }

    try {
      resetLoginThrottle();
      // Signup: no email; the username is the first 5 letters of the name
      // + 3 random digits.
      const signup = await call("/auth/signup", { password, displayName: "Test Player" });
      const username: string = signup.json.username;
      assert.match(username, /^testp\d{3}$/);
      assert.equal(signup.json.user.username, username);

      // Short names use all their letters; accents are dropped; names without
      // Latin letters (or no name) fall back to "cry". Checked directly so the
      // per-IP auth limiter budget (20 requests) is left for the flow below.
      assert.equal(usernamePrefix("Raj"), "raj");
      assert.equal(usernamePrefix("  José  Kumar"), "josek");
      assert.equal(usernamePrefix("राहुल"), "cry");
      assert.equal(usernamePrefix(null), "cry");
      assert.match(await generateUsername("Raj"), /^raj\d{3}$/);

      // Weak passwords are refused.
      await call("/auth/signup", { password: "password" }, 400);
      await call("/auth/signup", { password: "12345678" }, 400);

      // Login with the username (case-insensitive), not an email.
      const login = await call("/auth/login", { username: username.toUpperCase(), password });
      assert.equal(login.json.user.username, username);
      assert.ok(login.cookie);
      const me = await call("/auth/me", undefined, 200, login.cookie);
      assert.equal(me.json.username, username);

      // Wrong password and unknown usernames give the same generic error.
      const wrong = await call("/auth/login", { username, password: "Wrong@Pass123" }, 401);
      const unknown = await call("/auth/login", { username: "zzzzz0000x", password }, 401);
      assert.equal(wrong.json.error.message, unknown.json.error.message);

      // Per-account lockout after repeated failures (password spraying).
      resetLoginThrottle();
      for (let i = 0; i < 8; i++)
        await call("/auth/login", { username, password: `Wrong@Pass${i}x` }, 401);
      await call("/auth/login", { username, password }, 429);
      resetLoginThrottle();
      await call("/auth/login", { username, password });

      // Legacy players created with an email keep working with that email.
      const legacyEmail = `legacy-${Date.now()}@example.test`;
      await db.insert(usersTable).values({
        email: legacyEmail,
        emailNormalized: legacyEmail,
        username: null,
        passwordHash: await hashPassword(password),
        role: "player",
        channel: "b2c",
      });
      await call("/auth/login", { email: legacyEmail, password });
      await call("/auth/login", { username: legacyEmail, password });

      // Older "cry" + 4-digit usernames still resolve at login.
      let legacyUsername = "";
      for (let n = 0; n < 10000 && !legacyUsername; n++) {
        const candidate = `cry${String(n).padStart(4, "0")}`;
        const [taken] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.username, candidate));
        if (!taken) legacyUsername = candidate;
      }
      const [legacyUser] = await db
        .insert(usersTable)
        .values({
          email: legacyUsername,
          emailNormalized: legacyUsername,
          username: legacyUsername,
          passwordHash: await hashPassword(password),
          role: "player",
          channel: "b2c",
        })
        .returning();
      assert.equal((await findUserByLogin(legacyUsername.toUpperCase()))?.id, legacyUser!.id);

      // Reset tokens are only exposed on development/test servers.
      const reset = await call("/auth/password-reset/request", { username });
      assert.equal(typeof reset.json.token, "string");

      const [row] = await db.select().from(usersTable).where(eq(usersTable.username, username));
      assert.equal(row!.email, username);
      assert.equal(row!.emailNormalized, username);
    } finally {
      server.close();
      await pool.end();
    }
  },
);
