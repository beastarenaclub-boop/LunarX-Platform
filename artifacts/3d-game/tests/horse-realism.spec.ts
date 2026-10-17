import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

test("textured human and horse assets render in the live race and close-up", async ({
  page,
}) => {
  test.setTimeout(120000);
  const assetResponses: string[] = [];
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /THREE|WebGL|shader|GL_INVALID/i.test(message.text())
    )
      shaderErrors.push(message.text());
  });
  page.on("response", (r) => {
    if (r.url().includes("/realistic/") && r.ok())
      assetResponses.push(new URL(r.url()).pathname);
  });
  const f = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute(
    "data-character-detail",
    "animated-3d-horse-jockey",
  );
  await expect(canvas).toHaveAttribute(
    "data-visual-quality",
    "cinematic-desktop",
  );
  expect(
    assetResponses.some((url) => url.endsWith("earth/thoroughbred-v2.glb")),
  ).toBe(true);
  expect(
    assetResponses.some((url) =>
      url.endsWith("stadium/spectators-atlas-v1.png"),
    ),
  ).toBe(true);
  expect(
    assetResponses.some((url) =>
      url.endsWith("stadium/hospitality-facade-v1.png"),
    ),
  ).toBe(true);
  await expect(canvas).toHaveAttribute(
    "data-graphics-revision",
    "turf-broadcast-v1",
  );
  await expect(canvas).toHaveAttribute(
    "data-stadium-revision",
    "royal-park-broadcast-v1",
  );
  await expect(canvas).toHaveAttribute("data-audience-sections", "0");
  await expect(canvas).toHaveAttribute("data-track-surface", "turf");
  expect(
    assetResponses.some((url) =>
      url.endsWith("performance/jockey-mounted-v3.glb"),
    ),
  ).toBe(true);
  expect(
    assetResponses.some((url) =>
      url.endsWith("performance/thoroughbred-field-v3.glb"),
    ),
  ).toBe(true);
  await expect(canvas).toHaveAttribute(
    "data-character-asset",
    "thoroughbred-v2",
  );
  expect(
    assetResponses.some((url) =>
      url.endsWith("performance/jockey-mounted-v3.glb"),
    ),
  ).toBe(true);
  await expect(canvas).toHaveAttribute("data-rider-outfits", "8");
  expect(
    assetResponses.some((url) => url.endsWith("raked_dirt-nor_gl.jpg")),
  ).toBe(true);
  expect(
    assetResponses.some((url) => url.endsWith("earth/racing-loam-v1.png")),
  ).toBe(true);
  await expect(canvas).toHaveAttribute("data-track-detail", "maintained-turf");
  expect(assetResponses.some((url) => url.endsWith("tree-canopy-0.png"))).toBe(
    true,
  );
  await page
    .getByRole("button", { name: "Close-up camera", exact: true })
    .click();
  await page.clock.runFor(1200);
  await canvas.screenshot({ path: "test-results/horse-realistic-closeup.png" });
  await f.start();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  await page.clock.runFor(1200);
  await canvas.screenshot({ path: "test-results/horse-realistic-gallop.png" });
  await expect(
    page.getByRole("button", { name: "Front camera", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Broadcast camera", exact: true })
    .click();
  await page.clock.runFor(1500);
  await expect(canvas).toHaveAttribute("data-camera", "broadcast");
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await canvas.screenshot({ path: "test-results/horse-realistic-front.png" });
  // The opposite straight exposes the architectural stands behind the field.
  await f.advanceTo(f.race.startedAt + 9500);
  await page
    .getByRole("button", { name: "Rail-side camera", exact: true })
    .click();
  await page.clock.runFor(1100);
  await canvas.screenshot({ path: "test-results/horse-derby-grandstand.png" });
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
  expect(shaderErrors).toEqual([]);
});

test("cinematic mobile rendering supports all six venues without shader errors", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 390, height: 844 });
  const shaderErrors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /THREE|WebGL|shader|GL_INVALID/i.test(message.text())
    )
      shaderErrors.push(message.text());
  });
  const f = await setup(page, { holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute(
    "data-visual-quality",
    "cinematic-mobile",
  );
  for (const venue of [
    "royal",
    "dubai",
    "alpine",
    "coast",
    "night",
    "marathon",
  ]) {
    await page
      .getByRole("combobox", { name: "Race location" })
      .selectOption(venue);
    await expect(canvas).toHaveAttribute("data-venue", venue);
    await expect(canvas).toHaveAttribute("data-renderer", "webgl-3d");
    await expect(canvas).toHaveAttribute(
      "data-stadium-revision",
      venue === "royal" ? "royal-park-broadcast-v1" : "full-racecourse-v2",
    );
    await expect(canvas).toHaveAttribute(
      "data-track-surface",
      venue === "alpine" || venue === "royal" ? "turf" : "dirt",
    );
    await expect(canvas).toHaveAttribute(
      "data-track-detail",
      venue === "alpine" || venue === "royal"
        ? "maintained-turf"
        : "granular-loam-v1",
    );
    await page.clock.runFor(150);
  }
  await page
    .getByRole("combobox", { name: "Race location" })
    .selectOption("royal");
  await expect(canvas).toHaveAttribute("data-venue", "royal");
  await page
    .getByRole("button", { name: "Close-up camera", exact: true })
    .click();
  await page.clock.runFor(800);
  await f.start();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  await canvas.screenshot({ path: "test-results/horse-cinematic-mobile.png" });
  expect(shaderErrors).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.posts).toHaveLength(0);
});
