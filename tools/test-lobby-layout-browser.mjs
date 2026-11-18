import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { defaultLobbyLayout } from "../lib/api-zod/src/lobby-layout.ts";
const require = createRequire(
  new URL("../artifacts/api-server/package.json", import.meta.url),
);
const { chromium, expect } = require("@playwright/test");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
page.setDefaultTimeout(60_000);
page.setDefaultNavigationTimeout(120_000);
const issues = [];
page.on("pageerror", (error) => issues.push(error.message));
let saved = { revision: 0, updatedAt: null, layout: defaultLobbyLayout() };
let failSave = true;
let role = "admin";
await page.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  let body = {};
  if (path === "/api/auth/me")
    body = {
      id: "layout-admin",
      email: "layout@example.test",
      role,
      status: "active",
      displayName: "Layout Admin",
    };
  else if (path === "/api/network/insights/live")
    body = {
      role: "admin",
      generatedAt: new Date().toISOString(),
      windowSeconds: 120,
      totals: { totalPlayers: 0, online: 0, betting: 0, sessions: 0 },
      items: [],
      nodes: [],
    };
  else if (path === "/api/admin/lobby-layout") {
    if (route.request().method() === "PUT") {
      if (failSave)
        return route.fulfill({
          status: 500,
          json: {
            error: { code: "SAVE_FAILED", message: "Test save failure" },
          },
        });
      const input = route.request().postDataJSON();
      assert.equal(input.revision, saved.revision);
      saved = {
        revision: saved.revision + 1,
        updatedAt: new Date().toISOString(),
        layout: input.layout,
      };
    }
    body = saved;
  }
  return route.fulfill({ json: body });
});
try {
  await page.goto(
    process.env.LOBBY_ADMIN_TEST_URL ??
      "http://127.0.0.1:15175/admin/lobby-layout",
    { waitUntil: "domcontentloaded" },
  );
  await page.getByLabel("Position for Dice", { exact: true }).fill("1");
  await page.getByLabel("Position for Dice", { exact: true }).press("Enter");
  await page.getByLabel("Badge for Dice", { exact: true }).fill("HOT");
  await page
    .getByLabel("Search tags for Dice", { exact: true })
    .fill("favourite, featured");
  await page.getByTestId("save-lobby-layout").click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Test save failure" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Badge for Dice", { exact: true }).inputValue(),
    "HOT",
  );
  failSave = false;
  await page.getByTestId("save-lobby-layout").click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.equal(saved.layout.orders.casino[0], "dice");
  assert.equal(saved.layout.games.dice.label, "HOT");
  assert.deepEqual(saved.layout.games.dice.tags, ["favourite", "featured"]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByLabel("Position for Dice", { exact: true }).waitFor();
  assert.equal(
    await page
      .locator('[data-testid^="layout-game-"]')
      .first()
      .getAttribute("data-testid"),
    "layout-game-dice",
  );
  assert.equal(
    await page.getByLabel("Move Dice up", { exact: true }).isDisabled(),
    true,
  );
  await page.getByRole("tab", { name: "Lunar homepage" }).click();
  assert.notEqual(
    await page.getByLabel("Position for Dice", { exact: true }).inputValue(),
    "1",
  );
  await page.getByLabel("Position for Plinko", { exact: true }).fill("1");
  await page.getByLabel("Position for Plinko", { exact: true }).press("Enter");
  await page.getByRole("tab", { name: "Crypto777 homepage" }).click();
  await page
    .getByLabel("Feature Dice on Crypto777 homepage", { exact: true })
    .check();
  await page.getByLabel("Position for Dice", { exact: true }).fill("1");
  await page.getByLabel("Position for Dice", { exact: true }).press("Enter");
  await page.getByTestId("save-lobby-layout").click();
  await page.getByRole("status").filter({ hasText: "Saved." }).waitFor();
  assert.equal(saved.layout.orders.home[0], "plinko");
  assert.equal(saved.layout.orders.crypto[0], "dice");
  assert.equal(saved.layout.orders.casino[0], "dice");
  assert.ok(saved.layout.featured.includes("dice"));
  const out = fileURLToPath(
    new URL("../tmp/lobby-layout-qa/", import.meta.url),
  );
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: out + "/admin-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel("Search games to arrange").fill("dice");
  await page.screenshot({ path: out + "/admin-mobile.png" });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );

  // Player screens use their real sorting, filters and card components, with
  // the saved response above supplied at the network boundary.
  const player = await browser.newPage({
    viewport: { width: 1440, height: 950 },
  });
  player.setDefaultTimeout(60_000);
  player.setDefaultNavigationTimeout(120_000);
  player.on("pageerror", (error) => issues.push(error.message));
  let signedIn = true;
  await player.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me" && !signedIn)
      return route.fulfill({
        status: 401,
        json: { error: { code: "UNAUTHORIZED", message: "Sign in required" } },
      });
    let json = {};
    if (path === "/api/lobby/layout") json = saved;
    else if (path === "/api/auth/me")
      json = signedIn
        ? {
            id: "player",
            email: "player@example.test",
            role: "player",
            channel: "b2c",
            status: "active",
          }
        : null;
    else if (path === "/api/auth/site")
      json = { channel: "b2c", signupEnabled: true };
    else if (path === "/api/game/registry") json = [];
    else if (path === "/api/bets") json = { entries: [], total: 0 };
    else if (path.includes("wallet")) json = { balances: { lunar: "0" } };
    else if (path === "/api/banners/active") json = [];
    return route.fulfill({ json });
  });
  const playerUrl =
    process.env.LOBBY_PLAYER_TEST_URL ?? "http://127.0.0.1:5180";
  await player.goto(playerUrl + "/b2c", { waitUntil: "domcontentloaded" });
  await player.locator('.b2c-catalog [data-game-id="dice"]').waitFor();
  await expect(player.locator(".b2c-catalog [data-game-id]").first()).toHaveAttribute("data-game-id", "dice");
  await expect(player.locator('.b2c-catalog [data-game-id="dice"] .b2c-game-badge')).toHaveText("HOT");
  await player.screenshot({ path: out + "/crypto-casino.png" });
  console.log(
    "PASS: admin save/reload, mobile layout and All Casino order/badge",
  );
  signedIn = false;
  await player.reload({ waitUntil: "domcontentloaded" });
  await player
    .getByRole("button", { name: "Login", exact: true })
    .first()
    .waitFor();
  await player
    .locator(
      '.b2c-trending .b2c-slider-group:not(.b2c-slider-copy) [data-game-id="dice"]',
    )
    .first()
    .waitFor();
  await expect(player.locator(".b2c-trending .b2c-slider-group:not(.b2c-slider-copy) [data-game-id]").first()).toHaveAttribute("data-game-id", "dice");
  await player.screenshot({ path: out + "/crypto-homepage.png" });
  role = "support";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Only admins can change game order and tags.").waitFor();
  assert.deepEqual(issues, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "position, badges and tags",
        "save failure retains edits",
        "save and reload",
        "independent orders",
        "featured selection",
        "mobile overflow",
        "Crypto All Casino and homepage",
        "support role restriction",
      ],
      screenshots: out,
    }),
  );
} catch (error) {
  console.error(
    "Visible page:",
    (await page.locator("body").innerText()).slice(0, 1800),
  );
  const out = fileURLToPath(
    new URL("../tmp/lobby-layout-qa/", import.meta.url),
  );
  await mkdir(out, { recursive: true });
  await page.screenshot({ path: out + "/failure.png" });
  throw error;
} finally {
  await browser.close();
}
