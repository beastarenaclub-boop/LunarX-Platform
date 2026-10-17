import { test, expect } from "@playwright/test";
import path from "node:path";
import { quoteFixture } from "../../../../lib/forex/tests/quote-fixture.mjs";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/forex/quotes", route => route.fulfill({ json: quoteFixture() }));
});
const screenshots = path.resolve(
  import.meta.dirname,
  "../../../..",
  "tmp/forex-review",
);

test("shared asset pressure, placed prediction, persisted wallet, settlement and history", async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByText("Practice market connected")).toBeVisible();
  // Enter a fresh round with enough time to place the complete scenario.
  await expect
    .poll(
      async () => {
        const state = await (await page.request.get("/api/forex/state")).json();
        return state.round.lockAt - state.serverTime;
      },
      { timeout: 65000, intervals: [1000] },
    )
    .toBeGreaterThan(20000);
  await request.post("/api/forex/session", { data: {} });
  const otherState = await (await request.get("/api/forex/state")).json();
  await request.post("/api/forex/trades", {
    data: {
      asset: "silver",
      side: "buy",
      amount: 10,
      roundId: otherState.round.id,
      requestId: "browser-other-user",
    },
  });
  await page.locator(".fx-sell").click();
  await expect(page.getByRole("status")).toContainText("SELL placed");
  await expect(page.getByTestId("balance")).toContainText("9,900");
  await expect(page.getByTestId("direction")).toHaveText("DOWN ↘");
  await expect(page.locator(".fx-positions tbody tr")).toHaveCount(1);
  const ownState = await (await page.request.get("/api/forex/state")).json();
  expect(ownState.pool.participants).toBe(2);
  expect(
    ownState.assets.find((m: { id: string }) => m.id === "silver").direction,
  ).toBe("down");
  expect(
    ownState.assets.find((m: { id: string }) => m.id === "eurusd").direction,
  ).toBe("up");
  await page.reload();
  await expect(page.getByTestId("balance")).toContainText("9,900");
  await expect(page.locator(".fx-positions tbody tr")).toHaveCount(1);
  await page.screenshot({
    path: path.join(screenshots, "desktop.png"),
    fullPage: true,
  });
  await expect(page.getByTestId("balance")).toContainText("10,090", {
    timeout: 65000,
  });
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".fx-positions tbody")).toContainText("+90 CR");
  await expect(page.locator(".fx-positions tbody")).toContainText("WON");
  await page
    .getByRole("button", { name: "Round results", exact: true })
    .click();
  await expect(page.locator(".fx-positions tbody")).toContainText("DOWN");
  expect(errors).toEqual([]);
});

test("market selection, charts, filtering, validation and accessible rules", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Practice market connected")).toBeVisible();
  await page.getByRole("textbox", { name: "Search markets" }).fill("Silver");
  await page
    .getByRole("button", { name: "Select Silver Futures", exact: true })
    .click();
  await expect(page.locator(".fx-instrument h2")).toContainText("Silver");
  await page.getByRole("button", { name: "Line chart", exact: true }).click();
  await expect(
    page.getByRole("img", { name: /Silver Futures simulated game line chart/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Google market/ }).click();
  await page.getByRole("button", { name: "15m", exact: true }).click();
  await page.getByRole("spinbutton", { name: /Investment/ }).fill("11");
  await expect(page.locator(".fx-buy")).toBeDisabled();
  await expect(
    page.getByText("Use multiples of 10, from 10 to 5,000."),
  ).toBeVisible();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("all stakes ÷ 12");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});

for (const [width, height] of [
  [1440, 1000],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [320, 740],
]) {
  test(`responsive terminal at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expect(page.getByText("Practice market connected")).toBeAttached();
    await expect(page.locator(".fx-instrument h2")).toContainText("Gold");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Select Silver Futures", exact: true })
      .click();
    await expect(page.locator(".fx-instrument h2")).toContainText("Silver");
    await expect(page.locator(".fx-buy")).toBeVisible();
    await page.screenshot({
      path: path.join(screenshots, `terminal-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "How it works" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  });
}
