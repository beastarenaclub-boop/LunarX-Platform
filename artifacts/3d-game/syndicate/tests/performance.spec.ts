import { test, expect } from "@playwright/test";
import {
  calculate,
  defaultPlan,
  type CommissionRun,
} from "../src/live/commissions";
import { memberPerformance } from "../src/live/performance";
import {
  dayIST,
  type Entry,
  type LiveMember,
  type Snapshot,
} from "../src/live/types";
import { browserConnected, connectedAuth } from "./location-fixture";

const legacyPlan = {
  ...defaultPlan,
  basis: "transaction" as const,
  indirect: 10,
  levels: 2,
  reserve: 10,
  minimumCompany: 20,
};
const date = "2026-10-11";
function member(
  id: string,
  parent: string | null,
  position: "left" | "right" = "left",
): LiveMember {
  return {
    id,
    parent,
    position,
    name: id,
    ref: `SYN-${id}`,
    role: "user",
    status: "Approved",
    city: "",
    revision: 0,
    created_at: date,
    profile: {},
  };
}
function fixtures() {
  const all = [
    member("parent", null),
    member("left", "parent"),
    member("right", "parent", "right"),
    member("deep", "left"),
    member("sibling", "left", "right"),
  ];
  all[1].profile.accounts = [
    {
      id: "secret-account",
      bank: "HDFC Bank",
      last4: "6789",
      holder: "PRIVATE HOLDER",
      type: "Current",
      contact: 0,
      requestedLimit: 5000000,
      approvedLimit: 5000000,
      status: "Approved",
      owned: true,
    },
  ];
  const sources = [
    [all[0], 20],
    [all[1], 100],
    [all[2], 200],
    [all[3], 50],
  ] as const;
  const runs: CommissionRun[] = sources.map(([m, count]) => {
    const allocation = calculate(
      legacyPlan,
      m,
      all,
      count,
      count * 10000,
      count * 120,
    );
    return {
      id: `run-${m.id}`,
      entry_id: `entry-${m.id}`,
      member_id: m.id,
      member_name: m.name,
      plan_version: 0,
      transactions: count,
      turnover: count * 10000,
      fee: count * 120,
      allocations: allocation.allocations,
      reserve: allocation.reserve,
      company: allocation.company,
      status: "Posted",
      date,
      created_at: date,
      note: "PRIVATE RECONCILIATION NOTE",
    };
  });
  const entries: Entry[] = sources.map(([m, count]) => ({
    id: `entry-${m.id}`,
    member_id: m.id,
    account_id: m.id === "left" ? "secret-account" : null,
    kind: "Turnover",
    amount_paise: count * 10000,
    reference: "PRIVATE REFERENCE",
    description: "PRIVATE DESCRIPTION",
    date,
    status: "Approved",
    source: "Manual",
    created_by: "admin",
    reviewed_by: "admin",
    created_at: date,
  }));
  return { all, entries, runs };
}

test("performance conserves fixed shares, separates direct and deep activity, dates and reversals", () => {
  const { all, entries, runs } = fixtures();
  const range = { from: date, to: date };
  const parent = memberPerformance(
    all[0],
    all[0],
    all,
    entries,
    runs,
    [],
    range,
  );
  expect(parent.own).toMatchObject({
    transactions: 20,
    self: 1000,
    direct: 6000,
    indirect: 500,
    commission: 7500,
  });
  expect(parent.directs.map((m) => m.commissionToSelected)).toEqual([
    2000, 4000,
  ]);
  expect(parent.team.transactions).toBe(370);
  const left = memberPerformance(all[1], all[0], all, entries, runs, [], range);
  expect(left.own).toMatchObject({
    transactions: 100,
    turnover: 1000000,
    commission: 6000,
  });
  expect(left.team.viewerCommission).toBe(2500);
  expect(left.banks[0]).toMatchObject({
    bank: "HDFC Bank",
    self: 5000,
    transactions: 100,
  });
  const output = JSON.stringify(left);
  for (const secret of [
    "PRIVATE",
    "6789",
    "secret-account",
    "allocations",
    "entry_id",
  ])
    expect(output).not.toContain(secret);
  runs[1].status = "Reversed";
  const reversed = memberPerformance(
    all[1],
    all[0],
    all,
    entries,
    runs,
    [],
    range,
  );
  expect(reversed.own.turnover).toBe(1000000);
  expect(reversed.own.transactions).toBe(0);
  expect(reversed.team.viewerCommission).toBe(500);
  expect(
    memberPerformance(all[0], all[0], all, entries, runs, [], {
      from: "2026-10-01",
      to: "2026-10-10",
    }).own.commission,
  ).toBe(0);
  all[0].status = "Draft";
  const ordinary = memberPerformance(
    all[0],
    all[0],
    all,
    entries,
    runs,
    [],
    range,
  );
  expect(ordinary.canExploreTeam).toBe(false);
  expect(ordinary.directs).toEqual([]);
  expect(ordinary.team.transactions).toBe(20);
});

test("two direct source transactions pay forty paise regardless of transaction amount", () => {
  const { all } = fixtures();
  const oneLeft = calculate(legacyPlan, all[1], all, 1, 1000000, 120);
  const oneRight = calculate(legacyPlan, all[2], all, 1, 1000, 120);
  const direct = [...oneLeft.allocations, ...oneRight.allocations]
    .filter((a) => a.member === "parent")
    .reduce((n, a) => n + a.amount, 0);
  expect(direct).toBe(40);
  expect(oneLeft.allocations.find((a) => a.type === "Self")!.amount).toBe(50);
});

test("performance API enforces team scope and UI opens member reports and exports", async ({
  request,
  page,
}) => {
  test.setTimeout(90000);
  const auth = (id: string) =>
    connectedAuth(request, {
      "oai-authenticated-user-id": id,
      "oai-authenticated-user-email": `${id}@test.invalid`,
    });
  const admin = await auth("qa-admin");
  const response = await request.get("/api/state", { headers: admin });
  expect(response.status()).toBe(200);
  const state = (await response.json()) as Snapshot;
  const agent = state.members.find(
    (m) => m.role === "agent" && /^qa-/.test(m.name),
  );
  expect(agent, "Approved QA agent from live.spec.ts is required").toBeTruthy();
  const child = state.members.find((m) => m.parent === agent!.id)!;
  const outsider = state.members.find((m) => m.role === "admin")!;
  const agentAuth = await auth(agent!.name);
  const memberAuth = await auth(child.name);
  const path = (id: string) =>
    `/api/members/${id}/performance?from=2000-01-01&to=${dayIST()}`;
  expect((await request.get(path(child.id))).status()).toBe(401);
  expect(
    (await request.get(path(outsider.id), { headers: agentAuth })).status(),
  ).toBe(403);
  expect(
    (await request.get(path(agent!.id), { headers: memberAuth })).status(),
  ).toBe(403);
  expect(
    (await request.get(path(child.id), { headers: agentAuth })).status(),
  ).toBe(200);
  expect((await request.get(path(child.id), { headers: admin })).status()).toBe(
    200,
  );
  expect(
    (
      await request.get(`/api/members/${child.id}/performance?from=invalid`, {
        headers: agentAuth,
      })
    ).status(),
  ).toBe(400);
  const own = await (
    await request.get(path(child.id), { headers: memberAuth })
  ).json();
  expect(own.member.id).toBe(child.id);
  await browserConnected(page, agentAuth);
  await page.route("http://127.0.0.1:5201/**", async (route) => {
    const headers = { ...route.request().headers(), ...agentAuth };
    // The persistent QA plan predates the confirmed basis. Use a browser-only
    // chart fixture without editing stored plans or historical payouts.
    if (new URL(route.request().url()).pathname === "/api/state") {
      const response = await route.fetch({ headers });
      const body = await response.json();
      body.rewards.plan = defaultPlan;
      await route.fulfill({ response, json: body });
    } else await route.continue({ headers });
  });
  await page.goto("/agent/dashboard");
  await page
    .getByRole("button", { name: "Member performance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Member performance proforma",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Performance period", exact: true })
    .selectOption("All time");
  await expect(
    page.locator(".performance-direct").filter({ hasText: child.name }),
  ).toBeVisible();
  await page
    .locator("button.performance-direct")
    .filter({ hasText: child.name })
    .click();
  await expect(
    page.getByRole("combobox", { name: "View member", exact: true }),
  ).toHaveValue(child.id);
  await expect(page.locator(".performance-heading")).toContainText(child.name);
  await expect(
    page.getByRole("button", { name: "Performance Excel", exact: true }),
  ).toBeEnabled();
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Performance Excel", exact: true })
      .click(),
  ]);
  expect(file.suggestedFilename()).toBe("member-performance.xlsx");
  const [pdfFile] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Performance PDF", exact: true }).click(),
  ]);
  expect(pdfFile.suggestedFilename()).toBe("member-performance.pdf");
  await page.screenshot({
    path: "test-results/member-performance-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page
        .locator(".live-sidebar")
        .evaluate((element) => element.getBoundingClientRect().right),
    )
    .toBeLessThanOrEqual(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/member-performance-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Commissions & rewards", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Commission chart", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: /ka distribution chart/ }),
  ).toBeVisible();
  await expect(page.getByTestId("account-total-turnover")).toHaveText(
    "₹1,00,000.00",
  );
  await expect(page.getByTestId("account-total-fee")).toHaveText("₹1,200.00");
  await expect(
    page
      .locator(".commission-accounts")
      .getByRole("row")
      .filter({ hasText: "Member keeps" }),
  ).toContainText("₹500.00");
  await expect(
    page
      .locator(".commission-accounts")
      .getByRole("row")
      .filter({ hasText: "Direct upper agent" }),
  ).toContainText("₹200.00");
  await expect(
    page
      .locator(".commission-accounts")
      .getByRole("row")
      .filter({ hasText: "Company / admin" }),
  ).toContainText("₹400.00");
  await expect(
    page
      .locator(".commission-accounts")
      .getByRole("row")
      .filter({ hasText: "Indirect agents" }),
  ).toContainText("₹100.00");
  await page
    .getByRole("button", { name: "Add example account", exact: true })
    .click();
  await page
    .getByLabel("Account 6 turnover (INR)", { exact: true })
    .fill("10000");
  await expect(page.getByTestId("account-total-turnover")).toHaveText(
    "₹1,10,000.00",
  );
  await expect(page.getByTestId("account-total-fee")).toHaveText("₹1,320.00");
  await page
    .getByRole("button", { name: "Remove last example account", exact: true })
    .click();
  await expect(page.getByTestId("account-total-fee")).toHaveText("₹1,200.00");
  await expect(page.locator(".commission-parent strong")).toHaveText("₹400.00");
  await page
    .getByLabel("Left member turnover (INR)", { exact: true })
    .fill("50000");
  await page
    .getByLabel("Right member turnover (INR)", { exact: true })
    .fill("50000");
  await expect(page.locator(".commission-parent strong")).toHaveText("₹200.00");
  await expect(
    page.getByRole("heading", { name: "Kitni upline tak batega?" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/commission-chart-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page
      .locator(".commission-accounts .table-scroll")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/commission-chart-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page
    .getByRole("button", { name: "Tree calculator", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Poore tree ka commission calculator" }),
  ).toBeVisible();
  await expect(page.getByTestId("tree-total")).toHaveText("₹3,033.28");
  await expect(page.getByTestId("tree-direct")).toHaveText("₹400.00");
  await page
    .getByRole("button", { name: "Inspect level 4", exact: true })
    .click();
  await expect(
    page
      .locator(".tree-trace")
      .getByRole("row")
      .filter({ hasText: "Aap / selected agent" }),
  ).toContainText("₹33.33");
  await page.getByLabel("Eligible agents above you", { exact: true }).fill("1");
  await expect(page.getByTestId("tree-total")).toHaveText("₹2,406.64");
  await page.getByLabel("Eligible agents above you", { exact: true }).fill("0");
  for (const [name, extension] of [
    ["Tree Excel", "xlsx"],
    ["Tree PDF", "pdf"],
  ]) {
    const [file] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name, exact: true }).click(),
    ]);
    expect(file.suggestedFilename()).toBe(
      `tree-commission-illustration.${extension}`,
    );
  }
  await page.screenshot({
    path: "test-results/tree-commission-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("combobox", { name: "Downline levels", exact: true })
    .selectOption("20");
  await expect(page.locator(".tree-level-table tbody tr")).toHaveCount(21);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: "Downline levels", exact: true })
    .selectOption("5");
  expect(
    await page.locator(".tree-visual").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        element.scrollWidth <= element.clientWidth &&
        [...element.querySelectorAll("button")].every((button) => {
          const box = button.getBoundingClientRect();
          return box.left >= rect.left - 1 && box.right <= rect.right + 1;
        })
      );
    }),
  ).toBe(true);
  expect(
    await page
      .locator(".tree-level-table")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  expect(
    await page
      .locator(".tree-trace")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/tree-commission-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});
