import { test as base, expect, type Page } from "@playwright/test";

// Same auth bootstrap as game-pages-responsive.spec.ts: fresh account per test.
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const unique = `${testInfo.testId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const headers: Record<string, string> = {};
    if (process.env.TEST_RATE_LIMIT_BYPASS) {
      headers["x-test-bypass"] = process.env.TEST_RATE_LIMIT_BYPASS;
    }
    const res = await page.request.post("/api/auth/signup", {
      headers,
      data: {
        email: `playwright-${unique}@example.com`,
        password: "playwright-test-pw",
        displayName: "Playwright",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Failed to bootstrap auth: ${res.status()} ${await res.text()}`,
      );
    }
    await use(page);
  },
});

const STORAGE_KEY = "aviator:v1";

async function seedOnboarded(page: Page) {
  await page.addInitScript((key) => {
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : {};
      const settings = { ...(parsed.settings ?? {}), onboarded: true };
      const panels =
        Array.isArray(parsed.panels) && parsed.panels.length === 2
          ? parsed.panels
          : [{}, {}];
      localStorage.setItem(
        key,
        JSON.stringify({ ...parsed, settings, panels }),
      );
    } catch {
      localStorage.setItem(
        key,
        JSON.stringify({ settings: { onboarded: true }, panels: [{}, {}] }),
      );
    }
  }, STORAGE_KEY);
}

test.describe("lobby deposit/withdraw action bar", () => {
  test("Deposit CTA opens the wallet on the deposit tab", async ({ page }) => {
    await seedOnboarded(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const cta = page.locator('[data-testid="btn-action-deposit"]');
    await cta.waitFor({ state: "visible", timeout: 15_000 });
    await cta.click();
    await expect(page).toHaveURL(/\/wallet/);
    await expect(
      page.locator('[data-testid="tab-deposit"]'),
    ).toHaveAttribute("data-state", "active");
    await expect(
      page.locator('[data-testid="input-deposit-amount"]'),
    ).toBeVisible();
  });

  test("Withdraw CTA opens the wallet on the withdraw tab", async ({
    page,
  }) => {
    await seedOnboarded(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const cta = page.locator('[data-testid="btn-action-withdraw"]');
    await cta.waitFor({ state: "visible", timeout: 15_000 });
    await cta.click();
    await expect(page).toHaveURL(/\/wallet\?tab=withdraw/);
    await expect(
      page.locator('[data-testid="tab-withdraw"]'),
    ).toHaveAttribute("data-state", "active");
    // Withdraw pane content (KYC banner or the withdraw form) is rendered.
    await expect(
      page
        .locator(
          '[data-testid="banner-kyc-required"], [data-testid="input-withdraw-amount"]',
        )
        .first(),
    ).toBeVisible();
  });
});
