import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

for (const route of [
  "play",
  "mines",
  "plinko",
  "dice",
  "roulette",
  "baccarat",
  "blackjack",
  "andar-bahar",
  "teen-patti",
  "teen-patti-live",
  "lucky-7",
  "dragon-tiger",
  "rummy",
  "wingo",
]) {
  test(`${route}: phone, tablet and desktop keep controls readable and reachable`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await mockGames(page);
    await page.goto(`/${route}`, { waitUntil: "domcontentloaded" });
    const frame = page.locator("[data-game-viewport]");
    await expect(frame).toBeVisible();
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [844, 390],
      [1366, 768],
    ]) {
      await page.setViewportSize({ width, height });
      await expect
        .poll(() =>
          frame.evaluate((el) => {
            const controls = [
              ...el.querySelectorAll<HTMLElement>(
                "[data-game-coin], [data-game-bet], input",
              ),
            ].filter(
              (n) =>
                n.getClientRects().length &&
                getComputedStyle(n).visibility !== "hidden",
            );
            return controls.flatMap((n) => {
              const r = n.getBoundingClientRect();
              return r.left >= -1 &&
                r.right <= innerWidth + 1 &&
                (!n.hasAttribute("data-game-coin") || r.height >= 43)
                ? []
                : [
                    {
                      id: n.dataset.testid,
                      left: r.left,
                      right: r.right,
                      height: r.height,
                    },
                  ];
            });
          }),
        )
        .toEqual([]);
      const last = frame
        .locator("[data-game-bet]:visible, [data-game-coin]:visible")
        .last();
      await expect(async () => {
        await last.scrollIntoViewIfNeeded();
        await expect(last).toBeInViewport({ ratio: 0.99 });
      }).toPass({ timeout: 10000 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await frame.evaluate((el) => (el.scrollTop = 0));
      if (width === 390 || width === 1366)
        await page.screenshot({ path: info.outputPath(`${width}.png`) });
    }
  });
}
