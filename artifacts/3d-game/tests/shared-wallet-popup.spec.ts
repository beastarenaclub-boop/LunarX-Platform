import { test, expect } from "@playwright/test";

test("every game winner receipt names its game, fits small and landscape screens, and closes", async ({ page }) => {
  test.setTimeout(90000);
  await page.goto("http://127.0.0.1:5181");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const game of ["lunar", "aviator", "jetx", "fury", "mines", "dice", "plinko", "roulette", "baccarat", "blackjack", "teen-patti", "teen-patti-live", "andar-bahar", "lucky-7", "dragon-tiger", "rummy"]) {
    for (const [width, height] of [[320, 568], [932, 430]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(game => (window as unknown as { showWin(game: string): void }).showWin(game), game);
      const popup = page.getByTestId("round-win-dialog");
      await expect(popup).toBeVisible();
      await expect(popup).toHaveAttribute("data-game", game);
      await expect(page.getByTestId("round-win-game")).toHaveText(game.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" "));
      await expect(page.getByTestId("round-win-profit")).toContainText("12,34,567.89");
      const box = await popup.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height);
      await page.getByTestId("round-win-ok").click();
      await expect(popup).toHaveCount(0);
    }
  }
  expect(errors).toEqual([]);
});
