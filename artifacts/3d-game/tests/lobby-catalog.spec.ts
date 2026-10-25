import { test, expect, type Page } from "@playwright/test";
import { checkCategoryScrolling } from "./fixtures/category-scroll";

async function setupLobby(
  page: Page,
  options: { registryOffline?: boolean; brokenStorage?: boolean } = {},
) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ brokenStorage }) => {
    localStorage.setItem(
      "aviator:v1",
      JSON.stringify({ settings: { onboarded: true, sound: false } }),
    );
    if (
      brokenStorage &&
      localStorage.getItem("lunar:lobby:favourites:lobby-test") === null
    )
      localStorage.setItem("lunar:lobby:favourites:lobby-test", "{broken");
  }, options);
  await page.routeWebSocket("**/*", (socket) => socket.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/network/website")
      return route.fulfill({ contentType: "application/json", body: "null" });
    if (path === "/api/auth/site")
      return route.fulfill({ json: { channel: "b2b", signupEnabled: false } });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "lobby-test",
          email: "lobby@example.test",
          displayName: "Lobby tester",
          role: "player",
        },
      });
    if (path === "/api/wallet/balances")
      return route.fulfill({
        json: {
          balances: { lunar: "123456", mines: "123456", dice: "123456" },
        },
      });
    if (path === "/api/game/registry") {
      if (options.registryOffline)
        return route.fulfill({ status: 503, json: { error: "Offline" } });
      return route.fulfill({
        json: [
          { gameCode: "aviator", route: "/aviator", enabled: true, title: "Aviator" },
          { gameCode: "lunar", route: "/play", enabled: true, title: "Lunar Crash" },
          { gameCode: "jetx", route: "/jetx", enabled: true, title: "JetX" },
          {
            gameCode: "mines",
            route: "/mines",
            enabled: false,
            title: "Mines",
          },
          {
            gameCode: "horse-racing",
            route: "/horse-riding",
            enabled: true,
            title: "Wild Trails",
          },
          {
            gameCode: "wingo",
            route: "/wingo",
            enabled: true,
            title: "Win Go",
          },
          { gameCode: "jetx", route: "/jetx", enabled: true, title: "JetX" },
          {
            gameCode: "sic-bo",
            route: "/sic-bo",
            enabled: true,
            title: "Sic Bo",
          },
        ],
      });
    }
    if (path.includes("free-bets"))
      return route.fulfill({
        json: { count: 0, totalAmount: "0", grants: [] },
      });
    if (path.includes("rain")) return route.fulfill({ json: null });
    return route.fulfill({ status: 404, json: { error: "Not mocked" } });
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "TOP Games", exact: true }),
  ).toBeVisible();
  return errors;
}

test("one catalog has unique games, supported routes, disabled states and one shared balance", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const errors = await setupLobby(page);
  const cards = page.locator("[data-game-id]");
  const ids = await cards.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-game-id")),
  );
  expect(ids.length).toBeGreaterThan(25);
  expect(new Set(ids).size).toBe(ids.length);
  const routes = await cards
    .locator(":scope > a")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("href")),
    );
  expect(new Set(routes).size).toBe(routes.length);
  await expect(page.getByTestId("card-game-mines")).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByTestId("card-game-wild-trails")).toHaveAttribute(
    "href",
    "/horse-racing",
  );
  await expect(page.getByTestId("card-game-wingo")).toHaveAttribute(
    "href",
    "/lunar-colour-trading",
  );
  await expect(page.getByTestId("card-game-sic-bo")).toHaveCount(0);
  await expect(page.getByTestId("card-game-aviator")).toHaveCount(0);
  await expect(page.getByTestId("card-game-lunar")).toHaveCount(0);
  await expect(page.getByTestId("text-total-balance")).toContainText(
    "1,234.56",
  );
  await page.getByRole("tab", { name: "Betslip", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Favourites", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Your favourites live here" }),
  ).toBeVisible();
  await expect(page.getByTestId("btn-action-withdraw")).toHaveAttribute(
    "href",
    "/wallet?tab=withdraw",
  );
  await page
    .getByRole("button", { name: "Show all games", exact: true })
    .click();
  await expect(
    page.getByTestId("section-hot").locator("[data-game-id]"),
  ).toHaveCount(ids.length);
  await expect(
    page.getByRole("heading", { name: /More to Explore/ }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("search, category and provider filters return matching games and recover from empty results", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupLobby(page);
  await page.getByTestId("btn-category-racing").click();
  await expect(page.locator("[data-game-id]")).toHaveCount(7);
  await expect(page.getByTestId("card-game-bike-racing")).toBeVisible();
  await page.getByTestId("btn-category-all").click();
  await page.getByRole("button", { name: "Search games", exact: true }).click();
  const input = page.getByRole("searchbox");
  await expect(input).toBeFocused();
  await input.fill("  cHiCkEn  ");
  await expect(page.locator("[data-game-id]")).toHaveCount(3);
  await expect(page.getByTestId("card-game-chicken-road")).toBeVisible();
  await input.fill("a game that does not exist");
  await expect(
    page.getByRole("heading", { name: "No games found" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show all games", exact: true })
    .click();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await page
    .locator(".lobby-provider")
    .filter({ hasText: "SmartSoft" })
    .click();
  await expect(page.getByRole("heading", { name: /SmartSoft/ })).toBeVisible();
  await expect(page.getByTestId("card-game-jetx")).toBeVisible();
  await expect(page.getByTestId("card-game-chicken-road")).toHaveCount(0);
  await page.getByRole("button", { name: "Clear all filters" }).click();
  await expect(page.getByTestId("card-game-chicken-road")).toBeVisible();
});

test("New Games exposes Ludo first and supports board game tag search", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await setupLobby(page);
  await page.getByTestId("btn-category-new").click();
  const cards = page.locator("[data-game-id]");
  await expect(cards.first()).toHaveAttribute("data-game-id", "ludo");
  expect(await cards.evaluateAll(elements => elements.every(e => e.classList.contains("new-game-card")))).toBe(true);
  const search = page.getByRole("searchbox");
  await search.fill("board game");
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAttribute("data-game-id", "ludo");
  expect(errors).toEqual([]);
});

test("category strip supports mouse dragging and touch swiping without changing the filter", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await setupLobby(page);
  await checkCategoryScrolling(page, page.getByRole("navigation", { name: "Game categories", exact: true }));
  await expect(page.locator("[data-game-id]")).toHaveCount(3);
  expect(errors).toEqual([]);
});

test("families with three games are available from the header and mobile menu", async ({ page }) => {
  const errors = await setupLobby(page);
  const initialCount = await page.locator("[data-game-id]").count();
  for (const category of ["poker", "teen-patti", "chicken-road", "dice-games", "racing-games"]) {
    await page.getByTestId(`btn-category-${category}`).click();
    await expect(page.locator("[data-game-id]")).toHaveCount(3);
    await expect(page.getByTestId(`btn-category-${category}`)).toHaveAttribute("aria-pressed", "true");
    if (category === "teen-patti") await expect(page.getByTestId("card-game-teen-patti-joker")).toBeVisible();
  }
  await page.getByTestId("btn-category-all").click();
  await expect(page.locator("[data-game-id]")).toHaveCount(initialCount);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Poker", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("[data-game-id]")).toHaveCount(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("favourites persist without duplicating cards and mobile drawers support keyboard dismissal", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await setupLobby(page, { brokenStorage: true });
  await page
    .getByRole("button", { name: "Save JetX to favourites", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: "Remove JetX from favourites",
      exact: true,
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("button", { name: "Favourites" })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("link", { name: "JetX" })).toHaveAttribute(
    "href",
    "/jetx",
  );
  await drawer
    .getByRole("button", { name: "Remove JetX from favourites" })
    .click();
  await expect(
    drawer.getByRole("heading", { name: "Your favourites live here" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await page.getByRole("button", { name: "Open menu" }).click();
  await drawer.getByRole("button", { name: "Live Casino" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Live Casino/ }),
  ).toBeVisible();
  await expect(page.locator("[data-game-id]")).toHaveCount(7);
  expect(errors).toEqual([]);
});

test("responsive lobby fits phones, tablets and desktops with working artwork", async ({
  page,
}, testInfo) => {
  const errors = await setupLobby(page);
  for (const width of [320, 390, 768, 1024, 1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 1080 });
    const size = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(size.document, `overflow at ${width}px`).toBeLessThanOrEqual(
      size.viewport,
    );
    if (width <= 800) {
      const count = await page.getByRole("navigation", { name: "Game categories", exact: true }).evaluate(nav => {
        const bounds = nav.getBoundingClientRect();
        return [...nav.querySelectorAll("button")].filter(button => {
          const item = button.getBoundingClientRect();
          return item.left >= bounds.left - 1 && item.right <= bounds.right + 1;
        }).length;
      });
      expect(count, `Six categories visible at ${width}px`).toBeGreaterThanOrEqual(6);
    }
    await expect(page.getByTestId("card-game-jetx")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open menu" }),
    ).toBeInViewport();
    if (width === 390 || width === 1920) {
      await page.locator(".photo-banners").scrollIntoViewIfNeeded();
      await page.evaluate(async () => {
        await Promise.all(
          Array.from(document.images)
            .filter((image) => image.loading !== "lazy")
            .map((image) => image.decode().catch(() => {})),
        );
      });
      await page.evaluate(() => scrollTo(0, 0));
      await page.screenshot({
        path: testInfo.outputPath(`lobby-${width}.png`),
        fullPage: true,
      });
    }
  }
  const broken = await page
    .locator(".lobby-game-art img, .photo-banners-slide img")
    .evaluateAll((images) =>
      images
        .filter((element) => {
          const image = element as HTMLImageElement;
          return image.complete && image.naturalWidth === 0;
        })
        .map((image) => image.getAttribute("src")),
    );
  expect(broken).toEqual([]);
  expect(errors).toEqual([]);
});

test("catalog remains browsable when registry refresh fails", async ({
  page,
}) => {
  const errors = await setupLobby(page, { registryOffline: true });
  await expect(page.getByTestId("card-game-aviator")).toHaveCount(0);
  await expect(page.getByTestId("card-game-lunar")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Live game availability could not be refreshed",
  );
  await expect(page.getByTestId("card-game-jetx")).toHaveAttribute(
    "href",
    "/jetx",
  );
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("retired crash games stay unavailable through direct links and partner launch", async ({ page }) => {
  const errors = await setupLobby(page);
  await expect(page.getByTestId("card-game-jetx")).toHaveAttribute("href", "/jetx");
  await expect(page.getByTestId("card-game-fury")).toHaveAttribute("href", "/fury");
  await expect(page.getByTestId("card-game-wingo")).toHaveAttribute("href", "/lunar-colour-trading");
  for (const path of ["/aviator", "/play", "/lunar"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Page not found", exact: true })).toBeVisible();
    await expect(page.locator("[data-game-screen]")).toHaveCount(0);
  }
  for (const game of ["aviator", "lunar"]) {
    await page.goto(`/launcher?game=${game}`);
    await expect(page.getByText("This game is no longer available.", { exact: true })).toBeVisible();
  }
  expect(errors).toEqual([]);
});
