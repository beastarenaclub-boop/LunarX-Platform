import { test, expect } from "@playwright/test";

// Run only against the isolated _lottery_test database fixture, never customer funds.
test.skip(!process.env.LOTTERY_TEST_API, "Start the isolated lottery API and set LOTTERY_TEST_API.");
test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: false, music: false } })));
  const login = await page.request.post("/api/auth/login", { headers: { Origin: baseURL! }, data: { email: "lottery.browser@example.test", password: "LotteryTest@12345" } });
  expect(login.ok()).toBeTruthy();
});

test("lobby login opens lottery, coins debit the shared wallet, tickets reach admin and cancel refunds once", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const balance = async () => {
    const response = await page.request.get("/api/wallet/balance");
    const data = await response.json();
    expect(response.ok(), JSON.stringify(data)).toBeTruthy();
    return BigInt(data.balance);
  };
  const before = await balance();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("section-hot").getByTestId("card-game-lottery").click();
  await expect(page).toHaveURL(/\/lottery$/);
  await expect(page.getByTestId("lottery-connected")).toBeVisible();
  await expect(page.getByLabel("User ID", { exact: true })).toHaveCount(0);
  const state = await (await page.request.get("/api/lottery/bootstrap")).json();
  const future = state.draws.find((draw: { status: string; closes: number }) => draw.status === "open" && draw.closes > state.serverTime + 120000);
  await page.locator(".easy-options summary").click();
  await page.getByLabel("Draw time", { exact: true }).selectOption(future.id);
  await page.locator(".easy-options summary").click();
  await page.getByRole("button", { name: "Number 07", exact: true }).click();
  await page.getByTestId("chip-500").click();
  await expect(page.getByLabel("Quantity per number", { exact: true })).toHaveValue("5");
  const checkout = page.locator(".player-buy");
  await expect(checkout).toContainText("500");
  const bounds = await checkout.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  await checkout.click();
  await page.getByRole("button", { name: /Confirm bet/ }).click();
  await expect(page.getByText("Aapka ticket save ho gaya.", { exact: true })).toBeVisible();
  await expect.poll(balance).toBe(before - 50000n);
  const after = await (await page.request.get("/api/lottery/bootstrap")).json();
  const ticket = after.tickets[0];
  expect(ticket.total).toBe(500); expect(ticket.lines[0].unitPrice).toBe(100);
  const other = await (await page.request.get("/api/wingo/state?duration=30")).json();
  expect(BigInt(other.player.balance)).toBe(before - 50000n);
  const bets = await (await page.request.get("/api/bets")).json();
  expect(bets.entries.some((bet: { id: string; gameCode: string }) => bet.id === ticket.id && bet.gameCode === "lottery")).toBeTruthy();
  expect((await page.request.get("/api/lottery/admin")).status()).toBe(403);
  await page.getByRole("button", { name: "My tickets", exact: true }).last().click();
  await page.getByText(ticket.id, { exact: true }).click();
  await expect(page.getByRole("button", { name: /Print|Reprint/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel ticket", exact: true }).click();
  await page.getByRole("button", { name: "Confirm cancellation", exact: true }).click();
  await expect.poll(balance).toBe(before);
  expect((await page.request.post(`/api/lottery/tickets/${ticket.id}/cancel`, { headers: { Origin: baseURL! }, data: {} })).ok()).toBeTruthy();
  expect(await balance()).toBe(before);
  await page.goto("/lottery", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Wallet balance/ }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  expect(errors).toEqual([]);
});

test("mobile preserves paper tickets, even/odd, fixed prices and shared coin preferences", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lottery", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".nice-paper-ticket")).toHaveCount(10);
  await page.getByRole("button", { name: "Even", exact: true }).click();
  await expect(page.locator(".easy-step-title").first()).toContainText("50 selected");
  await page.getByRole("button", { name: "Odd", exact: true }).click();
  await expect(page.locator(".easy-step-title").first()).toContainText("50 selected");
  await page.getByTestId("coin-settings-button").click();
  await expect(page.getByTestId("coin-settings-dialog")).toBeVisible();
  await page.getByTestId("coin-settings-save").click();
  const preferences = await page.evaluate(() => localStorage.getItem("table-coins:v3:lottery-browser"));
  expect(preferences).toBeTruthy();
  await page.locator(".nice-paper-ticket").last().click();
  await expect(page.locator(".nice-paper-ticket").last()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("chip-100")).toHaveCount(0);
  await expect(page.getByTestId("chip-10000")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("table-coins:v3:lottery-browser"))).toBe(preferences);
  await expect(page.getByRole("button", { name: /Print|Reprint/ })).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "Back to lobby", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByTestId("section-hot").getByTestId("card-game-lottery")).toBeVisible();
});
