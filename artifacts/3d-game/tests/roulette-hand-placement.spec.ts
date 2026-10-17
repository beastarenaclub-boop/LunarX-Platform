import { test, expect } from "@playwright/test";
import { studio } from "./fixtures/roulette";

for (const width of [1366, 390]) {
  test(`hand stays above the wheel and ball follows its decoded release at ${width}px`, async ({ page }, info) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height: 960 });
    const game = await studio(page);
    const film = page.getByTestId("roulette-dealer-action");
    const foreground = page.getByTestId("roulette-dealer-hand");
    const ball = page.getByTestId("roulette-studio-ball");
    // Deliberately lag the decoder behind the betting clock. A timer-only
    // release would create a second ball before the hand has let go.
    await film.evaluate(el => { (el as HTMLVideoElement).playbackRate = .65; });
    game.betting("hand-contact", 4500);
    await expect(foreground).toHaveAttribute("data-visible", "true");
    await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath("hand-holding-ball.png") });
    const samples = await page.evaluate(async () => {
      const svg = document.querySelector('[data-testid="roulette-controlled-wheel"]')!;
      const hand = document.querySelector('[data-testid="roulette-dealer-hand"]') as HTMLCanvasElement;
      const ball = svg.querySelector('[data-testid="roulette-studio-ball"]') as SVGCircleElement;
      const samples: { media: number; stage: string | null; x: number; y: number; alpha: number; gapAlpha: number; visible: string }[] = [];
      const until = performance.now() + 7000;
      while (performance.now() < until) {
        const media = Number(hand.dataset.mediaMs);
        if (hand.dataset.visible === "true" && Number.isFinite(media)) {
          samples.push({ media, stage: svg.getAttribute("data-ball-stage"), x: ball.cx.baseVal.value, y: ball.cy.baseVal.value,
            alpha: hand.getContext("2d")!.getImageData(850, 530, 1, 1).data[3],
            gapAlpha: hand.getContext("2d")!.getImageData(828, 560, 1, 1).data[3], visible: getComputedStyle(ball).visibility });
          if (media > 1800) break;
        }
        await new Promise(requestAnimationFrame);
      }
      return samples;
    });
    const held = samples.filter(s => s.media > 1200 && s.media < 1400);
    expect(held.length).toBeGreaterThan(0);
    for (const s of held) expect(s).toMatchObject({ stage: "held", visible: "hidden", alpha: 255 });
    const transfer = samples.filter(s => s.media >= 1520 && s.media < 1580);
    expect(transfer.length).toBeGreaterThan(0);
    for (const s of transfer) expect(s.gapAlpha).toBe(0);
    const flight = samples.filter(s => s.stage === "flight");
    expect(flight.length).toBeGreaterThan(0);
    for (const s of flight) {
      expect(s.media).toBeGreaterThanOrEqual(1500);
      expect(s.x).toBeGreaterThanOrEqual(810);
      expect(s.x).toBeLessThanOrEqual(842);
      expect(s.y).toBeGreaterThanOrEqual(535);
      expect(s.y).toBeLessThanOrEqual(616);
    }
    expect(samples.some(s => s.stage === "orbit")).toBe(true);
    await expect(ball).toBeVisible();
    await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath("hand-to-track.png") });
    game.reveal(17, 2000);
    await expect(page.getByTestId("wheel-result")).toHaveText("17");
    await expect(foreground).toHaveAttribute("data-visible", "false");
    game.betting("hand-reset", 25000);
    await expect(ball).toBeHidden();
    expect(game.errors).toEqual([]);
  });
}
