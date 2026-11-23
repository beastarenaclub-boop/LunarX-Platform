import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";

test(
  "branch panel password resets follow the hierarchy and need the operator's own password",
  { skip: !process.env.NETWORK_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"),
    );
    const { db, pool, usersTable } = await import("@workspace/db");
    const { hashPassword } = await import("../../lib/password");
    const { createSession } = await import("../auth");
    const { default: app } = await import("../../app");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const prefix = `pwreset-${Date.now()}`;
    const password = "Network@Test123";

    type Client = { host: string; cookie?: string };
    type Result = { id: string; username: string; revokedSessions: number };
    async function call(
      client: Client,
      path: string,
      body?: unknown,
      expected = 200,
      confirm?: string,
    ): Promise<Result> {
      const response = await new Promise<{ status: number; body: string; cookie?: string }>(
        (resolve, reject) => {
          const outgoing = request(
            {
              hostname: "127.0.0.1",
              port,
              path: `/api${path}`,
              method: body === undefined ? "GET" : "POST",
              headers: {
                host: client.host,
                origin: `http://${client.host}`,
                "content-type": "application/json",
                ...(client.cookie ? { cookie: client.cookie } : {}),
                ...(confirm !== undefined ? { "x-confirm-password": confirm } : {}),
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
      if (response.cookie) client.cookie = response.cookie;
      return JSON.parse(response.body || "{}") as Result;
    }
    const operatorLogin = async (username: string, pass = password, expected = 200) => {
      const client: Client = { host: "localhost:5176" };
      await call(client, "/auth/agent-login", { username, password: pass }, expected);
      return client;
    };
    const playerLogin = async (username: string, pass: string, expected = 200) => {
      const client: Client = { host: "localhost:5202" };
      await call(client, "/auth/login", { username, password: pass }, expected);
      return client;
    };

    try {
      const [admin] = await db
        .insert(usersTable)
        .values({
          email: `${prefix}-admin@example.test`,
          emailNormalized: `${prefix}-admin@example.test`,
          passwordHash: await hashPassword(password),
          role: "admin",
        })
        .returning();
      const session = await createSession(admin!.id, null, null);
      const company: Client = { host: "localhost:5175", cookie: `sid=${session.id}` };

      const node = (client: Client, name: string) =>
        call(client, "/network/nodes", { name, password, shareBps: 5000 }, 201);
      const masterA = await node(company, "Reset Branch A");
      const masterB = await node(company, "Reset Branch B");
      const masterAClient = await operatorLogin(masterA.username);
      const masterBClient = await operatorLogin(masterB.username);
      const agentA = await node(masterAClient, "Reset Agent A");
      const agentB = await node(masterBClient, "Reset Agent B");
      let agentAClient = await operatorLogin(agentA.username);
      const agentBClient = await operatorLogin(agentB.username);
      const player = (client: Client, name: string) =>
        call(client, "/network/players", { name, password }, 201);
      const playerA = await player(agentAClient, "Reset Player A");
      const playerB = await player(agentBClient, "Reset Player B");

      // The operator must confirm with their own current password.
      await call(company, `/network/nodes/${masterB.id}/password`, { password: "MasterNew2026x" }, 403);
      await call(company, `/network/nodes/${masterB.id}/password`, { password: "MasterNew2026x" }, 403, "wrong-password");

      // Agents cannot reset branches; masters only their own agents.
      await call(agentAClient, `/network/nodes/${masterA.id}/password`, { password: "Whatever2026x" }, 403, password);
      await call(masterAClient, `/network/nodes/${agentB.id}/password`, { password: "Whatever2026x" }, 403, password);
      await call(masterAClient, `/network/nodes/${masterA.id}/password`, { password: "Whatever2026x" }, 403, password);

      // Password rules still apply.
      await call(masterAClient, `/network/nodes/${agentA.id}/password`, { password: "short1" }, 400, password);
      await call(masterAClient, `/network/nodes/${agentA.id}/password`, { password: "onlyletterslong" }, 400, password);

      // Master resets its agent: old password and old sessions stop working.
      const agentReset = await call(
        masterAClient,
        `/network/nodes/${agentA.id}/password`,
        { password: "AgentNew2026x" },
        200,
        password,
      );
      assert.equal(agentReset.username, agentA.username);
      assert.ok(agentReset.revokedSessions >= 1);
      await call(agentAClient, "/network/context", undefined, 401);
      await operatorLogin(agentA.username, password, 401);
      agentAClient = await operatorLogin(agentA.username, "AgentNew2026x");

      // Agents reset only their own users; the agent confirms with its new password.
      await call(agentAClient, `/network/players/${playerB.id}/password`, { password: "PlayerNew1x" }, 403, "AgentNew2026x");
      const playerReset = await call(
        agentAClient,
        `/network/players/${playerA.id}/password`,
        { password: "PlayerNew1x" },
        200,
        "AgentNew2026x",
      );
      assert.equal(playerReset.username, playerA.username);
      await playerLogin(playerA.username, password, 401);
      await playerLogin(playerA.username, "PlayerNew1x");

      // Masters reset users under their own agents only.
      await call(masterAClient, `/network/players/${playerB.id}/password`, { password: "PlayerNew2x" }, 403, password);
      await call(masterAClient, `/network/players/${playerA.id}/password`, { password: "PlayerNew2x" }, 200, password);
      await playerLogin(playerA.username, "PlayerNew2x");

      // Admin resets any master and any user.
      await call(company, `/network/nodes/${masterB.id}/password`, { password: "MasterNew2026x" }, 200, password);
      await call(masterBClient, "/network/context", undefined, 401);
      await operatorLogin(masterB.username, "MasterNew2026x");
      await call(company, `/network/players/${playerB.id}/password`, { password: "PlayerNew3x" }, 200, password);
      await playerLogin(playerB.username, "PlayerNew3x");

      // Admin accounts cannot be reached through the branch routes.
      await call(company, `/network/players/${admin!.id}/password`, { password: "AdminNew2026x" }, 404, password);
    } finally {
      server.close();
      await pool.end();
    }
  },
);
