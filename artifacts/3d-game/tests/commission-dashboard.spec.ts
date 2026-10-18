import { test, expect, type Page } from "@playwright/test";

const operator = process.env.OPERATOR_TEST_BASE_URL ?? "http://127.0.0.1:5318";
const admin = process.env.ADMIN_TEST_BASE_URL ?? "http://127.0.0.1:5319";
async function setup(page: Page, role: "admin" | "master" | "agent") {
  const requests: URLSearchParams[] = [],
    errors: string[] = [];
  const state = { fail: false };
  const masterChoices = [
    { id: "north", name: "North Branch", parentId: null },
    { id: "south", name: "South Branch", parentId: null },
  ];
  const allAgents = [
    { id: "alpha", name: "Alpha Agent", parentId: "north" },
    { id: "beta", name: "Beta Agent", parentId: "north" },
    { id: "gamma", name: "Gamma Agent", parentId: "south" },
  ];
  const agents =
    role === "admin"
      ? allAgents
      : role === "master"
        ? allAgents.slice(0, 2)
        : allAgents.slice(0, 1);
  const ownId = role === "master" ? "north" : "alpha";
  page.on("pageerror", (e) => errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      params = url.searchParams,
      path = url.pathname;
    if (path === "/api/auth/me")
      return route.fulfill({
        json: {
          id: "owner",
          role: role === "admin" ? "super_admin" : "agent",
          email: `${role}@example.test`,
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
                  id: ownId,
                  userId: "owner",
                  name: role === "master" ? "North Branch" : "Alpha Agent",
                  companyFeeBps: 1000,
                  shareBps: 5000,
                },
          website: null,
          weekly: { locked: false },
        },
      });
    if (path === "/api/network/nodes")
      return route.fulfill({
        json: {
          nodes: [
            ...masterChoices.map((m) => ({ ...m, kind: "master" })),
            ...agents.map((a) => ({ ...a, kind: "agent" })),
          ]
            .filter(
              (n) => role === "admin" || n.id === ownId || n.parentId === ownId,
            )
            .map((n) => ({
              ...n,
              user_id: n.id === ownId ? "owner" : n.id,
              parent_id: n.parentId,
              parent_name: "North Branch",
              email: `${n.id}@example.test`,
              status: "active",
              company_fee_bps: 1000,
              share_bps: 5000,
              players: 0,
              earned: "0",
              settled: "0",
              float_balance: "0",
            })),
        },
      });
    if (path === "/api/network/reports") {
      requests.push(params);
      if (state.fail) {
        state.fail = false;
        return route.fulfill({
          status: 503,
          json: { error: { message: "Report temporarily unavailable" } },
        });
      }
      const period = params.get("period") ?? "today",
        channel = params.get("channel") ?? "b2b";
      const stake =
        params.get("agentId") === "alpha"
          ? "10000"
          : params.get("agentId") === "beta"
            ? "0"
            : ({
                today: "10000",
                yesterday: "50000",
                weekly: "30000",
                monthly: "90000",
                custom: "70000",
              }[period] ?? "0");
      const negative = params.get("agentId") === "alpha";
      const totals = {
        stake,
        payout: negative ? "20000" : "0",
        net: negative ? "-10000" : stake,
        company: role === "admin" ? (stake === "0" ? "0" : "1000") : null,
        master:
          role !== "agent" && channel === "b2b"
            ? stake === "0"
              ? "0"
              : negative
                ? "-4500"
                : "4500"
            : null,
        agent:
          channel === "b2b"
            ? stake === "0"
              ? "0"
              : negative
                ? "-4500"
                : "4500"
            : null,
        wagers: stake === "0" ? 0 : 2,
        players: stake === "0" ? 0 : 1,
      };
      const from =
        params.get("from") ??
        (period === "yesterday"
          ? "2026-10-18"
          : period === "monthly"
            ? "2026-10-01"
            : "2026-10-19");
      const to =
        params.get("to") ??
        (period === "yesterday"
          ? "2026-10-18"
          : period === "weekly"
            ? "2026-10-25"
            : period === "monthly"
              ? "2026-10-31"
              : "2026-10-19");
      return route.fulfill({
        json: {
          role,
          channel,
          range: {
            period,
            from,
            to,
            today: "2026-10-19",
            timezone: "Asia/Kolkata",
          },
          options: { masters: role === "admin" ? masterChoices : [], agents },
          totals,
          masters:
            role === "admin" && channel === "b2b"
              ? masterChoices
                  .filter(
                    (m) =>
                      !params.get("masterId") ||
                      m.id === params.get("masterId"),
                  )
                  .map((m) => ({ ...totals, ...m }))
              : [],
          agents:
            channel === "b2b"
              ? agents
                  .filter(
                    (a) =>
                      (!params.get("masterId") ||
                        a.parentId === params.get("masterId")) &&
                      (!params.get("agentId") ||
                        a.id === params.get("agentId")),
                  )
                  .map((a) => ({
                    ...totals,
                    ...a,
                    masterId: a.parentId,
                    masterName: role === "admin" ? "North Branch" : null,
                  }))
              : [],
          days: stake === "0" ? [] : [{ ...totals, day: from }],
        },
      });
    }
    if (path === "/api/network/ledger") {
      requests.push(params);
      const entries =
        params.get("nodeId") === "alpha"
          ? [
              {
                id: "1",
                created_at: "2026-10-18T12:00:00Z",
                source_id: "commission-reference",
                revision: 2,
                player_email: "player@example.test",
                game_code: "dice",
                account_name: "North Branch",
                account_kind: "master",
                amount: "-4500",
                gross_stake: "10000",
                gross_payout: "20000",
                terms: {
                  companyFeeBps: 1000,
                  masterShareBps: 10000,
                  agentShareBps: 5000,
                },
              },
            ]
          : [];
      return route.fulfill({
        json: { entries, total: entries.length, summary: [] },
      });
    }
    if (path === "/api/admin/dashboard")
      return route.fulfill({
        json: {
          usersTotal: 5,
          usersActive: 5,
          usersSuspended: 0,
          kycPending: 0,
          withdrawalsPending: 0,
          openFlags: 0,
          betsToday: 0,
          stakeToday: "0",
          payoutToday: "0",
        },
      });
    if (path === "/api/admin/demo-presence")
      return route.fulfill({ json: { activeDemoUsers: 0 } });
    if (path === "/api/admin/games/metrics") return route.fulfill({ json: [] });
    return route.fulfill({
      json: { players: [], total: 0, entries: [], settlements: [] },
    });
  });
  return { requests, errors, state };
}

for (const width of [390, 1440])
  test(`master commission presets, agent selection and custom dates at ${width}px`, async ({
    page,
  }) => {
    const state = await setup(page, "master");
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${operator}/master/`);
    const report = page.getByTestId("commission-dashboard");
    await expect(report.getByTestId("commission-stat-stake")).toHaveText(
      "₹100.00",
    );
    for (const [label, stake] of [
      ["Yesterday", "₹500.00"],
      ["Weekly", "₹300.00"],
      ["Monthly", "₹900.00"],
      ["Today", "₹100.00"],
    ]) {
      await report.getByRole("button", { name: label, exact: true }).click();
      await expect(report.getByTestId("commission-stat-stake")).toHaveText(
        stake,
      );
    }
    await report
      .getByRole("combobox", { name: "Commission agent", exact: true })
      .selectOption("alpha");
    await expect(report.getByTestId("commission-stat-own")).toHaveText(
      "−₹45.00",
    );
    await expect(
      report.getByRole("combobox", { name: "Commission master", exact: true }),
    ).toHaveCount(0);
    await expect(
      report.getByText("Company commission", { exact: true }),
    ).toHaveCount(0);
    await report.getByRole("button", { name: "Custom", exact: true }).click();
    await report.getByLabel("From (IST)", { exact: true }).fill("2026-09-01");
    await report.getByLabel("To (IST)", { exact: true }).fill("2026-09-30");
    await report
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    await expect(report.getByTestId("commission-date-range")).toContainText(
      "01 Sept 2026",
    );
    expect(state.requests.at(-1)?.get("agentId")).toBe("alpha");
    expect(state.requests.at(-1)?.get("to")).toBe("2026-09-30");
    await report.getByLabel("From (IST)", { exact: true }).fill("2026-10-01");
    await report
      .getByRole("button", { name: "Apply dates", exact: true })
      .click();
    await expect(report.getByRole("alert")).toContainText(
      "Start date must precede",
    );
    await report.getByRole("button", { name: "Today", exact: true }).click();
    await report
      .getByRole("combobox", { name: "Commission agent", exact: true })
      .selectOption("beta");
    await expect(report.getByTestId("commission-empty")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `tmp/commission-master-${width}.png`,
      fullPage: true,
    });
    expect(state.errors).toEqual([]);
  });

test("master ledger uses the same selected dates and agent as summary", async ({
  page,
}) => {
  const state = await setup(page, "master");
  await page.goto(`${operator}/master/ledger`);
  const report = page.getByTestId("commission-dashboard");
  await report.getByRole("button", { name: "Yesterday", exact: true }).click();
  await report
    .getByRole("combobox", { name: "Commission agent", exact: true })
    .selectOption("alpha");
  await expect(
    report.getByText("commission-reference · rev 2", { exact: true }),
  ).toBeVisible();
  await expect(
    report.getByText("Company fee 10%", { exact: true }),
  ).toBeVisible();
  const filters=report.getByRole('region',{name:'Transaction filters',exact:true});
  await filters.getByLabel('Search transactions',{exact:true}).fill('commission-reference');
  await filters.getByLabel('Game code',{exact:true}).fill('dice');
  await filters.getByRole('combobox',{name:'Credit / debit',exact:true}).selectOption('debit');
  await filters.getByLabel('Maximum amount (₹)',{exact:true}).fill('45');
  await filters.getByRole('button',{name:'Apply filters',exact:true}).click();
  await expect.poll(()=>state.requests.at(-1)?.get('q')).toBe('commission-reference');
  expect(Object.fromEntries(state.requests.at(-1)!)).toMatchObject({game:'dice',direction:'debit',maxAmount:'4500',nodeId:'alpha',from:'2026-10-18',to:'2026-10-18'});
  await expect
    .poll(() =>
      state.requests.some(
        (p) =>
          p.has("nodeId") &&
          p.get("nodeId") === "alpha" &&
          p.get("from") === "2026-10-18" &&
          p.get("to") === "2026-10-18",
      ),
    )
    .toBe(true);
  expect(state.errors).toEqual([]);
});

test("admin dashboard filters masters and agents and resets incompatible selections", async ({
  page,
}) => {
  const state = await setup(page, "admin");
  await page.goto(`${admin}/admin/`);
  const report = page.getByTestId("commission-dashboard");
  await expect(
    report.getByText("Commission by master", { exact: true }),
  ).toBeVisible();
  await report
    .getByRole("combobox", { name: "Commission master", exact: true })
    .selectOption("north");
  await expect(
    report
      .getByRole("combobox", { name: "Commission agent", exact: true })
      .locator("option"),
  ).toHaveCount(3);
  await report
    .getByRole("combobox", { name: "Commission agent", exact: true })
    .selectOption("alpha");
  await expect(report.getByTestId("commission-stat-own")).toHaveText("₹10.00");
  await report
    .getByRole("combobox", { name: "Commission master", exact: true })
    .selectOption("south");
  await expect(
    report.getByRole("combobox", { name: "Commission agent", exact: true }),
  ).toHaveValue("");
  await expect(
    report
      .getByRole("combobox", { name: "Commission agent", exact: true })
      .locator("option"),
  ).toHaveCount(2);
  await expect.poll(() => state.requests.at(-1)?.get("masterId")).toBe("south");
  expect(state.requests.at(-1)?.has("agentId")).toBe(false);
  await report
    .getByRole("combobox", { name: "Business channel", exact: true })
    .selectOption("b2c");
  await expect(
    report.getByText("Commission by agent", { exact: true }),
  ).toHaveCount(0);
  await expect(
    report.getByRole("combobox", { name: "Commission master", exact: true }),
  ).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("agent has its own commission only and can recover from a report error", async ({
  page,
}) => {
  const state = await setup(page, "agent");
  await page.goto(`${operator}/agent/`);
  const report = page.getByTestId("commission-dashboard");
  await expect(
    report.getByText("Your account only", { exact: true }),
  ).toBeVisible();
  await expect(
    report.getByRole("combobox", { name: "Commission agent", exact: true }),
  ).toHaveCount(0);
  await expect(
    report.getByRole("combobox", { name: "Commission master", exact: true }),
  ).toHaveCount(0);
  await expect(
    report.getByText("Company commission", { exact: true }),
  ).toHaveCount(0);
  await expect(
    report.getByText("Master commission", { exact: true }),
  ).toHaveCount(0);
  state.state.fail = true;
  await report.getByRole("button", { name: "Monthly", exact: true }).click();
  await expect(report.getByRole("alert")).toBeVisible();
  await expect(report.getByTestId("commission-stat-stake")).toHaveCount(0);
  await report
    .getByRole("button", { name: "Retry report", exact: true })
    .click();
  await expect(report.getByTestId("commission-stat-stake")).toHaveText(
    "₹900.00",
  );
  expect(state.errors).toEqual([]);
});
