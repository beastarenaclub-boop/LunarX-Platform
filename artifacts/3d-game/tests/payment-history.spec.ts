import { test, expect, type Page } from "@playwright/test";
const operator = process.env.OPERATOR_TEST_BASE_URL ?? "http://127.0.0.1:5318";
const admin = process.env.ADMIN_TEST_BASE_URL ?? "http://127.0.0.1:5319";
const customer = process.env.CUSTOMER_TEST_BASE_URL ?? "http://127.0.0.1:5317";

async function setup(
  page: Page,
  role: "master" | "agent" | "admin" | "customer",
) {
  const state = {
    fail: false,
    requests: [] as URL[],
    mutations: [] as string[],
    errors: [] as string[],
  };
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  const nodes = [
    { id: "north", kind: "master", name: "North Branch", parent_id: null },
    { id: "alpha", kind: "agent", name: "Alpha Agent", parent_id: "north" },
  ].map((n) => ({
    ...n,
    user_id: n.id,
    email: `${n.id}@example.test`,
    status: "active",
    company_fee_bps: 1000,
    share_bps: 5000,
    players: 1,
    earned: "0",
    settled: "0",
    float_balance: "0",
  }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      p = url.searchParams,
      path = url.pathname;
    state.requests.push(url);
    if (route.request().method() !== "GET") state.mutations.push(path);
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "account",
          role:
            role === "customer"
              ? "player"
              : role === "admin"
                ? "admin"
                : "agent",
          channel: role === "customer" ? "b2b" : "b2c",
          email: "account@example.test",
          status: "active",
        },
      });
    if (path === "/api/network/context")
      return route.fulfill({
        json: {
          role,
          node:
            role === "admin"
              ? null
              : {
                  id: role === "master" ? "north" : "alpha",
                  name: "North Branch",
                  companyFeeBps: 1000,
                  shareBps: 5000,
                },
          weekly: { locked: false },
        },
      });
    if (path === "/api/network/nodes")
      return route.fulfill({
        json: { nodes: role === "agent" ? nodes.slice(1) : nodes },
      });
    if (path === "/api/network/reports")
      return route.fulfill({
        json: {
          role,
          channel: "b2b",
          range: {
            period: "today",
            from: "2026-10-19",
            to: "2026-10-19",
            today: "2026-10-19",
            timezone: "Asia/Kolkata",
          },
          totals: {
            stake: "0",
            payout: "0",
            net: "0",
            company: "0",
            master: "0",
            agent: "0",
            wagers: 0,
            players: 0,
          },
          options: { masters: [], agents: [] },
          masters: [],
          agents: [],
          days: [],
        },
      });
    if (
      path === "/api/network/payment-history" ||
      path === "/api/payments/history"
    ) {
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "History unavailable" } },
        });
      if (p.get("format") === "csv")
        return route.fulfill({
          contentType: "text/csv",
          body: "id,amountPaise\r\nrequest:fixture,1200",
        });
      const total = p.has("q") ? 1 : 55,
        offset = Number(p.get("offset") ?? 0);
      return route.fulfill({
        json: {
          total,
          totals: {
            approvedDeposits: "66000",
            depositWalletCredits: "60000",
            recordedPaidWithdrawals: "0",
            pending: 0,
            needsReview: 5,
            requestOnly: 0,
          },
          items: Array.from(
            { length: Math.max(0, Math.min(50, total - offset)) },
            (_, i) => ({
              id: `request:${i + offset}`,
              requestId: `request-${i + offset}`,
              userId: "account",
              email: role === "customer" ? null : "player@example.test",
              masterName: role === "customer" ? null : "North Branch",
              agentName: role === "customer" ? null : "Alpha Agent",
              amount: "1200",
              currency: "INR",
              status: "approved",
              type: "deposit",
              method: "manual",
              reference: `BANK-${i + offset}`,
              createdAt: "2026-10-19T05:00:00Z",
              reviewedAt: "2026-10-19T06:00:00Z",
              paidAt: null,
              reviewer: role === "customer" ? null : "reviewer-1",
              walletAmount: "0",
              walletEntries: 0,
              reconciliation: "needs_review",
            }),
          ),
        },
      });
    }
    if (path === "/api/wallet/balance")
      return route.fulfill({
        json: { balance: "10000", currency: "INR", walletId: "wallet" },
      });
    if (path === "/api/payments/deposit-settings")
      return route.fulfill({
        json: { manualEnabled: false, autoEnabled: false },
      });
    if (path.endsWith("-limits"))
      return route.fulfill({
        json: { minAmountPaise: "10000", maxAmountPaise: "1000000" },
      });
    if (path === "/api/kyc" || path.includes("website"))
      return route.fulfill({ json: null });
    return route.fulfill({ json: [] });
  });
  return {
    ...state,
    state,
    last: () =>
      state.requests
        .filter(
          (u) =>
            u.pathname.endsWith("history") && u.pathname.includes("payment"),
        )
        .at(-1)?.searchParams,
  };
}

for (const role of ["admin", "master", "agent", "customer"] as const)
  test(`${role} historical payments: filtering, export, details and mobile layout`, async ({
    page,
  }) => {
    const fixture = await setup(page, role);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(
      role === "admin"
        ? `${admin}/admin/network`
        : role === "customer"
          ? `${customer}/wallet?tab=history`
          : `${operator}/${role}/payments`,
    );
    if (role === "admin")
      await page
        .getByRole("navigation", { name: "Network sections" })
        .getByRole("button", { name: "Payment history", exact: true })
        .click();
    const section = page.getByRole("region", {
      name: "Connected payment history",
      exact: true,
    });
    await expect(
      section.getByText("1–50 of 55 transactions", { exact: true }),
    ).toBeVisible();
    await expect(
      section.getByText("Records needing review", { exact: true }),
    ).toBeVisible();
    await section.locator("summary").first().click();
    await expect(
      section.getByText("Request ID: request-0", { exact: true }),
    ).toBeVisible();
    if (role === "customer") {
      await expect(
        page.getByRole("tab", { name: "History", exact: true }),
      ).toHaveAttribute("data-state", "active");
      await expect(
        section.getByText("North Branch", { exact: true }),
      ).toHaveCount(0);
      await expect(
        section.getByText("Reviewed by account: reviewer-1", { exact: true }),
      ).toHaveCount(0);
      await expect(
        section.getByRole("columnheader", { name: "Customer / branch" }),
      ).toHaveCount(0);
    } else
      await expect(
        section
          .getByText("Reviewed by account: reviewer-1", { exact: true })
          .first(),
      ).toBeVisible();
    await section
      .getByRole("button", { name: "Next transactions", exact: true })
      .click();
    await expect(
      section.getByText("51–55 of 55 transactions", { exact: true }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: "Yesterday", exact: true })
      .click();
    await section
      .getByLabel("Search transactions", { exact: true })
      .fill("BANK-0");
    await section
      .getByRole("combobox", { name: "Transaction type", exact: true })
      .selectOption("deposit");
    await section
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      section.getByText("1–1 of 1 transactions", { exact: true }),
    ).toBeVisible();
    await section
      .getByRole("combobox", { name: "Wallet reconciliation", exact: true })
      .selectOption("needs_review");
    await expect
      .poll(() => fixture.last()?.get("reconciliation"))
      .toBe("needs_review");
    expect(Object.fromEntries(fixture.last()!)).toMatchObject({
      q: "BANK-0",
      type: "deposit",
      period: "yesterday",
      offset: "0",
    });
    if (role === "admin")
      await section
        .getByRole("combobox", { name: "Payment master", exact: true })
        .selectOption("north");
    if (role === "admin" || role === "master") {
      await section
        .getByRole("combobox", { name: "Payment agent", exact: true })
        .selectOption("alpha");
      await expect.poll(() => fixture.last()?.get("nodeId")).toBe("alpha");
    } else
      await expect(
        section.getByRole("combobox", { name: "Payment agent", exact: true }),
      ).toHaveCount(0);
    const download = page.waitForEvent("download");
    await section
      .getByRole("button", { name: "Export matching CSV", exact: true })
      .click();
    expect((await download).suggestedFilename()).toBe("payment-history.csv");
    expect(fixture.last()?.get("offset")).toBeNull();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    fixture.state.fail = true;
    await section.getByRole("button", { name: "Today", exact: true }).click();
    await expect(section.getByRole("alert")).toContainText(
      "could not be loaded",
    );
    await expect(
      section.getByRole("button", { name: "Export matching CSV", exact: true }),
    ).toBeDisabled();
    fixture.state.fail = false;
    await section
      .getByRole("button", { name: "Retry payment history", exact: true })
      .click();
    await expect(section.getByRole("alert")).toHaveCount(0);
    expect(fixture.errors).toEqual([]);
    expect(fixture.mutations).toEqual([]);
  });
