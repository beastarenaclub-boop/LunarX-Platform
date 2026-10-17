import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
test.skip(
  !process.env.PRIZE_TEST_API,
  "Requires isolated Prize Lotto test fixture.",
);
test.beforeEach(async ({ page, baseURL }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({
        settings: { onboarded: true, sound: false, music: false },
      }),
    ),
  );
  const result = await page.request.post("/api/auth/login", {
    headers: { Origin: baseURL! },
    data: {
      email: "prize-browser@example.test",
      password: "PrizeBrowser@12345",
    },
  });
  expect(result.ok()).toBeTruthy();
});
test("real wallet purchase, ticket history, cancellation and wallet navigation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page
    .getByTestId("section-hot")
    .getByTestId("card-game-prize-lotto")
    .click();
  await expect(page).toHaveURL(/\/prize-lotto$/);
  await expect(page.locator(".pl-reward")).toHaveCount(8);
  const balance = async () =>
    BigInt(
      (await (await page.request.get("/api/wallet/balance")).json()).balance,
    );
  const before = await balance();
  await page.getByLabel("Select Shopping", { exact: true }).click();
  await page.getByLabel("Ticket amount", { exact: true }).fill("1000");
  await expect(page.getByTestId("prize-return")).toHaveText("₹10,000");
  await expect(
    page.getByRole("button", { name: "Get my ticket" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Get my ticket" }).click();
  await expect(page.getByRole("dialog")).toContainText("voucher face value");
  await page.getByRole("button", { name: "Confirm & pay ₹1,000" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await balance()).toBe(before - 100000n);
  await page
    .locator(".pl-tabs")
    .getByRole("button", { name: "My tickets" })
    .click();
  const ticket = page
    .getByTestId("prize-ticket")
    .filter({ hasText: "Shopping" })
    .first();
  await ticket.getByRole("button", { name: "Cancel ticket" }).click();
  await expect(ticket).toContainText("cancelled");
  expect(await balance()).toBe(before);
  await page.getByLabel("Wallet balance", { exact: true }).click();
  await expect(page).toHaveURL(/\/wallet$/);
  expect(errors).toEqual([]);
});
test("player claim, admin fulfillment, private code display and verified draw", async ({
  page,
  browser,
}) => {
  await page.goto("/prize-lotto");
  await page
    .locator(".pl-tabs")
    .getByRole("button", { name: "My rewards" })
    .click();
  const ticket = page
    .getByTestId("prize-ticket")
    .filter({ hasText: "Travel" })
    .first();
  await ticket.getByRole("button", { name: "Claim voucher" }).click();
  await expect(ticket).toContainText("awaiting operator fulfilment");
  const context = await browser.newContext();
  const admin = await context.newPage();
  const adminOrigin = "http://127.0.0.1:5217";
  const login = await admin.request.post(`${adminOrigin}/api/auth/login`, {
    headers: { Origin: adminOrigin },
    data: {
      email: "prize-browser-admin@example.test",
      password: "PrizeBrowser@12345",
    },
  });
  expect(login.ok()).toBeTruthy();
  await admin.goto(`${adminOrigin}/admin/prize-lotto`);
  await expect(admin.getByTestId("admin-prize-lotto")).toBeVisible();
  const row = admin
    .getByRole("row")
    .filter({ hasText: "prize-browser" })
    .filter({ hasText: "requested" })
    .first();
  await row.getByRole("button", { name: "Fulfil voucher" }).click();
  await admin.getByLabel("Merchant / issuer").fill("Test Travel");
  await admin.getByLabel("Voucher code").fill("TEST-TRAVEL-10000");
  await admin
    .getByLabel("Redemption instructions")
    .fill("Test voucher only. Redeem full face value with the test issuer.");
  await admin
    .getByLabel("Expiry date")
    .fill(new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await admin.getByLabel("Confirm admin password").fill("PrizeBrowser@12345");
  await admin
    .getByRole("button", { name: "Deliver voucher", exact: true })
    .click();
  await expect(admin.getByRole("dialog")).toHaveCount(0);
  await expect(
    ticket.getByRole("button", { name: "View voucher" }),
  ).toBeVisible();
  await ticket.getByRole("button", { name: "View voucher" }).click();
  await expect(page.getByRole("dialog")).toContainText("TEST-TRAVEL-10000");
  await page.keyboard.press("Escape");
  await page
    .locator(".pl-tabs")
    .getByRole("button", { name: "Results", exact: true })
    .click();
  await page.locator(".pl-history details").first().locator("summary").click();
  await page
    .getByRole("button", { name: "Verify draw", exact: true })
    .first()
    .click();
  await expect(
    page.getByText("Verified: commitment and result match."),
  ).toBeVisible();
  await admin.getByRole("button", { name: "Game settings" }).click();
  await expect(admin.getByLabel("Reward RTP (%)")).toHaveValue("85");
  await admin.getByLabel("Reward RTP (%)").fill("90");
  await admin.getByLabel("Confirm admin password").fill("PrizeBrowser@12345");
  await admin.getByRole("button", { name: "Save settings" }).click();
  await expect(admin.getByRole("dialog")).toHaveCount(0);
  await expect(
    admin.getByText("9% win chance per selection", { exact: false }),
  ).toBeVisible();
  await context.close();
});
test("responsive rewards, keyboard focus, common coin settings and empty-state navigation", async ({
  page,
}) => {
  mkdirSync("tmp/prize-lotto-review", { recursive: true });
  await page.goto("/prize-lotto");
  for (const [width, height] of [
    [1440, 1050],
    [390, 844],
    [320, 568],
    [768, 1024],
    [932, 430],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".pl-reward")).toHaveCount(8);
    await page.getByLabel("Select Travel", { exact: true }).click();
    await expect(
      page.getByLabel("Select Travel", { exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    if (width === 1440 || width === 390)
      await page.screenshot({
        path: `tmp/prize-lotto-review/${width === 1440 ? "desktop" : "mobile"}.png`,
        fullPage: true,
      });
  }
  await page.getByTestId("coin-settings-button").click();
  await expect(page.getByTestId("coin-settings-dialog")).toBeVisible();
  await page.getByTestId("coin-settings-save").click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("table-coins:v3:prize-browser"),
    ),
  ).toBeTruthy();
  await page.getByLabel("Ticket amount", { exact: true }).fill("0");
  await expect(
    page.getByRole("button", { name: "Get my ticket" }),
  ).toBeDisabled();
  await page
    .locator(".pl-tabs")
    .getByRole("button", { name: "How to play" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Good luck starts with clear rules." }),
  ).toBeVisible();
});
