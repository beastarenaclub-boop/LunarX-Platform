import { test, expect, type Page } from "@playwright/test";
import { studio } from "./fixtures/roulette";

// Test the actual rendered paths and ball centre; a correct badge/dataset by
// itself cannot make this pass. All API/socket traffic is mocked.
async function physicalPocket(page: Page) {
  return page.getByTestId("roulette-controlled-wheel").evaluate(svg => {
    const ball = svg.querySelector('[data-testid="roulette-studio-ball"]') as SVGCircleElement;
    const screenPoint = new DOMPoint(ball.cx.baseVal.value, ball.cy.baseVal.value).matrixTransform(ball.getScreenCTM()!);
    const paths = [...svg.querySelectorAll<SVGPathElement>("path[data-pocket]")];
    const hit = paths.filter(path => path.isPointInFill(screenPoint.matrixTransform(path.getScreenCTM()!.inverse())));
    return { hits: hit.length, number: hit[0]?.parentElement?.querySelector("text")?.textContent,
      cx: ball.cx.baseVal.value, cy: ball.cy.baseVal.value };
  });
}

for (const width of [1366, 390]) {
  test(`all 37 results physically land in their printed pocket at ${width}px`, async ({ page }, info) => {
    test.setTimeout(150000);
    await page.setViewportSize({ width, height: 960 });
    const game = await studio(page, { late: true });
    const stage = page.getByTestId("roulette-dealer-stage");
    const rotor = page.getByTestId("roulette-controlled-wheel");
    await expect(page.getByTestId("wheel-result")).toHaveText("17");
    expect(await physicalPocket(page)).toMatchObject({ hits: 1, number: "17" });
    const printed = await rotor.locator("text").allTextContents();
    expect([...printed].map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    for (let n = 0; n <= 36; n++) {
      game.betting(`pocket-${width}-${n}`, 120000);
      await expect(stage).toHaveAttribute("data-round-id", `pocket-${width}-${n}`);
      await expect(stage).toHaveAttribute("data-phase", "betting");
      game.reveal(n, 700);
      await expect(page.getByTestId("wheel-result")).toHaveText(String(n));
      expect(await physicalPocket(page), `ball must be inside printed pocket ${n}`).toMatchObject({ hits: 1, number: String(n) });
      if (n === 0 || n === 17 || n === 36) {
        await expect.poll(() => page.getByTestId("roulette-camera-scene").evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1.52, 2);
        await stage.screenshot({ path: info.outputPath(`landed-${n}.png`) });
      }
    }
    const before = await physicalPocket(page);
    game.repeatResult();
    await page.getByRole("button", { name: "Hide wheel close-up" }).click();
    expect(await physicalPocket(page)).toEqual(before);
    await page.getByRole("button", { name: "Show wheel close-up" }).click();
    expect(await physicalPocket(page)).toEqual(before);
    expect(game.errors).toEqual([]);
  });
}

test("reduced motion and unavailable dealer video still show the correct physical pocket", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/*dealer-*.mp4", route => route.abort());
  const game = await studio(page, { late: true });
  await expect(page.getByTestId("wheel-result")).toHaveText("17");
  expect(await physicalPocket(page)).toMatchObject({ hits: 1, number: "17" });
  game.betting("static-zero", 120000);
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute("data-round-id", "static-zero");
  game.reveal(0, 700);
  await expect(page.getByTestId("wheel-result")).toHaveText("0");
  expect(await physicalPocket(page)).toMatchObject({ hits: 1, number: "0" });
  expect(game.errors).toEqual([]);
});

test("animated landing, duplicate result and camera changes keep the ball in the winning pocket", async ({ page }) => {
  test.setTimeout(60000);
  const game = await studio(page);
  game.betting("animated-pocket", 4500);
  await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute("data-round-id", "animated-pocket");
  game.reveal(17, 5000);
  await expect(page.getByTestId("roulette-wheel")).toHaveAttribute("data-wheel-state", "spinning");
  await expect(page.getByTestId("wheel-result")).toHaveCount(0);
  const rotor = page.getByTestId("roulette-studio-rotor");
  const moving = await rotor.getAttribute("transform");
  await expect.poll(() => rotor.getAttribute("transform")).not.toBe(moving);
  await expect(page.getByTestId("wheel-result")).toHaveText("17", { timeout: 8000 });
  const settled = await physicalPocket(page);
  expect(settled).toMatchObject({ hits: 1, number: "17" });
  const stopped = await rotor.getAttribute("transform");
  game.repeatResult();
  await page.getByRole("button", { name: "Hide wheel close-up" }).click();
  await page.getByRole("button", { name: "Show wheel close-up" }).click();
  await page.waitForTimeout(1000);
  expect(await physicalPocket(page)).toEqual(settled);
  expect(await rotor.getAttribute("transform")).toBe(stopped);
  await page.reload();
  await expect(page.getByTestId("wheel-result")).toHaveText("17");
  expect(await physicalPocket(page)).toMatchObject({ hits: 1, number: "17" });
  const restored = await page.getByTestId("roulette-studio-rotor").getAttribute("transform");
  // A restored angle can differ by floating-point roundoff after whole turns
  // are removed. Compare the physical angle, not its serialized decimal text.
  expect(Number.parseFloat(restored!.slice(7))).toBeCloseTo(Number.parseFloat(stopped!.slice(7)), 8);
  expect(game.errors).toEqual([]);
});
