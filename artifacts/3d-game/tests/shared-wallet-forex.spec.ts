import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

test("Forex uses the lobby wallet, updates another tab, rejects refills and pays after leaving", async ({ page, context }) => {
  test.skip(!process.env.FOREX_TEST_EMAIL || !process.env.FOREX_TEST_PASSWORD, "Seed a funded fixture in an isolated _shared_wallet_test database first.");
  const login = await page.request.post("/api/auth/login", { data: { email: process.env.FOREX_TEST_EMAIL, password: process.env.FOREX_TEST_PASSWORD } });
  expect(login.ok(), await login.text()).toBeTruthy();
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({ settings: { sound: false, onboarded: true } })));
  const balance = async () => (await (await page.request.get("/api/wallet/balance")).json()).balance;
  expect(await balance()).toBe("1000000");
  await page.goto("/");
  await page.getByTestId("card-game-forex-trading").first().click();
  await expect(page.getByTestId("balance")).toHaveText("₹10,000");
  await expect(page.locator(".fa-game")).not.toContainText(/Practice|Refill/);
  const other = await context.newPage();
  await other.goto("/wallet");
  await expect(other.getByTestId("text-wallet-balance")).toContainText("10,000");

  let state: any;
  await expect.poll(async () => {
    state = await (await page.request.get("/api/forex/state")).json();
    return state.round.lockAt - state.serverTime;
  }, { timeout: 65000 }).toBeGreaterThan(25000);
  const input = { roundId: state.round.id, asset: "gold", side: "sell", amount: 100, requestId: randomUUID() };
  for (let i = 0; i < 2; i++) {
    const placed = await page.request.post("/api/forex/trades", { data: input });
    expect(placed.ok(), await placed.text()).toBeTruthy();
  }
  await expect(page.getByTestId("balance")).toHaveText("₹9,900");
  await expect(other.getByTestId("text-wallet-balance")).toContainText("9,900");
  expect((await page.request.post("/api/forex/refill", { data: {} })).status()).toBe(410);
  expect(await balance()).toBe("990000");
  const aliases = await (await page.request.get("/api/wallet/balances")).json();
  expect(aliases.balances["forex-trading"]).toBe("990000");
  expect(Object.values(aliases.balances).every(v => v === "990000")).toBeTruthy();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Open Wallet", exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByTestId("text-wallet-balance")).toContainText("9,900");
  // No Forex requests while waiting: the startup scheduler must settle independently.
  await expect.poll(balance, { timeout: 70000 }).toBe("1009000");
  await expect(other.getByTestId("text-wallet-balance")).toContainText("10,090");
  await page.goto("/forex-trading");
  await expect(page.getByTestId("balance")).toHaveText("₹10,090");
  await expect(page.getByRole("dialog")).toContainText("190.00");
  const history = await (await page.request.get("/api/wallet/transactions")).json();
  expect(history.entries.filter((e: any) => e.refType === "forex_bet")).toHaveLength(1);
  expect(history.entries.filter((e: any) => e.refType === "forex_payout")).toHaveLength(1);
  await page.screenshot({ path: path.resolve(import.meta.dirname, "../../../tmp/forex-integrated/wallet-win-mobile.png") });
  await other.close();
});
