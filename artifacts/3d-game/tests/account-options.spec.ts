import { test, expect, type Page } from "@playwright/test";

const options = [
  "Account Statement",
  "Current Bets",
  "Activity Log",
  "Casino Results",
  "Live Casino Bets",
  "SportBook Bets",
  "Set Button Value",
  "Change Password",
  "Security Auth Verification",
];
const routes = [
  "/report/accountstatement",
  "/report/currentbets",
  "/report/activity",
  "/report/casinoresult",
  "/report/livecasinoresult",
  "/report/sportbookresult",
  "/settings/buttonvalue",
  "/settings/changepassword",
  "/settings/secureauth",
];
async function setup(page: Page, path = "/profile") {
  let loggedIn = true,
    reportFails = false,
    revoked = false;
  const errors: string[] = [],
    requests: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.routeWebSocket("**/*", (socket) => socket.onMessage(() => {}));
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    requests.push(request.method() + " " + path + url.search);
    const user = {
      id: "profile-test",
      email: "player@example.test",
      displayName: "Test Player",
      role: "player",
      status: "active",
      isDemo: false,
      createdAt: "2026-01-01T00:00:00Z",
    };
    if (path === "/api/auth/me")
      return route.fulfill(
        loggedIn
          ? { json: user }
          : { status: 401, json: { error: { message: "Sign in required" } } },
      );
    if (path === "/api/auth/site")
      return route.fulfill({ json: { channel: "b2c", signupEnabled: true } });
    if (path === "/api/profile") return route.fulfill({ json: user });
    if (path === "/api/kyc")
      return route.fulfill({ contentType: "application/json", body: "null" });
    if (path === "/api/wallet/balance")
      return route.fulfill({ json: { balance: "1234500", currency: "INR" } });
    if (path === "/api/wallet/balances")
      return route.fulfill({
        json: { currency: "INR", balances: { lunar: "1234500" } },
      });
    if (path === "/api/game/registry") return route.fulfill({ json: [] });
    if (path === "/api/bets")
      return route.fulfill({ json: { entries: [], nextCursor: null } });
    if (path.includes("free-bets"))
      return route.fulfill({
        json: { count: 0, totalAmount: "0", grants: [] },
      });
    if (path.includes("rain")) return route.fulfill({ json: null });
    if (path.startsWith("/api/reports/")) {
      if (reportFails)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Offline" } },
        });
      const isStatement = path.endsWith("accountstatement"),
        activity = path.endsWith("activity"),
        empty = path.endsWith("currentbets");
      const next = !!url.searchParams.get("cursor");
      const row = {
        id: next ? "second" : "first",
        at: "2026-10-18T12:00:00Z",
        ...(isStatement
          ? {
              type: "bet",
              amount: "-10000",
              balance: "90000",
              reference: "round-123",
            }
          : activity
            ? { action: "auth.login", ip: "127.0.0.1", device: "Test browser" }
            : {
                game: path.endsWith("sportbookresult")
                  ? "virtual-cricket"
                  : "roulette",
                stake: "10000",
                payout: "20000",
                status: "won",
                reference: "round-123",
              }),
      };
      return route.fulfill({
        json: {
          items: empty ? [] : [row],
          nextCursor: isStatement && !next ? "next-page" : null,
        },
      });
    }
    if (path === "/api/profile/security")
      return route.fulfill({
        json: {
          sessions: [
            {
              current: true,
              createdAt: "2026-10-18T10:00:00Z",
              expiresAt: "2026-11-18T10:00:00Z",
              ip: "127.0.0.1",
              device: "Chrome desktop",
            },
            ...(!revoked
              ? [
                  {
                    current: false,
                    createdAt: "2026-10-17T10:00:00Z",
                    expiresAt: "2026-11-17T10:00:00Z",
                    ip: "127.0.0.2",
                    device: "Mobile browser",
                  },
                ]
              : []),
          ],
        },
      });
    if (
      path.startsWith("/api/profile/security/") ||
      path === "/api/profile/password"
    ) {
      const body = request.postDataJSON();
      if (body.currentPassword !== "correct-password")
        return route.fulfill({
          status: 400,
          json: { error: { message: "Current password is incorrect." } },
        });
      if (path.endsWith("revoke-others")) revoked = true;
      if (path === "/api/profile/password") loggedIn = false;
      return route.fulfill({ json: { success: true, verified: true } });
    }
    if (path === "/api/dice/config")
      return route.fulfill({
        json: {
          enabled: true,
          houseEdge: 0.01,
          maxMultiplier: 100,
          maxStakePaise: "500000",
          minTarget: 2,
          maxTarget: 98,
        },
      });
    if (path === "/api/dice/seed")
      return route.fulfill({
        json: {
          serverSeedHash: "hash",
          clientSeed: "client",
          nextNonce: 1,
          createdAt: new Date().toISOString(),
          lastRotatedAt: new Date().toISOString(),
        },
      });
    if (path === "/api/dice/recent") return route.fulfill({ json: [] });
    return route.fulfill({
      status: 404,
      json: { error: { message: "Not mocked" } },
    });
  });
  await page.goto(path);
  return {
    errors,
    requests,
    failReports: (fail: boolean) => {
      reportFails = fail;
    },
  };
}

test("all nine profile options open their pages on desktop and mobile", async ({
  page,
}) => {
  const state = await setup(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/profile");
    const nav = page.getByRole("navigation", { name: "Profile options" });
    await expect(nav.getByRole("link")).toHaveCount(9);
    for (let i = 0; i < options.length; i++) {
      await nav.getByRole("link", { name: options[i], exact: false }).click();
      await expect(page).toHaveURL(new RegExp(routes[i] + "$"));
      await expect(
        page.getByRole("heading", { name: options[i], exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      await page.getByRole("link", { name: "← Profile options" }).click();
    }
    await page.screenshot({
      path: `test-results-account/profile-${width}.png`,
      fullPage: true,
    });
  }
  expect(state.errors).toEqual([]);
});
test("lobby account dropdown exposes the requested options", async ({
  page,
}) => {
  await setup(page, "/");
  await page.locator(".b2c-account").click();
  for (const option of options)
    await expect(
      page.getByRole("menuitem", { name: option, exact: true }),
    ).toBeVisible();
});
test("reports filter, paginate, and recover after failures", async ({
  page,
}) => {
  const state = await setup(page, routes[0]);
  await expect(page.getByText("1 records loaded")).toBeVisible();
  await page.getByRole("button", { name: "Load more" }).click();
  await expect(page.getByText("2 records loaded")).toBeVisible();
  await page.getByLabel("From", { exact: true }).fill("2026-10-01");
  await page.getByLabel("To", { exact: true }).fill("2026-10-18");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect
    .poll(() =>
      state.requests.some((url) =>
        url.includes("from=2026-10-01&to=2026-10-18"),
      ),
    )
    .toBe(true);
  state.failReports(true);
  await page.getByRole("button", { name: "Refresh report" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not load");
  state.failReports(false);
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.goto(routes[1]);
  await expect(
    page.getByText("You have no pending bets for this period."),
  ).toBeVisible();
  expect(state.errors).toEqual([]);
});
test("button values persist, validate duplicates and update cash-game chips without placing a bet", async ({
  page,
}) => {
  const state = await setup(page, "/settings/buttonvalue");
  const values = [25, 75, 150, 250, 750, 1500];
  for (let i = 0; i < 6; i++)
    await page
      .getByLabel(`Button ${i + 1} (₹)`, { exact: true })
      .fill(String(values[i]));
  await page.getByRole("button", { name: "Save button values" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Button values saved" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Button 1 (₹)", { exact: true })).toHaveValue(
    "25",
  );
  await page.getByLabel("Button 2 (₹)", { exact: true }).fill("25");
  await page.getByRole("button", { name: "Save button values" }).click();
  await expect(page.getByRole("alert")).toContainText("six different");
  await page.goto("/dice");
  await expect(page.getByTestId("chip-dice-25").first()).toBeVisible();
  expect(state.requests.filter((r) => r.startsWith("POST "))).toEqual([]);
  await page.goto("/settings/buttonvalue");
  await page.getByRole("button", { name: "Restore defaults" }).click();
  await expect(page.getByLabel("Button 1 (₹)", { exact: true })).toHaveValue(
    "100",
  );
  expect(state.errors).toEqual([]);
});
test("security verifies credentials and password changes return to login", async ({
  page,
}) => {
  const state = await setup(page, "/settings/secureauth");
  await expect(page.getByText("This device", { exact: true })).toBeVisible();
  await page.getByLabel("Current password", { exact: true }).fill("wrong");
  await page.getByRole("button", { name: "Verify password" }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("correct-password");
  await page.getByRole("button", { name: "Sign out other devices" }).click();
  await expect(page.getByText("Other device", { exact: true })).toHaveCount(0);
  await page.goto("/settings/changepassword");
  await page
    .getByLabel("Current password", { exact: true })
    .fill("correct-password");
  await page.getByLabel("New password", { exact: true }).fill("new-password");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("mismatch-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  await page
    .getByLabel("Confirm new password", { exact: true })
    .fill("new-password");
  await page
    .getByRole("button", { name: "Change password", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  expect(state.errors).toEqual([]);
});
