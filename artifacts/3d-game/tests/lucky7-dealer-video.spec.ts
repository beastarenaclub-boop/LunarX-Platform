import { expect, test, type Page } from "@playwright/test";
import { table, crossNativeLoop } from "./lucky7-table-fixture";

const stage = (page: Page) => page.getByTestId("lucky7-dealer-stage");
const video = (page: Page) => page.getByTestId("lucky7-dealer-idle-video");
const action = (page: Page) => page.getByTestId("lucky7-dealer-action-video");

test("coins keep the frame stable and each round plays one physical shake", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    (window as any).dealerSeeks = [];
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime")!;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      ...descriptor, set(value: number) { (window as any).dealerSeeks.push({ id: this.getAttribute("data-testid"), time: value }); descriptor.set!.call(this, value); },
    });
  });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
  await expect.poll(() => action(page).evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => { (window as any).dealerPlayer = document.querySelector("video"); });
  const geometry = await page.getByTestId("dice-table").evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }));
  for (const value of [500, 1000, 100]) await page.getByTestId("chip-mobile-" + value).click();
  expect(round.submissions).toHaveLength(0);
  expect(await page.evaluate(() => (window as any).dealerSeeks)).toEqual([]);
  await page.getByTestId("spot-under").click();
  await expect(page.getByTestId("chipstack-under")).toHaveText("100.00");
  for (let i = 0; i < 2; i++) {
    if (i) round.nextBetting("continuous-" + i, 60000);
    round.reveal();
    await expect(stage(page)).toHaveAttribute("data-mode", "roll");
    await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).toBe(0);
    expect(await video(page).evaluate(el => (el as HTMLVideoElement).paused)).toBe(true);
    await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "shake");
    await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
    await expect(stage(page)).toHaveAttribute("data-mode", "idle", { timeout: 10000 });
    round.repeatResult();
    round.settle("0");
    round.repeatSettlement();
  }
  expect(await page.evaluate(() => document.querySelector("video") === (window as any).dealerPlayer)).toBe(true);
  const seeks = await page.evaluate(() => (window as any).dealerSeeks) as { id: string; time: number }[];
  expect(seeks.filter(seek => seek.id === "lucky7-dealer-action-video").length).toBeLessThanOrEqual(1);
  expect(seeks.filter(seek => seek.id === "lucky7-dealer-idle-video")).toHaveLength(2);
  expect(seeks.every(seek => seek.time === 0)).toBe(true);
  expect(await page.getByTestId("dice-table").evaluate(el => ({ width: el.clientWidth, height: el.clientHeight }))).toEqual(geometry);
  await expect(page.locator("video")).toHaveCount(2);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await video(page).evaluate(el => (el as HTMLVideoElement).playbackRate)).toBe(1);
});

test("desktop keeps the full frame and decodes the selected quality", async ({ page }, info) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.addInitScript(()=>Object.defineProperty(navigator,"deviceMemory",{value:8,configurable:true}));
  await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
  await expect(stage(page)).toHaveAttribute("data-quality", "2K");
  const quality = await stage(page).getAttribute("data-quality");
  expect(await video(page).evaluate(el => [(el as HTMLVideoElement).videoWidth, (el as HTMLVideoElement).videoHeight]))
    .toEqual(quality === "2K" ? [2560, 1440] : quality === "1080p" ? [1920, 1080] : [1280, 720]);
  await expect(stage(page)).toHaveAttribute("data-dealer-id", "naina");
  expect(await video(page).evaluate(el => getComputedStyle(el).objectFit)).toBe("contain");
  const bounds = (await page.getByTestId("dice-table").boundingBox())!;
  expect(bounds.width / bounds.height).toBeCloseTo(16 / 9, 1);
  await page.screenshot({ path: info.outputPath("desktop-studio.png"), fullPage: true });
});

test("phone uses the light clip and rotating the screen does not reload it", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
  await expect(stage(page)).toHaveAttribute("data-quality", "720p");
  const source = await video(page).evaluate(el => (el as HTMLVideoElement).currentSrc);
  await page.setViewportSize({ width: 740, height: 360 });
  expect(await video(page).evaluate(el => (el as HTMLVideoElement).currentSrc)).toBe(source);
  expect(await video(page).evaluate(el => getComputedStyle(el).objectFit)).toBe("contain");
});

test("long native loop and action handoff match the face and hands without a pose jump", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "idle", { timeout: 30000 });
  await expect.poll(() => action(page).evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const difference = await video(page).evaluate(async element => {
    const source = document.createElement("video");
    source.muted = true; source.preload = "auto"; source.src = (element as HTMLVideoElement).currentSrc;
    source.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:.01;pointer-events:none";
    document.body.append(source);
    await new Promise<void>((resolve, reject) => { source.onloadeddata = () => resolve(); source.onerror = () => reject(new Error("Decode failed")); });
    const seekDecoded = async (time: number) => {
      // A cached first frame is already presented by loadeddata. Seeking to
      // the same frame does not necessarily produce another native callback.
      if (Math.abs(source.currentTime - time) < .01) {
        await new Promise<void>(resolve => {
          source.onseeked = () => { source.onseeked = null; resolve(); };
          source.currentTime = .2;
        });
      }
      return new Promise<void>((resolve, reject) => {
      let frame = 0;
      const done = () => { clearTimeout(timeout); source.onseeked = null; resolve(); };
      const timeout = setTimeout(() => {
        if (frame) source.cancelVideoFrameCallback(frame);
        reject(new Error(`No decoded frame for ${time}s`));
      }, 5000);
      if (typeof source.requestVideoFrameCallback === "function") {
        const decoded = (_now: number, metadata: VideoFrameCallbackMetadata) => {
          // seeked can fire before drawImage sees the new decoded surface,
          // especially after switching from idle to action on the same video.
          if (!source.seeking && Math.abs(metadata.mediaTime - time) < .05) done();
          else frame = source.requestVideoFrameCallback(decoded);
        };
        frame = source.requestVideoFrameCallback(decoded);
      } else source.onseeked = done;
      source.currentTime = time;
      });
    };
    const canvas = document.createElement("canvas");
    canvas.width = 320; canvas.height = 180;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    const frames: Uint8ClampedArray[] = [];
    const images: string[] = [];
    const duration = source.duration;
    for (const time of [.001, source.duration - .001]) {
      await seekDecoded(time);
      context.drawImage(source, 0, 0, 320, 180);
      frames.push(context.getImageData(0, 0, 320, 180).data);
      images.push(canvas.toDataURL("image/png"));
    }
    const compare = (first: Uint8ClampedArray, last: Uint8ClampedArray, [x,y,w,h]: number[]) => {
      let total=0;
      for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)for(let c=0;c<3;c++){
        const pixel=(row*320+col)*4+c; total+=Math.abs(first[pixel]-last[pixel]);
      }
      return total/(w*h*3);
    };
    source.src = (document.querySelector('[data-testid="lucky7-dealer-action-video"]') as HTMLVideoElement).currentSrc;
    await new Promise<void>((resolve,reject) => { source.onloadeddata=()=>resolve(); source.onerror=()=>reject(new Error("Action decode failed")); });
    await seekDecoded(source.duration-.001);
    context.drawImage(source,0,0,320,180);
    const actionEnd=context.getImageData(0,0,320,180).data;
    images.push(canvas.toDataURL("image/png"));
    const face=[130,6,54,60], hands=[95,110,135,55];
    const result={duration,full:compare(frames[0],frames[1],[0,0,320,180]),
      face:compare(frames[0],frames[1],face),hands:compare(frames[0],frames[1],hands),
      handoffFace:compare(actionEnd,frames[0],face),handoffHands:compare(actionEnd,frames[0],hands)};
    source.removeAttribute("src"); source.load(); source.remove();
    return {...result,images};
  });
  const {images,...metrics}=difference;
  await info.attach("loop-and-handoff-continuity",{body:JSON.stringify(metrics),contentType:"application/json"});
  for(const [index,name] of ["idle-first","idle-last","action-last"].entries())
    await info.attach(name,{body:Buffer.from(images[index].split(",")[1],"base64"),contentType:"image/png"});
  expect(difference.duration).toBeGreaterThanOrEqual(6);
  // Background guests move independently over this longer loop. Bound that
  // whole-scene change separately; the face, fingers and handoff stay strict.
  expect(difference.full).toBeLessThan(5);
  expect(difference.face).toBeLessThan(4);
  expect(difference.hands).toBeLessThan(4);
  expect(difference.handoffFace).toBeLessThan(2);
  expect(difference.handoffHands).toBeLessThan(2);
  expect(await crossNativeLoop(video(page))).toBeLessThan(1.5);
  await expect(video(page)).toHaveCSS("opacity", "1");
  const before = await video(page).evaluate(el => (el as HTMLVideoElement).currentTime);
  await expect.poll(() => video(page).evaluate(el => (el as HTMLVideoElement).currentTime)).not.toBe(before);
  expect(await video(page).evaluate(el => (el as HTMLVideoElement).paused)).toBe(false);
});

test("reduced motion shows the matching full resolution poster and instant result", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const round = await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "static");
  await expect(page.locator("video")).toHaveCount(0);
  await expect.poll(() => page.getByTestId("lucky7-dealer").evaluate(el => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight])).toEqual([2560, 1440]);
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "rest");
});

test("failed movie keeps the poster and betting result working", async ({ page }) => {
  await page.route(/\.(mp4|webm)(\?|$)/, route =>
    route.request().resourceType() === "script" ? route.continue() : route.abort());
  const round = await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "static");
  await expect(page.getByTestId("lucky7-dealer")).toBeVisible();
  round.reveal();
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
});

test("an unavailable HD movie falls back to the small movie", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.route(/naina-bar-.*2k[^/]*\.mp4/, route =>
    route.request().resourceType() === "script" ? route.continue() : route.abort());
  await table(page);
  await expect(stage(page)).toHaveAttribute("data-mode", "idle");
  await expect(stage(page)).toHaveAttribute("data-quality", "720p");
});

test("a late join shows the result without a long shake", async ({ page }) => {
  await table(page, true);
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "rest");
});
