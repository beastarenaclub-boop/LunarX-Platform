import { test, expect } from "@playwright/test";
import { studio } from "./fixtures/roulette";
test.setTimeout(90000);

for (const viewport of [
  { width: 1366, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`dealer release, result and next round at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    const game = await studio(page);
    const stage = page.getByTestId("roulette-dealer-stage");
    const idle = page.getByTestId("roulette-dealer-idle");
    await expect
      .poll(() =>
        idle.evaluate((element) => (element as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(0.2);
    expect(await idle.getAttribute("src")).toContain(
      viewport.width < 768 ? "720p" : "1080p",
    );
    await page.screenshot({
      path: testInfo.outputPath("studio-betting.png"),
      fullPage: true,
    });
    game.betting("throw-1");
    await expect(stage).toHaveAttribute("data-dealer-state", "release");
    await expect(page.getByTestId("roulette-dealer-action")).toHaveAttribute(
      "data-visible",
      "true",
    );
    await expect(stage).toHaveAttribute("data-ball-released", "true");
    await page.screenshot({
      path: testInfo.outputPath("studio-release.png"),
      fullPage: true,
    });
    await expect(stage).toHaveAttribute("data-dealer-state", "idle");
    game.reveal(17);
    await expect(page.getByTestId("roulette-wheel-popup")).toHaveAttribute(
      "data-open",
      "true",
    );
    await expect(page.getByTestId("wheel-result")).toHaveCount(0);
    await expect(page.getByTestId("wheel-result")).toHaveText("17", {
      timeout: 8000,
    });
    await expect(page.getByTestId("text-result-pocket")).toHaveText("17");
    game.repeatResult();
    await expect(stage).toHaveAttribute("data-dealer-state", "idle");
    await page.screenshot({
      path: testInfo.outputPath("studio-result.png"),
      fullPage: true,
    });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    game.betting("throw-2");
    await expect(stage).toHaveAttribute("data-dealer-state", "release");
    await expect(stage).toHaveAttribute("data-ball-released", "true");
    expect(game.errors).toEqual([]);
  });
}

test("late arrival shows the correct pocket without replaying the dealer", async ({
  page,
}) => {
  const game = await studio(page, { late: true });
  await expect(page.getByTestId("wheel-result")).toHaveText("17");
  await page.getByRole("button", { name: "Hide wheel close-up" }).click();
  await expect(page.getByTestId("roulette-wheel-popup")).toHaveAttribute("data-open", "false");
  await page.getByRole("button", { name: "Show wheel close-up" }).click();
  await expect(page.getByTestId("roulette-wheel-popup")).toHaveAttribute("data-open", "true");
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute(
    "data-dealer-state",
    "idle",
  );
  expect(game.errors).toEqual([]);
});

test("reduced motion keeps results and controls usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const game = await studio(page);
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute(
    "data-dealer-state",
    "paused",
  );
  expect(
    await page.getByTestId("roulette-dealer-idle").getAttribute("src"),
  ).toBeNull();
  game.reveal(0, 700);
  await expect(page.getByTestId("wheel-result")).toHaveText("0");
  expect(game.errors).toEqual([]);
});

test("video failure never blocks round settlement", async ({ page }) => {
  await page.route("**/*dealer-*.mp4", (route) => route.abort());
  const game = await studio(page);
  await expect(page.getByTestId("wheel-popup-status")).toContainText(
    "video unavailable",
  );
  game.betting("failed-film");
  game.reveal(32, 700);
  await expect(page.getByTestId("wheel-result")).toHaveText("32");
  expect(game.errors).toEqual([]);
});

test("studio and betting controls fit small, tablet and landscape screens", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await studio(page);
  for (const size of [
    { width: 320, height: 740 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(size);
    const stage = page.getByTestId("roulette-dealer-stage");
    await stage.scrollIntoViewIfNeeded();
    const bounds = await stage.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width);
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 1);
    await expect(
      page.getByRole("button", { name: "Show wheel close-up" }),
    ).toBeVisible();
    await page.getByTestId("roulette-board").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("roulette-board")).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`studio-${size.width}x${size.height}.png`),
      fullPage: true,
    });
  }
});

test("pause, resume and backgrounding do not replay a release", async ({
  page,
}) => {
  const game = await studio(page);
  await page.getByRole("button", { name: "Pause dealer video" }).click();
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute(
    "data-dealer-state",
    "paused",
  );
  await page.getByRole("button", { name: "Play dealer video" }).click();
  game.betting("hidden-round");
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute(
    "data-dealer-state",
    "release",
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  game.reveal(9, 700);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByTestId("wheel-result")).toHaveText("9");
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute(
    "data-dealer-state",
    "idle",
  );
  expect(game.errors).toEqual([]);
});
