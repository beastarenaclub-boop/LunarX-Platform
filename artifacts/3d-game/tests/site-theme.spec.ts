import { test, expect, type Page } from "@playwright/test";

for (const path of ["/profile", "/"]) {
  test(`signing out from ${path} clears the session before login renders`, async ({
    page,
  }) => {
    await setup(page);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(path);
    if (path === "/") {
      await page.getByTestId("btn-user-menu").click();
      await page.getByTestId("menu-logout").click();
    } else
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId("input-login-email")).toBeVisible();
    await page.goto("/wallet");
    await expect(page).toHaveURL(/\/login\?next=%2Fwallet$/);
  });
}

async function setup(page: Page, { guest = false, approved = false } = {}) {
  let signedIn = !guest;
  const errors: string[] = [];
  const writes: { path: string; data: unknown }[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() =>
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({
        settings: { onboarded: true, sound: false, theme: "neon" },
      }),
    ),
  );
  await page.routeWebSocket("**/*", (socket) => socket.onMessage(() => {}));
  const profile = {
    id: "theme-test",
    email: "alex.long.email.address@example.test",
    displayName: "Alex Morgan",
    role: "player",
    status: "active",
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/logout") {
      signedIn = false;
      return route.fulfill({ status: 204 });
    }
    if (request.method() !== "GET") {
      writes.push({ path, data: request.postDataJSON() });
      return route.fulfill({ json: { id: "new-request", status: "pending" } });
    }
    if (path === "/api/auth/me")
      return route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn ? profile : { error: "Unauthorized" },
      });
    if (path === "/api/auth/site")
      return route.fulfill({ json: { channel: "b2c", signupEnabled: true } });
    if (path === "/api/profile") return route.fulfill({ json: profile });
    if (path === "/api/wallet/balance")
      return route.fulfill({ json: { balance: "1250000", scope: "lunar" } });
    if (path === "/api/wallet/balances")
      return route.fulfill({ json: { balances: { lunar: "1250000" } } });
    if (path === "/api/kyc")
      return route.fulfill({
        contentType: "application/json",
        json: approved
          ? {
              status: "approved",
              fullName: "Alex Morgan",
              documentType: "passport",
              documentNumber: "TEST1234",
              submittedAt: "2026-10-01T12:00:00Z",
            }
          : null,
      });
    if (path.endsWith("-limits"))
      return route.fulfill({
        json: { minAmountPaise: "10000", maxAmountPaise: "10000000" },
      });
    if (path.endsWith("deposit-settings"))
      return route.fulfill({
        json: { manualEnabled: true, autoEnabled: false },
      });
    if (path.endsWith("coin-packs"))
      return route.fulfill({
        json: [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000].map(
          (chipValue) => ({
            sku: `COINS-LUNAR-${chipValue * 10}`,
            chipValue,
            coins: chipValue * 10,
            amount: String(chipValue * 1000),
          }),
        ),
      });
    if (path.endsWith("upi-accounts"))
      return route.fulfill({
        json: [
          { id: "upi-test", label: "Lunar payments", upiId: "lunar-test@bank" },
        ],
      });
    if (path === "/api/bets" || path.endsWith("transactions"))
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    if (path === "/api/promotions/me")
      return route.fulfill({
        json: {
          balance: "50000",
          wagering: {
            requiredPaise: "0",
            completedPaise: "0",
            remainingPaise: "0",
            multiplier: 10,
          },
          referrals: {
            referralCode: "ALEX2026",
            totalReferred: 0,
            qualifiedCount: 0,
            totalEarnedPaise: "0",
            recent: [],
          },
          eligibleGames: ["Lunar", "Mines", "Plinko", "Dice"],
          settings: {
            signupBonusPaise: "10000",
            depositTiers: [],
            referrerRewardPaise: "50000",
            referrerMinDepositPaise: "500000",
            wageringMultiplier: 10,
          },
        },
      });
    if (path.includes("free-bets"))
      return route.fulfill({
        json: { count: 0, totalAmount: "0", grants: [] },
      });
    if (path.includes("rain")) return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  return { errors, writes };
}

test("wallet keeps server-priced deposits, withdrawal gating and in-page navigation", async ({
  page,
}) => {
  const { writes, errors } = await setup(page);
  await page.goto("/wallet?tab=withdraw");
  await expect(page.getByTestId("banner-kyc-required")).toBeVisible();
  await expect(page.getByTestId("text-wallet-balance")).toHaveText(
    "₹12,500.00",
  );
  await page
    .locator(".site-header")
    .getByRole("link", { name: "Deposit", exact: true })
    .click();
  await expect(page.getByTestId("tab-deposit")).toHaveAttribute(
    "data-state",
    "active",
  );
  await page.getByTestId("btn-coin-pack-COINS-LUNAR-2000").click();
  await expect(page.getByTestId("input-deposit-amount")).toHaveValue("2000");
  await expect(page.getByTestId("img-upi-qr")).toBeVisible();
  await page.getByTestId("input-deposit-ref").fill("123456789012");
  await page.getByTestId("btn-deposit-submit").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].path).toBe("/api/payments/deposits");
  expect(writes[0].data).toMatchObject({
    game: "lunar",
    packageSku: "COINS-LUNAR-2000",
    upiRef: "123456789012",
  });
  await page.getByTestId("tab-withdraw").click();
  await expect(page).toHaveURL(/tab=withdraw/);
  await expect(page.getByTestId("banner-kyc-required")).toBeVisible();
  await page.getByRole("link", { name: "Complete KYC", exact: true }).click();
  await expect(page.getByTestId("input-kyc-name")).toBeVisible();
  await page.getByTestId("select-kyc-doctype").click();
  await expect(
    page.getByRole("option", { name: "Passport", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("verified withdrawal preserves amount and UPI payload", async ({
  page,
}) => {
  const { writes } = await setup(page, { approved: true });
  await page.goto("/wallet?tab=withdraw");
  await page.getByTestId("input-withdraw-amount").fill("750");
  await page.getByTestId("input-withdraw-upi").fill("alex@bank");
  await page.getByTestId("btn-withdraw-submit").click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    path: "/api/payments/withdrawals",
    data: { amount: "75000", upiId: "alex@bank" },
  });
});

test("all account surfaces fit phones and desktops with the same theme", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const { errors } = await setup(page);
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    for (const path of [
      "/wallet",
      "/profile",
      "/history",
      "/promotions",
      "/help",
      "/verify",
      "/missing-page",
    ]) {
      await page.goto(path);
      await expect(page.locator(".site-page-heading h1")).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute(
        "data-site-theme",
        "lunar",
      );
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      const offscreen = await page
        .locator(
          ".site-content input, .site-content button, .site-content [role=tab]",
        )
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.width > 0 &&
                box.height > 0 &&
                (box.left < -1 || box.right > innerWidth + 1)
              );
            })
            .map((el) => el.getAttribute("data-testid") || el.textContent),
        );
      expect(offscreen, `${path} at ${width}px`).toEqual([]);
      if ([390, 1440].includes(width))
        await page.screenshot({
          path: testInfo.outputPath(`${path.slice(1)}-${width}.png`),
          fullPage: true,
        });
    }
  }
  expect(errors).toEqual([]);
});

test("auth screens stay themed and usable on small screens", async ({
  page,
}, testInfo) => {
  const { errors } = await setup(page, { guest: true });
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/login", "/signup", "/forgot", "/reset"]) {
      await page.goto(path);
      await expect(page.locator(".site-auth-form form").first()).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      if (path === "/login")
        await page.screenshot({
          path: testInfo.outputPath(`login-${width}.png`),
          fullPage: true,
        });
    }
  }
  await page.goto("/wallet");
  await expect(page).toHaveURL(/\/login\?next=%2Fwallet$/);
  expect(errors).toEqual([]);
});
