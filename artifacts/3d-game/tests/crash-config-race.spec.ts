import { test as base, expect } from "@playwright/test";

// Regression for: fetchAndApplyServerConfig applied whatever config response
// arrived last, so on slow networks a stale response for a previous game
// (e.g. lunar, fetched on engine init) could overwrite the config of the
// currently active crash game (e.g. aviator). The engine now drops responses
// whose gameCode no longer matches the active game.
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

test.describe("crash config race", () => {
  test("stale lunar config response cannot overwrite the active aviator config", async ({
    page,
  }) => {
    // Delay the lunar config response so it resolves AFTER the aviator page
    // has switched the engine to aviator and fetched aviator's config.
    await page.route("**/api/game/config/lunar/public", async (route) => {
      await new Promise((r) => setTimeout(r, 3000));
      await route.continue();
    });

    await page.goto("/aviator");

    // Wait until some config has been applied, then wait past the delayed
    // lunar response so a stale apply (the old bug) would have happened.
    await page.waitForFunction(
      () =>
        (window as unknown as Record<string, unknown>)
          .__lastAppliedGameConfig !== undefined,
      undefined,
      { timeout: 15000 },
    );
    await page.waitForTimeout(4500);

    const applied = await page.evaluate(
      () =>
        (window as unknown as Record<string, unknown>)
          .__lastAppliedGameConfig as {
          gameCode: string;
          activeGameCode: string;
        },
    );
    expect(applied.activeGameCode).toBe("aviator");
    expect(applied.gameCode).toBe("aviator");
  });
});
