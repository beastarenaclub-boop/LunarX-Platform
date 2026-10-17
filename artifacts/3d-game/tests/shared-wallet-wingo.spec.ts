import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("Win Go uses the lobby wallet, updates another tab, and cannot refill shared funds", async ({ page, context }) => {
  test.skip(!process.env.WINGO_TEST_EMAIL || !process.env.WINGO_TEST_PASSWORD,
    "Seed a funded account in an isolated _shared_wallet_test database first.");
  const login = await page.request.post("/api/auth/login", { data: {
    email: process.env.WINGO_TEST_EMAIL, password: process.env.WINGO_TEST_PASSWORD,
  } });
  expect(login.ok(), await login.text()).toBeTruthy();
  const wallet = async (game = "lunar") => {
    const response = await page.request.get(`/api/wallet/balance?game=${game}`);
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const initial = await wallet();
  expect(initial.balance).toBe("1000000");
  await page.goto("/lunar-colour-trading");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  await expect(page.getByRole("button", { name: "Open shared wallet", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refill practice coins" })).toHaveCount(0);
  const otherTab = await context.newPage();
  await otherTab.goto("/wallet");
  await expect(otherTab.getByTestId("text-wallet-balance")).toContainText("10,000");

  let state: any;
  await expect.poll(async () => {
    state = await (await page.request.get("/api/wingo/state?duration=30")).json();
    return state.round.ends - state.serverTime;
  }, { timeout: 35000 }).toBeGreaterThan(15000);
  const slip = { duration: 30, period: state.round.period, pick: "green", stake: 1000, request: randomUUID() };
  for (let retry = 0; retry < 2; retry++) {
    const result = await page.request.post("/api/wingo/bets", { data: slip });
    expect(result.ok(), await result.text()).toBeTruthy();
  }
  await expect(page.getByTestId("balance")).toContainText("9,990");
  await expect(otherTab.getByTestId("text-wallet-balance")).toContainText("9,990");
  const aliases = await (await page.request.get("/api/wallet/balances")).json();
  expect(aliases.balances.wingo).toBe("999000");
  for (const value of await Promise.all(Object.keys(aliases.balances).map(wallet))) {
    expect(value.walletId).toBe(initial.walletId);
    expect(value.balance).toBe("999000");
  }
  expect((await page.request.post("/api/wingo/refill", { data: {} })).status()).toBe(410);
  expect((await wallet()).balance).toBe("999000");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open shared wallet", exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  await expect(page.getByTestId("text-wallet-balance")).toContainText("9,990");
  // The payout engine continues after the player leaves Win Go.
  await expect.poll(async () => {
    state = await (await page.request.get("/api/wingo/state")).json();
    return state.pending;
  }, { timeout: 40000 }).toBe(0);
  const expected = 999000 + state.bets[0].payout;
  expect(Number((await wallet()).balance)).toBe(expected);
  await page.goto("/wingo");
  await expect(page.getByTestId("balance")).toContainText((expected / 100).toLocaleString("en-IN"));
  const history = await (await page.request.get("/api/wallet/transactions?game=wingo")).json();
  expect(history.entries.filter((entry: any) => entry.refType === "wingo_bet")).toHaveLength(1);
  expect(history.entries.filter((entry: any) => entry.refType === "wingo_payout"))
    .toHaveLength(state.bets[0].payout > 0 ? 1 : 0);
  await otherTab.close();
});
