import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const require = createRequire(resolve("artifacts/api-server/package.json"));
const { chromium, expect } = require("@playwright/test"), express = require("express");
const directory = resolve(process.argv[2] ?? "artifacts/admin-panel/dist/public");
const app = express();
app.use("/admin", express.static(directory));
app.use((_req, res) => res.sendFile(resolve(directory, "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
await mkdir("tmp/bulk-controls-browser", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage();
    const errors = [], writes = [], previews = [], receipts = new Map();
    page.on("pageerror", error => errors.push(error.message));
    const playerRtpGames = ["lunar", "coin-flip"], tableGames = ["roulette-american", "coin-flip"];
    const masters = [{ id: "master-a", name: "Master A", playerRtpBps: 8500, status: "active" }];
    const budget = { mode: "per_game", combinedBankPaise: "43000", floorPaise: "0", remainingPaise: null, sameEachPaise: null };
    const games = ["lunar", "coin-flip", "roulette-american", "blackjack"].map(code => ({ code, enabled: true, retired: false,
      playerRtp: playerRtpGames.includes(code), tableModes: tableGames.includes(code), b2cRtpBps: null, mode: "normal", tableTargetRtpBps: null,
      defaultRtp: { minPercent: code === "blackjack" ? null : code === "coin-flip" ? 99 : 85, maxPercent: code === "blackjack" ? null : code === "coin-flip" ? 99 : 85,
        source: code === "coin-flip" ? "Fixed payout v2" : "Saved game default", note: "Original game payout rules" } }));
    let loseResponse = false, stale = false;
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
      const json = (value, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
      if (path === "/api/auth/me") return json({ id: "bulk-admin", email: "admin@test.invalid", displayName: "Operator", status: "active", role: "admin" });
      if (path === "/api/network/insights/live") return json({ role: "admin", totals: { online: 0, betting: 0, totalPlayers: 0 }, items: [] });
      if (path === "/api/game/b2c-rtp") return json({ policies: games.filter(g => g.playerRtp).map(g => ({ gameCode: g.code, playerRtpBps: null, revision: 0, defaultRtp: g.defaultRtp })) });
      if (path === "/api/admin/game-control") return json({ games: [], modes: ["normal", "collect", "distribute", "auto", "rtp"], bounds: {}, budget: { ...budget, budgetPaise: null, games: [] } });
      if (path === "/api/admin/game-control/bulk" && method === "GET") return json({ games, masters, budget, playerRtpGames, tableGames });
      if (path === "/api/admin/game-control/bulk/preview") {
        const operation = request.postDataJSON(); previews.push(operation);
        const b2cGames = operation.kind === "rtp" && operation.channel !== "b2b" ? playerRtpGames : [];
        const affectedMasters = operation.kind === "rtp" && operation.channel !== "b2c" ? masters : [];
        const tables = operation.kind !== "rtp" || operation.includeTables ? tableGames : [];
        return json({ operation, b2cGames, masters: affectedMasters, tableGames: tables, budget, previewToken: "signed-preview", expiresAt: Date.now() + 600000,
          changes: [...b2cGames.map(code => ({ target: `B2C / ${code}`, before: null, after: operation.playerRtpBps, unit: "rtp-bps" })),
            ...tables.map(code => ({ target: `Shared table / ${code}`, before: "normal", after: operation.mode ?? "rtp", unit: "mode" }))],
          excludedGames: [{ code: "blackjack", reason: "Outside this operation" }] });
      }
      if (path === "/api/admin/game-control/bulk" && method === "PUT") {
        const input = request.postDataJSON(); writes.push(input);
        if (request.headers()["x-confirm-password"] !== "test-password") return json({ error: { message: "Invalid confirmation password" } }, 403);
        if (stale) { stale = false; return json({ error: { message: "Settings changed after preview. Review again." } }, 409); }
        if (!receipts.has(input.requestId)) receipts.set(input.requestId, { requestId: input.requestId, appliedAt: new Date().toISOString(),
          b2cGames: input.operation.kind === "rtp" && input.operation.channel !== "b2b" ? playerRtpGames : [], masters: input.operation.kind === "rtp" && input.operation.channel !== "b2c" ? masters : [],
          tableGames: input.operation.kind !== "rtp" || input.operation.includeTables ? tableGames : [], budget });
        if (loseResponse) { loseResponse = false; return route.abort("failed"); }
        return json(receipts.get(input.requestId));
      }
      return json({ error: { message: "Unmocked route" } }, 404);
    });
    await page.goto(base + "/admin/b2c-rtp?section=bulk");
    try { await expect(page.getByRole("heading", { name: "All games · B2B + B2C", exact: true })).toBeVisible(); }
    catch (error) { console.error(JSON.stringify({ body: await page.locator("body").innerText(), errors })); throw error; }
    await expect(page.getByRole("row").filter({ hasText: "coin-flip" })).toContainText("99.00%");
    await expect(page.getByRole("row").filter({ hasText: "blackjack" })).toContainText("Varies by hand / bet");
    const preview = page.getByRole("button", { name: "Preview all-game changes", exact: true });
    await expect(preview).toBeDisabled();
    await page.getByLabel("Bulk target RTP", { exact: true }).fill("88.25");
    await preview.click();
    await expect(page.getByRole("region", { name: "Bulk change preview" })).toContainText("2 B2C policies · 1 B2B masters · 2 shared table games");
    assert.deepEqual(previews.at(-1), { kind: "rtp", channel: "both", playerRtpBps: 8825, includeTables: true });
    assert.equal(writes.length, 0, "Preview never saves");
    await expect(page.getByRole("button", { name: "Apply reviewed changes", exact: true })).toBeDisabled();
    await page.screenshot({ path: `tmp/bulk-controls-browser/preview-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "No horizontal page overflow");
    await page.getByLabel("Bulk confirm admin password").fill("test-password");
    await page.getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
    await expect(page.getByText("Saved together:", { exact: false })).toBeVisible();
    assert.equal(writes.length, 1); assert.equal(receipts.size, 1);
    await page.getByLabel("Bulk channels").selectOption("b2c");
    await page.getByLabel("Include shared table RTP modes").uncheck();
    await preview.click();
    await expect(page.getByRole("region", { name: "Bulk change preview" })).toContainText("2 B2C policies · 0 B2B masters · 0 shared table games");
    stale = true;
    await page.getByLabel("Bulk confirm admin password").fill("test-password");
    await page.getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Settings changed after preview");
    await expect(page.getByRole("region", { name: "Bulk change preview" })).toHaveCount(0);
    await expect(preview).toBeEnabled();
    await page.getByLabel("Bulk change", { exact: true }).selectOption("table-mode");
    await page.getByLabel("Bulk result mode").selectOption("auto");
    await page.getByLabel("Bulk target RTP", { exact: true }).fill("92");
    await preview.click();
    assert.deepEqual(previews.at(-1), { kind: "table-mode", mode: "auto", targetRtpBps: 9200 });
    await page.getByLabel("Bulk change", { exact: true }).selectOption("budget");
    await page.getByLabel("Bulk loss budget").fill("1250.75");
    await preview.click();
    assert.deepEqual(previews.at(-1), { kind: "budget", mode: "combined", budgetPaise: "125075" });
    await expect(page.getByRole("region", { name: "Bulk change preview" })).toContainText("₹1,250.75");
    loseResponse = true;
    await page.getByLabel("Bulk confirm admin password").fill("test-password");
    await page.getByRole("button", { name: "Apply reviewed changes", exact: true }).click();
    await expect(page.getByText("The last apply result is not confirmed.", { exact: false })).toBeVisible();
    const lostId = writes.at(-1).requestId, uniqueApplied = receipts.size;
    await page.reload();
    await expect(page.getByRole("button", { name: "Check / retry last apply", exact: true })).toBeVisible();
    await expect(page.getByLabel("Bulk change", { exact: true })).toBeDisabled();
    await page.getByLabel("Bulk confirm admin password").fill("wrong-password");
    await page.getByRole("button", { name: "Check / retry last apply", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("Invalid confirmation password");
    await expect(page.getByRole("button", { name: "Check / retry last apply", exact: true })).toBeVisible();
    await page.getByLabel("Bulk confirm admin password").fill("test-password");
    await page.getByRole("button", { name: "Check / retry last apply", exact: true }).click();
    await expect(page.getByText("Saved together:", { exact: false })).toBeVisible();
    assert.equal(receipts.size, uniqueApplied, "Lost response and wrong-password retry must never replenish a budget twice");
    assert.ok(writes.slice(-3).every(write => write.requestId === lostId));
    assert.equal(await page.evaluate(() => sessionStorage.getItem("pending-bulk-game-control:bulk-admin")), null);
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS bulk controls ${width}px: scope, previews, saves, stale settings, reload and idempotent budget retries`);
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
