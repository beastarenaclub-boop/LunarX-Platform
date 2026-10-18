import { test, expect, type Page } from "@playwright/test";
const operator = process.env.OPERATOR_TEST_BASE_URL ?? "http://127.0.0.1:5318";
const admin = process.env.ADMIN_TEST_BASE_URL ?? "http://127.0.0.1:5319";
async function setup(
  page: Page,
  role: "master" | "agent" | "admin" | "support",
) {
  const requests: { path: string; params: URLSearchParams }[] = [],
    errors: string[] = [];
  const state = { fail: false };
  const nodes = [
    { id: "north", name: "North Branch", kind: "master", parent_id: null },
    { id: "alpha", name: "Alpha Agent", kind: "agent", parent_id: "north" },
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
    float_balance: "10000",
  }));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname,
      p = url.searchParams;
    requests.push({ path, params: p });
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: role === "agent" ? "alpha" : "north",
          role: ["master", "agent"].includes(role) ? "agent" : role,
          email: "operator@example.test",
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
                  id: role === "agent" ? "alpha" : "north",
                  userId: role === "agent" ? "alpha" : "north",
                  name: "North Branch",
                  companyFeeBps: 1000,
                  shareBps: 5000,
                },
          website: role==='master'?{masterId:'north',name:'North Branch',domain:'play.example.test',url:'https://play.example.test/branch/north/',loginUrl:'https://play.example.test/branch/north/login'}:null,
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
      ["/api/network/wallet-ledger", "/api/network/settlements"].includes(path)
    ) {
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { error: { message: "Transactions unavailable" } },
        });
      const offset = Number(p.get("offset") ?? 0),
        filtered = p.has("q"),
        total = filtered ? 1 : 55;
      const items = Array.from(
        { length: Math.max(0, Math.min(50, total - offset)) },
        (_, i) => ({
          id: `tx-${offset + i}`,
          created_at: "2026-10-19T05:00:00Z",
          amount: "-1200",
          balance_after: "10000",
          type: "bet",
          email: "player@example.test",
          memo: "Game debit",
          reference: "BANK-REF",
          ref_id: `round-${offset + i}`,
        }),
      );
      return route.fulfill({
        json: {
          items,
          total,
          summary: {
            credit: "0",
            debit: String(total * 1200),
            net: String(-total * 1200),
          },
        },
      });
    }
    if (path === "/api/network/weekly")
      return route.fulfill({
        json: {
          masterId: "north",
          locked: false,
          duePaise: "5000",
          overduePaise: "0",
          startedAt: "2026-10-01T00:00:00+05:30",
          weekStart: "2026-10-19T00:00:00+05:30",
          nextDeadline: "2026-10-27T00:00:00+05:30",
          weeks: [],
          payments:
            p.get("status") === "pending"
              ? []
              : [
                  {
                    id: "payment-1",
                    amount: "1000",
                    reference: "BANK-REF",
                    status: "confirmed",
                    created_at: "2026-10-18T00:00:00Z",
                    review_note: null,
                  },
                ],
          paymentTotal: p.get("status") === "pending" ? 0 : 1,
          paymentSummary: { credit: "1000", debit: "0", net: "1000" },
        },
      });
    if (["/api/admin/deposits", "/api/admin/withdrawals"].includes(path)) {
      const offset = Number(p.get("offset") ?? 0),
        total = p.has("q") ? 1 : 55;
      const items = Array.from(
        { length: Math.max(0, Math.min(50, total - offset)) },
        (_, i) => ({
          id: `request-${offset + i}`,
          createdAt: "2026-10-19T05:00:00Z",
          requestedAt: "2026-10-19T05:00:00Z",
          userId: "player-1",
          amount: "1250",
          status: p.get("status") ?? "pending",
          method: "manual",
          utr: `BANK-${offset + i}`,
          destination: "player@upi",
          kind: "player",
          walletPackName: "Main wallet",
        }),
      );
      return route.fulfill({
        json: {
          [path.endsWith("deposits") ? "deposits" : "withdrawals"]: items,
          total,
          summary: {
            credit: String(total * 1250),
            debit: "0",
            net: String(total * 1250),
          },
        },
      });
    }
    return route.fulfill({ json: [] });
  });
  return {
    requests,
    errors,
    state,
    last: (suffix: string) =>
      requests.filter((r) => r.path.endsWith(suffix)).at(-1)?.params,
  };
}

for (const role of ["master", "agent", "admin"] as const)
  test(`${role} wallet filters and pagination preserve account scope`, async ({
    page,
  }) => {
    const state = await setup(page, role);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(
      role === "admin"
        ? `${admin}/admin/network`
        : `${operator}/${role}/transactions`,
    );
    if (role === "admin")
      await page
        .getByRole("navigation", { name: "Network sections" })
        .getByRole("button", { name: "Wallet ledger", exact: true })
        .click();
    const section = page.getByRole("region", {
      name: "Wallet transactions",
      exact: true,
    });
    await expect(
      section.getByText("1–50 of 55 transactions", { exact: true }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: "Next transactions", exact: true })
      .click();
    await expect(
      section.getByText("51–55 of 55 transactions", { exact: true }),
    ).toBeVisible();
    expect(state.last("wallet-ledger")?.get("offset")).toBe("50");
    const filters = section.getByRole("region", {
      name: "Transaction filters",
      exact: true,
    });
    await filters.getByRole("button", { name: "Custom", exact: true }).click();
    await filters.getByLabel("From (IST)", { exact: true }).fill("2026-10-01");
    await filters.getByLabel("To (IST)", { exact: true }).fill("2026-10-19");
    await filters
      .getByLabel("Search transactions", { exact: true })
      .fill("player@example.test");
    await filters
      .getByRole("combobox", { name: "Transaction type", exact: true })
      .selectOption("bet");
    await filters
      .getByRole("combobox", { name: "Credit / debit", exact: true })
      .selectOption("debit");
    await filters
      .getByLabel("Minimum amount (₹)", { exact: true })
      .fill("12.00");
    await filters
      .getByLabel("Maximum amount (₹)", { exact: true })
      .fill("12.50");
    await filters
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      section.getByText("1–1 of 1 transactions", { exact: true }),
    ).toBeVisible();
    expect(Object.fromEntries(state.last("wallet-ledger")!)).toMatchObject({
      period: "custom",
      from: "2026-10-01",
      to: "2026-10-19",
      q: "player@example.test",
      type: "bet",
      direction: "debit",
      minAmount: "1200",
      maxAmount: "1250",
      offset: "0",
    });
    if (role !== "agent") {
      if (role === "admin")
        await section
          .getByRole("combobox", { name: "Transaction master", exact: true })
          .selectOption("north");
      await section
        .getByRole("combobox", { name: "Transaction agent", exact: true })
        .selectOption("alpha");
      await expect
        .poll(() => state.last("wallet-ledger")?.get("nodeId"))
        .toBe("alpha");
    } else
      await expect(
        section.getByRole("combobox", {
          name: "Transaction agent",
          exact: true,
        }),
      ).toHaveCount(0);
    await filters.getByLabel("Minimum amount (₹)", { exact: true }).fill("13");
    await filters
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(filters.getByRole("alert")).toContainText(
      "Minimum amount must not exceed",
    );
    await filters
      .getByRole("button", { name: "Reset filters", exact: true })
      .click();
    await expect(
      section.getByText("1–50 of 55 transactions", { exact: true }),
    ).toBeVisible();
    await expect(filters.getByLabel('Search transactions',{exact:true})).toHaveValue('');
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `tmp/transactions-${role}-mobile.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  });

test("settlement and weekly payment filters keep collection dues intact", async ({
  page,
}) => {
  const state = await setup(page, "master");
  await page.goto(`${operator}/master/settlements`);
  let filters = page.getByRole("region", {
    name: "Transaction filters",
    exact: true,
  });
  await filters.getByRole("button", { name: "Yesterday", exact: true }).click();
  await filters
    .getByRole("combobox", { name: "Credit / debit", exact: true })
    .selectOption("debit");
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect
    .poll(() => state.last("settlements")?.get("direction"))
    .toBe("debit");
  expect(state.last("settlements")?.get("period")).toBe("yesterday");
  await page.goto(`${operator}/master/weekly`);
  filters = page.getByRole("region", {
    name: "Transaction filters",
    exact: true,
  });
  await expect(page.getByText("BANK-REF", { exact: false })).toBeVisible();
  const dues = page
    .locator(".net-stats article")
    .filter({ hasText: "Closed-week amount unpaid" });
  await expect(dues).toContainText("₹50.00");
  await filters
    .getByRole("combobox", { name: "Payment status", exact: true })
    .selectOption("pending");
  await filters
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("No payment submissions match these filters.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(dues).toContainText("₹50.00");
  expect(state.last("weekly")?.get("status")).toBe("pending");
  expect(state.errors).toEqual([]);
});

for (const kind of ["deposits", "withdrawals"])
  test(`admin ${kind} filter all pages and payment statuses`, async ({
    page,
  }) => {
    const state = await setup(page, "support");
    await page.goto(`${admin}/admin/${kind}`);
    await expect(
      page.getByText("1–50 of 55 transactions", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Next transactions", exact: true })
      .click();
    await expect(
      page.getByText("51–55 of 55 transactions", { exact: true }),
    ).toBeVisible();
    const filters = page.getByRole("region", {
      name: "Transaction filters",
      exact: true,
    });
    await filters.getByRole("button", { name: "Monthly", exact: true }).click();
    await filters
      .getByLabel("Search transactions", { exact: true })
      .fill("BANK-UTR");
    await filters
      .getByLabel("Minimum amount (₹)", { exact: true })
      .fill("12.50");
    await filters
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await expect(
      page.getByText("1–1 of 1 transactions", { exact: true }),
    ).toBeVisible();
    expect(Object.fromEntries(state.last(kind)!)).toMatchObject({
      q: "BANK-UTR",
      minAmount: "1250",
      period: "monthly",
      offset: "0",
      status: "pending",
    });
    await page
      .getByTestId(
        kind === "deposits" ? "select-dep-status" : "select-wd-status",
      )
      .click();
    await page.getByRole("option", { name: "Approved", exact: true }).click();
    await expect.poll(() => state.last(kind)?.get("status")).toBe("approved");
    await page.setViewportSize({ width: 390, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.errors).toEqual([]);
  });
