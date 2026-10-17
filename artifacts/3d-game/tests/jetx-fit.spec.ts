import { test, expect } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

test("JetX keeps the flight readout and bet controls visible without overlap", async ({ page }, info) => {
  await mockGames(page);
  await page.route("**/api/wallet/balance**", route => route.fulfill({ json: { balance: "12345678900", scope: "lunar", currency: "INR" } }));
  let phase: "betting" | "flying" | "crashed" = "betting";
  await page.route("**/api/crash/**", route => {
    const now = Date.now();
    return route.fulfill({ json: { id: "crash-fit", gameCode: "jetx", phase, now, startsAt: phase === "betting" ? now + 20000 : now - 8500, bettingMs: 20000, multiplier: 2.34, nextRoundAt: now + 150, crashPoint: phase === "crashed" ? 2.34 : null, serverSeed: phase === "crashed" ? "revealed" : null, serverSeedHash: "fit", clientSeed: "fit", nonce: 0, version: 3, bets: [] } });
  });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto("/jetx");
  await expect(page.getByTestId("jetx-countdown")).toBeVisible();
  const sizes = [[320, 568], [390, 844], [568, 320], [844, 390], [768, 1024], [1024, 480], [1024, 768], [1280, 400], [1192, 626], [1366, 600], [1366, 768], [1594, 820], [1920, 1080]];
  for (const nextPhase of ["betting", "flying", "crashed"] as const) {
    phase = nextPhase;
    await expect(page.getByTestId("jetx-scene")).toHaveAttribute("data-phase", phase);
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await expect.poll(() => page.locator("[data-game-viewport]").evaluate(el => Math.round(el.getBoundingClientRect().height))).toBe(height);
      await page.locator("[data-game-viewport]").evaluate(el => { el.scrollTop = 0; });
      // Chromium applies orientation/media changes asynchronously on resize.
      await expect.poll(() => page.evaluate(() => {
        const readout = document.querySelector(".jetx-readout")!.getBoundingClientRect();
        const history = document.querySelector(".jetx-round-toolbar")!.getBoundingClientRect();
        return readout.top >= history.bottom;
      })).toBe(true);
      const metrics = await page.evaluate(() => {
        const bounds = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
        const readout = bounds(".jetx-readout"), dock = bounds(".jetx-betting-dock"), toolbar = bounds(".jetx-round-toolbar");
        const overlap = readout.left < dock.right && readout.right > dock.left && readout.top < dock.bottom && readout.bottom > dock.top;
        const frame = document.querySelector("[data-game-viewport]")!;
        const logo = bounds(".jetx-wordmark"), wallet = bounds('[data-testid="btn-balance"]');
        return { overflowX: frame.scrollWidth - frame.clientWidth, overflowY: frame.scrollHeight - frame.clientHeight, overlap, headerOverlap: logo.right > wallet.left, readoutAboveHistory: readout.top < toolbar.bottom, dockBottom: dock.bottom, height: innerHeight, fit: (frame.firstElementChild as HTMLElement).style.cssText, computedFit: getComputedStyle(document.querySelector('.jetx-layout')!).getPropertyValue('--fit-height'), layout: bounds('.jetx-layout').toJSON(), stage: bounds('.jetx-stage').toJSON(), page: bounds('.jetx-page').toJSON() };
      });
      expect(metrics.overflowX, `${width}x${height} ${phase}: horizontal overflow`).toBeLessThanOrEqual(1);
      expect(metrics.overflowY, `${width}x${height} ${phase}: controls require scrolling ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
      expect(metrics.overlap, `${width}x${height} ${phase}: multiplier overlaps betting dock`).toBe(false);
      expect(metrics.headerOverlap, `${width}x${height} ${phase}: long balance overlaps logo`).toBe(false);
      expect(metrics.readoutAboveHistory, `${width}x${height} ${phase}: readout overlaps round history`).toBe(false);
      expect(metrics.dockBottom, `${width}x${height} ${phase}: dock outside screen`).toBeLessThanOrEqual(height + 1);
      for (const button of await page.locator(".jetx-bet-action:visible").all()) {
        await expect(button).toBeInViewport({ ratio: .99 });
        expect(await button.evaluate(el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("button") === el; })).toBe(true);
      }
      if (nextPhase === "betting" && [320, 568, 844, 1366].includes(width)) await page.screenshot({ path: info.outputPath(`${width}x${height}.png`) });
    }
  }
  for (const [width, height] of [[320, 568], [568, 320], [844, 390]]) {
    await page.setViewportSize({width, height});
    await expect(page.locator(".jetx-bet-panel:visible")).toHaveCount(4);
    await page.getByRole("button", {name: "Open players and round activity"}).click();
    await expect(page.getByRole("dialog")).toBeInViewport({ratio: .99});
    await page.getByRole("dialog").getByRole("tab", {name: "Rounds", exact: true}).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await page.getByRole("button", {name: "Auto play settings"}).click();
    await expect(page.getByRole("dialog")).toBeInViewport({ratio: .99});
    await page.keyboard.press("Escape");
  }
  expect(errors).toEqual([]);
});
