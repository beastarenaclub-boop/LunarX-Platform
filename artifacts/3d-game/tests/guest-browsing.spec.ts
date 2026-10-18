import { test, expect, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

async function guestSite(page: Page, channel: "b2c" | "b2b", signedIn = false) {
  await mockGames(page);
  const privateReads: string[] = [];
  const writes: string[] = [];
  const errors: string[] = [];
  let sockets = 0;
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/(wallet|crash|mines|wingo|virtual-sports|lottery)\//.test(path)) privateReads.push(path);
    if (request.method() === "POST" && path !== "/api/auth/login") writes.push(path);
  });
  await page.routeWebSocket("**/ws", () => { sockets++; });
  await page.route("**/api/wallet/balances", route => route.fulfill({ json: { balances: { lunar: "1000000" } } }));
  await page.route("**/api/game/registry", route => route.fulfill({ json: [
    { gameCode: "mines", route: "/mines", enabled: true, title: "Mines" },
    { gameCode: "jetx", route: "/jetx", enabled: true, title: "JetX" },
  ] }));
  await page.route("**/api/auth/**", route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/site") return route.fulfill({ json: { channel, signupEnabled: channel === "b2c" } });
    if (path === "/api/auth/login") signedIn = true;
    if (path === "/api/auth/login" || path === "/api/auth/me") return route.fulfill(signedIn
      ? { json: { id: "guest-flow", email: "guest-flow@example.test", displayName: "Player", role: "player" } }
      : { status: 401, json: { error: "Sign in required" } });
    return route.fallback();
  });
  return { privateReads, writes, errors, sockets: () => sockets };
}

for (const channel of ["b2c", "b2b"] as const) {
  for (const width of [390, 1440]) {
    test(`${channel}: guests browse and search games at ${width}px without a session`, async ({ page }) => {
      const observed = await guestSite(page, channel);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "TOP Games", exact: true })).toBeVisible();
      await expect(page.getByTestId("input-login-email")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Sign up", exact: true })).toHaveCount(channel === "b2c" ? 1 : 0);
      if (width >= 768) await page.getByRole("button", { name: "Search games", exact: true }).click();
      await page.getByRole("searchbox").fill("mines");
      await expect(page.getByTestId("card-game-mines")).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
      expect(observed.privateReads).toEqual([]);
      expect(observed.sockets()).toBe(0);
      expect(observed.errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }

  test(`${channel}: choosing a game asks for login and resumes that game`, async ({ page }) => {
    const observed = await guestSite(page, channel);
    await page.goto("/");
    await page.getByTestId("card-game-mines").click();
    await expect(page).toHaveURL(/\/login\?next=%2Fmines$/);
    await expect(page.getByTestId("input-login-email")).toBeVisible();
    expect(observed.privateReads).toEqual([]);
    await page.getByTestId("input-login-email").fill("guest-flow@example.test");
    await page.getByTestId("input-login-password").fill("browser-test-password");
    await page.getByTestId("btn-login-submit").click();
    await expect(page).toHaveURL(/\/mines$/);
    await expect(page.locator('[data-game-viewport="mines"]')).toBeVisible();
    expect(observed.writes).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
}

test("direct game and account links stay protected, preserving the requested page", async ({ page }) => {
  const observed = await guestSite(page, "b2b");
  for (const path of ["/mines", "/jetx", "/horse-racing", "/lunar-colour-trading", "/lottery", "/virtual-sports/football", "/wallet?tab=deposit", "/history", "/profile"]) {
    await page.goto(path);
    await expect(page.getByTestId("input-login-email")).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(path);
  }
  expect(observed.privateReads).toEqual([]);
  expect(observed.writes).toEqual([]);
  expect(observed.errors).toEqual([]);
});

test("the lobby renders while the session check is pending", async ({ page }) => {
  await guestSite(page, "b2c");
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  await page.route("**/api/auth/me", async route => {
    await pending;
    await route.fulfill({ status: 401, json: { error: "Sign in required" } });
  });
  try {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "TOP Games", exact: true })).toBeVisible();
  } finally { finish(); }
});

test("login return links cannot leave the site or loop through authentication", async ({ page }) => {
  await guestSite(page, "b2c", true);
  for (const next of ["https://example.com", "//example.com", "/\\example.com", "/login", "/LOGIN/", "/signup/", "/launcher?token=untrusted"]) {
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "TOP Games", exact: true })).toBeVisible();
  }
});

for (const width of [390, 1440]) {
  test(`a master's playing website keeps game and login navigation within its branch at ${width}px`, async ({ page }) => {
    const observed = await guestSite(page, "b2b");
    await page.route("**/api/network/website/north-branch", route => route.fulfill({ json: {
      masterId: "north-branch", name: "North Branch", domain: "b2b.example.test",
      url: "https://b2b.example.test/branch/north-branch/", loginUrl: "https://b2b.example.test/branch/north-branch/login",
    } }));
    await page.setViewportSize({width, height:900});
    await page.goto("/branch/north-branch/");
    await expect(page.getByRole("link", {name:"North Branch home"})).toBeVisible();
    await expect(page.getByTestId("card-game-mines")).toHaveAttribute("href", "/branch/north-branch/mines");
    await page.getByTestId("card-game-mines").click();
    await expect(page).toHaveURL(/\/branch\/north-branch\/login\?next=%2Fmines$/);
    await page.reload();
    await expect(page.getByTestId("input-login-email")).toBeVisible();
    expect(observed.privateReads).toEqual([]);
    await page.getByTestId("input-login-email").fill("guest-flow@example.test");
    await page.getByTestId("input-login-password").fill("browser-test-password");
    await page.getByTestId("btn-login-submit").click();
    await expect(page).toHaveURL(/\/branch\/north-branch\/mines$/);
    await expect(page.locator('[data-game-viewport="mines"]')).toBeVisible();
    expect(observed.writes).toEqual([]);
    expect(observed.errors).toEqual([]);
  });
}

test("invalid or inactive branch links cannot display an unrelated lobby", async ({page}) => {
  await guestSite(page, "b2b");
  await page.route("**/api/network/website/**", route => route.fulfill({status:404,json:{error:{message:"Branch unavailable"}}}));
  await page.goto("/branch/inactive/");
  await expect(page.getByRole("heading", {name:"Branch website unavailable"})).toBeVisible();
  await expect(page.getByTestId("card-game-mines")).toHaveCount(0);
});
