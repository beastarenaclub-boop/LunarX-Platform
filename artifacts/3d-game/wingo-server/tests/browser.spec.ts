import { test, expect } from "@playwright/test";
import path from "node:path";
const shots = path.resolve(import.meta.dirname, "../../../../tmp/wingo-review");

test("desktop: real prediction, settlement, persistent balance, proof and chart", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  await expect
    .poll(
      async () => {
        const current = await (
          await page.request.get("/api/wingo/state?duration=30")
        ).json();
        return current.round.ends - current.serverTime;
      },
      { timeout: 35000 },
    )
    .toBeGreaterThan(12000);
  await expect(
    page.getByRole("button", { name: "Pick number 7", exact: true }),
  ).toBeEnabled({ timeout: 35000 });
  await page
    .getByRole("button", { name: "Pick number 7", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Play Number 7", exact: false })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm · 10 coins", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByTestId("balance")).toContainText("9,990");
  await expect(page.getByText("1 active prediction this round")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("balance")).toContainText("9,990");
  await page.getByRole("tab", { name: /My history/ }).click();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await expect(page.getByText("Pending", { exact: true })).not.toBeVisible({
    timeout: 40000,
  });
  await expect(page.locator(".bet-status")).toHaveText(/Won|Lost/);
  await page
    .getByRole("button", { name: "Verify this round", exact: true })
    .click();
  await page.getByRole("button", { name: "Verify in my browser" }).click();
  await expect(
    page.getByText(
      "Verified. The revealed result matches its published commitment.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("tab", { name: "Game history", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(shots, "desktop.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Chart", exact: true }).click();
  await expect(page.getByText("Every number has a story.")).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("tab", { name: /My history/ }).click();
  await page.getByRole("button", { name: "Export recent" }).click();
  expect((await download).suggestedFilename()).toBe("lunar-colour-trading-30s-history.csv");
  expect(errors).toEqual([]);
});

test("mobile widths, 30-second countdown, help, wallet and keyboard interactions", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/lunar-colour-trading");
  await expect(page).toHaveTitle("Colour Trading");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.mode-picker, .round-progress')).toHaveCount(0);
  await expect(page.getByTestId('countdown')).toHaveText(/^00:[0-3][0-9]$/);
  await expect(page.getByTestId("period")).toContainText('#30-');
  await page.getByRole("button", { name: "Game rules & fairness" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("cell", {name:"1.98×",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "Open practice wallet" }).click();
  await expect(
    page.getByRole("button", { name: "Refill practice coins" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: path.join(shots, "mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("disconnection locks play and reconnects without inventing outcomes", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("balance")).toContainText("10,000");
  await page.route("**/api/wingo/state**", (route) => route.abort());
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Pick number 7", exact: true }),
  ).toBeDisabled();
  await page.unroute("**/api/wingo/state**");
  await expect(page.getByRole("alert")).not.toBeVisible();
  await expect(page.getByTestId("balance")).toContainText("10,000");
});
