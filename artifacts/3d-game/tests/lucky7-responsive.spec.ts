import { expect, test, type Locator } from "@playwright/test";
import { table } from "./lucky7-table-fixture";

// The application shell may own scrolling instead of the document. Compare
// layout coordinates so scrolling a coin into view is not mistaken for reflow.
const layoutBox = (locator: Locator) => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  let x = r.x + scrollX, y = r.y + scrollY;
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (parent !== document.scrollingElement) { x += parent.scrollLeft; y += parent.scrollTop; }
  }
  return { x, y, width: r.width, height: r.height };
});

for (const [name, width, height] of [
  ["small phone", 320, 568], ["phone", 390, 844], ["tablet", 768, 1024],
  ["short landscape", 568, 320], ["landscape", 844, 390], ["laptop", 1280, 720],
] as const) test(`${name}: no crop, hidden controls or coin-induced layout movement`, async ({ page }, info) => {
  await page.setViewportSize({ width, height });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  const scene = page.getByTestId("dice-table");
  const geometry = () => layoutBox(scene);
  const before = await geometry();
  expect(before.width / before.height).toBeCloseTo(16 / 9, 1);
  await expect(page.getByTestId("lucky7-dealer")).toHaveCSS("object-fit", "contain");
  const title = (await page.locator(".lucky7-table-title").boundingBox())!;
  const die = (await page.getByTestId("static-die-1").boundingBox())!;
  expect(title.x + title.width <= die.x || die.x + die.width <= title.x
    || title.y + title.height <= die.y || die.y + die.height <= title.y).toBe(true);
  const panel = page.getByTestId("lucky7-betting-panel");
  expect(await panel.evaluate(el => getComputedStyle(el).overflowY)).toBe("visible");
  const reachable = async (testId: string) => {
    const el = page.getByTestId(testId);
    await expect(el).toBeVisible();
    await el.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" }));
    await expect(el).toBeInViewport({ ratio: 1 });
    if (!await el.isDisabled()) expect(await el.evaluate(node => {
      const r = node.getBoundingClientRect();
      return node.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), `${testId} is not covered`).toBe(true);
  };
  await reachable("text-lucky7-balance");
  const suffix = width >= 1024 ? "" : "-mobile";
  for (const value of [100, 200, 500, 1000, 2000, 5000, 10000]) {
    await reachable(`chip${suffix}-${value}`);
    await page.getByTestId(`chip${suffix}-${value}`).click();
    const after = await geometry();
    for (const key of ["x", "y", "width", "height"] as const) expect(after[key]).toBeCloseTo(before[key], 2);
  }
  expect(round.submissions).toHaveLength(0);
  await page.getByTestId(`chip${suffix}-100`).click();
  for (const spot of ["under", "exactly", "over"]) await reachable("spot-" + spot);
  await reachable(`chip${suffix}-custom`);
  await reachable(`btn-rebet${suffix}`);
  await page.getByTestId("btn-game-rules").click();
  await expect(page.getByTestId("lucky7-instant-hint")).toBeVisible();
  await expect(page.locator(".live-bet-limits")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect((await layoutBox(page.getByTestId("lucky7-betting-dock"))).y)
    .toBeGreaterThanOrEqual(width >= 640 && height <= 550 ? before.y : before.y + before.height);
  await scene.evaluate(el => {
    for (let parent = el.parentElement; parent; parent = parent.parentElement) parent.scrollTo(0,0);
    scrollTo(0,0);
  });
  await page.screenshot({ path: info.outputPath(name + ".png"), fullPage: true });
});
