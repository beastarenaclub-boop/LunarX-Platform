import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

for (const mobile of [false, true]) {
  test(`${mobile ? "mobile" : "desktop"} race uses every animation tick within its geometry budget`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const f = await setup(page, { holdBetting: true });
    const canvas = page.getByTestId("horse-race-canvas");
    await expect(canvas).toHaveAttribute(
      "data-graphics-revision",
      "turf-broadcast-v1",
    );
    await page
      .getByRole("button", { name: "Rail-side camera", exact: true })
      .click();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
    await f.start();
    await f.advanceTo(f.race.startedAt + 7000);
    const before = Number(await canvas.getAttribute("data-frame-count"));
    await page.clock.runFor(1000);
    const after = Number(await canvas.getAttribute("data-frame-count"));
    // A deterministic scheduler regression check, not an assertion that every
    // real device achieves 60 fps. The old threshold skipped alternating ticks.
    expect(after - before).toBeGreaterThanOrEqual(50);
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    await expect(canvas).toHaveAttribute("data-horse-detail", "skinned-lod");
    expect(Number(await canvas.getAttribute("data-draw-calls"))).toBeLessThan(
      450,
    );
    expect(Number(await canvas.getAttribute("data-triangles"))).toBeLessThan(
      500000,
    );
    await expect(canvas).toHaveAttribute(
      "data-stadium-revision",
      "royal-park-broadcast-v1",
    );
    await page
      .getByRole("button", { name: "Close-up camera", exact: true })
      .click();
    await page.clock.runFor(500);
    await expect(canvas).toHaveAttribute("data-horse-detail", "skinned-lod");
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    expect(f.errors).toEqual([]);
    expect(f.posts).toHaveLength(0);
  });
}
