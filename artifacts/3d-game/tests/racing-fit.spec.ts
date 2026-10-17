import { test, expect } from "@playwright/test";
import { setup as horse } from "./horse-live-fixture";
import { setup as bike } from "./bike-live-fixture";

for (const game of ["horse", "bike"] as const)
  test(`${game}: track and controls reflow with reachable actions on short screens`, async ({
    page,
    baseURL,
  }, info) => {
    process.env.HORSE_GAME_URL = `${baseURL}/horse-racing`;
    process.env.BIKE_GAME_URL = `${baseURL}/bike-racing`;
    // Force the supported timing view: this test checks layout, not GPU availability.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (
        type: string,
        ...args: any[]
      ) {
        return type.includes("webgl")
          ? null
          : getContext.call(this, type as any, ...args);
      } as typeof getContext;
    });
    await (game === "horse" ? horse : bike)(page, { holdBetting: true });
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [844, 390],
      [1280, 600],
      [1366, 768],
      [1440, 900],
      [1920, 1080],
      [568, 280],
    ]) {
      await page.setViewportSize({ width, height });
      await page.clock.runFor(300);
      if (game === "horse") {
        const frame = await page.locator("[data-game-viewport]").boundingBox();
        expect(frame!.width).toBe(width);
        const stage = await page.getByTestId("horse-race-stage").boundingBox();
        expect(stage!.width / stage!.height).toBeCloseTo(16 / 9, 2);
        if (
          (width >= 1280 && height >= 600) ||
          (width === 390 && height === 844)
        ) {
          expect(
            Number(
              await page
                .locator("[data-game-viewport]")
                .getAttribute("data-fit-scale"),
            ),
          ).toBe(1);
        }
        for (const control of await page
          .locator(".hr-camera-controls button, .hr-coins button")
          .all()) {
          await control.scrollIntoViewIfNeeded();
          await expect(
            control,
            `horse controls at ${width}x${height}`,
          ).toBeInViewport({ ratio: 0.999 });
        }
      }
      for (const control of await page
        .locator(
          '[data-game-bet]:visible, [data-game-coin]:visible, [data-testid^="' +
            game +
            '-"]:is(button)',
        )
        .all()) {
        await control.scrollIntoViewIfNeeded();
        await expect(control, `${game} at ${width}x${height}`).toBeInViewport({
          ratio: 0.999,
        });
      }
      expect(
        await page
          .locator("[data-game-viewport]")
          .evaluate(
            (el) =>
              el.scrollWidth <= el.clientWidth,
          ),
      ).toBe(true);
      await page.locator("[data-game-viewport]").evaluate(el=>el.scrollTop=0);
      if (width === 390 || width === 1440)
        await page.screenshot({ path: info.outputPath(`${width}.png`) });
    }
  });
