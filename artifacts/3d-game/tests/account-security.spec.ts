import { test, expect, type Page } from "@playwright/test";
const base = process.env.ADMIN_TEST_BASE_URL ?? "http://127.0.0.1:5319";
async function setup(page: Page, role = "super_admin", targetRole = "player") {
  const state = {
    fail: false,
    requests: [] as URL[],
    mutations: [] as { path: string; data: any; confirmation: string }[],
    errors: [] as string[],
  };
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  const user = {
    id: "u1",
    email: "customer@example.test",
    role: targetRole,
    status: "active",
    createdAt: "2026-10-01T00:00:00Z",
  };
  await page.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      p = url.searchParams;
    state.requests.push(url);
    if (req.method() !== "GET")
      state.mutations.push({
        path,
        data: req.postDataJSON(),
        confirmation: req.headers()["x-confirm-password"],
      });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "operator",
          email: "operator@example.test",
          role,
          status: "active",
        },
      });
    if (path === "/api/admin/users/u1")
      return route.fulfill({
        json: {
          user,
          kyc: null,
          walletStatus: null,
          wallet: { balance: "10000", currency: "INR" },
          recentBets: [],
          recentLedger: [],
          flags: [],
        },
      });
    if (path.endsWith("/password"))
      return route.fulfill({
        json: { ok: true, revokedSessions: 3, self: false },
      });
    if (path.endsWith("/support-view"))
      return route.fulfill({
        json: {
          mode: "read_only",
          user,
          balance: "10000",
          branch: { name: "Demo Branch", kind: "agent" },
          entries: [
            {
              type: "deposit",
              amount: "10000",
              created_at: "2026-10-19T05:00:00Z",
            },
          ],
          viewedAt: new Date().toISOString(),
        },
      });
    if (path === "/api/admin/access-history") {
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Temporarily unavailable" } },
        });
      const total = p.has("q") ? 1 : 51,
        offset = Number(p.get("offset") ?? 0);
      return route.fulfill({
        json: {
          total,
          items: Array.from(
            { length: Math.max(0, Math.min(50, total - offset)) },
            (_, i) => ({
              id: `s-${offset + i}`,
              userId: "u1",
              email: user.email,
              role: "player",
              loginAt: "2026-10-19T05:00:00Z",
              lastSeenAt: "2026-10-19T06:00:00Z",
              loginIp: "203.0.113.5",
              ip: "203.0.113.5",
              ipSource: "trusted_proxy",
              status: "active",
              device: {
                type: "mobile",
                browser: "Chrome",
                version: "132",
                os: "Android",
                osVersion: "15",
                model: "Pixel 9",
                userAgent: "Mock browser",
              },
              location: {
                city: "New Delhi",
                region: "Delhi",
                country: "India",
                status: "approximate",
                databaseMonth: "2026-10",
              },
            }),
          ),
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  return state;
}
for (const width of [390, 1280])
  test(`password reset and audited read-only preview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page);
    await page.goto(`${base}/admin/users/u1`);
    await page
      .getByRole("button", { name: "Change password", exact: true })
      .click();
    await page
      .getByLabel("Security action reason")
      .fill("Account owner requested reset");
    await page
      .getByLabel("Your admin password", { exact: true })
      .fill("Admin-fixture-password");
    await page
      .getByLabel("New account password", { exact: true })
      .fill("New-fixture-password");
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("Different-fixture-password");
    await page
      .getByRole("button", { name: "Reset password and sign out sessions" })
      .click();
    await expect(page.getByRole("alert")).toContainText("do not match");
    expect(state.mutations).toHaveLength(0);
    await page
      .getByLabel("Confirm new password", { exact: true })
      .fill("New-fixture-password");
    await page
      .getByRole("button", { name: "Reset password and sign out sessions" })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: "Password changed" }),
    ).toContainText("3 existing sessions revoked");
    expect(state.mutations[0]).toEqual({
      path: "/api/admin/users/u1/password",
      data: {
        reason: "Account owner requested reset",
        newPassword: "New-fixture-password",
      },
      confirmation: "Admin-fixture-password",
    });
    await page
      .getByRole("button", { name: "View account (read-only)", exact: true })
      .click();
    await expect(
      page.getByLabel("Your admin password", { exact: true }),
    ).toHaveValue("");
    await page
      .getByLabel("Security action reason")
      .fill("Investigate customer account issue");
    await page
      .getByLabel("Your admin password", { exact: true })
      .fill("Admin-fixture-password");
    await page
      .getByRole("button", { name: "Open read-only preview", exact: true })
      .click();
    await expect(
      page.getByText("No customer login session is created.", { exact: false }),
    ).toBeVisible();
    await expect(page.getByText("Branch: Demo Branch")).toBeVisible();
    await expect(
      page.getByLabel("Your admin password", { exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Close preview" }).click();
    expect(state.mutations).toHaveLength(2);
    expect(state.errors).toEqual([]);
  });
test("mobile activity filters, pagination and error recovery", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await setup(page);
  await page.goto(`${base}/admin/access`);
  const history = page.getByLabel("Account login activity", { exact: true });
  await expect(history.getByText("51 matching sessions")).toBeVisible();
  await expect(
    history.getByText("New Delhi, Delhi, India").first(),
  ).toBeVisible();
  await expect(
    history
      .getByText("mobile", { exact: false })
      .filter({ hasText: "Pixel 9" })
      .first(),
  ).toBeVisible();
  await history.getByRole("button", { name: "Next sessions" }).click();
  await expect
    .poll(() =>
      state.requests
        .filter((u) => u.pathname.endsWith("/access-history"))
        .at(-1)
        ?.searchParams.get("offset"),
    )
    .toBe("50");
  await history.getByRole("button", { name: "Today", exact: true }).click();
  await history.getByLabel("Search account activity").fill("203.0.113.5");
  await history
    .getByLabel("Session status", { exact: true })
    .selectOption("recent");
  await history.getByRole("button", { name: "Apply activity filters" }).click();
  await expect(history.getByText("1 matching sessions")).toBeVisible();
  expect(
    state.requests
      .filter((u) => u.pathname.endsWith("/access-history"))
      .at(-1)
      ?.searchParams.get("status"),
  ).toBe("recent");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  state.fail = true;
  await history.getByRole("button", { name: "Yesterday", exact: true }).click();
  await expect(history.getByRole("alert")).toContainText("could not be loaded");
  await expect(history.getByText("1 matching sessions")).toHaveCount(0);
  state.fail = false;
  await history.getByRole("button", { name: "Retry activity" }).click();
  await expect(history.getByText("1 matching sessions")).toBeVisible();
  expect(state.mutations).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
test("support cannot see controls and admin cannot manage another admin", async ({
  page,
}) => {
  await setup(page, "support");
  await page.goto(`${base}/admin/users/u1`);
  await expect(
    page.getByRole("heading", { name: "customer@example.test", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toHaveCount(0);
  await page.unroute("**/api/**");
  await setup(page, "admin", "admin");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Change password", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "View account (read-only)", exact: true }),
  ).toBeDisabled();
});
