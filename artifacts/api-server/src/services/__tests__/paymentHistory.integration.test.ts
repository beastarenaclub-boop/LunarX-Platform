import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";

test(
  "historical payment reconciliation: scoped reads, honest matching, pagination and safe CSV",
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
      withdrawalsTable,
    } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const { createSession } = await import("../auth");
    const { postEntry } = await import("../wallet");
    const { default: app } = await import("../../app");
    const prefix = `ph-${randomUUID()}`;
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    type Client = { cookie?: string; host: string };
    async function user(
      name: string,
      role: "admin" | "agent" | "player",
      channel: "b2b" | "b2c" = "b2c",
      b2bAgentId?: string,
    ) {
      const email = `${prefix}-${name}@example.test`;
      const [u] = await db
        .insert(usersTable)
        .values({
          email,
          emailNormalized: email,
          passwordHash: "integration-test-no-login",
          role,
          channel,
          b2bAgentId,
        })
        .returning();
      const session = await createSession(u!.id, null, null);
      const cookie =
        role === "agent"
          ? "sid_operator"
          : role === "player" && channel === "b2b"
            ? "sid_b2b"
            : "sid";
      return {
        user: u!,
        client: {
          cookie: `${cookie}=${session.id}`,
          host:
            role === "admin"
              ? "localhost:5175"
              : role === "agent"
                ? "localhost:5176"
                : channel === "b2b"
                  ? "localhost:5202"
                  : "localhost:5200",
        },
      };
    }
    async function get(client: Client, path: string, expected = 200) {
      const response = await new Promise<{
        status: number;
        body: string;
        cache: unknown;
      }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path: `/api${path}`,
            headers: {
              host: client.host,
              ...(client.cookie ? { cookie: client.cookie } : {}),
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
        req.end();
      });
      assert.equal(response.status, expected, `${path}: ${response.body}`);
      if (expected === 200) assert.equal(response.cache, "no-store");
      return response.body;
    }
    try {
      const admin = await user("admin", "admin");
      async function branch(name: string) {
        const master = await user(`${name}-master`, "agent");
        const [m] = await db
          .insert(networkNodesTable)
          .values({
            userId: master.user.id,
            kind: "master",
            name,
            createdBy: admin.user.id,
          })
          .returning();
        const agent = await user(`${name}-agent`, "agent");
        const [a] = await db
          .insert(networkNodesTable)
          .values({
            userId: agent.user.id,
            kind: "agent",
            parentId: m!.id,
            name: `${name} Agent`,
            createdBy: admin.user.id,
          })
          .returning();
        const player = await user(`${name}-player`, "player", "b2b", a!.id);
        return { master, agent, player, masterId: m!.id, agentId: a!.id };
      }
      const own = await branch("North"),
        other = await branch("South"),
        retail = await user("retail", "player", "b2c");
      const second = await user(
        "same-agent-player",
        "player",
        "b2b",
        own.agentId,
      );
      const when = new Date("2024-02-28T18:30:00Z"),
        audit = `${prefix}-audit`;
      async function deposit(
        id: string,
        amount: bigint,
        status: "pending" | "approved",
        userId = own.player.user.id,
        ledgerEntryId?: string,
      ) {
        await db
          .insert(paymentRequestsTable)
          .values({
            id,
            userId,
            kind: "deposit",
            amount,
            status,
            createdAt: when,
            processedBy: status === "approved" ? admin.user.id : null,
            processedAt: status === "approved" ? when : null,
            upiRef: id.endsWith("good") ? "=SUM(1,2)" : null,
            ledgerEntryId,
          });
      }
      async function ledger(
        id: string,
        amount: bigint,
        refType: string,
        userId = own.player.user.id,
      ) {
        return postEntry({
          userId,
          type: amount > 0 ? "deposit" : "withdraw",
          amount,
          refType,
          refId: id,
          enforceNonNegative: false,
        });
      }
      await deposit(`${audit}-good`, 1000n, "approved");
      const credit = await ledger(`${audit}-good`, 1000n, "deposit");
      await deposit(`${audit}-missing`, 2000n, "approved");
      await deposit(`${audit}-pending`, 500n, "pending");
      await deposit(
        `${audit}-bad-pointer`,
        1000n,
        "approved",
        own.player.user.id,
        credit.entry.id,
      );
      await db
        .insert(paymentRequestsTable)
        .values({
          id: `${audit}-request`,
          userId: own.player.user.id,
          kind: "withdraw",
          amount: 300n,
          status: "pending",
          createdAt: when,
        });
      async function payout(
        suffix: string,
        amount: bigint,
        status: "paid" | "approved" | "failed",
      ) {
        await db
          .insert(withdrawalsTable)
          .values({
            id: `${audit}-${suffix}`,
            userId: own.player.user.id,
            amount,
            status,
            destination: "test@upi",
            requestedAt: when,
            reviewedAt: when,
            reviewedBy: admin.user.id,
            paidAt: status === "paid" ? when : null,
          });
      }
      await payout("paid", 400n, "paid");
      await ledger(`${audit}-paid`, -400n, "withdrawal");
      await payout("approved", 600n, "approved");
      await payout("refunded", 300n, "failed");
      await ledger(`${audit}-refunded`, -300n, "withdrawal");
      await ledger(`${audit}-refunded`, 300n, "withdrawal");
      await payout("collision", 700n, "paid");
      await ledger(`${audit}-collision`, -700n, "withdrawal");
      await db
        .insert(paymentRequestsTable)
        .values({
          id: `${audit}-collision`,
          userId: own.player.user.id,
          kind: "withdraw",
          amount: 700n,
          status: "pending",
          createdAt: when,
        });
      for (const [suffix, p] of [
        ["other", other.player],
        ["retail", retail],
        ["same-agent", second],
      ] as const)
        await deposit(`${prefix}-${suffix}`, 100n, "pending", p.user.id);
      const snapshot = async () =>
        (
          await db.execute(
            sql`SELECT count(*)::int AS count,COALESCE(sum(amount),0)::text AS amount FROM wallet_ledger WHERE user_id=${own.player.user.id}`,
          )
        ).rows[0];
      const before = await snapshot();
      const path = `/network/payment-history?q=${audit}`;
      const history = JSON.parse(await get(own.master.client, path));
      assert.equal(history.total, 10);
      assert.deepEqual(history.totals, {
        approvedDeposits: "4000",
        depositWalletCredits: "1000",
        recordedPaidWithdrawals: "1100",
        pending: 4,
        needsReview: 5,
        requestOnly: 2,
      });
      assert.equal(history.bankVerified, false);
      assert.equal(history.branchAttribution, "current_membership");
      assert.equal(
        history.items.find((r: any) => r.requestId === `${audit}-refunded`)
          .reconciliation,
        "matched",
      );
      assert.equal(
        history.items.find((r: any) => r.requestId === `${audit}-request`)
          .reconciliation,
        "request_only",
      );
      assert.equal(JSON.parse(await get(own.agent.client, path)).total, 10);
      assert.equal(JSON.parse(await get(other.master.client, path)).total, 0);
      assert.equal(
        JSON.parse(
          await get(
            own.master.client,
            `/network/payment-history?q=${prefix}&nodeId=${other.agentId}`,
          ),
        ).total,
        0,
      );
      assert.equal(
        JSON.parse(
          await get(
            own.agent.client,
            `/network/payment-history?q=${prefix}&userId=${other.player.user.id}`,
          ),
        ).total,
        0,
      );
      assert.equal(
        JSON.parse(
          await get(
            admin.client,
            `/network/payment-history?q=${prefix}&channel=b2c`,
          ),
        ).total,
        1,
      );
      await get(own.master.client, `${path}&channel=b2c`, 403);
      await get({ host: "localhost:5176" }, path, 401);
      await get(own.player.client, path, 403);
      await get(admin.client, "/payments/history", 403);
      const customer = JSON.parse(
        await get(
          own.player.client,
          `/payments/history?q=${prefix}&userId=${other.player.user.id}&nodeId=${other.masterId}&channel=b2c`,
        ),
      );
      assert.equal(customer.total, 10);
      for (const row of customer.items) {
        assert.equal(row.userId, own.player.user.id);
        for (const field of [
          "email",
          "masterId",
          "masterName",
          "agentId",
          "agentName",
          "reviewer",
        ])
          assert.equal(row[field], null);
      }
      const first = JSON.parse(await get(own.master.client, `${path}&limit=3`)),
        next = JSON.parse(
          await get(own.master.client, `${path}&limit=3&offset=3`),
        );
      assert.deepEqual(first.totals, history.totals);
      assert.deepEqual(
        [...first.items, ...next.items].map((r) => r.id),
        history.items.slice(0, 6).map((r: any) => r.id),
      );
      assert.equal(
        JSON.parse(
          await get(
            own.master.client,
            `${path}&period=custom&from=2024-02-29&to=2024-02-29`,
          ),
        ).total,
        10,
      );
      assert.equal(
        JSON.parse(
          await get(
            own.master.client,
            `${path}&period=custom&from=2024-02-28&to=2024-02-28`,
          ),
        ).total,
        0,
      );
      assert.equal(
        JSON.parse(
          await get(
            own.master.client,
            `${path}&type=deposit&status=approved&minAmount=1500&maxAmount=2500`,
          ),
        ).total,
        1,
      );
      assert.equal(
        JSON.parse(
          await get(
            own.master.client,
            `${path}&type=payout&reconciliation=needs_review`,
          ),
        ).total,
        2,
      );
      assert.equal(
        JSON.parse(
          await get(own.master.client, "/network/payment-history?q=%25"),
        ).total,
        0,
      );
      await get(own.master.client, `${path}&status=made-up`, 400);
      const csv = await get(
        own.master.client,
        `${path}&format=csv&limit=1&offset=7`,
      );
      assert.equal(csv.split("\r\n").length, 11);
      assert.ok(csv.includes('"\'=SUM(1,2)"'));
      assert.ok(csv.includes("amountPaise"));
      const customerCsv = await get(
        own.player.client,
        `/payments/history?q=${prefix}&format=csv`,
      );
      for (const privateValue of [
        "masterName",
        "agentName",
        "reviewer",
        own.player.user.email,
        admin.user.id,
      ])
        assert.ok(!customerCsv.includes(privateValue));
      assert.deepEqual(
        await snapshot(),
        before,
        "Reads must not post wallet entries",
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
