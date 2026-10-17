import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

test("restored flight keeps cashout available after rejection and waits for an accepted payout", async ({
  page,
}) => {
  await mockGames(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const startsAt = Date.now() - 5000;
  let attempts = 0,
    accepted = false;
  const receipt = () => ({
    id: "server-bet",
    panel: 0,
    stakeAmount: "10000",
    status: accepted ? "cashed_out" : "placed",
    multiplier: accepted ? 1.5 : null,
    payoutAmount: accepted ? "15000" : "0",
  });
  await page.route("**/api/crash/**", (route) =>
    route.fulfill({
      json: {
        id: "crash-browser",
        gameCode: "lunar",
        phase: "flying",
        now: Date.now(),
        startsAt,
        bettingMs: 5000,
        multiplier: 1.5,
        nextRoundAt: null,
        crashPoint: null,
        serverSeed: null,
        serverSeedHash: "committed",
        clientSeed: "browser",
        nonce: 0,
        version: 3,
        bets: [receipt()],
      },
    }),
  );
  await page.route("**/api/bets/server-bet/cashout", async (route) => {
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 400,
        json: {
          message: "Cashout multiplier is not available",
          detail: "Cashout multiplier is not available",
        },
      });
    await new Promise((resolve) => setTimeout(resolve, 500));
    accepted = true;
    await route.fulfill({
      json: {
        ...receipt(),
        gameCode: "lunar",
        userId: "viewport-test",
        roundId: "crash-browser",
        placedAt: new Date().toISOString(),
        settledAt: new Date().toISOString(),
      },
    });
  });
  await page.goto("/play");
  const cashout = page.getByTestId("btn-cashout-0").filter({ visible: true });
  await expect(cashout).toBeVisible();
  await cashout.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(cashout).toBeVisible();
  await cashout.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(cashout).toBeVisible();
  await expect(cashout).toHaveCount(0);
  expect(accepted).toBe(true);
  await page.reload();
  await expect(
    page.getByTestId("bet-panel-0").filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByTestId("btn-cashout-0")).toHaveCount(0);
});
