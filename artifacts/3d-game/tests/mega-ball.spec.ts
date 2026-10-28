import { test, expect } from "@playwright/test";

test("the complete studio frame fits without covering controls on resize and rotation", async ({
  page,
}, info) => {
  await page.goto("/mega-ball");
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-studio-asset",
    "ready",
    { timeout: 30000 },
  );
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-relief-asset", "ready", { timeout: 30000 },
  );
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
    { width: 320, height: 568 },
    { width: 844, height: 390 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.locator('[data-game-viewport="mega-ball"]').evaluate((e) => {
      e.scrollTop = 0;
    });
    await expect
      .poll(() =>
        page.evaluate(() => {
          const rect = (s: string) =>
            document.querySelector(s)!.getBoundingClientRect();
          const stage = rect(".mb-stage"),
            film = rect(".mb-studio-frame");
          const header = rect(".mb-topbar"),
            dock = rect(".mb-dock"),
            footer = rect(".mb-bottom");
          const canvas =
            document.querySelector<HTMLCanvasElement>(".mb-machine-canvas")!;
          return (
            film.width > 0 &&
            film.height > 0 &&
            Math.abs(film.width / film.height - canvas.width / canvas.height) <
              0.02 &&
            film.left >= stage.left - 1 &&
            film.right <= stage.right + 1 &&
            film.top >= stage.top - 1 &&
            film.bottom <= stage.bottom + 1 &&
            header.bottom <= stage.top + 1 &&
            stage.bottom <= dock.top + 1 &&
            dock.bottom <= footer.top + 1 &&
            document.documentElement.scrollWidth <= innerWidth
          );
        }),
      )
      .toBe(true);
    await page.screenshot({
      path: info.outputPath(`fit-${viewport.width}x${viewport.height}.png`),
    });
    await page.locator(".mb-lobby").scrollIntoViewIfNeeded();
    await expect(page.locator(".mb-lobby")).toBeInViewport();
  }
});

test("Mega Ball lobby banner, category and NEW badges on both storefronts", async ({
  page,
}, info) => {
  for (const route of ["/", "/b2c"]) {
    await page.goto(route);
    const category = page
      .getByRole("button", { name: "Mega Ball", exact: true })
      .first();
    await expect(category).toBeVisible();
    await category.click();
    const card = page
      .locator('a[href="/mega-ball"], button[data-game-id="mega-ball"]')
      .filter({ has: page.locator(".game-new-badge") })
      .first();
    await expect(card).toBeVisible();
    await expect(card.locator(".game-new-badge")).toHaveText("NEW");
    await page.screenshot({
      path: info.outputPath(route === "/" ? "lobby.png" : "storefront.png"),
      fullPage: true,
    });
    await card.click();
    await expect(page.getByTestId("mega-ball-game")).toBeVisible();
  }
});

test("real preview API: purchase, reload recovery, draw, settlement and history", async ({
  page,
}, info) => {
  // A join during the draw can require waiting through two complete rounds.
  test.setTimeout(240000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/mega-ball");
  const add = page.getByRole("button", { name: "Add 10 cards", exact: true });
  await expect(add).toBeEnabled({ timeout: 90000 });
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await page.screenshot({ path: info.outputPath("desktop-betting.png") });
  await add.click();
  await expect(
    page.getByRole("button", { name: "BUY 10 CARDS", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "UNDO", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "SELECT CARDS", exact: true }),
  ).toBeDisabled();
  await add.click();
  await page.getByRole("button", { name: "Increase card price" }).click();
  await page.getByRole("button", { name: "Decrease card price" }).click();
  await page.getByRole("button", { name: "BUY 10 CARDS", exact: true }).click();
  await expect(page.locator(".mb-card")).toHaveCount(4);
  const firstCard = await page
    .locator(".mb-card-grid")
    .first()
    .locator("span")
    .allTextContents();
  await page.reload();
  await expect(page.locator(".mb-card")).toHaveCount(4);
  await expect(
    page.locator(".mb-card-grid").first().locator("span"),
  ).toHaveText(firstCard);
  await page.setViewportSize({ width: 320, height: 568 });
  expect(
    await page
      .getByTestId("mega-ball-game")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("small-phone-cards.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Next cards", exact: true }).click();
  await expect(page.locator(".mb-card-navigation")).toContainText("2/3");
  await page
    .getByRole("button", { name: "Previous cards", exact: true })
    .click();
  await expect(page.locator(".mb-card-grid .is-marked").first()).toBeVisible({
    timeout: 30000,
  });
  await page.screenshot({ path: info.outputPath("desktop-draw.png") });
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await page.screenshot({ path: info.outputPath("studio-machine.png") });
  await expect(page.locator(".mb-mega-small")).toBeVisible({ timeout: 70000 });
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await page.screenshot({ path: info.outputPath("mega-ball-result.png") });
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/mega-ball/recent")).json()).length,
      { timeout: 20000 },
    )
    .toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Round history", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").locator("article").first(),
  ).toContainText("10 cards");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Verifiable draw", exact: true })
    .click();
  await page
    .getByRole("button", { name: /Verify (current|previous) round/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Verified:");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("only the generated presenter uses video while all numbered balls remain live", async ({
  page,
}) => {
  const videos: string[] = [];
  page.on("request", (request) => {
    if (/\.mp4(?:\?|$)/.test(request.url())) videos.push(request.url());
  });
  await page.goto("/mega-ball");
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await expect(page.locator(".mega-game video")).toHaveCount(0);
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-presenter",
    "animated",
    { timeout: 30000 },
  );
  await expect
    .poll(() =>
      page
        .locator(".mb-machine-canvas")
        .evaluate((canvas: HTMLCanvasElement) => {
          const numbers = (key: string) =>
            (canvas.dataset[key] ?? "").split(",").filter(Boolean).map(Number);
          const bowl = numbers("bowlNumbers"),
            chute = numbers("chuteNumbers"),
            rack = numbers("rackNumbers");
          const all = [...bowl, ...chute, ...rack];
          return (
            all.length === 51 &&
            new Set(all).size === 51 &&
            all.every((n) => n >= 1 && n <= 51) &&
            chute.length <= 1 &&
            (chute.length === 0 ||
              chute[0] === Number(canvas.dataset.currentNumber))
          );
        }),
    )
    .toBe(true);
  expect(videos.length).toBeGreaterThan(0);
  expect(
    videos.every(
      (url) => new URL(url).pathname === "/media/mega-ball/presenter-host.mp4",
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Game settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Machine motion", exact: true })
    .click();
  await expect(page.locator(".mb-studio-scene")).toHaveAttribute(
    "data-motion",
    "false",
  );
  await page
    .getByRole("button", { name: "Machine motion", exact: true })
    .click();
  await expect(page.locator(".mb-studio-scene")).toHaveAttribute(
    "data-motion",
    "true",
  );
});

test("reduced motion and WebGL failure keep a generated, playable machine", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/mega-ball");
  await expect(page.locator(".mb-studio-scene")).toHaveAttribute(
    "data-motion",
    "false",
  );
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
  await page
    .locator(".mb-machine-canvas")
    .evaluate((canvas) =>
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true })),
    );
  await expect(page.locator(".mb-studio-scene")).toHaveAttribute(
    "data-renderer",
    "standard",
  );
  await expect(page.locator(".mb-machine-standard")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Game settings", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("machine-fallback.png") });
  await page
    .getByRole("button", { name: "Enable 3D view", exact: true })
    .click();
  await expect(page.locator(".mb-machine-canvas")).toHaveAttribute(
    "data-renderer",
    "webgl",
    { timeout: 30000 },
  );
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`responsive layout and working settings at ${viewport.width}x${viewport.height}`, async ({
    page,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize(viewport);
    await page.goto("/mega-ball");
    await expect(page.getByTestId("mega-ball-game")).toBeVisible();
    await expect(page.locator(".mb-studio-scene")).toBeVisible();
    await page
      .getByRole("button", { name: "How to play", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Twenty unique balls");
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "Game settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Draw sound effects", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Draw sound effects", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .getByTestId("mega-ball-game")
        .evaluate((e) => e.scrollWidth <= e.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("layout.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  });
}
