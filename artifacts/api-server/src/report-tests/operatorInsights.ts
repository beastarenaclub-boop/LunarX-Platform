import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import ExcelJS from "exceljs";
import { db, usersTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { memory, ready } from "../demo/database";
import {
  operatorInsightsRouter,
  adminBettingInsightsRouter,
} from "../routes/operatorInsights";
import { requireAuth } from "../middlewares/auth";
import { errorHandler } from "../middlewares/error";
import {
  insightFilter,
  insightRange,
  rupeesToPaise,
} from "../services/operatorInsightFilters";
import {
  exportInsights,
  decimalMoney,
} from "../services/operatorInsightExport";
import { recordRealtimeActivity } from "../services/sessionActivity";
import { networkIdentity } from "../services/network";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
type TestReport = {
  totals: Record<string, unknown>;
  items: Record<string, unknown>[];
  entries: { total: number; items: Record<string, unknown>[] };
  evidence: Record<string, unknown>[];
};

test("filters validate money exactly and reject invalid reporting dates", () => {
  assert.equal(rupeesToPaise("90071992547409.99"), 9007199254740999n);
  assert.equal(decimalMoney("-109"), "-1.09");
  assert.throws(() => insightFilter.parse({ minStake: "-1" }));
  assert.throws(() => insightFilter.parse({ minStake: "1.001" }));
  assert.throws(() => insightFilter.parse({ offset: "-1" }));
  assert.throws(() =>
    insightRange(insightFilter.parse({ minStake: "10", maxStake: "1" })),
  );
  assert.throws(() =>
    insightRange(
      insightFilter.parse({
        period: "custom",
        from: "2026-10-19",
        to: "2026-10-18",
      }),
    ),
  );
  assert.throws(() =>
    insightRange(
      insightFilter.parse({
        period: "custom",
        from: "2024-01-01",
        to: "2026-10-18",
      }),
    ),
  );
});

test("real SQL: branch isolation, live deduplication, exact tally, numeric bet ranks and protected full exports", async () => {
  await ready;
  const users = [
    { id: "admin", role: "admin" as const },
    { id: "master", role: "agent" as const },
    { id: "agent", role: "agent" as const },
    { id: "other-agent", role: "agent" as const },
    { id: "player", channel: "b2b" as const, b2bAgentId: "a" },
    { id: "other-player", channel: "b2b" as const, b2bAgentId: "a2" },
    { id: "public" },
    { id: "offline" },
    { id: "demo" },
  ];
  await db.insert(usersTable).values(
    users.map((u) => ({
      ...u,
      email: u.id === "demo" ? "test@demo.lunar.local" : `${u.id}@example.test`,
      emailNormalized: `${u.id}@example.test`,
      passwordHash: "unused",
      displayName: `User ${u.id}`,
    })),
  );
  await db.execute(sql`INSERT INTO network_nodes(id,user_id,kind,parent_id,name,created_by) VALUES
    ('m','master','master',NULL,'Master','admin'),('a','agent','agent','m','Agent','admin'),('a2','other-agent','agent','m','Other Agent','admin')`);
  await db.execute(
    sql`INSERT INTO wallets(id,user_id,scope) VALUES ('w','player','lunar'),('w2','other-player','lunar'),('w3','public','lunar')`,
  );
  // Same-time debit/credit IDs deliberately reverse application order.
  await db.execute(sql`INSERT INTO wallet_ledger(id,wallet_id,user_id,type,amount,balance_after,created_at) VALUES
    ('opening','w','player','deposit',10000,10000,'2026-10-17T18:29:59Z'),
    ('z-credit','w','player','deposit',5000,15000,'2026-10-17T18:30:00Z'),
    ('a-debit','w','player','bet',-2000,13000,'2026-10-17T18:30:00Z'),
    ('win','w','player','win',3000,16000,'2026-10-18T10:00:00Z'),
    ('withdraw','w','player','withdraw',-1000,15000,'2026-10-18T12:00:00Z'),
    ('tomorrow','w','player','deposit',10000,25000,'2026-10-18T18:30:00Z'),
    ('broken','w2','other-player','deposit',1000,999,'2026-10-18T10:00:00Z'),
    ('good-ending','w2','other-player','deposit',500,1500,'2026-10-18T11:00:00Z'),
    ('public-dep','w3','public','deposit',500,500,'2026-10-18T10:00:00Z')`);
  await db.execute(sql`INSERT INTO sessions(id,user_id,expires_at,last_seen_at,revoked_at) VALUES
    ('s1','player',now()+interval '1 day',now(),NULL),('s2','player',now()+interval '1 day',now(),NULL),
    ('s3','other-player',now()+interval '1 day',now(),NULL),('s4','public',now()-interval '1 minute',now(),NULL),
    ('s5','public',now()+interval '1 day',now(),now()),('s6','offline',now()+interval '1 day',now()-interval '3 minutes',NULL),
    ('sd','demo',now()+interval '1 day',now(),NULL)`);
  await db.execute(sql`INSERT INTO bets(id,user_id,game_code,round_id,stake_amount,payout_amount,status,placed_at) VALUES
    ('big','player','mines','r1',10000,20000,'won','2026-10-18T10:00:00Z'),
    ('small','other-player','mines','r2',900,0,'lost','2026-10-18T10:00:01Z'),
    ('pending','player','roulette','r3',5000,0,'placed','2026-10-18T11:00:00Z'),
    ('void','player','mines','r4',2000,2000,'voided','2026-10-18T12:00:00Z'),
    ('future','player','mines','r5',90000,0,'lost','2026-10-18T18:30:00Z')`);
  await db.execute(
    sql`INSERT INTO fraud_flags(id,user_id,rule,severity,description) VALUES ('flag','player','test_flag','medium','Check related session and bet references')`,
  );
  await db.execute(sql`INSERT INTO network_ledger(source,source_id,revision,user_id,game_code,channel,master_id,agent_id,account_id,account_kind,amount,gross_stake,gross_payout,terms,created_at)
    SELECT 'bets','big',1,'player','mines','b2b','m','a',account,kind,amount,10000,20000,'{}'::jsonb,'2026-10-18T10:00:00Z'::timestamptz
    FROM (VALUES ('company','company',-1000),('m','master',-4500),('a','agent',-4500)) AS allocations(account,kind,amount)`);
  const actors = new Map(
    (await db.select().from(usersTable)).map((u) => [u.id, u]),
  );
  const app = express();
  app.use((req, _res, next) => {
    req.user = actors.get(String(req.headers["x-test-user"]));
    next();
  });
  app.use("/api/network/insights", requireAuth, operatorInsightsRouter);
  app.use("/api/admin/betting-insights", adminBettingInsightsRouter);
  app.get("/api/auth/me", (req, res) =>
    res.json({
      id: req.user!.id,
      email: req.user!.email,
      role: req.user!.role,
      status: "active",
      displayName: req.user!.displayName,
    }),
  );
  app.get("/api/network/context", async (req, res) =>
    res.json({
      ...(await networkIdentity(req.user!)),
      manualPaymentsAllowed: false,
    }),
  );
  app.get("/api/network/nodes", (_req, res) => res.json({ nodes: [] }));
  const adminDir = resolve("../admin-panel/dist/public"),
    agentDir = resolve("../agent-panel/dist/public");
  app.use("/admin", express.static(adminDir));
  app.get(/^\/admin(?:\/.*)?$/, (_req, res) =>
    res.sendFile(resolve(adminDir, "index.html")),
  );
  app.use("/agent", express.static(agentDir));
  app.get(/^\/(agent|master)(?:\/.*)?$/, (_req, res) =>
    res.sendFile(resolve(agentDir, "index.html")),
  );
  app.use(
    (
      error: unknown,
      _req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!(error && typeof error === "object" && "status" in error))
        console.error(
          error instanceof Error
            ? ((error.cause as Error)?.message ?? error.message)
            : error,
        );
      next(error);
    },
  );
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const dates = "period=custom&from=2026-10-18&to=2026-10-18";
  async function call(actor: string, path: string, expected = 200) {
    const response = await fetch(base + path, {
      headers: { "x-test-user": actor },
    });
    assert.equal(
      response.status,
      expected,
      `${path}: ${response.status === expected ? "" : await response.text()}`,
    );
    return response;
  }
  try {
    await call("", "/api/network/insights/live", 401);
    await call("player", "/api/network/insights/live", 403);
    const live = (await (
      await call("admin", "/api/network/insights/live")
    ).json()) as TestReport;
    assert.equal(live.totals.totalPlayers, 4);
    assert.equal(live.totals.online, 2);
    assert.equal(live.totals.sessions, 3);
    const agentLive = (await (
      await call("agent", "/api/network/insights/live")
    ).json()) as TestReport;
    assert.equal(agentLive.totals.totalPlayers, 1);
    assert.equal(agentLive.items[0].id, "player");
    await call("agent", "/api/network/insights/live?channel=b2c", 403);
    await call("agent", "/api/network/insights/live?nodeId=a2", 403);
    assert.equal(await recordRealtimeActivity("s6"), true);
    assert.equal(await recordRealtimeActivity("s4"), false);
    assert.equal(await recordRealtimeActivity("s5"), false);
    const active = (await (
      await call("admin", "/api/network/insights/live")
    ).json()) as TestReport;
    assert.equal(active.totals.online, 3);
    const report = (await (
      await call("agent", `/api/network/insights/accounts?${dates}`)
    ).json()) as TestReport;
    assert.equal(report.items.length, 1);
    assert.equal(report.items[0].opening, "10000");
    assert.equal(report.items[0].credits, "8000");
    assert.equal(report.items[0].debits, "3000");
    assert.equal(report.items[0].closing, "15000");
    assert.equal(report.items[0].recorded, "15000");
    assert.equal(report.items[0].breaks, 0);
    assert.equal(report.entries.total, 4);
    const broken = (await (
      await call(
        "master",
        `/api/network/insights/accounts?${dates}&mismatchOnly=true`,
      )
    ).json()) as TestReport;
    assert.equal(broken.items.length, 1);
    assert.equal(broken.items[0].player_id, "other-player");
    assert.equal(broken.items[0].difference, "0");
    assert.equal(broken.items[0].breaks, 1);
    assert.equal(broken.entries.total, 2);
    for (const role of ["agent", "master", "player"]) {
      await call(role, `/api/admin/betting-insights?${dates}`, 403);
      await call(role, `/api/admin/betting-insights?${dates}&format=xlsx`, 403);
    }
    const bets = (await (
      await call("admin", `/api/admin/betting-insights?${dates}`)
    ).json()) as TestReport;
    assert.equal(
      bets.items[0].player_id,
      "player",
      "numeric sorting must put 17000 above 900",
    );
    assert.equal(bets.totals.stake, "17900");
    assert.equal(bets.totals.settledStake, "10900");
    assert.equal(bets.totals.payout, "20000");
    assert.equal(bets.totals.houseNet, "-9100");
    assert.equal(bets.totals.pending, "5000");
    assert.equal(bets.totals.review, 1);
    assert.equal(bets.entries.total, 4);
    const pending = (await (
      await call("admin", `/api/admin/betting-insights?${dates}&status=placed`)
    ).json()) as TestReport;
    assert.equal(pending.totals.settledStake, "0");
    assert.equal(pending.totals.houseNet, "0");
    const outside = (await (
      await call(
        "agent",
        `/api/network/insights/accounts?${dates}&playerId=other-player`,
      )
    ).json()) as TestReport;
    assert.equal(outside.items.length, 0);
    await db.execute(
      sql`UPDATE network_nodes SET status='suspended' WHERE id='a2'`,
    );
    const suspended = (await (
      await call("admin", "/api/network/insights/live")
    ).json()) as TestReport;
    assert.equal(suspended.totals.online, 2);
    await db.execute(
      sql`UPDATE network_nodes SET status='active' WHERE id='a2'`,
    );
    const filtered = (await (
      await call(
        "admin",
        `/api/admin/betting-insights?${dates}&game=mines&minStake=10&maxStake=100&status=won&playerId=player`,
      )
    ).json()) as TestReport;
    assert.equal(filtered.entries.total, 1);
    assert.equal(filtered.evidence[0].id, "flag");
    const reviewed = (await (
      await call(
        "admin",
        `/api/admin/betting-insights?${dates}&reviewOnly=true`,
      )
    ).json()) as TestReport;
    assert.equal(reviewed.items.length, 1);
    assert.equal(reviewed.entries.total, 3);
    const page = (await (
      await call(
        "admin",
        `/api/admin/betting-insights?${dates}&limit=1&offset=1&entriesOffset=2`,
      )
    ).json()) as TestReport;
    assert.equal(page.items[0].player_id, "other-player");
    assert.equal(page.entries.items[0].id, "bet:void");
    const response = await call(
      "admin",
      `/api/admin/betting-insights?${dates}&limit=1&offset=1&format=xlsx`,
    );
    assert.match(response.headers.get("content-disposition")!, /\.xlsx/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(await response.arrayBuffer()) as never,
    );
    assert.equal(workbook.getWorksheet("Player rankings")!.actualRowCount, 3);
    assert.equal(workbook.getWorksheet("Bets")!.actualRowCount, 5);
    const accountsExport = await call(
      "agent",
      `/api/network/insights/accounts?${dates}&format=xlsx`,
    );
    await workbook.xlsx.load(
      Buffer.from(await accountsExport.arrayBuffer()) as never,
    );
    assert.equal(workbook.getWorksheet("Wallet tally")!.actualRowCount, 2);
    assert.equal(workbook.getWorksheet("Wallet ledger")!.actualRowCount, 5);
    const commissions = workbook.getWorksheet("Commission ledger")!;
    assert.equal(
      commissions.actualRowCount,
      2,
      "an agent sees only its allocation",
    );
    const header = commissions.getRow(1).values as string[];
    assert.equal(
      commissions.getRow(2).getCell(header.indexOf("account kind")).value,
      "agent",
    );
    const mismatchExport = await call("admin", `/api/network/insights/accounts?${dates}&mismatchOnly=true&format=xlsx`);
    await workbook.xlsx.load(Buffer.from(await mismatchExport.arrayBuffer()) as never);
    assert.ok(workbook.getWorksheet("Commission ledger")!.actualRowCount <= 1, "mismatch filtering must apply to every exported sheet");
    const pdf = await call(
      "admin",
      `/api/admin/betting-insights?${dates}&format=pdf`,
    );
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdfBytes.subarray(-30).toString(), /%%EOF/);
    await call(
      "agent",
      `/api/network/insights/accounts?${dates}&nodeId=a2&format=pdf`,
      403,
    );
    await call(
      "admin",
      "/api/admin/betting-insights?minStake=100&maxStake=1",
      400,
    );
    await call("admin", "/api/network/insights/accounts?period=custom", 400);
    const untrusted = await exportInsights("xlsx", [
      {
        name: "Escaping",
        rows: [{ email: '=HYPERLINK("bad")', amount: "9007199254740999" }],
      },
    ]);
    await workbook.xlsx.load(untrusted as never);
    assert.equal(
      workbook.worksheets[0]!.getCell("A2").type,
      ExcelJS.ValueType.String,
    );
    assert.equal(
      workbook.worksheets[0]!.getCell("B2").value,
      "90071992547409.99",
    );
    await assert.rejects(
      exportInsights("xlsx", [
        {
          name: "Too many",
          rows: Array.from({ length: 50001 }, () => ({ id: "x" })),
        },
      ]),
      /exceeds/,
    );
    await assert.rejects(
      exportInsights("pdf", [
        {
          name: "Too many",
          rows: Array.from({ length: 5001 }, () => ({ id: "x" })),
        },
      ]),
      /5,000/,
    );
    if (process.env.INSIGHTS_BROWSER) {
      const browser = await chromium.launch({
        headless: true,
        channel: "chrome",
      });
      const errors: string[] = [];
      const output = resolve("../../tmp/operator-insights");
      await mkdir(output, { recursive: true });
      try {
        const adminContext = await browser.newContext({
          extraHTTPHeaders: { "x-test-user": "admin" },
          viewport: { width: 1440, height: 1050 },
        });
        const page = await adminContext.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        async function chooseDate() {
          await page
            .getByLabel("Period", { exact: true })
            .selectOption("custom");
          await page
            .getByLabel("From (IST)", { exact: true })
            .fill("2026-10-18");
          await page.getByLabel("To (IST)", { exact: true }).fill("2026-10-18");
          await page
            .getByRole("button", { name: "Apply filters", exact: true })
            .click();
        }
        await page.goto(`${base}/admin/accounts`);
        await expect(
          page.getByRole("heading", { name: "Accounts & ledger tally" }),
        ).toBeVisible();
        await chooseDate();
        await expect(
          page.getByText("1 balance breaks", { exact: true }),
        ).toBeVisible();
        await page.getByText("View online players", { exact: true }).click();
        await expect(page.locator(".oi-live-list")).toContainText(
          "player@example.test",
        );
        await page.screenshot({
          path: resolve(output, "admin-accounts.png"),
          fullPage: true,
        });
        for (const kind of ["Excel", "PDF"]) {
          const download = page.waitForEvent("download");
          await page
            .getByRole("button", { name: `Download ${kind}`, exact: true })
            .click();
          const file = await download;
          assert.match(file.suggestedFilename(), /lunarx-accounts/);
          await file.saveAs(resolve(output, file.suggestedFilename()));
        }
        await page.goto(`${base}/admin/bets`);
        await chooseDate();
        await expect(
          page.getByText("Unresolved security flags; inspect evidence", {
            exact: true,
          }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Inspect player", exact: true })
          .first()
          .click();
        await expect(
          page.getByRole("heading", { name: "Current security evidence" }),
        ).toBeVisible();
        await expect(
          page.getByText("Check related session and bet references"),
        ).toBeVisible();
        await page.screenshot({
          path: resolve(output, "admin-bets.png"),
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.ok(
          await page.evaluate<boolean>(
            "document.documentElement.scrollWidth <= window.innerWidth + 1",
          ),
          "mobile page must not overflow",
        );
        await page.screenshot({
          path: resolve(output, "admin-bets-mobile.png"),
          fullPage: true,
        });
        for (const actor of ["master", "agent"]) {
          const context = await browser.newContext({
            extraHTTPHeaders: { "x-test-user": actor },
            viewport: { width: 390, height: 844 },
          });
          const branchPage = await context.newPage();
          branchPage.on("pageerror", (e) => errors.push(e.message));
          await branchPage.goto(`${base}/${actor}/accounts`);
          await expect(
            branchPage.getByRole("heading", {
              name: "Accounts & ledger tally",
            }),
          ).toBeVisible();
          await expect(
            branchPage.getByRole("heading", { name: "Top betting players" }),
          ).toHaveCount(0);
          await expect(
            branchPage.getByRole("region", {
              name: "Live player counts",
              exact: true,
            }),
          ).toContainText("Your branch");
          assert.ok(
            await branchPage.evaluate<boolean>(
              "document.documentElement.scrollWidth <= window.innerWidth + 1",
            ),
            `${actor} mobile overflow`,
          );
          await branchPage.screenshot({
            path: resolve(output, `${actor}-accounts-mobile.png`),
            fullPage: true,
          });
          await context.close();
        }
        assert.deepEqual(errors, []);
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await memory.close();
  }
});
