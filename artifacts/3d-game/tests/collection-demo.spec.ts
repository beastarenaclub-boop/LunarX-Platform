import { test, expect, type Page } from "@playwright/test";
const base = process.env.ADMIN_TEST_BASE_URL ?? "http://127.0.0.1:5319";
async function setup(page: Page, role = "super_admin") {
  const state = { mutations: [] as string[], errors: [] as string[] };
  page.on("pageerror", (e) => state.errors.push(e.message));
  await page.routeWebSocket("**/ws*", () => {});
  await page.route("**/api/**", (route) => {
    const r = route.request();
    if (r.method() !== "GET")
      state.mutations.push(r.method() + " " + new URL(r.url()).pathname);
    return route.fulfill({
      json:
        new URL(r.url()).pathname === "/api/auth/me"
          ? {
              id: "operator",
              email: "operator@example.test",
              role,
              status: "active",
            }
          : [],
    });
  });
  await page.goto(base + "/admin/collection-demo");
  return state;
}
const identity = (page: Page, id: string) =>
  page.getByLabel("Simulated identity", { exact: true }).selectOption(id);
async function masterMode(page: Page) {
  await page.getByLabel("East master collection mode").selectOption("master");
  await identity(page, "demo-master-east");
  await page
    .getByRole("button", { name: "Add fictional account A", exact: true })
    .click();
}
for (const width of [390, 1280])
  test(`delegated collection, reservations and approvals at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await setup(page);
    await expect(page.getByRole("note")).toContainText("Simulation only");
    await masterMode(page);
    await page.getByLabel("Alpha agent collection mode").selectOption("agent");
    await identity(page, "demo-agent-alpha");
    await page
      .getByRole("button", { name: "Add fictional account A", exact: true })
      .click();
    await identity(page, "demo-user-asha");
    await expect(page.getByTestId("assigned-collector")).toHaveText(
      "Alpha agent",
    );
    await page
      .getByRole("button", { name: "Submit simulated deposit" })
      .click();
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Available credits0 test credits",
    );
    await identity(page, "demo-master-east");
    await expect(
      page.getByRole("button", { name: "Approve demo deposit" }),
    ).toHaveCount(0);
    await identity(page, "demo-agent-alpha");
    await page.getByRole("button", { name: "Approve demo deposit" }).click();
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Available credits500 test credits",
    );
    await identity(page, "demo-user-asha");
    await page
      .getByLabel("Request type", { exact: true })
      .selectOption("withdrawal");
    await page.getByLabel("Request test credits").fill("200");
    await page
      .getByRole("button", { name: "Submit simulated withdrawal" })
      .click();
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Reserved withdrawals200 test credits",
    );
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Available credits300 test credits",
    );
    await identity(page, "demo-agent-alpha");
    await page.getByRole("button", { name: "Reject demo withdrawal" }).click();
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Available credits500 test credits",
    );
    await identity(page, "demo-user-asha");
    await page
      .getByRole("button", { name: "Submit simulated withdrawal" })
      .click();
    await identity(page, "demo-agent-alpha");
    await page.getByRole("button", { name: "Approve demo withdrawal" }).click();
    await expect(page.getByLabel("Demo balances")).toContainText(
      "Customer balance300 test credits",
    );
    await identity(page, "demo-master-west");
    await expect(
      page.getByLabel("Demo request history").locator("article"),
    ).toHaveCount(0);
    await identity(page, "demo-admin");
    await expect(
      page.getByLabel("Demo request history").locator("article"),
    ).toHaveCount(3);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(state.mutations).toEqual([]);
    expect(state.errors).toEqual([]);
  });
test("weekly sample locks after Monday grace and unlocks only after admin confirmation", async ({
  page,
}) => {
  const state = await setup(page);
  await masterMode(page);
  await page
    .getByLabel("Simulation clock")
    .selectOption("2026-10-19T18:30:00.000Z");
  await expect(
    page.getByText("Demo branch locked — sample commission overdue", {
      exact: true,
    }),
  ).toBeVisible();
  await identity(page, "demo-user-asha");
  await page.getByRole("button", { name: "Submit simulated deposit" }).click();
  await expect(page.getByRole("alert")).toContainText("branch locked");
  await identity(page, "demo-master-east");
  await page
    .getByRole("button", { name: "Submit demo weekly receipt" })
    .click();
  await expect(
    page.getByText("Demo branch locked — sample commission overdue", {
      exact: true,
    }),
  ).toBeVisible();
  await identity(page, "demo-admin");
  await page
    .getByRole("button", { name: "Confirm demo weekly receipt" })
    .click();
  await identity(page, "demo-master-east");
  await expect(
    page.getByText("Sample commission settled — branch unlocked", {
      exact: true,
    }),
  ).toBeVisible();
  await identity(page, "demo-user-asha");
  await page.getByRole("button", { name: "Submit simulated deposit" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByLabel("Demo request history").locator("article"),
  ).toHaveCount(1);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("date, agent, status and search filters; reset clears only fictional state", async ({
  page,
}) => {
  const state = await setup(page);
  await identity(page, "demo-user-asha");
  await page.getByRole("button", { name: "Submit simulated deposit" }).click();
  await identity(page, "demo-user-ravi");
  await page.getByRole("button", { name: "Submit simulated deposit" }).click();
  await identity(page, "demo-admin");
  const history = page.getByLabel("Demo request history");
  await expect(history.locator("article")).toHaveCount(2);
  await page
    .getByLabel("Request agent filter")
    .selectOption("demo-agent-alpha");
  await expect(history.locator("article")).toHaveCount(1);
  await page.getByLabel("Request status filter").selectOption("approved");
  await expect(history.locator("article")).toHaveCount(0);
  await page.getByLabel("Request status filter").selectOption("all");
  await page.getByLabel("Search demo requests").fill("Ravi");
  await expect(history.locator("article")).toHaveCount(0);
  await page.getByLabel("Search demo requests").fill("Asha");
  await expect(history.locator("article")).toHaveCount(1);
  await page
    .getByLabel("Simulation clock")
    .selectOption("2026-10-19T18:30:00.000Z");
  await page.getByLabel("Request period").selectOption("today");
  await expect(history.locator("article")).toHaveCount(0);
  await page.getByLabel("Request period").selectOption("yesterday");
  await expect(history.locator("article")).toHaveCount(1);
  await page.getByLabel("Request period").selectOption("custom");
  await page.getByLabel("Request from").fill("2026-10-20");
  await page.getByLabel("Request to").fill("2026-10-19");
  await expect(history.getByRole("alert")).toContainText("precede");
  await page.getByRole("button", { name: "Reset fictional scenario" }).click();
  await expect(history.locator("article")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "Production records were not changed",
  );
  await identity(page, "demo-user-asha");
  await page.getByRole("button", { name: "Submit simulated deposit" }).click();
  await page.reload();
  await expect(history.locator("article")).toHaveCount(0);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("support does not enter the sandbox", async ({ page }) => {
  const state = await setup(page, "support");
  await expect(
    page.getByText("Administrator access is required to review the sandbox.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Simulated identity")).toHaveCount(0);
  expect(state.mutations).toEqual([]);
});
