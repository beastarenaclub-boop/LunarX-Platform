import { test, expect } from "@playwright/test";
import { studio } from "./fixtures/roulette";

for (const width of [1366, 390]) {
  test(`dealer launches one physical ball on each round at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 960 });
    const game = await studio(page, { bettingMs: 25000 });
    const wheel = page.getByTestId("roulette-controlled-wheel");
    const ball = page.getByTestId("roulette-studio-ball");
    await expect(wheel).toHaveAttribute("data-ball-stage", "held");
    await expect(ball).toBeHidden();
    for (let round = 1; round <= 2; round++) {
      game.betting(`physical-throw-${round}`, 4500);
      await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute("data-dealer-state", "release");
      await expect(wheel).toHaveAttribute("data-ball-stage", "held");
      await expect(ball).toBeHidden();
      await expect(wheel).toHaveAttribute("data-ball-stage", "orbit");
      await expect(ball).toBeVisible();
      expect(await page.getByTestId("roulette-dealer-action").evaluate(v => (v as HTMLVideoElement).currentTime)).toBeGreaterThan(1.5);
      // Real screen geometry: the ball circles inside the bowl in the opposite
      // direction to the rotor. A number badge or spinning CSS shadow cannot pass.
      const samples = await wheel.evaluate(async svg => {
        const ball = svg.querySelector('[data-testid="roulette-studio-ball"]') as SVGCircleElement;
        const rotor = svg.querySelector('[data-testid="roulette-studio-rotor"]')!;
        const samples: { angle: number; radius: number; rotor: number }[] = [];
        for (let i = 0; i < 14; i++) {
          const x = ball.cx.baseVal.value - 748, y = (ball.cy.baseVal.value - 813) / .42;
          samples.push({ angle: Math.atan2(y, x) * 180 / Math.PI, radius: Math.hypot(x, y), rotor: Number.parseFloat(rotor.getAttribute("transform")!.slice(7)) });
          await new Promise(resolve => setTimeout(resolve, 90));
        }
        return samples;
      });
      const travel = (key: "angle" | "rotor") => samples.slice(1).reduce((sum, s, i) => sum + ((s[key] - samples[i][key] + 540) % 360 - 180), 0);
      expect(travel("angle")).toBeLessThan(-400);
      expect(travel("rotor")).toBeGreaterThan(50);
      for (const sample of samples) expect(sample.radius).toBeCloseTo(475, 3);
      await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath(`throw-${round}.png`) });
      game.reveal(round === 1 ? 17 : 32, 3500);
      await expect(page.getByTestId("wheel-result")).toHaveText(round === 1 ? "17" : "32", { timeout: 6000 });
      await expect(wheel).toHaveAttribute("data-ball-stage", "settled");
      await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath(`pocket-${round}.png`) });
    }
    expect(game.errors).toEqual([]);
  });
}
