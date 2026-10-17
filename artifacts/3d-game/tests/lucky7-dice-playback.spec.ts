import { expect, test } from "@playwright/test";
import { table, crossNativeLoop } from "./lucky7-table-fixture";

test("unavailable WebAudio cannot blank the game or block bets and winning popups", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    for (const key of ["AudioContext", "webkitAudioContext"]) {
      Object.defineProperty(window, key, { value: undefined, configurable: true });
    }
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const round = await table(page, false, 0, { sound: true, bettingMs: 60000 });
  await page.getByRole("button", { name: "₹100 coin", exact: true }).click();
  await page.getByTestId("spot-exactly").click();
  await expect(page.getByTestId("chipstack-exactly")).toHaveText("100.00");
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  round.settle();
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  await page.getByTestId("round-win-ok").click();
  round.nextBetting();
  await expect(page.getByTestId("spot-under")).toBeEnabled();
  expect(errors).toEqual([]);
});

test("physical shake keeps the same shot through the center landing and no WebGL", async ({ page }) => {
  await page.addInitScript(() => {
    const native = HTMLVideoElement.prototype.requestVideoFrameCallback;
    if (!native) return;
    HTMLVideoElement.prototype.requestVideoFrameCallback = function(callback) {
      return native.call(this, (now, metadata) => {
        if (this.dataset.testid === "lucky7-dealer-action-video") (window as any).lastDealerFrame = metadata.mediaTime;
        callback(now, metadata);
      });
    };
  });
  const assets: string[] = [];
  page.on("request", request => assets.push(request.url()));
  const round = await table(page);
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  await expect.poll(() => page.getByTestId("lucky7-dealer-action-video").evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const dice = page.getByTestId("lucky7-dice");
  // Record inside the browser: a busy test runner can miss a motion transition
  // between remote locator polls even when every frame plays correctly.
  await dice.evaluate(element => {
    const states: { motion: string | undefined; fromHand: string | undefined; duration: number; videoTime: number; decodedTime: number; visible: string; source: string }[] = [];
    const observer = new MutationObserver(() => {
      const { motion, fromHand, durationMs } = (element as HTMLElement).dataset;
      const video = document.querySelector('[data-testid="lucky7-dealer-action-video"]') as HTMLVideoElement;
      if (states.at(-1)?.motion !== motion) states.push({ motion, fromHand, duration: Number(durationMs), videoTime: video.currentTime, decodedTime: (window as any).lastDealerFrame ?? video.currentTime, visible: video.style.opacity, source: video.currentSrc });
    });
    observer.observe(element, { attributes: true, attributeFilter: ["data-motion"] });
    (window as any).diceFlight = { states, observer };
  });
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(dice).toHaveAttribute("data-motion", "rest");
  const flight = await page.evaluate(() => {
    const { states, observer } = (window as any).diceFlight;
    observer.disconnect();
    return states as { motion: string; fromHand: string; duration: number; videoTime: number; decodedTime: number; visible: string; source: string }[];
  });
  expect(flight.map(state => state.motion)).toEqual(["shake", "roll", "rest"]);
  expect(flight[1].fromHand).toBe("true");
  expect(flight[1].duration).toBeGreaterThanOrEqual(2200);
  expect(flight[1].duration).toBeLessThanOrEqual(2500);
  expect(flight[2].visible).toBe("1");
  // Inspect the decoded frame itself; currentTime is a separate media clock.
  expect(flight[1].decodedTime).toBeGreaterThanOrEqual(93/24);
  expect(flight[2].decodedTime).toBeGreaterThanOrEqual(149/24);
  expect(flight[2].decodedTime).toBeGreaterThan(flight[1].decodedTime);
  expect(flight[2].source).toBe(flight[1].source);
  await expect(dice).toHaveAttribute("data-dice-renderer", "svg");
  await expect(page.locator(".lucky7-die-rolling")).toHaveCount(0);
  await expect(page.getByTestId("static-die-1")).toHaveAttribute("data-value", "3");
  await expect(page.getByTestId("static-die-2")).toHaveAttribute("data-value", "4");
  round.repeatResult();
  await expect(dice).toHaveAttribute("data-motion", "rest");
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(assets.some(url => /DiceScene|react-three|three\.module/.test(url))).toBe(false);
});

test("all six server dice values appear on the centered dice", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const round = await table(page);
  for (let first = 1; first <= 6; first++) {
    round.nextBetting("face-" + first);
    round.reveal(5000, [first, 7-first]);
    await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
    for (const [index, value] of [first, 7-first].entries()) {
      const die = page.getByTestId(`static-die-${index + 1}`);
      await expect(die).toHaveAttribute("data-value", String(value));
      expect((await die.locator('[data-face="top"] [data-pips]').getAttribute("d"))?.match(/M/g)?.length).toBe(value);
    }
  }
});

test("preloaded idle and action survive network loss through loops and a round", async ({ page }) => {
  let downloads = 0;
  page.on("request", request => {
    if (request.resourceType() === "fetch" && /naina-bar-.*\.(mp4|webm)$/.test(new URL(request.url()).pathname)) downloads++;
  });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  const video = page.getByTestId("lucky7-dealer-idle-video");
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  test.skip(await page.getByTestId("lucky7-dealer-stage").getAttribute("data-cache-mode") === "native",
    "Playwright routing disables HTTP caching; offline cache checks require a blob-capable media backend.");
  expect(await video.evaluate(el => (el as HTMLVideoElement).currentSrc)).toMatch(/^(blob:|https?:)/);
  expect(downloads).toBe(2);
  // WebKit backends that reject blob media use the native HTTP cache. In
  // either case, require the full clip to be buffered before disconnecting.
  await expect.poll(() => video.evaluate(el => {
    const player = el as HTMLVideoElement;
    return player.buffered.length ? player.duration - player.buffered.end(player.buffered.length - 1) : Infinity;
  })).toBeLessThan(.1);
  await expect.poll(() => page.getByTestId("lucky7-dealer-action-video").evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.context().setOffline(true);
  expect(await crossNativeLoop(video)).toBeLessThan(1.5);
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(video).toHaveCSS("opacity", "1");
  expect(downloads).toBe(2);
});

test("a stalled action decoder cannot hold up the dice result", async ({ page }) => {
  const round = await table(page);
  const video = page.getByTestId("lucky7-dealer-idle-video");
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  await page.getByTestId("lucky7-dealer-action-video").evaluate(el => {
    (el as HTMLVideoElement).play = () => Promise.resolve();
  });
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
});

test("browsers without decoded-frame callbacks still play the dealer and settle", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(HTMLVideoElement.prototype, "requestVideoFrameCallback", { value: undefined, configurable: true });
  });
  const round = await table(page);
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  await expect.poll(() => page.getByTestId("lucky7-dealer-action-video").evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.getByTestId("lucky7-dice").evaluate(el => {
    (window as any).legacyRollSeen = false;
    const observer = new MutationObserver(() => {
      if ((el as HTMLElement).dataset.motion === "roll") (window as any).legacyRollSeen = true;
      if ((el as HTMLElement).dataset.motion === "rest") observer.disconnect();
    });
    observer.observe(el, { attributes: true, attributeFilter: ["data-motion"] });
  });
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  expect(await page.evaluate(() => (window as any).legacyRollSeen)).toBe(true);
});

test("an action downloaded after settlement does not replay the finished roll", async ({ page }) => {
  let allowDownload!: () => void;
  const gate = new Promise<void>(resolve => { allowDownload = resolve; });
  await page.route(/naina-bar-natural-action.*\.(mp4|webm)(\?|$)/, async route => {
    if (route.request().resourceType() !== "script") await gate;
    await route.continue();
  });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  allowDownload();
  const action = page.getByTestId("lucky7-dealer-action-video");
  await expect.poll(() => action.evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  expect(await action.evaluate(el => (el as HTMLVideoElement).paused)).toBe(true);
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "rest");
});

test("leaving the game releases its cached video URL", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).releasedVideos = [];
    const revoke = URL.revokeObjectURL;
    URL.revokeObjectURL = url => { (window as any).releasedVideos.push(url); revoke.call(URL, url); };
  });
  await table(page);
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  await expect.poll(() => page.getByTestId("lucky7-dealer-action-video").evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const source = await page.getByTestId("lucky7-dealer-idle-video").evaluate(el => (el as HTMLVideoElement).currentSrc);
  test.skip(!source.startsWith("blob:"), "Native HTTP media does not expose a cached blob URL.");
  await page.getByTestId("btn-back").click();
  await expect.poll(() => page.evaluate(() => (window as any).releasedVideos)).toContain(source);
  await expect(page.locator("video")).toHaveCount(0);
});
