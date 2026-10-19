import { test, expect, type Page } from "@playwright/test";

async function setup(
  page: Page,
  options: {
    loggedIn?: boolean;
    offline?: boolean;
    signup?: boolean;
    path?: string;
    demoSession?: boolean;
  } = {},
) {
  let loggedIn = !!options.loggedIn;
  let demo = !!options.demoSession;
  const expiresAt = new Date(Date.now() + 3600000).toISOString();
  const errors: string[] = [];
  const mutations: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.routeWebSocket("**/*", (socket) => socket.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/network/website") {
      // Production demo sessions reject account/network routes. Public branding
      // must still load after a demo starts and the storefront reloads.
      if ((await request.headerValue("cookie"))?.includes("sid=demo_regression"))
        return route.fulfill({ status: 403, json: { error: { message: "Demo gameplay only" } } });
      return route.fulfill({ contentType: "application/json", body: "null" });
    }
    if (request.method() === "POST") mutations.push(path);
    const user = {
      id: "b2c-test",
      email: "player@example.test",
      displayName: demo ? "Demo TEST01" : "Test Player",
      isDemo: demo,
      ...(demo ? { demoExpiresAt: expiresAt } : {}),
      role: "player",
      status: "active",
      createdAt: "2026-01-01T00:00:00Z",
    };
    if (path === "/api/auth/demo-login") { loggedIn = true; demo = true; return route.fulfill({ json: { user: { ...user, isDemo: true }, expiresAt } }); }
    if (path === "/api/auth/demo-heartbeat") return route.fulfill({ json: { expiresAt, serverNow: Date.now() } });
    if (path === "/api/auth/me")
      return route.fulfill(
        loggedIn
          ? { json: user }
          : { status: 401, json: { error: { message: "Sign in required" } } },
      );
    if (path === "/api/auth/site")
      return route.fulfill({
        json: {
          channel: options.signup === false ? "b2b" : "b2c",
          signupEnabled: options.signup !== false,
        },
      });
    if (path === "/api/auth/login") {
      if (request.postDataJSON().password === "incorrect")
        return route.fulfill({
          status: 401,
          json: {
            error: {
              code: "INVALID_CREDENTIALS",
              message: "Email or password is incorrect",
            },
          },
        });
      loggedIn = true;
      return route.fulfill({ json: { user } });
    }
    if (path === "/api/auth/logout") {
      loggedIn = false; demo = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/wallet/balances")
      return route.fulfill({
        json: {
          currency: "INR",
          balances: { lunar: "123456", mines: "123456", dice: "123456" },
        },
      });
    if (path === "/api/game/registry")
      return route.fulfill(
        options.offline
          ? { status: 503, json: { error: { message: "Offline" } } }
          : {
              json: [
                {
                  gameCode: "mines",
                  route: "/mines",
                  title: "Mines",
                  enabled: false,
                },
              ],
            },
      );
    if (path === "/api/bets")
      return route.fulfill({
        json: {
          entries: [
            {
              id: "lost",
              userId: user.id,
              gameCode: "dice",
              stakeAmount: "100",
              payoutAmount: "0",
              status: "lost",
              placedAt: "2026-10-18T10:00:00Z",
            },
          ],
          nextCursor: null,
        },
      });
    if (path.includes("free-bets"))
      return route.fulfill({
        json: { count: 0, totalAmount: "0", grants: [] },
      });
    if (path.includes("rain")) return route.fulfill({ json: null });
    return route.fulfill({
      status: 404,
      json: { error: { message: "Not mocked" } },
    });
  });
  await page.goto(options.path || "/");
  await expect(page.locator(".b2c-site")).toBeVisible({ timeout: 45_000 });
  return { errors, mutations };
}

test("demo session can reload the storefront's public branding", async ({ page, baseURL }) => {
  await page.context().addCookies([{ name: "sid", value: "demo_regression", url: baseURL! }]);
  const { errors } = await setup(page, { loggedIn: true, demoSession: true });
  await expect(page.getByRole("region", { name: "Demo session", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Demo session", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("standalone landing, banner controls and real catalog artwork", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1918, height: 1000 });
  const { errors } = await setup(page);
  await expect(page.locator(".b2c-brand img")).toHaveAttribute(
    "src",
    /brand-logo\.[a-f0-9]+\.webp$/,
  );
  await expect(
    page.getByRole("heading", { name: "OUR LIVE CASINO" }),
  ).toBeVisible();
  const gameIds = await page
    .locator(".b2c-game-grid [data-game-id]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-game-id")),
    );
  expect(new Set(gameIds).size).toBe(gameIds.length);
  expect(
    await page.locator(".b2c-game-grid [data-game-id]").count(),
  ).toBeGreaterThan(30);
  await expect(page.locator(".b2c-hero > img")).toHaveAttribute(
    "src",
    /crash-games-banner\.[a-f0-9]+\.webp$/,
  );
  await page.getByRole("button", { name: "Next banner" }).click();
  await expect(page.locator(".b2c-hero > img")).toHaveAttribute(
    "src",
    /casino-banner\.[a-f0-9]+\.webp$/,
  );
  await page.getByRole("button", { name: "Next banner" }).click();
  await expect(page.locator(".b2c-hero > img")).toHaveAttribute(
    "src",
    /instant-games-banner\.[a-f0-9]+\.webp$/,
  );
  await page.getByRole("button", { name: "Next banner" }).click();
  await expect(page.locator(".b2c-hero > img")).toHaveAttribute(
    "src",
    /crash-games-banner\.[a-f0-9]+\.webp$/,
  );
  await page.getByRole("button", { name: "Previous banner" }).click();
  await expect(page.locator(".b2c-hero > img")).toHaveAttribute(
    "src",
    /instant-games-banner\.[a-f0-9]+\.webp$/,
  );
  await page.getByRole("button", { name: "Next banner" }).click();
  await page.evaluate(async () => {
    const sources = new Set([
      ...Array.from(document.images, (image) => image.src),
      ...Array.from(
        document.querySelectorAll<SVGImageElement>(".b2c-game-art image"),
        (image) => image.href.baseVal,
      ),
    ]);
    await Promise.all(
      [...sources].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode();
      }),
    );
  });
  await page.screenshot({
    path: testInfo.outputPath("b2c-desktop.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("search, categories, disabled games and empty results", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Search games", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search games" });
  await search.fill("Mines");
  await expect(
    page.locator("#b2c-games [data-game-id='mines']"),
  ).toBeDisabled();
  await search.fill("no-such-game-991");
  await expect(
    page.getByRole("heading", { name: "No games found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all games", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Browse games" })
    .getByRole("button", { name: "Crash", exact: true })
    .click();
  await expect(page.locator("#b2c-games [data-game-id='jetx']")).toBeVisible();
  await expect(
    page.locator("#b2c-games [data-game-id='roulette']"),
  ).toHaveCount(0);
});

test("demo creates a temporary session and opens games with unlimited coins", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1918, height: 1000 });
  const { mutations } = await setup(page);
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Game providers" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Demo session", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Demo time remaining")).toContainText(/^(59|60):/);
  await expect(page.getByRole("button", { name: "Wallet balance ∞ Demo coins" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("b2c-demo.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Play Roulette", exact: true })
    .click();
  await expect(page).toHaveURL(/\/roulette$/);
  expect(mutations).toContain("/api/auth/demo-login");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/wallet?tab=withdraw");
  await expect(page.getByRole("heading", { name: "Unlimited demo coins" })).toBeVisible();
  await expect(page.getByRole("button", { name: /withdraw/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Exit Demo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Demo", exact: true })).toBeVisible();
});

test("login validates consent, reports errors, signs in and uses one shared balance", async ({
  page,
}) => {
  const { errors } = await setup(page);
  await page
    .locator(".b2c-header-actions")
    .getByRole("button", { name: "Login", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Login", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Email address").fill("player@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("incorrect");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Login", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Email or password is incorrect",
  );
  await dialog.getByLabel("Password", { exact: true }).fill("correct-password");
  await dialog.getByRole("button", { name: "Login", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Wallet balance ₹1,234.56" }),
  ).toBeVisible();
  await expect(
    page.getByText("Your settled winning rounds will appear here."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test Player", exact: true }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(
    page
      .locator(".b2c-header-actions")
      .getByRole("button", { name: "Login", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("selected game is preserved through authentication and B2B signup stays hidden", async ({
  page,
}) => {
  await setup(page, { signup: false });
  await page
    .locator("#b2c-games")
    .getByRole("button", { name: "Play Roulette", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("player account supplied by your agent");
  await expect(page.getByRole("button", { name: "Demo", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Play Demo", exact: true })).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Create an account" }),
  ).toHaveCount(0);
  await dialog.getByLabel("Email address").fill("player@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("correct-password");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Login", exact: true }).click();
  await expect(page).toHaveURL(/\/roulette$/);
});

test("offline registry remains browsable and the separate route works", async ({
  page,
}) => {
  await setup(page, { offline: true, path: "/b2c" });
  await expect(page.getByRole("status")).toContainText(
    "Game availability could not be refreshed",
  );
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await page.getByRole("button", { name: "Search games", exact: true }).click();
  await page.getByRole("searchbox", { name: "Search games" }).fill("Roulette");
  await expect(
    page
      .locator("#b2c-games")
      .getByRole("button", { name: "Play Roulette", exact: true }),
  ).toBeVisible();
});

for (const label of ["Now trending", "Top winners"]) {
  test(`${label} autoplays, pauses, loops and remains manually scrollable`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1918, height: 1000 });
    const { errors } = await setup(page);
    const region = page.getByRole("region", { name: label, exact: true });
    const viewport = region.locator(".b2c-slider-viewport");
    await viewport.scrollIntoViewIfNeeded();
    await expect(region).toHaveAttribute("data-loop", "true");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.mouse.move(0, 0);
    const position = () => viewport.evaluate((element) => element.scrollLeft);
    const initial = await position();
    await expect.poll(position).toBeGreaterThan(initial + 10);

    await region.hover();
    const hovered = await position();
    // Observe a real interval to catch unwanted movement while the pointer is on a card.
    await page.waitForTimeout(350);
    expect(await position()).toBe(hovered);
    await page.mouse.move(0, 0);
    await expect.poll(position).toBeGreaterThan(hovered + 10);

    await region
      .getByRole("button", { name: `Pause ${label}`, exact: true })
      .click();
    await viewport.evaluate((element) =>
      (document.activeElement as HTMLElement)?.blur(),
    );
    await page.mouse.move(0, 0);
    const stopped = await position();
    await page.waitForTimeout(350);
    expect(await position()).toBe(stopped);
    await region
      .getByRole("button", { name: `Next ${label}`, exact: true })
      .click();
    await expect.poll(position).toBeGreaterThan(stopped + 60);
    await region
      .getByRole("button", { name: `Resume ${label}`, exact: true })
      .click();
    await viewport.evaluate(() =>
      (document.activeElement as HTMLElement)?.blur(),
    );
    await page.mouse.move(0, 0);
    const cycle = await region
      .locator(".b2c-slider-group:not(.b2c-slider-copy)")
      .evaluate((element) => element.getBoundingClientRect().width);
    await viewport.evaluate((element, cycleWidth) => {
      element.scrollLeft = cycleWidth * 2 - 4;
    }, cycle);
    await expect.poll(position, { timeout: 6000 }).toBeLessThan(cycle + 50);

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reducedPosition = await position();
    await page.waitForTimeout(350);
    expect(await position()).toBe(reducedPosition);
    expect(errors).toEqual([]);
  });
}

for (const width of [360, 390, 768]) {
  test(`responsive lobby, navigation and login at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const { errors } = await setup(page);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`b2c-mobile-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Demo", exact: true }).click();
    await expect(page.getByRole("region", { name: "Demo session", exact: true })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "OUR VIRTUAL", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Exit Demo", exact: true }).click();
    await expect(page.getByRole("button", { name: "Demo", exact: true })).toBeVisible();
    await page
      .locator(".b2c-header-actions")
      .getByRole("button", { name: "Login", exact: true })
      .click();
    const bounds = await page.getByRole("dialog").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    expect(bounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: testInfo.outputPath(`b2c-login-${width}.png`),
    });
    expect(errors).toEqual([]);
  });
}
