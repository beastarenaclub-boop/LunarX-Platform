import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";

test(
  "master manual QR: ownership, recipient snapshots, duplicate UTR, funded atomic approval and admin parity",
  { skip: !process.env.NETWORK_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"),
    );
    const {
      db,
      pool,
      usersTable,
      networkNodesTable,
      paymentRequestsTable,
      auditLogTable,
      walletLedgerTable,
    } = await import("@workspace/db");
    const { eq, and, sql } = await import("drizzle-orm");
    const { createSession } = await import("../auth");
    const { postEntry, getBalanceByUser } = await import("../wallet");
    const { default: app } = await import("../../app");
    const prefix = `qr-${randomUUID()}`;
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    type Client = { host: string; cookie: string };
    async function user(
      name: string,
      role: "admin" | "agent" | "player",
      agentId?: string,
    ) {
      const email = `${prefix}-${name}@example.test`;
      const [row] = await db
        .insert(usersTable)
        .values({
          email,
          emailNormalized: email,
          passwordHash: "test-no-login",
          role,
          channel: agentId ? "b2b" : "b2c",
          b2bAgentId: agentId,
        })
        .returning();
      const session = await createSession(row!.id, null, null);
      return {
        user: row!,
        client: {
          host:
            role === "admin"
              ? "localhost:5175"
              : role === "agent"
                ? "localhost:5176"
                : agentId
                  ? "localhost:5202"
                  : "localhost:5200",
          cookie: `${role === "agent" ? "sid_operator" : agentId ? "sid_b2b" : "sid"}=${session.id}`,
        },
      };
    }
    async function call(
      client: Client,
      path: string,
      body?: unknown,
      method = "POST",
      expected = 200,
    ) {
      const result = await new Promise<{
        status: number;
        body: string;
        cache?: string;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path: `/api${path}`,
            method: body === undefined ? "GET" : method,
            headers: {
              host: client.host,
              origin: `http://${client.host}`,
              cookie: client.cookie,
              "content-type": "application/json",
            },
          },
          (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk) => (body += chunk));
            res.on("end", () =>
              resolve({
                status: res.statusCode!,
                body,
                cache: res.headers["cache-control"],
              }),
            );
          },
        );
        req.on("error", reject);
        req.end(body === undefined ? undefined : JSON.stringify(body));
      });
      assert.equal(result.status, expected, `${path}: ${result.body}`);
      return JSON.parse(result.body);
    }
    try {
      const admin = await user("admin", "admin");
      async function branch(name: string) {
        const master = await user(`${name}-master`, "agent");
        const [node] = await db
          .insert(networkNodesTable)
          .values({
            userId: master.user.id,
            kind: "master",
            name,
            createdBy: admin.user.id,
          })
          .returning();
        const agent = await user(`${name}-agent`, "agent");
        const [agentNode] = await db
          .insert(networkNodesTable)
          .values({
            userId: agent.user.id,
            kind: "agent",
            name: `${name} agent`,
            parentId: node!.id,
            createdBy: master.user.id,
          })
          .returning();
        const player = await user(`${name}-player`, "player", agentNode!.id);
        return { master, agent, player, id: node!.id };
      }
      const a = await branch("A"),
        b = await branch("B"),
        b2c = await user("public", "player");
      const path = (id: string) => `/network/manual-payments/${id}`;
      const settings = {
        label: "A receiver",
        upiId: "master.a@upi",
        qrData: null,
        active: true,
      };
      assert.deepEqual(
        await call(a.player.client, "/payments/upi-accounts"),
        [],
      );
      await call(a.agent.client, path(a.id), settings, "PUT", 403);
      await call(b.master.client, path(a.id), settings, "PUT", 403);
      await call(a.player.client, path(a.id), settings, "PUT", 403);
      await call(
        a.master.client,
        path(a.id),
        { ...settings, qrData: "data:image/svg+xml;base64,PHN2Zy8+" },
        "PUT",
        400,
      );
      const png =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=";
      const account = await call(
        a.master.client,
        path(a.id),
        { ...settings, qrData: png },
        "PUT",
      );
      const bAccount = await call(
        b.master.client,
        path(b.id),
        { ...settings, upiId: "master.b@upi" },
        "PUT",
      );
      const publicAccounts = await call(
        a.player.client,
        "/payments/upi-accounts",
      );
      assert.equal(publicAccounts.length, 1);
      assert.equal(publicAccounts[0].id, a.id);
      assert.equal(publicAccounts[0].qrUrl, png);
      assert.ok(
        !(await call(b2c.client, "/payments/upi-accounts")).some(
          (x: { id: string }) => x.id === a.id,
        ),
      );
      await call(b.master.client, path(a.id), undefined, "GET", 403);
      await call(
        a.agent.client,
        `${path(a.id)}/deposits`,
        undefined,
        "GET",
        403,
      );
      const depositBody = {
        amount: "20000",
        upiRef: "123456789012",
        accountId: a.id,
        accountVersion: account.version,
      };
      await call(
        a.player.client,
        "/payments/deposits",
        { ...depositBody, accountId: b.id, accountVersion: bAccount.version },
        "POST",
        409,
      );
      await call(
        a.player.client,
        "/payments/deposits",
        { amount: "20000", upiRef: "123456789012" },
        "POST",
        409,
      );
      await call(
        a.player.client,
        "/payments/deposits/auto",
        { amount: "20000" },
        "POST",
        403,
      );
      assert.equal(
        (await call(a.player.client, "/payments/deposit-settings")).autoEnabled,
        false,
      );
      const deposit = await call(
        a.player.client,
        "/payments/deposits",
        depositBody,
      );
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 0n);
      await call(
        a.player.client,
        "/payments/deposits",
        depositBody,
        "POST",
        409,
      );
      const second = await user(
        "another-a-player",
        "player",
        a.player.user.b2bAgentId!,
      );
      await call(second.client, "/payments/deposits", depositBody, "POST", 409);
      const reviewedPath = `${path(a.id)}/deposits/${deposit.id}/decision`;
      await call(
        b.master.client,
        `${path(b.id)}/deposits/${deposit.id}/decision`,
        { decision: "approve" },
        "POST",
        404,
      );
      await call(
        a.agent.client,
        reviewedPath,
        { decision: "approve" },
        "POST",
        403,
      );
      await call(
        a.master.client,
        reviewedPath,
        { decision: "approve" },
        "POST",
        400,
      );
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 0n);
      assert.equal(
        (
          await db
            .select()
            .from(paymentRequestsTable)
            .where(eq(paymentRequestsTable.id, deposit.id))
        )[0]!.status,
        "pending",
      );
      await postEntry({
        userId: a.master.user.id,
        type: "adjustment",
        amount: 100000n,
        refType: "manual_qr_test",
      });
      const updated = await call(
        a.master.client,
        path(a.id),
        { ...settings, upiId: "master.changed@upi" },
        "PUT",
      );
      await call(
        a.player.client,
        "/payments/deposits",
        { ...depositBody, upiRef: "123456789013" },
        "POST",
        409,
      );
      const pending = await call(a.master.client, `${path(a.id)}/deposits`);
      assert.equal(pending.items[0].upiId, "master.a@upi");
      const concurrent = await Promise.allSettled([
        call(a.master.client, reviewedPath, { decision: "approve" }),
        call(admin.client, `/admin/deposits/${deposit.id}/decision`, {
          decision: "approve",
        }),
      ]);
      assert.equal(
        concurrent.filter((r) => r.status === "fulfilled").length,
        1,
      );
      const failed = concurrent.find(
        (r) => r.status === "rejected",
      ) as PromiseRejectedResult;
      assert.match(failed.reason.message, /already been reviewed/);
      assert.equal((await getBalanceByUser(a.master.user.id)).balance, 80000n);
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 20000n);
      assert.equal(
        (
          await db
            .select()
            .from(walletLedgerTable)
            .where(
              and(
                eq(walletLedgerTable.refId, deposit.id),
                eq(walletLedgerTable.refType, "deposit"),
              ),
            )
        ).length,
        1,
      );
      assert.equal(
        (
          await db
            .select()
            .from(auditLogTable)
            .where(
              and(
                eq(auditLogTable.targetId, deposit.id),
                eq(auditLogTable.action, "network.deposit.approve"),
              ),
            )
        ).length,
        1,
      );
      const reject = await call(a.player.client, "/payments/deposits", {
        ...depositBody,
        accountVersion: updated.version,
        upiRef: "123456789014",
      });
      await call(
        a.master.client,
        `${path(a.id)}/deposits/${reject.id}/decision`,
        { decision: "reject" },
        "POST",
        400,
      );
      await call(
        a.master.client,
        `${path(a.id)}/deposits/${reject.id}/decision`,
        { decision: "reject", reason: "Payment not received" },
      );
      assert.equal((await getBalanceByUser(a.master.user.id)).balance, 80000n);
      const adminDeposit = await call(a.player.client, "/payments/deposits", {
        ...depositBody,
        accountVersion: updated.version,
        upiRef: "123456789015",
      });
      await call(admin.client, `/admin/deposits/${adminDeposit.id}/decision`, {
        decision: "approve",
      });
      assert.equal((await getBalanceByUser(a.master.user.id)).balance, 60000n);
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 40000n);
      const foreignList = await call(b.master.client, `${path(b.id)}/deposits`);
      assert.deepEqual(foreignList.items, []);
      await call(
        a.master.client,
        path(a.id),
        { ...settings, active: false },
        "PUT",
      );
      assert.deepEqual(
        await call(a.player.client, "/payments/upi-accounts"),
        [],
      );
      await call(
        a.player.client,
        "/payments/deposits",
        {
          ...depositBody,
          upiRef: "123456789016",
          accountVersion: updated.version,
        },
        "POST",
        400,
      );
      // An unconfigured branch cannot fall through to a platform collector.
      const c = await branch("C");
      await call(
        c.player.client,
        "/payments/deposits",
        { ...depositBody, accountId: c.id },
        "POST",
        400,
      );
      await db.execute(
        sql`UPDATE network_nodes SET status='suspended' WHERE id=${a.id}`,
      );
      await call(
        a.player.client,
        "/payments/upi-accounts",
        undefined,
        "GET",
        401,
      );
      await call(a.master.client, path(a.id), undefined, "GET", 401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
    }
  },
);
