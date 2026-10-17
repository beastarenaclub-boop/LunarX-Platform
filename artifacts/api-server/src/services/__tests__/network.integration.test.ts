import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request } from "node:http";

test(
  "branch roles, isolated channels, immutable settlement snapshots and funded downlines",
  { skip: !process.env.NETWORK_INTEGRATION },
  async () => {
    assert.ok(
      new URL(process.env.DATABASE_URL!).pathname.endsWith("_network_test"),
    );
    const { db, pool, usersTable } = await import("@workspace/db");
    const { hashPassword } = await import("../../lib/password");
    const { createSession } = await import("../auth");
    const { default: app } = await import("../../app");
    const { sql } = await import("drizzle-orm");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    const prefix = `net-${Date.now()}`;
    const password = "Network@Test123";
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
    type Client = { host: string; cookie?: string; panel?: "master" | "agent" };
    const company: Client = {
      host: "localhost:5175",
      cookie: `sid=${session.id}`,
    };
    const publicB2c: Client = { host: "localhost:5200" };
    const publicB2b: Client = { host: "localhost:5202" };
    async function call(
      client: Client,
      path: string,
      body?: unknown,
      method = "POST",
      expected = 200,
    ) {
      const response = await new Promise<{
        status: number;
        body: string;
        cookie?: string;
      }>((resolve, reject) => {
        const outgoing = request(
          {
            hostname: "127.0.0.1",
            port,
            path: `/api${path}`,
            method: body === undefined ? "GET" : method,
            headers: {
              host: client.host,
              origin: `http://${client.host}`,
              "content-type": "application/json",
              ...(client.cookie ? { cookie: client.cookie } : {}),
              ...(client.panel ? { "x-operator-panel": client.panel } : {}),
            },
          },
          (incoming) => {
            let text = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk) => (text += chunk));
            incoming.on("end", () =>
              resolve({
                status: incoming.statusCode!,
                body: text,
                cookie: incoming.headers["set-cookie"]?.[0],
              }),
            );
          },
        );
        outgoing.on("error", reject);
        outgoing.end(body === undefined ? undefined : JSON.stringify(body));
      });
      const result = JSON.parse(response.body) as {
        id: string;
        userId: string;
        email: string;
        role: string;
        total: number;
        balance: string;
        user: { id: string; email: string; channel: string };
        players: { id: string; agent_id: string | null }[];
        nodes: {
          id: string;
          parent_id: string | null;
          parent_name: string | null;
          kind: string;
        }[];
        entries: {
          source_id: string;
          account_kind: string;
          amount: string;
          account_id: string;
          email: string;
        }[];
      };
      assert.equal(
        response.status,
        expected,
        `${path}: ${JSON.stringify(result)}`,
      );
      const cookie = response.cookie;
      if (cookie) client.cookie = cookie.split(";")[0];
      return result;
    }
    async function login(email: string, panel?: "master" | "agent") {
      const client: Client = { host: "localhost:5176", panel };
      await call(client, "/auth/agent-login", { email, password });
      return client;
    }
    async function sum(account: string) {
      const r = await db.execute(
        sql`SELECT COALESCE(sum(amount),0)::text AS n FROM network_ledger WHERE account_id=${account}`,
      );
      return BigInt(String(r.rows[0]!.n));
    }
    try {
      const master = await call(
        company,
        "/network/nodes",
        {
          email: `${prefix}-master@example.test`,
          name: "North Branch",
          password,
          companyFeeBps: 1000,
          shareBps: 10000,
        },
        "POST",
        201,
      );
      const masterClient = await login(`${prefix}-master@example.test`);
      assert.equal(
        (await call(masterClient, "/network/context")).role,
        "master",
      );
      const agent = await call(
        masterClient,
        "/network/nodes",
        {
          email: `${prefix}-agent@example.test`,
          name: "North Agent",
          password,
          shareBps: 5000,
        },
        "POST",
        201,
      );
      const agentClient = await login(`${prefix}-agent@example.test`);
      // Both tabs send the same browser cookie jar; the panel selects its own session.
      const scopedMaster = await login(`${prefix}-master@example.test`, "master");
      const scopedAgent = await login(`${prefix}-agent@example.test`, "agent");
      assert.ok(scopedMaster.cookie!.startsWith("sid_master="));
      assert.ok(scopedAgent.cookie!.startsWith("sid_agent="));
      const sharedCookies = `${scopedMaster.cookie}; ${scopedAgent.cookie}; ${agentClient.cookie}`;
      for (const panel of ["master", "agent"] as const) {
        assert.equal((await call({ host: "localhost:5176", cookie: sharedCookies, panel }, "/network/context")).role, panel);
      }
      await call({ ...scopedMaster, cookie: agentClient.cookie }, "/network/context", undefined, "GET", 401);
      await call({ ...scopedMaster, cookie: scopedAgent.cookie!.replace("sid_agent=", "sid_master=") }, "/network/context", undefined, "GET", 401);
      await call(scopedMaster, "/auth/agent-login", { email: `${prefix}-agent@example.test`, password }, "POST", 403);
      await call(scopedAgent, "/auth/agent-login", { email: `${prefix}-master@example.test`, password }, "POST", 403);
      await call({ ...scopedAgent, cookie: sharedCookies }, "/auth/logout", {});
      await call(scopedAgent, "/network/context", undefined, "GET", 401);
      assert.equal((await call({ ...scopedMaster, cookie: sharedCookies }, "/network/context")).role, "master");
      await call(agentClient, "/agent/players", undefined, "GET", 410);
      await call(agentClient, "/dragon-tiger/table", undefined, "GET", 403);
      await call(
        company,
        "/admin/agents",
        { email: `${prefix}-legacy@example.test`, password },
        "POST",
        409,
      );
      for (const client of [company, masterClient])
        await call(
          client,
          "/network/players",
          { email: `${prefix}-forbidden@example.test`, name: "No", password },
          "POST",
          403,
        );
      await call(
        agentClient,
        "/network/nodes",
        { email: `${prefix}-bad-agent@example.test`, name: "No", password },
        "POST",
        403,
      );
      await call(
        masterClient,
        `/network/nodes/${master.id}`,
        { shareBps: 10000 },
        "PATCH",
        403,
      );
      await call(
        company,
        `/network/nodes/${master.id}`,
        { companyFeeBps: 500 },
        "PATCH",
        400,
      );
      const player = await call(
        agentClient,
        "/network/players",
        {
          email: `${prefix}-player@example.test`,
          name: "North Player",
          password,
        },
        "POST",
        201,
      );
      await call(
        agentClient,
        "/network/players",
        { email: player.email, name: "Duplicate Player", password },
        "POST",
        409,
      );
      const otherMaster = await call(
        company,
        "/network/nodes",
        {
          email: `${prefix}-other@example.test`,
          name: "South Branch",
          password,
        },
        "POST",
        201,
      );
      const otherClient = await login(`${prefix}-other@example.test`);
      await call(
        otherClient,
        `/network/nodes/${agent.id}`,
        { shareBps: 10000 },
        "PATCH",
        403,
      );
      assert.equal((await call(otherClient, "/network/players")).total, 0);
      const branchNodes = (await call(masterClient, "/network/nodes")).nodes;
      const agentNodes = (await call(agentClient, "/network/nodes")).nodes;
      assert.equal(
        agentNodes.length,
        1,
        "Agent tree exposes only its own account",
      );
      assert.equal(agentNodes[0]!.id, agent.id);
      assert.equal(agentNodes[0]!.parent_name, "North Branch");
      assert.equal(
        (
          await call(
            agentClient,
            `/network/players?agentId=${agent.id}&q=North%20Player`,
          )
        ).total,
        1,
      );
      assert.equal(
        (
          await call(
            agentClient,
            `/network/players?agentId=${agent.id}&q=missing-user`,
          )
        ).total,
        0,
      );
      assert.equal(
        branchNodes.find((node) => node.id === agent.id)?.parent_id,
        master.id,
      );
      assert.ok(
        branchNodes.every(
          (node) => node.id === master.id || node.parent_id === master.id,
        ),
      );
      for (const viewer of [company, masterClient, agentClient]) {
        const agentUsers = await call(
          viewer,
          `/network/players?agentId=${agent.id}&limit=1`,
        );
        assert.equal(agentUsers.total, 1);
        assert.deepEqual(
          agentUsers.players.map((user) => [user.id, user.agent_id]),
          [[player.id, agent.id]],
        );
        assert.equal(
          (await call(viewer, `/network/players?agentId=${agent.id}&offset=1`))
            .players.length,
          0,
        );
        assert.equal(
          (await call(viewer, `/network/players?agentId=${otherMaster.id}`))
            .total,
          0,
        );
      }
      const hiddenUsers = await call(
        otherClient,
        `/network/players?agentId=${agent.id}`,
      );
      assert.equal(hiddenUsers.total, 0);
      assert.deepEqual(hiddenUsers.players, []);
      await call(
        company,
        `/network/players?channel=b2c&agentId=${agent.id}`,
        undefined,
        "GET",
        400,
      );
      await call(
        agentClient,
        "/network/players?channel=b2c",
        undefined,
        "GET",
        403,
      );
      await call(
        publicB2b,
        "/auth/signup",
        { email: `${prefix}-public-b2b@example.test`, password },
        "POST",
        403,
      );
      await call(
        publicB2c,
        "/auth/login",
        { email: player.email, password },
        "POST",
        401,
      );
      const b2bPlayer: Client = { host: "localhost:5202" };
      await call(b2bPlayer, "/auth/login", { email: player.email, password });
      assert.ok(b2bPlayer.cookie?.startsWith("sid_b2b="));
      const b2c = await call(publicB2c, "/auth/signup", {
        email: `${prefix}-direct@example.test`,
        password,
        referralCode: "ANYCODE",
      });
      assert.equal(b2c.user.channel, "b2c");
      await call(
        publicB2b,
        "/auth/login",
        { email: b2c.user.email, password },
        "POST",
        401,
      );
      await call(
        { host: "localhost:5202", cookie: publicB2c.cookie },
        "/auth/me",
        undefined,
        "GET",
        401,
      );
      const ref = `${prefix}-bet`;
      await db.execute(
        sql`INSERT INTO bets(id,user_id,game_code,stake_amount,status) VALUES(${ref},${player.id},'dice',10000,'placed')`,
      );
      assert.equal(await sum(agent.id), 0n);
      await call(
        masterClient,
        `/network/nodes/${agent.id}`,
        { shareBps: 2500 },
        "PATCH",
      );
      await db.execute(
        sql`UPDATE bets SET status='lost',settled_at=now() WHERE id=${ref}`,
      );
      assert.equal(await sum(agent.id), 4500n);
      assert.equal(await sum(master.id), 4500n);
      await db.execute(
        sql`UPDATE bets SET status='lost',settled_at=now() WHERE id=${ref}`,
      );
      let rows = await db.execute(
        sql`SELECT count(*)::int AS n FROM network_ledger WHERE source_id=${ref}`,
      );
      assert.equal(rows.rows[0]!.n, 3);
      await db.execute(
        sql`UPDATE bets SET status='won',payout_amount=20000 WHERE id=${ref}`,
      );
      assert.equal(await sum(agent.id), -4500n);
      assert.equal(await sum(master.id), -4500n);
      const lossSettlement = {
        nodeId: agent.id,
        amountPaise: "-1000",
        reference: "Loss collected TEST",
        requestId: randomUUID(),
      };
      const recorded = await call(
        company,
        "/network/settlements",
        lossSettlement,
      );
      assert.equal(
        (await call(company, "/network/settlements", lossSettlement)).id,
        recorded.id,
      );
      await call(
        company,
        "/network/settlements",
        { ...lossSettlement, amountPaise: "-999999", requestId: randomUUID() },
        "POST",
        400,
      );
      await db.execute(sql`UPDATE bets SET status='voided' WHERE id=${ref}`);
      assert.equal(await sum(agent.id), 0n);
      assert.equal(await sum(master.id), 0n);
      await call(
        masterClient,
        `/network/nodes/${agent.id}`,
        { shareBps: 5000 },
        "PATCH",
      );
      await db.execute(
        sql`INSERT INTO bets(id,user_id,game_code,stake_amount,status,payout_amount) VALUES(${`${prefix}-loss`},${player.id},'dice',10000,'lost',0)`,
      );
      const ledger = await call(company, "/network/ledger?channel=b2b");
      const snap = ledger.entries.find(
        (e: { source_id: string; account_kind: string }) =>
          e.source_id === `${prefix}-loss` && e.account_kind === "company",
      );
      assert.ok(snap);
      assert.equal(snap.amount, "1000");
      await assert.rejects(
        db.execute(
          sql`UPDATE network_wagers SET terms='{}' WHERE source_id=${ref}`,
        ),
        (error: unknown) =>
          /permanent/.test(
            String((error as { cause?: Error }).cause?.message ?? error),
          ),
      );
      assert.equal(
        (await call(agentClient, "/network/ledger")).entries.every(
          (e: { account_id: string }) => e.account_id === agent.id,
        ),
        true,
      );
      assert.equal((await call(otherClient, "/network/ledger")).total, 0);
      await db.execute(
        sql`INSERT INTO bets(id,user_id,game_code,stake_amount,status) VALUES(${`${prefix}-b2c`},${b2c.user.id},'dice',10000,'lost')`,
      );
      const direct = await call(company, "/network/ledger?channel=b2c");
      assert.ok(
        direct.entries.some(
          (e: { source_id: string; amount: string }) =>
            e.source_id === `${prefix}-b2c` && e.amount === "10000",
        ),
      );
      await db.execute(
        sql`INSERT INTO bets(id,user_id,game_code,stake_amount,status,metadata) VALUES(${`${prefix}-bonus`},${player.id},'dice',10000,'lost','{"useBonus":true}')`,
      );
      rows = await db.execute(
        sql`SELECT count(*)::int AS n FROM network_ledger WHERE source_id=${`${prefix}-bonus`}`,
      );
      assert.equal(rows.rows[0]!.n, 0);
      await assert.rejects(
        db.execute(
          sql`UPDATE network_ledger SET amount=0 WHERE source_id=${ref}`,
        ),
        (error: unknown) =>
          /append-only/.test(
            String((error as { cause?: Error }).cause?.message ?? error),
          ),
      );
      await assert.rejects(
        db.execute(
          sql`UPDATE users SET channel='b2c',b2b_agent_id=NULL WHERE id=${player.id}`,
        ),
        (error: unknown) =>
          /permanent/.test(
            String((error as { cause?: Error }).cause?.message ?? error),
          ),
      );
      await assert.rejects(
        db.execute(
          sql`UPDATE network_nodes SET company_fee_bps=0 WHERE id=${master.id}`,
        ),
        (error: unknown) =>
          /permanent/.test(
            String((error as { cause?: Error }).cause?.message ?? error),
          ),
      );
      // Funds travel down the hierarchy; a retry must not transfer twice.
      const { bus } = await import("../../realtime/eventBus");
      const balanceEvents: { topic: string; balance: string; amount: string }[] = [];
      const unsubscribe = bus.subscribe("*", (event) => {
        if (event.type === "balance" && event.topic.startsWith("wallet:"))
          balanceEvents.push({ topic: event.topic, balance: event.balance, amount: event.amount });
      });
      const transfer = (targetId: string, amountPaise: string) => ({
        targetId,
        amountPaise,
        direction: "credit",
        memo: "Test funding",
        requestId: randomUUID(),
      });
      await call(
        company,
        "/network/transfers",
        transfer(master.userId, "10000"),
      );
      await call(
        masterClient,
        "/network/transfers",
        transfer(agent.userId, "5000"),
      );
      const funding = transfer(player.id, "2000");
      await Promise.all([
        call(agentClient, "/network/transfers", funding),
        call(agentClient, "/network/transfers", funding),
      ]);
      const balance = await call(b2bPlayer, "/wallet/balance");
      assert.equal(balance.balance, "2000");
      const expectedEvents = [
        { topic: `wallet:${master.userId}`, balance: "10000", amount: "10000" },
        { topic: `wallet:${master.userId}`, balance: "5000", amount: "-5000" },
        { topic: `wallet:${agent.userId}`, balance: "5000", amount: "5000" },
        { topic: `wallet:${agent.userId}`, balance: "3000", amount: "-2000" },
        { topic: `wallet:${player.id}`, balance: "2000", amount: "2000" },
      ];
      assert.deepEqual(balanceEvents, expectedEvents, "Both balances are published once after commit");
      await call(
        otherClient,
        "/network/transfers",
        transfer(player.id, "100"),
        "POST",
        403,
      );
      await call(
        agentClient,
        "/network/transfers",
        transfer(player.id, "99999"),
        "POST",
        400,
      );
      const wallet = await call(agentClient, "/network/wallet-ledger");
      // Collecting more than the child's balance must roll back even the first posting.
      await call(masterClient, "/network/transfers", { ...transfer(agent.userId, "99999"), direction: "debit" }, "POST", 400);
      assert.deepEqual(balanceEvents, expectedEvents, "Failed transfers publish no balance changes");
      unsubscribe();
      assert.ok(
        wallet.entries.every((e: { email: string }) =>
          [player.email, `${prefix}-agent@example.test`].includes(e.email),
        ),
      );
      await call(
        company,
        `/network/nodes/${master.id}`,
        { status: "suspended" },
        "PATCH",
      );
      await call(b2bPlayer, "/wallet/balance", undefined, "GET", 401);
      await call(agentClient, "/network/context", undefined, "GET", 401);
      await call(
        company,
        `/network/nodes/${master.id}`,
        { status: "active" },
        "PATCH",
      );
      // Every independent game table feeds the same journal with its actual units.
      const round = await db.execute(
        sql`INSERT INTO dragon_tiger_rounds(dragon,tiger,closes_at,reveals_at,ends_at) VALUES(1,2,now(),now(),now()) RETURNING id`,
      );
      const dt = await db.execute(
        sql`INSERT INTO dragon_tiger_bets(round_id,user_id,spots,stake,payout) VALUES(${round.rows[0]!.id},${player.id},'{}',100,0) RETURNING id`,
      );
      const check = async (source: string, id: string) => {
        const r = await db.execute(
          sql`SELECT sum(amount)::text AS n FROM network_ledger WHERE source=${source} AND source_id=${id}`,
        );
        assert.equal(r.rows[0]!.n, "10000", source);
      };
      await check("dragon_tiger_bets", String(dt.rows[0]!.id));
      await db.execute(
        sql`INSERT INTO wingo_rounds(period,duration,start,ends,number,secret,commitment) VALUES(${prefix},30,0,1,0,'test','test')`,
      );
      await db.execute(
        sql`INSERT INTO wingo_bets(id,user_id,period,pick,stake,payout,created,request) VALUES(${prefix},${player.id},${prefix},'red',10000,0,0,${prefix})`,
      );
      await check("wingo_bets", prefix);
      await db.execute(
        sql`INSERT INTO forex_trades(id,user_id,request_id,round_id,asset,side,amount,payout,status,opened,open_price) VALUES(${prefix},${player.id},${prefix},1,'gold','buy',10000,0,'lost',0,100)`,
      );
      await check("forex_trades", prefix);
      await db.execute(
        sql`INSERT INTO virtual_sports_rounds(id,sport,starts,data) VALUES(${prefix},'football',0,'{}')`,
      );
      await db.execute(
        sql`INSERT INTO virtual_sports_bets(id,user_id,request_id,round_id,sport,choice,amount,odds_hundredths,payout,status,created) VALUES(${prefix},${player.id},${prefix},${prefix},'football',0,10000,200,0,'lost',0)`,
      );
      await check("virtual_sports_bets", prefix);
      const od = await db.execute(
        sql`INSERT INTO dragon_tiger_one_day_rounds(dragon,tiger,nonce,commitment,first_closes_at,second_opens_at,second_closes_at,reveals_at,ends_at) VALUES(1,2,'test','test',now(),now(),now(),now(),now()) RETURNING id`,
      );
      const odb = await db.execute(
        sql`INSERT INTO dragon_tiger_one_day_bets(round_id,user_id,stage,selections,stake_paise,payout_paise) VALUES(${od.rows[0]!.id},${player.id},'first','[]',10000,0) RETURNING id`,
      );
      await check("dragon_tiger_one_day_bets", String(odb.rows[0]!.id));
      await db.execute(
        sql`INSERT INTO rummy_sessions(user_id,state) VALUES(${player.id},'{"table":{"round":1,"stake":100,"phase":"playing"}}')`,
      );
      await db.execute(
        sql`UPDATE rummy_sessions SET state='{"table":{"round":1,"stake":100,"phase":"finished","result":{"payout":0}}}' WHERE user_id=${player.id}`,
      );
      await check("rummy_sessions", `${player.id}:1`);
      // Fees and balance allocation use identical signed math for every game source.
      const mismatch = await db.execute(
        sql`SELECT source,source_id FROM network_ledger WHERE user_id=${player.id} GROUP BY source,source_id HAVING sum(amount) <> max(CASE WHEN account_kind='company' THEN 0 ELSE 0 END)+sum(CASE WHEN account_kind='company' THEN gross_stake-gross_payout ELSE 0 END)`,
      );
      assert.equal(mismatch.rows.length, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await pool.end();
    }
  },
);
