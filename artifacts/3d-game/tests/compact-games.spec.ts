import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
import { setup as horse } from "./horse-live-fixture";
import { setup as bike } from "./bike-live-fixture";

test('Andar Bahar revealed cards remain visible in the compact lanes', async ({ page }) => {
  await mockGames(page);
  await page.route('**/api/andar-bahar/round', async route => {
    const now = Date.now();
    await route.fulfill({ json: {
      roundId: 'compact-reveal', gameCode: 'andar-bahar', phase: 'settling', now,
      bettingEndsAt: now - 10000, revealEndsAt: now - 1000, settleEndsAt: now + 120000,
      config: { enabled: true, bettingWindowMs: 20000, revealDurationMs: 5000, settleDurationMs: 120000, minStakePaise: '100', maxStakePaise: '100000' },
      outcome: { joker: 0, andarCards: [1, 13], baharCards: [2], firstSide: 'andar', winner: 'andar', cardsDealt: 3 },
      serverSeedHash: 'test', clientSeed: 'test', nonce: 1, serverSeed: 'test', totalStake: '0', playerCount: 0, liveBets: [], myBets: [], recent: [],
    } });
  });
  await page.goto('/andar-bahar');
  for (const [width, height] of [[390, 844], [844, 390], [1440, 900]]) {
    await page.setViewportSize({ width, height });
    for (const [side, card] of [['andar', 1], ['andar', 13], ['bahar', 2]]) {
      const face = page.getByTestId(`side-${side}`).getByTestId(`card-${card}`);
      await expect(face).toBeVisible();
      await expect(face).toBeInViewport({ ratio: .99 });
    }
  }
});

const routes = [
  "play",
  "aviator",
  "jetx",
  "fury",
  "mines",
  "plinko",
  "dice",
  "roulette",
  "baccarat",
  "blackjack",
  "teen-patti",
  "teen-patti-live",
  "andar-bahar",
  "lucky-7",
  "dragon-tiger",
  "rummy",
  "vegetable-bowl",
  "horse-racing",
  "bike-racing",
  "wingo",
];

for (const route of routes)
  test(`${route}: native controls stay reachable; extra panels open from information`, async ({
    page,
    baseURL,
  }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    const racing = route === "horse-racing" || route === "bike-racing";
    if (racing) {
      await page.routeWebSocket("**/*", (ws) => ws.onMessage(() => {}));
      process.env.HORSE_GAME_URL = `${baseURL}/horse-racing`;
      process.env.BIKE_GAME_URL = `${baseURL}/bike-racing`;
      await page.emulateMedia({ reducedMotion: "reduce" });
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
      await (route === "horse-racing" ? horse : bike)(page, {
        holdBetting: true,
      });
    } else {
      await mockGames(page);
      await page.goto(`/${route}`, { waitUntil: "domcontentloaded" });
    }
    const frame = page.locator("[data-game-viewport]");
    const information = page.getByTestId("btn-game-rules");
    await expect(information).toBeVisible();
    await expect(page.locator(".game-information-panels")).toHaveCount(0);
    const metrics = [];
    for (const [width, height] of [
      [320, 568],
      [390, 844],
      [768, 1024],
      [844, 390],
      [1280, 600],
      [1440, 900],
      [568, 280],
    ]) {
      await page.setViewportSize({ width, height });
      if (racing) await page.clock.runFor(300);
      if (route !== "wingo") await expect(frame).toHaveAttribute("data-fit-scale", "1.000");
      // Read all controls in one browser task; this also avoids slow protocol
      // round trips masking a layout failure on Firefox/WebKit.
      await expect
        .poll(
          () =>
            frame.evaluate((el) => {
              const nodes = Array.from(
                el.querySelectorAll<HTMLElement>(
                  '[data-game-bet], [data-game-coin], .vb-mode, .vb-quick-amounts button, .vb-amount input, .vb-place-bet, [data-testid="last-result-banner"], [data-testid="round-phase-banner"], [data-testid="round-timer-seconds"]',
                ),
              ).filter(
                (n) =>
                  n.getClientRects().length &&
                  getComputedStyle(n).visibility !== "hidden",
              );
              if (!nodes.length) return ["No play controls"];
              return nodes.flatMap((n) => {
                const r = n.getBoundingClientRect();
                return r.x >= -1 && r.right <= innerWidth + 1
                  ? []
                  : [n.dataset.testid ?? n.tagName];
              });
            }),
          { message: `${route} controls at ${width}x${height}` },
        )
        .toEqual([]);
      if (route === "lucky-7") {
        const scene = page.getByTestId("dice-table");
        await scene.scrollIntoViewIfNeeded();
        await expect(scene).toBeInViewport({ ratio: 0.995 });
        expect((await scene.boundingBox())!.height).toBeGreaterThan(60);
      }
      await information.scrollIntoViewIfNeeded();
      await expect(information).toBeInViewport({ ratio: 0.995 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      // Short windows may scroll vertically, but betting controls must remain
      // reachable at their native size instead of being scaled out of usability.
      const lastCoin = frame.locator('[data-game-coin]:visible').last();
      if (await lastCoin.count()) {
        await lastCoin.scrollIntoViewIfNeeded();
        await expect(lastCoin).toBeInViewport({ ratio: .99 });
      }
      metrics.push({
        width,
        height,
        scale: await frame.getAttribute("data-fit-scale"),
      });
      if (width === 390 || width === 1440) {
        const chips = await frame.locator('[data-game-coin]').evaluateAll(nodes => nodes
          .filter(n => n.getClientRects().length)
          .map(n => n.getBoundingClientRect().height));
        if (chips.length) expect(Math.min(...chips), `${route} chip size at ${width}`).toBeGreaterThanOrEqual(35);
      }
      if (width === 390 || width === 1440)
        await page.screenshot({ path: info.outputPath(`${width}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    if (racing) await page.clock.runFor(300);
    await information.click();
    if (racing) await page.clock.runFor(300);
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId("game-information-panels")).toBeVisible();
    expect(
      await page.getByTestId("game-information-panels").innerText(),
    ).not.toBe("");
    await expect(dialog).toBeInViewport({ ratio: 0.995 });
    await expect(dialog).toHaveAttribute('data-game-information-drawer', 'true');
    const drawerBounds = (await dialog.boundingBox())!;
    expect(drawerBounds.width).toBeLessThanOrEqual(440);
    expect(Math.abs(drawerBounds.x + drawerBounds.width - 390)).toBeLessThanOrEqual(1);
    if (route === 'dice' || route === 'plinko') {
      await page.getByTestId(`toggle-${route}-bonus`).check();
      await expect(page.getByTestId('input-auto-count')).toBeVisible();
    }
    if (route === 'rummy') {
      await page.getByRole('tab', { name: /Auto bet/ }).click();
      await expect(page.getByLabel('Auto bet rounds')).toBeVisible();
    }
    await page.screenshot({ path: info.outputPath('information-drawer.png') });
    await page.keyboard.press("Escape");
    if (racing) await page.clock.runFor(300);
    await expect(dialog).toHaveCount(0);
    await expect(information).toBeFocused();
    if (route === 'dice' || route === 'plinko') await expect(page.getByText('Bonus wallet selected')).toBeVisible();
    if (route === 'rummy') await expect(page.getByText(/AUTO ENTRY/)).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    if (racing) await page.clock.runFor(300);
    await information.click();
    if (racing) await page.clock.runFor(300);
    await expect(dialog).toBeInViewport({ ratio: 0.995 });
    const desktopDrawer = (await dialog.boundingBox())!;
    const desktopFrame = (await frame.boundingBox())!;
    expect(desktopDrawer.width).toBeLessThanOrEqual(440);
    expect(Math.abs(desktopDrawer.x + desktopDrawer.width - desktopFrame.x - desktopFrame.width)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    if (racing) await page.clock.runFor(300);
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
    console.log(route, JSON.stringify(metrics));
    await info.attach("viewport-scales", {
      body: JSON.stringify(metrics),
      contentType: "application/json",
    });
  });
