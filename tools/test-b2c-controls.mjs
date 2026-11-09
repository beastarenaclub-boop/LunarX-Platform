import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const require = createRequire(resolve("artifacts/api-server/package.json"));
const { chromium, expect } = require("@playwright/test");
const express = require("express");
const directory = resolve(process.argv[2] ?? "artifacts/admin-panel/dist/public");
const app = express();
app.use("/admin", express.static(directory));
app.use((_req, res) => res.sendFile(resolve(directory, "index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
await mkdir("tmp/b2c-controls-browser", { recursive: true });
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await context.newPage(), writes = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const games = ["roulette-american", "roulette-mini", "fun-target", "roulette", "lunar"].map(gameCode => ({
      game: { gameCode, enabled: true, houseEdge: .15, maxPerSpotPaise: "500000", ftDigitReturn: 9 },
      supported: gameCode !== "lunar", reason: "This game uses its own committed draw and RTP controls.",
      engine: gameCode === "lunar" ? null : { mode: "normal", revision: "1", bankPaise: "0", budgetPaise: "0",
        minBankFloorPaise: "0", floorMode: "per_game", effectiveFloorPaise: "0", effectiveBudgetPaise: "0", forcedChoice: null,
        params: { targetBankPaise: null, rtpHoldBps: 1000, targetHoldPct: .07 } },
    }));
    const policies = [{ gameCode: "lunar", playerRtpBps: null, revision: 0 }, { gameCode: "jetx", playerRtpBps: 2500, revision: 2 }];
    let role = "admin", controlReads = 0;
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const json = value => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(value) });
      if (request.method() !== "GET") writes.push({ path, body: request.postDataJSON() });
      if (path === "/api/auth/me") return json({ id: "test-admin", email: "admin@test.invalid", displayName: "Test operator", status: "active", role });
      if (path === "/api/network/insights/live") return json({ role: "admin", generatedAt: new Date().toISOString(), totals: { online: 0, betting: 0, totalPlayers: 0 }, items: [] });
      if (path === "/api/admin/game-control") {
        controlReads++;
        return json({ games, modes: ["normal", "collect", "distribute", "auto", "rtp"], bounds: {},
          budget: { mode: "per_game", budgetPaise: null, combinedBankPaise: "0" } });
      }
      if (/\/api\/admin\/game-control\/[^/]+\/choices$/.test(path)) return json([{ id: "1", label: "1" }]);
      if (/\/api\/admin\/game-control\/[^/]+\/history$/.test(path)) return json({ decisions: [], ledger: [] });
      if (path.startsWith("/api/admin/game-control/") && request.method() === "PUT") {
        const game = games.find(g => path.endsWith("/" + g.game.gameCode));
        if (game) Object.assign(game.engine, request.postDataJSON(), { revision: "2" });
        return json({ ok: true });
      }
      if (path === "/api/game/b2c-rtp") return json({ policies });
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: { message: "Unmocked test route" } }) });
    });
    await page.goto(base + "/admin/b2c-rtp");
    await expect(page.getByRole("heading", { name: "B2C Game Control", exact: true })).toBeVisible();
    await expect(page.getByText("These settings apply to shared table rounds", { exact: false })).toBeVisible();
    try { await expect(page.getByLabel("Result mode", { exact: true })).toHaveValue("normal"); }
    catch (error) { console.error(JSON.stringify({ body: await page.locator("body").innerText(), errors })); throw error; }
    assert.deepEqual(await page.getByLabel("Result mode", { exact: true }).locator("option").allTextContents(), ["normal", "collect", "distribute", "auto", "rtp"]);
    for (const code of ["roulette-american", "roulette-mini", "fun-target"]) {
      await page.getByRole("button").filter({ has: page.getByText(code, { exact: true }) }).click();
      await expect(page.getByLabel("Result mode", { exact: true })).toBeVisible();
    }
    await page.getByRole("button").filter({ has: page.getByText("roulette-american", { exact: true }) }).click();
    await page.getByLabel("Result mode", { exact: true }).selectOption("collect");
    await page.getByRole("tab", { name: "B2C player RTP", exact: true }).click();
    await expect(page.getByLabel("B2C game", { exact: true })).toHaveValue("lunar");
    await expect(page.getByRole("heading", { name: "Aviator / Lunar", exact: true })).toBeVisible();
    await page.getByLabel("B2C RTP policy", { exact: true }).selectOption("custom");
    await page.getByRole("spinbutton", { name: "B2C player RTP", exact: true }).fill("85");
    await page.getByRole("tab", { name: "Result modes & budgets", exact: true }).click();
    await expect(page.getByLabel("Result mode", { exact: true })).toHaveValue("collect");
    assert.equal(writes.length, 0, "Opening and switching sections must never change settings");
    await page.getByRole("button", { name: "Save game settings", exact: true }).click();
    await expect(page.getByText("Game Control saved", { exact: true })).toBeVisible();
    assert.equal(writes.length, 1); assert.equal(writes[0].path, "/api/admin/game-control/roulette-american");
    assert.equal(writes[0].body.mode, "collect"); assert.equal(writes[0].body.revision, "1");
    assert.equal(writes[0].body.budgetPaise, undefined, "Untouched budgets are preserved");
    await page.getByRole("tab", { name: "B2C player RTP", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "B2C player RTP", exact: true })).toHaveValue("85");
    await page.getByLabel("B2C game", { exact: true }).selectOption("jetx");
    await expect(page.getByTestId("b2c-saved-rtp")).toContainText("25.00%");
    await page.getByRole("tab", { name: "Result modes & budgets", exact: true }).click();
    await page.screenshot({ path: `tmp/b2c-controls-browser/modes-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), "No horizontal overflow");
    await page.reload();
    await expect(page.getByLabel("Result mode", { exact: true })).toHaveValue("collect");
    await page.getByRole("button").filter({ has: page.getByText("lunar", { exact: true }) }).click();
    await expect(page.getByLabel("Result mode", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Game Defaults for RTP, payouts and limits" })).toBeVisible();
    await page.goto(base + "/admin/game-control");
    await expect(page.getByRole("heading", { name: "Game Control", exact: true })).toBeVisible();
    await page.getByRole("button").filter({ has: page.getByText("roulette-american", { exact: true }) }).click();
    await expect(page.getByLabel("Result mode", { exact: true })).toHaveValue("collect");
    role = "support";
    const readsBefore = controlReads;
    await page.goto(base + "/admin/b2c-rtp");
    await expect(page.getByText("Only admin can manage B2C Game Control.", { exact: true })).toBeVisible();
    assert.equal(controlReads, readsBefore, "Support must not fetch privileged settings");
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`PASS B2C Game Control ${width}px: modes, saved settings, draft retention, RTP and permissions`);
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
