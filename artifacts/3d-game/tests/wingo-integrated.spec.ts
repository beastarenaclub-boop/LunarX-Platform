import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
const shots = path.resolve(
  import.meta.dirname,
  "../../../tmp/wingo-integrated",
);
const viewports = [
  [320, 720],
  [360, 740],
  [390, 844],
  [480, 800],
  [600, 900],
  [768, 1024],
  [850, 1100],
  [1024, 768],
  [1280, 720],
  [1440, 900],
  [1920, 1080],
  [1366, 600],
  [740, 360],
];
async function signUp(page: Page) {
  const email = `wingo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "WinGo-test-12345";
  const response = await page.request.post("/api/auth/signup", {
    data: { email, password, displayName: "Win Go test" },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return { email, password };
}
async function fitsWidth(page: Page) {
  const bounds = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
}

test("lobby card opens native Win Go and returning leaves the lobby styles intact", async ({
  page,
}) => {
  await signUp(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/");
  const card = page.getByTestId("card-game-wingo").first();
  await expect(card).toBeVisible();
  const before = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily,
    size: getComputedStyle(document.documentElement).fontSize,
  }));
  await card.click();
  await expect(page).toHaveURL(/\/lunar-colour-trading$/);
  await expect(page.getByTestId("balance")).toHaveText("0 INR");
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(page.locator(".wingo-integrated")).toBeVisible();
  await page.getByRole("button", { name: "Back to all games" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(card).toBeVisible();
  const after = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontFamily,
    size: getComputedStyle(document.documentElement).fontSize,
  }));
  expect(after).toEqual(before);
  await expect(page.getByTestId("card-game-lunar").first()).toBeVisible();
});

test("responsive controls, landscape dialogs, browser zoom with the 30-second countdown", async ({
  page,
}) => {
  await signUp(page);
  await page.goto("/wingo");
  await expect(page.getByTestId("balance")).toHaveText("0 INR");
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await fitsWidth(page);
    const panel = page.locator(".prediction-panel");
    const box = await panel.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(width);
    await page.getByTestId("btn-game-rules").click();
    await page.getByRole("button", { name: "Game rules & fairness" }).click();
    const dialog = page.getByRole("dialog").last();
    await expect(dialog).toBeVisible();
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
    expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width + 1);
    expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(height + 1);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await fitsWidth(page);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });
  await expect(page.locator('.mode-picker, .round-progress')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveText(/^00:[0-3][0-9]$/);
  await expect(page.getByTestId("period")).toContainText('#30-');
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Pick number 7", exact: true })
    .waitFor();
  await expect(
    page.getByRole("button", { name: "Pick number 7", exact: true }),
  ).toBeEnabled({ timeout: 35000 });
  await page
    .getByRole("button", { name: "Pick number 7", exact: true })
    .click();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({
    path: path.join(shots, "mobile.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({
    path: path.join(shots, "desktop.png"),
    fullPage: true,
  });
});

test("new accounts keep their shared wallet across login without a Win Go grant", async ({ page, browser }) => {
  const credentials = await signUp(page);
  const initial = await (await page.request.get("/api/wallet/balance")).json();
  expect(initial.balance).toBe("0");
  await page.goto("/wingo");
  await expect(page.getByTestId("balance")).toHaveText("0 INR");
  await expect(page.getByRole("button", { name: "Open shared wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refill practice coins" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("balance")).toHaveText("0 INR");
  const second = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    expect((await second.request.get("/api/wingo/state")).status()).toBe(401);
    const login = await second.request.post("/api/auth/login", { data: credentials });
    expect(login.ok(), await login.text()).toBeTruthy();
    const other = await second.newPage();
    await other.goto("/wingo");
    await expect(other.getByTestId("balance")).toHaveText("0 INR");
    const state = await (await second.request.get("/api/wingo/state")).json();
    expect(state.player.balance).toBe(0);
    expect(state.bets).toEqual([]);
    const shared = await (await second.request.get("/api/wallet/balance?game=wingo")).json();
    expect(shared.walletId).toBe(initial.walletId);
    expect(shared.balance).toBe(initial.balance);
  } finally {
    await second.close();
  }
});
