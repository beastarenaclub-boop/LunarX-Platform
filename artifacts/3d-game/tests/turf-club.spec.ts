import { test, expect } from "@playwright/test";

const url = process.env.TURF_URL ?? "http://127.0.0.1:5192/horse-riding/race";
const key = "turf-club-practice-v1";
test.beforeEach(async ({ page }) => {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("runner-8")).toBeVisible();
});
test("multiple tickets reserve coins, remove and venue changes refund, invalid stakes cannot submit", async ({
  page,
}) => {
  await page.getByTestId("place-bet").click();
  await expect(page.getByTestId("turf-balance")).toContainText("9,900");
  await page.getByTestId("runner-8").click();
  await page.locator("#turf-stake").fill("250");
  await page.getByTestId("place-bet").click();
  await expect(page.getByTestId("turf-balance")).toContainText("9,650");
  await expect(page.locator(".tc-ticket")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Remove bet on Midnight Storm" })
    .click();
  await expect(page.getByTestId("turf-balance")).toContainText("9,750");
  await page.getByTestId("venue-dubai").click();
  await expect(page.getByTestId("turf-balance")).toContainText("10,000");
  await expect(page.locator(".tc-ticket")).toHaveCount(0);
  for (const stake of ["0", "-50", "10.5", "10001"]) {
    await page.locator("#turf-stake").fill(stake);
    await page.getByTestId("place-bet").click();
    await expect(page.getByRole("alert")).toContainText("whole-number");
    await expect(page.getByTestId("turf-balance")).toContainText("10,000");
  }
  await page.locator("#turf-stake").fill("100");
  await page.getByTestId("place-bet").click();
  await page.locator("#turf-stake").fill("10000");
  await page.getByTestId("place-bet").click();
  await expect(page.getByRole("alert")).toContainText("Not enough");
  await page.reload();
  await expect(page.getByTestId("turf-balance")).toContainText("9,900");
  await expect(page.locator(".tc-ticket")).toHaveCount(1);
});
test("full race locks bets, resumes after reload and settles exactly once", async ({
  page,
}) => {
  await page.clock.install();
  await page.locator("#turf-stake").fill("50");
  for (let id = 1; id <= 8; id++) {
    await page.getByTestId(`runner-${id}`).click();
    await page.getByTestId("place-bet").click();
  }
  await expect(page.getByTestId("turf-balance")).toContainText("9,600");
  await page.getByTestId("start-race").click();
  await expect(page.locator('[data-phase="countdown"]')).toBeVisible();
  await expect(page.getByTestId("place-bet")).toBeDisabled();
  await expect(page.getByTestId("venue-dubai")).toBeDisabled();
  await page.clock.fastForward(6000);
  await expect(page.locator('[data-phase="racing"]')).toBeVisible();
  for (const name of [
    "Broadcast",
    "Trackside",
    "Drone",
    "Chase",
    "Jockey",
    "Finish line",
  ]) {
    const button = page.getByRole("button", { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.reload();
  await expect(page.locator('[data-phase="racing"]')).toBeVisible();
  await page.clock.fastForward(65000);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Official race result");
  const saved = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(saved.history).toHaveLength(1);
  expect(saved.plan).toBeNull();
  expect(saved.tickets).toHaveLength(0);
  expect(saved.balance).toBe(9600 + saved.history[0].payout);
  expect(saved.history[0].payout).toBeGreaterThan(0);
  await page.reload();
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    key,
  );
  expect(after.balance).toBe(saved.balance);
  expect(after.history).toHaveLength(1);
  await page.getByRole("button", { name: "My races" }).click();
  await expect(page.getByRole("dialog")).toContainText("Your recent races");
});
test("all six locations render local 3D assets without runtime errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page
    .getByRole("button", { name: "3D simulation", exact: true })
    .click();
  await expect(page.locator(".tc-scene-loading")).toHaveCount(0, {
    timeout: 30000,
  });
  for (const id of ["royal", "dubai", "alpine", "coast", "night", "marathon"]) {
    await page.getByTestId(`venue-${id}`).click();
    await expect(page.getByTestId(`venue-${id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.waitForTimeout(300);
    await expect(page.locator("canvas")).toBeVisible();
  }
  await expect(page.locator(".tc-meeting")).toContainText("Grand Endurance");
  await expect(page.locator(".tc-minimap")).toContainText("2 LAPS");
  await page.getByRole("button", { name: "Graphics quality: high" }).click();
  await expect(
    page.getByRole("button", { name: "Graphics quality: low" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("six local HD films play, camera selection seeks actual shots, quality switches and portraits load", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const id of ["royal", "dubai", "alpine", "coast", "night", "marathon"]) {
    await page.getByTestId(`venue-${id}`).click();
    const film = page.locator(".tc-cinematic-scene video");
    await expect(film).toHaveAttribute("src", new RegExp(`${id}-1080\\.mp4$`));
    await expect
      .poll(
        () =>
          film.evaluate(
            (v: HTMLVideoElement) => v.readyState >= 2 && !v.paused,
          ),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(
      await film.evaluate((v: HTMLVideoElement) => v.duration),
    ).toBeGreaterThan(17.8);
    await expect(page.locator(".tc-film-notice")).toHaveCount(0);
  }
  const film = page.locator(".tc-cinematic-scene video");
  for (const [name, start, end] of [
    ["Broadcast", 0.15, 2.85],
    ["Trackside", 3.15, 5.85],
    ["Drone", 6.15, 8.85],
    ["Chase", 9.15, 11.85],
    ["Jockey", 12.15, 14.85],
    ["Finish line", 15.15, 17.8],
  ] as const) {
    await page.getByRole("button", { name, exact: true }).click();
    await expect
      .poll(() => film.evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThanOrEqual(start);
    expect(
      await film.evaluate((v: HTMLVideoElement) => v.currentTime),
    ).toBeLessThan(end + 0.15);
    await expect(page.locator(".tc-camera-label")).toContainText(
      name.toUpperCase(),
    );
  }
  await page.getByRole("button", { name: "Graphics quality: high" }).click();
  await expect(film).toHaveAttribute("src", /marathon-720\.mp4$/);
  await expect
    .poll(() =>
      film.evaluate((v: HTMLVideoElement) => v.readyState >= 2 && !v.paused),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Enable race sound" }).click();
  expect(await film.evaluate((v: HTMLVideoElement) => v.muted)).toBe(false);
  await page.getByRole("button", { name: "Pause preview" }).click();
  await expect
    .poll(() => film.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page.getByRole("button", { name: "Preview the action" }).click();
  await expect
    .poll(() => film.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  for (let id = 1; id <= 8; id++) {
    const portrait = page.getByTestId(`runner-${id}`).locator("img");
    await portrait.scrollIntoViewIfNeeded();
    await expect
      .poll(() => portrait.evaluate((i: HTMLImageElement) => i.naturalWidth))
      .toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
});

test("failed film has a recoverable fallback and does not block race settlement", async ({
  page,
}) => {
  await page.route("**/higgsfield/*.mp4", (route) => route.abort());
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".tc-film-notice")).toContainText(
    "Film unavailable",
  );
  await page.clock.install();
  await page.getByTestId("place-bet").click();
  await page.getByTestId("start-race").click();
  await page.clock.fastForward(65000);
  await expect(page.getByRole("dialog")).toContainText("Official race result");
  await expect(page.locator(".tc-result-photo")).toHaveAttribute(
    "src",
    /runner-[1-8]\.jpg$/,
  );
});
test("marathon runs two laps and can be watched without a bet", async ({
  page,
}) => {
  await page.clock.install();
  await page.getByTestId("venue-marathon").click();
  await page.getByTestId("start-race").click();
  await page.clock.fastForward(44000);
  await expect(page.locator(".tc-stage-bottom")).toContainText("LAP 2 / 2");
  await page.clock.fastForward(40000);
  await expect(page.getByRole("dialog")).toContainText("Official race result");
  await expect(page.getByTestId("turf-balance")).toContainText("10,000");
  await page.getByRole("button", { name: "Back to the paddock" }).click();
  await expect(page.getByTestId("start-race")).toBeEnabled();
  await expect(page.locator('[data-phase="betting"]')).toBeVisible();
});
test("mobile, landscape, tablet and desktop keep controls reachable without horizontal overflow", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1024, 768],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    const frame = page.locator(".game-viewport");
    expect(
      await frame.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const stageBox = await page.getByTestId("race-stage").boundingBox();
    expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(width);
    await page.getByTestId("place-bet").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("place-bet")).toBeInViewport();
    await page.getByTestId("start-race").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("start-race")).toBeInViewport();
  }
});

test("starting on mobile brings the race into view", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("place-bet").click();
  await page.getByTestId("start-race").click();
  await expect
    .poll(async () => {
      const rect = await page.getByTestId("race-stage").boundingBox();
      return !!rect && rect.y >= -1 && rect.y < 100;
    })
    .toBe(true);
  await expect(page.getByTestId("race-stage")).toBeInViewport();
});
