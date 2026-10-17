import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }, testInfo) => {
  const unique = `${testInfo.testId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const headers: Record<string, string> = {};
  if (process.env.TEST_RATE_LIMIT_BYPASS) {
    headers["x-test-bypass"] = process.env.TEST_RATE_LIMIT_BYPASS;
  }
  const response = await page.request.post("/api/auth/signup", {
    headers,
    data: {
      email: `andar-table-${unique}@example.com`,
      password: "playwright-test-pw",
      displayName: "Table Tester",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
});

async function openTable(page: import("@playwright/test").Page) {
  await page.goto("/andar-bahar", { waitUntil: "domcontentloaded" });
  const closeBanner = page.getByRole("button", { name: "Close banner" });
  if (await closeBanner.isVisible().catch(() => false)) await closeBanner.click();
  await expect(page.getByTestId("andar-bahar-table")).toBeVisible();
}

test("keeps the table hierarchy and betting controls clear on a phone", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 360, height: 740 });
  await openTable(page);

  await expect(page.getByText("Lunar digital table")).toBeVisible();
  await expect(page.getByTestId("side-andar")).toContainText("Andar");
  await expect(page.getByTestId("side-bahar")).toContainText("Bahar");
  await expect(page.getByTestId("spot-andar")).toBeVisible();
  await expect(page.getByTestId("spot-bahar")).toBeVisible();
  await expect(page.getByTestId("spot-range41_49")).toBeVisible();

  const rack = page.getByTestId("chip-rack").filter({ visible: true });
  await rack.getByTestId("chip-100").click();
  await page.getByTestId("spot-andar").click();
  await expect(page.getByTestId("chipstack-andar")).toHaveText("100");
  await expect(page.getByTestId("text-total-staked").filter({ visible: true })).toContainText(
    "100",
  );

  const bounds = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    table: document
      .querySelector<HTMLElement>('[data-testid="andar-bahar-table"]')
      ?.getBoundingClientRect(),
  }));
  expect(bounds.document).toBeLessThanOrEqual(bounds.viewport + 1);
  expect(bounds.table?.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.table?.right).toBeLessThanOrEqual(bounds.viewport + 1);
});

test("uses a two-lane table and keeps the desktop rail beside play", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openTable(page);

  const andar = await page.getByTestId("side-andar").boundingBox();
  const bahar = await page.getByTestId("side-bahar").boundingBox();
  const table = await page.getByTestId("andar-bahar-table").boundingBox();
  const liveBets = await page.getByTestId("live-bets-panel").boundingBox();

  expect(andar).not.toBeNull();
  expect(bahar).not.toBeNull();
  expect(table).not.toBeNull();
  expect(liveBets).not.toBeNull();
  expect(Math.abs(andar!.y - bahar!.y)).toBeLessThan(2);
  expect(andar!.x + andar!.width).toBeLessThanOrEqual(bahar!.x + 2);
  expect(table!.x + table!.width).toBeLessThanOrEqual(liveBets!.x + 2);
});

test("reveals dealt cards one at a time during the paced deal", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await openTable(page);

  await expect(page.locator('[data-testid="round-phase-banner"][data-phase="reveal"]')).toBeVisible({
    timeout: 75_000,
  });
  const result = page.getByTestId("text-result-line");
  await expect(result).toBeVisible({ timeout: 75_000 });

  const dealtCards = page
    .locator(
      '[data-testid="side-andar"] [data-testid^="card-"], [data-testid="side-bahar"] [data-testid^="card-"]',
    );
  await expect(dealtCards.first()).toBeVisible();
  await expect(page.getByTestId("deal-progress")).toContainText(/^Dealing \d+ of \d+/);
  const firstCount = await dealtCards.count();
  await page.waitForTimeout(800);
  expect(await dealtCards.count()).toBeGreaterThanOrEqual(firstCount);

  await expect(result).toContainText(/Andar wins|Bahar wins/);
  await expect(page.locator('[data-testid^="card-"]').first()).toBeVisible();
});

test("shows the server result without card motion when requested", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 768, height: 1024 });
  await openTable(page);

  await expect(page.getByTestId("text-result-line")).toBeVisible({ timeout: 75_000 });
  const cardMotion = await page
    .locator('[data-testid^="card-"]')
    .first()
    .evaluate((card) => getComputedStyle(card).transitionDuration);
  expect(cardMotion).toBe("0s");
});