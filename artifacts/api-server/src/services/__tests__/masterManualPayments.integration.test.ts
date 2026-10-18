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
      // No master is opted in automatically, and only admin can assign access.
      assert.equal((await call(a.master.client, "/network/context")).node.manualPaymentsEnabled, false);
      await call(a.master.client, path(a.id), undefined, "GET", 403);
      await call(a.master.client, path(a.id), settings, "PUT", 403);
      await call(a.master.client, `/network/nodes/${a.id}`, { manualPaymentsEnabled: true }, "PATCH", 403);
      await call(a.master.client, `/network/nodes/${a.player.user.b2bAgentId}`, { manualPaymentsEnabled: true }, "PATCH", 403);
      await call(a.agent.client, `/network/nodes/${a.id}`, { manualPaymentsEnabled: true }, "PATCH", 403);
      await call(admin.client, `/network/nodes/${a.player.user.b2bAgentId}`, { manualPaymentsEnabled: true }, "PATCH", 403);
      const newMasterInput = { name: "Assigned master", email: `${prefix}-assigned@example.test`, password: "Permission-test-12345", manualPaymentsEnabled: true };
      await call(a.master.client, "/network/nodes", newMasterInput, "POST", 403);
      assert.equal((await call(admin.client, "/network/nodes", newMasterInput, "POST", 201)).manualPaymentsEnabled, true);
      assert.equal((await call(admin.client, "/network/nodes", { name: "Unassigned master", email: `${prefix}-unassigned@example.test`, password: "Permission-test-12345" }, "POST", 201)).manualPaymentsEnabled, false);
      for (const branch of [a, b]) await call(admin.client, `/network/nodes/${branch.id}`, { manualPaymentsEnabled: true }, "PATCH");
      assert.equal((await call(a.master.client, "/network/context")).node.manualPaymentsEnabled, true);
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
      await postEntry({ userId: a.master.user.id, type: "adjustment", amount: 100000n, refType: "manual_qr_test" });
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
        userId: a.agent.user.id,
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
      assert.equal((await getBalanceByUser(a.agent.user.id)).balance, 80000n);
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
      assert.equal((await getBalanceByUser(a.agent.user.id)).balance, 80000n);
      const adminDeposit = await call(a.player.client, "/payments/deposits", {
        ...depositBody,
        accountVersion: updated.version,
        upiRef: "123456789015",
      });
      await call(admin.client, `/network/nodes/${a.id}`, { manualPaymentsEnabled: false }, "PATCH");
      assert.equal((await call(a.master.client, "/network/context")).node.manualPaymentsEnabled, false);
      assert.equal((await call(b.master.client, "/network/context")).node.manualPaymentsEnabled, true);
      await call(a.master.client, path(a.id), undefined, "GET", 403);
      await call(a.master.client, path(a.id), settings, "PUT", 403);
      await call(a.master.client, `${path(a.id)}/deposits`, undefined, "GET", 403);
      await call(a.master.client, `${path(a.id)}/deposits/${adminDeposit.id}/decision`, { decision: "approve" }, "POST", 403);
      await call(a.master.client, `${path(a.id)}/deposits/${adminDeposit.id}/decision`, { decision: "reject", reason: "Not received" }, "POST", 403);
      assert.deepEqual(await call(a.player.client, "/payments/upi-accounts"), []);
      await call(a.player.client, "/payments/deposits", { ...depositBody, accountVersion: updated.version, upiRef: "123456789099" }, "POST", 403);
      assert.equal((await getBalanceByUser(a.agent.user.id)).balance, 80000n);
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 20000n);
      // Admin can still resolve requests received before permission was revoked.
      await call(admin.client, `/admin/deposits/${adminDeposit.id}/decision`, {
        decision: "approve",
      });
      assert.equal((await getBalanceByUser(a.agent.user.id)).balance, 60000n);
      assert.equal((await getBalanceByUser(a.player.user.id)).balance, 40000n);
      assert.equal((await getBalanceByUser(a.master.user.id)).balance, 100000n);
      const foreignList = await call(b.master.client, `${path(b.id)}/deposits`);
      assert.deepEqual(foreignList.items, []);
      await call(admin.client, `/network/nodes/${a.id}`, { manualPaymentsEnabled: true }, "PATCH");
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
      await call(c.player.client, "/payments/deposits", { ...depositBody, accountId: c.id }, "POST", 403);
      await call(admin.client, `/network/nodes/${c.id}`, { manualPaymentsEnabled: true }, "PATCH");
      await call(
        c.player.client,
        "/payments/deposits",
        { ...depositBody, accountId: c.id },
        "POST",
        400,
      );
      // Delegation preserves the master's QR and isolates each agent's queue.
      const cAccount = await call(c.master.client, path(c.id), settings, "PUT");
      const agentId = c.player.user.b2bAgentId!;
      await call(c.master.client, `/network/nodes/${agentId}`, { manualPaymentsEnabled: true }, "PATCH");
      assert.equal((await call(c.agent.client, "/network/context")).manualPaymentsAllowed, true);
      assert.equal((await call(c.agent.client, path(c.id))).upiId, settings.upiId);
      await call(c.agent.client, path(c.id), { ...settings, upiId: "agent@upi" }, "PUT", 403);
      await call(b.master.client, `/network/nodes/${agentId}`, { manualPaymentsEnabled: true }, "PATCH", 403);
      const sibling = await user("c-sibling", "agent");
      const [siblingNode] = await db.insert(networkNodesTable).values({ userId: sibling.user.id, kind: "agent", parentId: c.id, name: "Sibling", createdBy: c.master.user.id }).returning();
      const siblingPlayer = await user("c-sibling-player", "player", siblingNode!.id);
      const pendingBody = { ...depositBody, accountId: c.id, accountVersion: cAccount.version };
      const own = await call(c.player.client, "/payments/deposits", pendingBody);
      const other = await call(siblingPlayer.client, "/payments/deposits", { ...pendingBody, upiRef: "999999999999" });
      const queue = await call(c.agent.client, `${path(c.id)}/deposits`);
      assert.deepEqual(queue.items.map((x: { id: string }) => x.id), [own.id]);
      await call(c.agent.client, `${path(c.id)}/deposits/${other.id}/decision`, { decision: "approve" }, "POST", 404);
      await call(c.master.client, `/network/nodes/${agentId}`, { manualPaymentsEnabled: false }, "PATCH");
      await call(c.agent.client, `${path(c.id)}/deposits/${own.id}/decision`, { decision: "approve" }, "POST", 403);
      await call(c.master.client, `/network/nodes/${agentId}`, { manualPaymentsEnabled: true }, "PATCH");
      await call(admin.client, `/network/nodes/${c.id}`, { manualPaymentsEnabled: false }, "PATCH");
      assert.equal((await call(c.agent.client, "/network/context")).manualPaymentsAllowed, false);
      await call(c.agent.client, `${path(c.id)}/deposits`, undefined, "GET", 403);
      await call(admin.client, `/network/nodes/${c.id}`, { manualPaymentsEnabled: true }, "PATCH");
      await postEntry({ userId: c.agent.user.id, type: "adjustment", amount: 100000n, refType: "test" });
      await call(c.agent.client, `${path(c.id)}/deposits/${own.id}/decision`, { decision: "approve" });
      assert.equal((await getBalanceByUser(c.agent.user.id)).balance, 80000n);
      assert.equal((await getBalanceByUser(c.player.user.id)).balance, 20000n);
      assert.equal((await getBalanceByUser(c.master.user.id)).balance, 0n);
      const moved = await call(c.player.client, "/payments/deposits", { ...pendingBody, upiRef: "888888888888" });
      await assert.rejects(db.update(usersTable).set({ b2bAgentId: siblingNode!.id }).where(eq(usersTable.id, c.player.user.id)));
      await db.update(paymentRequestsTable).set({ fundingAgentId: siblingNode!.id }).where(eq(paymentRequestsTable.id, moved.id));
      await call(c.master.client, `${path(c.id)}/deposits/${moved.id}/decision`, { decision: "approve" }, "POST", 400);

      // Monday boundaries use approval time, and totals are independent of pagination.
      const week = "2026-10-12";
      await db.update(paymentRequestsTable).set({ processedAt: new Date("2026-10-11T18:30:00Z"), createdAt: new Date("2026-10-01T00:00:00Z") }).where(eq(paymentRequestsTable.id, own.id));
      const makeRecord = async (name: string, when: string, method: "manual" | "auto", amount: bigint, status: "approved" | "pending" = "approved") => {
        const [r] = await db.insert(paymentRequestsTable).values({ userId: c.player.user.id, kind: "deposit", method, status, amount, fundingAgentId: agentId, collectionMasterId: c.id, processedAt: new Date(when), upiRef: name + prefix }).returning(); return r!;
      };
      await makeRecord("auto", "2026-10-18T18:29:59.999Z", "auto", 30000n);
      await makeRecord("before", "2026-10-11T18:29:59.999Z", "manual", 90000n);
      await makeRecord("after", "2026-10-18T18:30:00Z", "manual", 90000n);
      await makeRecord("pending", "2026-10-14T00:00:00Z", "manual", 90000n, "pending");
      const reportPath = `/network/collections?week=${week}`;
      const report = await call(c.agent.client, `${reportPath}&limit=1`);
      assert.equal(report.total, 2);
      assert.equal(report.items.length, 1);
      assert.deepEqual(report.totals, { total: "50000", manual: "20000", auto: "30000" });
      assert.equal(report.range.to, "2026-10-19");
      assert.equal((await call(c.agent.client, `${reportPath}&method=manual`)).totals.total, "20000");
      assert.equal((await call(c.agent.client, `${reportPath}&method=auto`)).totals.total, "30000");
      await call(c.agent.client, `${reportPath}&agentId=${siblingNode!.id}`, undefined, "GET", 403);
      await call(b.master.client, `${reportPath}&agentId=${agentId}`, undefined, "GET", 403);
      await call(c.master.client, reportPath, undefined, "GET", 400);
      await call(c.agent.client, "/network/collections?week=2026-10-13", undefined, "GET", 400);
      assert.equal((await call(c.master.client, `${reportPath}&agentId=${agentId}`)).total, 2);
      assert.equal((await call(c.agent.client, reportPath)).totals.total, "50000");
      const history = await call(c.agent.client, "/network/payment-history?period=all&method=auto");
      assert.equal(history.total, 1);
      assert.equal(history.items[0].method, "auto");

      // Historical correction is atomic and idempotent; no second player credit.
      async function legacy(amount: bigint) {
        const [r] = await db.insert(paymentRequestsTable).values({ userId: c.player.user.id, kind: "deposit", method: "manual", status: "approved", amount, collectionMasterId: c.id, processedAt: new Date() }).returning();
        await postEntry({ userId: c.master.user.id, type: "adjustment", amount, refType: "test" });
        const old = await postEntry({ userId: c.master.user.id, type: "adjustment", amount: -amount, refType: "master_deposit_funding", refId: r!.id });
        const credit = await postEntry({ userId: c.player.user.id, type: "deposit", amount, refType: "deposit", refId: r!.id });
        await db.update(paymentRequestsTable).set({ ledgerEntryId: credit.entry.id }).where(eq(paymentRequestsTable.id, r!.id));
        return { ...r!, originalDebit: old.entry.id, originalCredit: credit.entry.id };
      }
      const oldDeposit = await legacy(10000n);
      const correction = `${path(c.id)}/deposits/${oldDeposit.id}/funding-correction`;
      const reason = { reason: "Correct original master funding to customer agent" };
      await call(c.master.client, correction, reason, "POST", 403);
      await call(c.agent.client, correction, reason, "POST", 403);
      const corrections = await Promise.all([call(admin.client, correction, reason), call(admin.client, correction, reason)]);
      assert.equal(corrections.filter(r => !r.alreadyCorrected).length, 1);
      assert.equal((await getBalanceByUser(c.agent.user.id)).balance, 70000n);
      assert.equal((await getBalanceByUser(c.master.user.id)).balance, 10000n);
      assert.equal((await getBalanceByUser(c.player.user.id)).balance, 30000n);
      const entries = await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, oldDeposit.id));
      assert.equal(entries.length, 4);
      assert.ok(entries.some(e => e.id === oldDeposit.originalDebit));
      assert.equal(entries.filter(e => e.refType === "deposit").length, 1);
      assert.equal(entries.reduce((s, e) => s + e.amount, 0n), 0n);
      await call(admin.client, `${path(c.id)}/deposits/${own.id}/funding-correction`, reason, "POST", 409);
      const insufficient = await legacy(90000n);
      await call(admin.client, `${path(c.id)}/deposits/${insufficient.id}/funding-correction`, reason, "POST", 400);
      assert.equal((await getBalanceByUser(c.agent.user.id)).balance, 70000n);
      assert.equal((await getBalanceByUser(c.master.user.id)).balance, 10000n);
      assert.equal((await db.select().from(walletLedgerTable).where(eq(walletLedgerTable.refId, insufficient.id))).length, 2);
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
