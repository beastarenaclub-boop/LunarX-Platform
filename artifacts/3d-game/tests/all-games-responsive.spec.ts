import { test, expect } from "@playwright/test";
import { mockResponsiveGame } from "./fixtures/responsive-game-data";
import { setup as horse } from "./horse-live-fixture";
import { setup as bike } from "./bike-live-fixture";

test("keyboard-sized viewport and client navigation keep controls reachable", async ({ page }) => {
  await mockResponsiveGame(page, "chicken-road");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/mines");
  const frame = page.locator("[data-game-viewport]");
  await expect(frame).toHaveAttribute("data-fit-scale", "1.000");
  await page.setViewportSize({ width: 390, height: 300 });
  const coin = frame.locator("[data-game-coin]:visible:not(:disabled)").last();
  await coin.click({ trial: true, timeout: 10000 });
  await expect(coin).toBeInViewport({ ratio: .99 });
  await expect(frame).toHaveAttribute("data-fit-scale", "1.000");
  await page.evaluate(() => {
    history.pushState(null, "", "/chicken-road");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page.getByTestId("chicken-road-page")).toBeVisible();
  await expect(frame).toHaveAttribute("data-fit-scale", "1.000");
  expect(await frame.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollTop }))).toEqual({ height: 300, scroll: 0 });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.getByTestId("chicken-play").click({ trial: true, timeout: 10000 });
});

const routes = ["play", "aviator", "jetx", "fury", "mines", "plinko", "dice", "roulette", "baccarat", "blackjack", "teen-patti", "teen-patti-live", "andar-bahar", "lucky-7", "dragon-tiger", "rummy", "vegetable-bowl", "horse-racing", "bike-racing", "wingo", "lunar-colour-trading", "chicken-road", "crazy-time", "dragon-tiger-one-day", "forex-trading"];

for (const route of routes) test(`${route}: responsive browser layout`, async ({ page, baseURL }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  let cleanup = () => {};
  const racing = route === "horse-racing" || route === "bike-racing";
  if (racing) {
    await page.routeWebSocket("**/*", ws => ws.onMessage(() => {}));
    await page.emulateMedia({ reducedMotion: "reduce" });
    // The flat scene preserves the same layout without loading GPU models.
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
        return type.includes("webgl") ? null : getContext.call(this, type as any, ...args);
      } as typeof getContext;
    });
    process.env.HORSE_GAME_URL = `${baseURL}/horse-racing`;
    process.env.BIKE_GAME_URL = `${baseURL}/bike-racing`;
    await (route === "horse-racing" ? horse : bike)(page, { holdBetting: true });
  } else {
    cleanup = await mockResponsiveGame(page, route);
    await page.goto(`/${route}`, { waitUntil: "domcontentloaded" });
  }
  const frame = page.locator("[data-game-viewport]");
  const information = ["chicken-road", "crazy-time"].includes(route) ? page.getByRole("button", { name: "Game rules", exact: true }) : page.getByTestId("btn-game-rules");
  await expect(information).toBeVisible();
  const playControls = "[data-game-bet], [data-game-coin], .cr-play, .cr-coins > div > button, [data-testid^='crazy-spot-'], [data-testid^='od-market-']";
  const metrics = [];
  for (const [width, height] of [[320, 568], [390, 844], [568, 320], [844, 390], [768, 1024], [1024, 768], [1366, 768], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    if (racing) await page.clock.runFor(300);
    else await page.waitForTimeout(120);
    const metric = await frame.evaluate((el, selector) => {
      const controls = [...el.querySelectorAll<HTMLElement>(selector)].filter(n => n.getClientRects().length);
      return {
        viewport: `${innerWidth}x${innerHeight}`, scale: el.getAttribute("data-fit-scale"),
        controls: controls.length,
        overflow: el.scrollWidth - el.clientWidth,
        small: controls.filter(n => n.getBoundingClientRect().height < 35).map(n => n.dataset.testid),
        outside: controls.filter(n => {
          const r = n.getBoundingClientRect();
          if (r.x >= -1 && r.right <= innerWidth + 1) return false;
          // Coin racks and the enlarged roulette table intentionally scroll.
          // Their last control is separately scrolled into view and hit-tested below.
          for (let parent = n.parentElement; parent && parent !== el; parent = parent.parentElement) {
            if (["auto", "scroll"].includes(getComputedStyle(parent).overflowX) && parent.scrollWidth > parent.clientWidth + 1) return false;
          }
          return true;
        }).map(n => n.dataset.testid),
        overflowElements: el.scrollWidth > el.clientWidth + 1 ? [...el.querySelectorAll<HTMLElement>("*")].filter(n => { const r = n.getBoundingClientRect(); return r.width && r.right > innerWidth + 1 && getComputedStyle(n).position !== "absolute"; }).slice(0, 8).map(n => ({ tag: n.tagName, class: n.className, width: n.getBoundingClientRect().width })) : [],
      };
    }, playControls);
    metrics.push(metric);
    expect.soft(metric.overflow, `${route} horizontal overflow at ${width}x${height}: ${JSON.stringify(metric.overflowElements)}`).toBeLessThanOrEqual(1);
    expect.soft(metric.small, `${route} shrunk controls at ${width}x${height}`).toEqual([]);
    expect.soft(metric.outside, `${route} offscreen controls at ${width}x${height}`).toEqual([]);
    expect.soft(metric.scale === null || metric.scale === "1.000", "Controls retain native size").toBe(true);
    expect(metric.controls, "Game controls have loaded").toBeGreaterThan(0);
    if (route === "roulette" && width < 768) {
      const number = page.getByTestId("cell-36");
      await number.scrollIntoViewIfNeeded();
      await expect(number).toBeInViewport({ ratio: .99 });
      expect((await number.boundingBox())!.width).toBeGreaterThanOrEqual(44);
      await number.click({ trial: true });
    }
    const lastCoin = frame.locator("[data-game-coin]:visible:not(:disabled), .cr-coins > div > button:visible:not(:disabled)").last();
    if (await lastCoin.count()) {
      await lastCoin.scrollIntoViewIfNeeded();
      await expect(lastCoin).toBeInViewport({ ratio: .99 });
      await lastCoin.click({ trial: true, timeout: 10000 });
    }
    await frame.evaluate(el => { el.scrollTop = 0; });
    if (process.env.RESPONSIVE_SCREENSHOTS && (width === 390 || width === 1366)) {
      await page.screenshot({ path: info.outputPath(`${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  if (racing) await page.clock.runFor(300);
  await information.click();
  if (racing) await page.clock.runFor(300);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeInViewport({ ratio: .99 });
  await page.setViewportSize({ width: 844, height: 390 });
  if (racing) await page.clock.runFor(300);
  await expect(dialog).toBeInViewport({ ratio: .99 });
  await page.keyboard.press("Escape");
  if (racing) await page.clock.runFor(300);
  await expect(dialog).toBeHidden();
  expect(errors).toEqual([]);
  cleanup();
  await info.attach("responsive-metrics", { body: JSON.stringify(metrics), contentType: "application/json" });
});
