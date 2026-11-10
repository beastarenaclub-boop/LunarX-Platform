import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
const require = createRequire(resolve("artifacts/3d-game/package.json")),
  { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true }),
  base = process.env.ICE_FISH_URL ?? "http://127.0.0.1:5395";
await mkdir("tmp/reference-2026-11-10/browser", { recursive: true });
try {
  for (const viewport of [
    { width: 1586, height: 850 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const context = await browser.newContext({ viewport }),
      page = await context.newPage(),
      errors = [],
      writes = [],
      seen = new Map();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__iceAudioStarts = 0;
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) { window.__iceAudioStarts++; return start.apply(this, args); };
    });
    await page.routeWebSocket("**/ws*", (socket) => socket.close());
    const config = {
      enabled: true,
      houseEdge: 0.045,
      maxMultiplier: 5000,
      minStakePaise: "100",
      maxStakePaise: "500000",
      bettingWindowMs: 60000,
      revealDurationMs: 14000,
      settleDurationMs: 4000,
      pricingVersion: "test-pricing",
    };
    const outcome = (segment) => ({
      version: 1,
      segment,
      boosts: Array.from({ length: 45 }, (_, i) => (i % 9 === 0 ? 3 : 1)),
      fishValue: 20,
    });
    let roundId = "ice-browser-1",
      phase = "betting",
      revealDurationMs = 14000,
      revealElapsedMs = 0,
      bettingEndsAt = Date.now() + 60000,
      current = null,
      myBets = [],
      wallet = "1000000",
      loseResponse = false;
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname,
        json = (value) => route.fulfill({ status: 200, json: value });
      if (path === "/api/auth/me")
        return json({
          id: "ice-player",
          role: "player",
          status: "active",
          channel: "b2c",
          email: "ice@test.invalid",
          displayName: "Ice Player",
        });
      if (path === "/api/wallet/balance")
        return json({ balance: wallet, currency: "INR", scope: "lunar" });
      if (path === "/api/ice-fish/config") return json(config);
      if (path === "/api/ice-fish/recent") return json([]);
      if (path === "/api/ice-fish/round") {
        const snapshotEnd = phase === "betting" ? bettingEndsAt : Date.now() - revealElapsedMs;
        return json({
          roundId,
          gameCode: "ice-fish",
          phase,
          now: Date.now(),
          bettingEndsAt: snapshotEnd,
          revealEndsAt: snapshotEnd + revealDurationMs,
          settleEndsAt: snapshotEnd + revealDurationMs + 4000,
          serverSeedHash: "committed-seed",
          clientSeed: "public-client",
          nonce: 0,
          outcome: current,
          serverSeed: current ? "revealed-seed" : null,
          totalStake: "0",
          playerCount: 20,
          config: { ...config, revealDurationMs },
          myBets,
          liveBets: [],
          recent: Array.from({ length: 21 }, (_, i) => ({
            roundId: `old-${i}`,
            outcome: outcome([0, 3, 10, 22, 1, 2, 4][i % 7]),
            settledAt: new Date().toISOString(),
          })),
        });
      }
      if (path === "/api/ice-fish/bet") {
        const body = req.postDataJSON();
        writes.push(body);
        if (!seen.has(body.idempotencyKey)) {
          const total = body.bets.reduce(
            (n, b) => n + BigInt(b.amountPaise),
            0n,
          );
          wallet = String(BigInt(wallet) - total);
          const receipt = {
            slipId: `slip-${seen.size}`,
            roundId: body.roundId,
            totalStake: String(total),
            bets: body.bets,
            status: "pending",
            payoutAmount: "0",
            auditRoundId: null,
          };
          seen.set(body.idempotencyKey, receipt);
          myBets = [receipt];
        }
        if (loseResponse) {
          loseResponse = false;
          return route.abort("failed");
        }
        return json(seen.get(body.idempotencyKey));
      }
      if (path.endsWith("/verify")) return json({ verified: true });
      if (path === "/api/game/registry") return json({ games: [] });
      return json([]);
    });
    await page.goto(base + "/ice-fish");
    try {
      await expect(page.getByTestId("ice-fish-game")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Bet LIL’ BLUES", exact: true }),
      ).toBeEnabled();
    } catch (error) {
      console.error(
        JSON.stringify({
          errors,
          body: await page.locator("body").innerText(),
        }),
      );
      throw error;
    }
    await expect(page.getByTestId("demo-activity")).toHaveCount(0);
    await page.evaluate(async () => {
      await Promise.all(
        ["frozen-lake-v2.webp", "fish-atlas-v1.webp"].map(async (asset) => {
          const img = new Image();
          img.src = "/media/ice-fish/" + asset;
          await img.decode();
        }),
      );
    });
    await page.screenshot({
      path: `tmp/reference-2026-11-10/browser/betting-${viewport.width}.png`,
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 2,
      ),
      "No horizontal page overflow",
    );
    for (const name of [
      "Bet LIL’ BLUES",
      "Bet BIG GREEN",
      "Bet HUGE REDS",
      "Game settings",
    ]) {
      const box = await page
        .getByRole("button", { name, exact: true })
        .boundingBox();
      assert.ok(
        box &&
          box.x >= 0 &&
          box.x + box.width <= viewport.width + 1 &&
          box.y + box.height <= viewport.height + 2,
        `${name} stays accessible`,
      );
    }
    assert.equal(writes.length, 0, "Opening the game cannot spend money");
    await page
      .getByRole("button", { name: "Select ₹50 chip", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Bet LIL’ BLUES", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Selected ₹ 50");
    await page
      .getByRole("button", { name: "Bet all three fish bonuses", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Selected ₹ 200");
    await page
      .getByRole("button", { name: "Undo last chip", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Selected ₹ 50");
    await page
      .getByRole("button", { name: "Cancel selected bets", exact: true })
      .click();
    await expect(page.getByText("Selected ₹", { exact: false })).toHaveCount(0);
    await page
      .getByRole("button", { name: "Bet BIG GREEN", exact: true })
      .click();
    loseResponse = true;
    bettingEndsAt = Date.now() + 6500;
    await expect.poll(() => writes.length, { timeout: 12000 }).toBe(1);
    await expect(
      page.getByRole("button", { name: "Check / retry bet", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Check / retry bet", exact: true })
      .click();
    await expect.poll(() => writes.length).toBe(2);
    assert.equal(writes[0].idempotencyKey, writes[1].idempotencyKey);
    assert.equal(wallet, "995000");
    assert.equal(seen.size, 1);
    roundId = "ice-browser-2";
    bettingEndsAt = Date.now() + 60000;
    myBets = [];
    await expect(
      page.getByRole("button", { name: "Repeat previous bets", exact: true }),
    ).toBeEnabled({ timeout: 6000 });
    await page
      .getByRole("button", { name: "Repeat previous bets", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Selected ₹ 50");
    await page
      .getByRole("button", { name: "Cancel selected bets", exact: true })
      .click();
    phase = "reveal";
    revealDurationMs = 42000;
    bettingEndsAt = Date.now() - 1000;
    revealElapsedMs = 1000;
    current = outcome(10);
    await expect(page.locator(".if-wheel-stage")).toHaveClass(/is-zoomed/, {
      timeout: 6000,
    });
    await expect(page.locator(".if-chip-row")).toBeHidden();
    await expect(page.locator(".if-countdown")).toBeHidden();
    revealElapsedMs = 12300;
    current = outcome(10);
    await expect(
      page.getByRole("status", { name: "BIG GREEN fishing bonus" }),
    ).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId("ice-fishing-bonus")).toHaveAttribute("data-stage", "underwater");
    await page.screenshot({
      path: `tmp/reference-2026-11-10/browser/bonus-${viewport.width}.png`,
      fullPage: true,
    });
    await expect(page.locator(".if-bet-console")).toBeHidden();
    for (const [elapsed, stage] of [[18500, "casting"], [25000, "reeling"], [35000, "catch"]]) {
      revealElapsedMs = elapsed;
      await expect(page.getByTestId("ice-fishing-bonus")).toHaveAttribute("data-stage", stage, {timeout:6000});
      await expect(page.locator(".if-fisher")).toBeVisible();
      await page.evaluate(async () => { await Promise.all(["fishing-station-v3.webp", "fisher-v3.webp", "fish-school-v3.webp"].map(async name => {const image = new Image(); image.src = "/media/ice-fish/" + name; await image.decode();})); });
      await page.screenshot({path:`tmp/reference-2026-11-10/browser/${stage}-${viewport.width}.png`,fullPage:true});
    }
    phase = "settling";
    bettingEndsAt = Date.now() - 42000;
    revealElapsedMs = 42000;
    myBets = [{slipId:"bonus-win",totalStake:"5000",bets:[{type:"green",amountPaise:"5000"}],status:"settled",payoutAmount:"92419",auditRoundId:null,pricingConfig:{...config,houseEdge:.045}}];
    await expect(page.getByTestId("ice-bonus-result")).toContainText("YOU WON",{timeout:6000});
    await expect(page.getByTestId("ice-bonus-result")).toContainText("924.19");
    await page.screenshot({path:`tmp/reference-2026-11-10/browser/bonus-win-${viewport.width}.png`,fullPage:true});
    for (const [segment, color] of [[3,"blue"],[22,"red"]]) {
      roundId = `bonus-${color}`; current = outcome(segment); myBets = [];
      await expect(page.getByTestId("ice-fishing-bonus")).toHaveClass(new RegExp(`bonus-${color}`),{timeout:6000});
      await expect(page.getByTestId("ice-bonus-result")).not.toContainText("YOU WON");
    }
    await page.reload();
    await expect(page.getByTestId("ice-fishing-bonus")).toHaveAttribute("data-stage","result",{timeout:6000});
    await expect(page.locator(".if-coin-rain")).toHaveCount(0);
    roundId = "ice-browser-3";
    phase = "settling";
    revealDurationMs = 14000;
    bettingEndsAt = Date.now() - 14000;
    revealElapsedMs = 14000;
    current = outcome(0);
    await expect(page.getByTestId("ice-fish-result")).toContainText(
      "White anchor",
      { timeout: 6000 },
    );
    await page.screenshot({
      path: `tmp/reference-2026-11-10/browser/result-${viewport.width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Open game menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "How to play", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("95.50%");
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("button", { name: "Open results and bet history", exact: true }).click();
    await expect(page.getByRole("tab", {name:"Wheel results"})).toHaveAttribute("aria-selected","true");
    await expect(page.locator(".if-result-row")).toHaveCount(21);
    await page.getByRole("tab", {name:"My bets"}).click();
    await expect(page.getByRole("dialog")).toContainText("No settled bets yet.");
    await page.getByRole("button", {name:"Close dialog",exact:true}).click();
    await page
      .getByRole("button", { name: "Game settings", exact: true })
      .click();
    await page.getByRole("button", { name: "Sound off", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Sound on", exact: true }),
    ).toBeVisible();
    await page.getByRole("slider", {name:"Sound volume"}).fill("0.35");
    assert.equal(await page.evaluate(() => localStorage.getItem("ice-fish:volume")),"0.35");
    await page.getByRole("button",{name:"Animations on",exact:true}).click();
    await expect(page.getByTestId("ice-fish-game")).toHaveClass(/reduce-motion/);
    await page.getByRole("button",{name:"Close dialog",exact:true}).click();
    roundId = "ice-sound-check"; phase = "betting"; current = null; myBets = []; bettingEndsAt = Date.now() + 60000;
    await expect(page.getByRole("button", { name: "Bet BIG GREEN", exact:true })).toBeEnabled({timeout:6000});
    const audioBefore = await page.evaluate(() => window.__iceAudioStarts);
    await page.getByRole("button", { name: "Bet BIG GREEN", exact:true }).click();
    await expect.poll(() => page.evaluate(() => window.__iceAudioStarts)).toBeGreaterThan(audioBefore);
    await page.getByRole("button", {name:"Cancel selected bets",exact:true}).click();
    assert.deepEqual(errors, []);
    assert.equal(writes.length, 2);
    await context.close();
    console.log(
      `PASS Ice Fish ${viewport.width}x${viewport.height}: chips, retry, underwater/cast/reel/catch, all fish colours, own win, spectator, reconnect, result history and sound settings`,
    );
  }
} finally {
  await browser.close();
}
