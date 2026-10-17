import { test as base, expect, type Page } from "@playwright/test";

// Regression for: a saved `aviator:v1` payload missing `panels` (e.g. written
// by an older build, or partially cleared) used to crash BetPanel because
// `loadPersisted()` returned `panels: undefined` and clobbered the in-memory
// default. Loading /play with such a payload must render the game UI without
// throwing.
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

async function seedPartialPayload(page: Page, payload: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    { key: STORAGE_KEY, value: payload },
  );
}

test.describe("Lunar /play tolerates incomplete persisted player data", () => {
  test("renders normally when saved payload is missing `panels`", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    // Minimal payload: onboarded so we skip the intro overlay, but no
    // `panels` key at all (the case that used to crash BetPanel).
    await seedPartialPayload(page, { settings: { onboarded: true } });

    await page.goto("/play", { waitUntil: "domcontentloaded" });

    // TopBar's achievements button is rendered at every viewport and only
    // appears once the lunar shell mounts successfully — a good readiness
    // signal that the page didn't white-screen.
    await page.waitForSelector('[data-testid="btn-achievements"]', {
      state: "visible",
      timeout: 15_000,
    });

    // BetPanel is the component that previously crashed on `panels[0]`.
    // Either the bet/cashout/cancel button must be present (desktop / when
    // the Bet tab is active), or the Bet tab itself must be reachable
    // (smaller mobile layouts default to another tab).
    const hasBetButton =
      (await page.locator('[data-testid="btn-bet-0"]').count()) > 0 ||
      (await page.locator('[data-testid="btn-cashout-0"]').count()) > 0 ||
      (await page.locator('[data-testid="btn-cancel-0"]').count()) > 0;
    const hasBetTab =
      (await page.getByRole("tab", { name: /^Bet$/i }).count()) > 0;
    expect(
      hasBetButton || hasBetTab,
      "Bet panel did not render after loading partial persisted payload",
    ).toBe(true);

    expect(
      errors,
      `unexpected page errors after loading partial payload: ${errors.join("\n")}`,
    ).toEqual([]);
  });
});
