import { test, expect } from "@playwright/test";
import { RACING_HORSES } from "@workspace/api-zod/horse-racing-game";
import { setup } from "./horse-live-fixture";
test("full browser viewport and coin sizes, all locations, no video panel or provider branding", async ({
  page,
}) => {
  test.setTimeout(180000);
  const f = await setup(page, { holdBetting: true });
  const tracks = new Set<string>();
  for (const id of ["royal", "dubai", "alpine", "coast", "night", "marathon"]) {
    await page
      .getByRole("combobox", { name: "Race location" })
      .selectOption(id);
    await expect(page.getByTestId("horse-race-canvas")).toHaveAttribute(
      "data-venue",
      id,
    );
    tracks.add(
      await page
        .getByTestId("horse-race-canvas")
        .screenshot({ type: "jpeg", quality: 20 })
        .then((image) => image.toString("base64")),
    );
  }
  expect(tracks.size).toBe(6);
  const audioLengths = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 1, 44100);
    return Promise.all(
      ["hooves", "crowd"].map(async (id) => {
        const response = await fetch(`/assets/horse-racing/${id}.mp3`);
        return (await context.decodeAudioData(await response.arrayBuffer()))
          .duration;
      }),
    );
  });
  expect(audioLengths.every((n) => n >= 5)).toBe(true);
  await page.getByRole("button", { name: "Enable race sound" }).click();
  await expect(
    page.getByRole("button", { name: "Mute race sound" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Mute race sound" }).click();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [768, 1024],
    [932, 430],
    [1440, 900],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    const frame = await page.locator("[data-game-viewport]").boundingBox();
    expect(Math.abs(frame!.width - width)).toBeLessThan(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    // Viewport fitting runs in ResizeObserver/requestAnimationFrame callbacks.
    // Read the settled stage, rather than the transient layout during reflow.
    await expect
      .poll(async () => {
        await page.clock.runFor(100);
        const screen = await page.getByTestId("horse-race-stage").boundingBox();
        return (
          screen!.width > 100 &&
          Math.abs(screen!.width / screen!.height - 16 / 9) < 0.02
        );
      })
      .toBe(true);
    const screen = await page.getByTestId("horse-race-stage").boundingBox();
    expect(screen!.x + screen!.width).toBeLessThanOrEqual(width);
    for (const id of ["horse-8", "chip-10000"]) {
      await page.getByTestId(id).scrollIntoViewIfNeeded();
      await expect(page.getByTestId(id)).toBeInViewport();
    }
    for (const name of [
      "Broadcast",
      "Rail-side",
      "Front",
      "Grandstand",
      "Close-up",
      "Auto",
    ]) {
      const button = page.getByRole("button", {
        name: name + " camera",
        exact: true,
      });
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeInViewport();
    }
  }
  await expect(page.locator("video")).toHaveCount(0);
  await page.setViewportSize({ width: 932, height: 430 });
  await page.getByRole("button", { name: "Fullscreen race" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  const fullscreen = await page.getByTestId("horse-race-stage").boundingBox();
  expect(
    Math.abs(fullscreen!.width / fullscreen!.height - 16 / 9),
  ).toBeLessThan(0.02);
  expect(fullscreen!.height).toBeLessThanOrEqual(430);
  await expect(
    page.getByRole("button", { name: "Grandstand camera", exact: true }),
  ).toBeInViewport();
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByText(/Higgsfield|AI CINEMATIC|practice coins/),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("[data-game-viewport]").evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({
    path: "test-results/horse-game-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("[data-game-viewport]").evaluate((e) => (e.scrollTop = 0));
  await page.screenshot({
    path: "test-results/horse-game-mobile.png",
    fullPage: true,
  });
  expect(f.errors).toEqual([]);
});

test("close-up keeps all eight horses together without single-runner controls", async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute("data-pose", "standing");
  await page
    .getByRole("button", { name: "Close-up camera", exact: true })
    .click();
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await expect(
    page.getByRole("group", { name: "Follow a runner" }),
  ).toHaveCount(0);
  await page.getByTestId("btn-game-rules").click();
  await page
    .getByRole("button", {
      name: "View Silver Arrow with the race pack",
      exact: true,
    })
    .click();
  await page.keyboard.press("Escape");
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await expect(
    page.getByRole("button", { name: "Front camera", exact: true }),
  ).toBeEnabled();
  expect(f.posts).toHaveLength(0);
  await page.getByTestId("horse-8").click();
  await page.clock.runFor(6600);
  await expect.poll(() => f.posts.length).toBe(1);
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  await f.start();
  for (const seconds of [2, 6, 12]) {
    await f.advanceTo(f.race.startedAt + seconds * 1000);
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    expect(
      Number(await canvas.getAttribute("data-heading-error")),
    ).toBeLessThan(1e-8);
    const bounds = JSON.parse(
      (await canvas.getAttribute("data-runner-bounds"))!,
    ) as number[][];
    expect(bounds).toHaveLength(8);
    expect(
      bounds.every(
        ([, x, y, w, h]) => x >= 0 && y >= 0 && x + w <= 1280 && y + h <= 720,
      ),
    ).toBe(true);
    await canvas.screenshot({
      path: "test-results/horse-pack-turn-" + seconds + ".png",
    });
  }
  expect(f.posts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("camera changes preserve the active race and stake, support auto and keyboard, and survive reload", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await setup(page, { holdBetting: true });
  await page.getByTestId("horse-8").click();
  await page.clock.runFor(6600);
  await expect.poll(() => f.posts.length).toBe(1);
  await f.start();
  // Keep the live round from naturally rolling over while screenshots are encoded.
  // Explicit runFor calls below still advance the camera and race together.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  const canvas = page.getByTestId("horse-race-canvas"),
    raceId = f.race!.id,
    seed = f.race!.plan.seed;
  const shots = new Set<string>();
  for (const [id, name, minElevation, maxElevation] of [
    ["broadcast", "Broadcast", 28, 34],
    ["rail", "Rail-side", 10, 17],
    ["grandstand", "Grandstand", 43, 49],
  ] as const) {
    await page
      .getByRole("button", { name: name + " camera", exact: true })
      .click();
    await page.clock.runFor(1100);
    await expect(canvas).toHaveAttribute("data-camera", id);
    const elevation = Number(await canvas.getAttribute("data-elevation"));
    expect(elevation).toBeGreaterThan(minElevation);
    expect(elevation).toBeLessThan(maxElevation);
    await expect(canvas).toHaveAttribute("data-race-id", raceId);
    const bounds = JSON.parse(
      (await canvas.getAttribute("data-runner-bounds"))!,
    ) as number[][];
    expect(bounds).toHaveLength(8);
    expect(
      bounds.every(
        ([, x, y, w, h]) => x >= 0 && x + w <= 1280 && y >= 0 && y + h <= 720,
      ),
    ).toBe(true);
    shots.add((await canvas.screenshot()).toString("base64"));
    expect(f.posts).toHaveLength(1);
    expect(f.race!.plan.seed).toBe(seed);
  }
  expect(shots.size).toBe(3);
  await page.getByRole("button", { name: "Auto camera", exact: true }).click();
  await page.clock.runFor(500);
  const before = await canvas.getAttribute("data-camera");
  await page.clock.runFor(8100);
  expect(await canvas.getAttribute("data-camera")).not.toBe(before);
  await page
    .getByRole("button", { name: "Broadcast camera", exact: true })
    .click();
  await page.keyboard.press("c");
  await page.clock.runFor(800);
  await expect(canvas).toHaveAttribute("data-camera", "rail");
  // Freeze the server's wall clock while allowing React timers and GPU setup
  // to run. Asset decoding must not turn persistence into a finish-line check.
  await page.clock.setFixedTime(await page.evaluate(() => Date.now()));
  await page.clock.resume();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("button", { name: "Rail-side camera", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(canvas).toHaveAttribute("data-camera", "rail", {
    timeout: 30000,
  });
  await expect(canvas).toHaveAttribute("data-race-id", raceId);
  expect(f.posts).toHaveLength(1);
  expect(f.errors).toEqual([]);
});
