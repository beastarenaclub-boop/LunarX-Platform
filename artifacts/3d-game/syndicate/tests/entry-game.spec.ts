import { test, expect, type Page } from "@playwright/test";

import { cameraFixture, removeVisitor } from "./visitor-fixture";

test.beforeEach(async ({ page }) => {
  await cameraFixture(page);
});
test.afterEach(async ({ page }) => {
  await removeVisitor(page.request);
});

async function solve(page: Page, keyboard = false) {
  for (const [part, turns] of [
    ["upper", 2],
    ["left", 1],
    ["right", 2],
  ] as const) {
    const piece = page.getByRole("button", {
      name: `Rotate ${part} triangle fragment`,
    });
    await expect(piece).toBeEnabled();
    for (let n = 0; n < turns; n++) {
      if (keyboard) {
        await piece.focus();
        await page.keyboard.press("Enter");
      } else await piece.click();
    }
    await expect(piece).toHaveAttribute("aria-pressed", "true");
  }
}
async function collectKey(page: Page) {
  await page.getByRole("button", { name: "Inspect the locked gate" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Pehle kamre mein chhupi key dhoondho",
  );
  for (const spot of ["lantern alcove", "cracked stone", "stone pedestal"]) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/entry/search")),
      page.getByRole("button", { name: `Search ${spot}`, exact: true }).click(),
    ]);
    if ((await response.json()).found) break;
  }
  await expect(
    page.getByRole("button", { name: "Pick up the hidden key" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Unlock the gate with the key" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Pick up the hidden key" }).click();
  await expect(
    page.getByText("Gate key collected", { exact: true }),
  ).toBeVisible();
}

test("entrance puzzle opens the gate, restart works, passage can pause and the key unlocks login", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [],
    api: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/api/entry/") &&
      !request.url().includes("/api/visitors/")
    )
      api.push(request.url());
  });
  await page.addInitScript(() =>
    sessionStorage.setItem("syndicate-live-entry", "1"),
  );
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /login|signup|sign in/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rotate upper triangle fragment" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open visitor camera check-in" }),
  ).toBeVisible();
  await solve(page);
  await page.getByRole("button", { name: "Restart entry game" }).click();
  await expect(
    page.getByRole("heading", { name: "Align the triangle." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Inspect the locked gate" }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "test-results/entry-puzzle-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Need a clue?" }).click();
  await expect(page.getByText(/Har fragment ka arrow centre/)).toBeVisible();
  await solve(page);
  await expect(
    page.getByRole("heading", { name: "The passage awakens." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Follow the faint light." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause walk" }).click();
  const progress = page.getByRole("progressbar", { name: "Passage progress" });
  const before = await progress.getAttribute("aria-valuenow");
  await page.waitForTimeout(350);
  await expect(progress).toHaveAttribute("aria-valuenow", before!);
  await page.screenshot({
    path: "test-results/entry-passage-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue walking" }).click();
  await expect(
    page.getByRole("heading", { name: "Every lock has a secret." }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/entry-chamber-desktop.png",
    fullPage: true,
  });
  await collectKey(page);
  expect(api).toEqual([]);
  await page
    .getByRole("button", { name: "Unlock the gate with the key" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Welcome to the inside." }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  const grant = (await page.context().cookies()).find(
    (cookie) => cookie.name === "syndicate_entry",
  );
  expect(grant?.httpOnly).toBe(true);
  expect(grant?.sameSite).toBe("Strict");
  await expect(
    page.getByRole("heading", { name: "Choose your panel." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Member login", exact: true }).click();
  await expect(
    page.getByText("Location required", { exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/state")).status()).toBe(401);
  expect(errors).toEqual([]);
});

test.describe("mobile entry", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    contextOptions: { reducedMotion: "reduce" },
  });
  test("touch entry, keyboard puzzle, restart and reduced-motion journey fit on mobile", async ({
    page,
  }) => {
    await page.goto("/");
    await solve(page, true);
    await page.getByRole("button", { name: "Restart entry game" }).tap();
    await expect(
      page.getByRole("button", { name: "Reduce motion", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page
      .getByRole("button", { name: "Rotate upper triangle fragment" })
      .tap();
    await page.getByRole("button", { name: "Restart entry game" }).tap();
    await expect(
      page.getByRole("button", { name: "Rotate upper triangle fragment" }),
    ).toHaveAttribute("aria-pressed", "false");
    await page.screenshot({
      path: "test-results/entry-puzzle-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await solve(page, true);
    await expect(
      page.getByRole("heading", { name: "Every lock has a secret." }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/entry-chamber-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await collectKey(page);
    await page
      .getByRole("button", { name: "Unlock the gate with the key" })
      .tap();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Rotate upper triangle fragment" }),
    ).toBeVisible();
    await solve(page, true);
    await page.getByRole("button", { name: "Back to entrance" }).tap();
    await expect(page.getByLabel("0 of 3 fragments aligned")).toBeVisible();
  });
});
