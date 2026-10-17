import { test, expect, type Page } from "@playwright/test";
import { setup } from "./bike-live-fixture";

test("automatic race needs no bet, reload keeps its clock, next window opens", async ({ page }) => {
  const f = await setup(page), id = f.race.id;
  await expect(page.getByTestId("bike-betting-countdown")).toBeVisible();
  await f.start();
  await expect(page.getByTestId("bike-1")).toBeDisabled();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('[data-phase="racing"]')).toBeVisible();
  expect(f.race.id).toBe(id);
  await f.finish(); await f.next();
  await expect(page.getByTestId("bike-1")).toBeEnabled();
  expect(f.posts).toHaveLength(0); expect(f.race.id).not.toBe(id);
  expect(f.errors).toEqual([]);
});
test("coins wait for the 20 second timer, debit once and survive refresh", async ({ page }) => {
  const f = await setup(page), start = f.race.startedAt;
  await page.getByTestId("chip-100").click();
  await page.getByTestId("bike-1").click(); await page.getByTestId("bike-6").click();
  await page.clock.runFor(3300);
  expect(f.posts).toHaveLength(0);
  await f.advanceTo(start - 2200);
  await expect.poll(() => f.posts.length).toBe(1);
  expect(f.posts[0].bets).toEqual([{ bikeId: 1, amountPaise: "10000" }, { bikeId: 6, amountPaise: "10000" }]);
  expect(f.race.startedAt).toBe(start);
  await expect(page.getByTestId("bike-wallet")).toContainText("9,800.00");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("bike-1")).toHaveAttribute("data-selected", "true");
  await f.start(); await f.finish();
  await expect(page.getByTestId("bike-3")).toHaveAttribute("data-winner", "true");
  expect(f.posts).toHaveLength(1); expect(f.errors).toEqual([]);
});
test("auto repeats once per betting window, Stop prevents the next charge", async ({ page }) => {
  const f = await setup(page);
  await page.getByTestId("bike-2").click();
  await page.getByRole("button", { name: "Start auto", exact: true }).click();
  await f.advanceTo(f.race.startedAt - 2200);
  await expect.poll(() => f.posts.length).toBe(1);
  await f.start(); await f.finish(); await f.next();
  await expect(page.getByTestId("auto-bet-status")).toContainText("Auto bet in");
  expect(f.posts).toHaveLength(1);
  await f.advanceTo(f.race.startedAt - 2200);
  await expect.poll(() => f.posts.length).toBe(2);
  expect(f.posts[0].bets).toEqual(f.posts[1].bets);
  expect(f.posts[0].roundId).not.toBe(f.posts[1].roundId);
  await expect(page.getByRole("button", { name: /Stop auto/ })).toContainText("3 left");
  await page.getByRole("button", { name: /Stop auto/ }).click();
  await f.start(); await f.finish(); await f.next();
  await f.advanceTo(f.race.startedAt - 2200);
  expect(f.posts).toHaveLength(2); expect(f.errors).toEqual([]);
});
test("cancelled selections and rejected auto bets cannot spend", async ({ page }) => {
  const f = await setup(page, { reject: true });
  await page.getByTestId("bike-4").click();
  await page.getByRole("button", { name: "Cancel selected bet" }).click();
  await f.advanceTo(f.race.startedAt - 2200); expect(f.posts).toHaveLength(0);
  await f.start(); await f.finish(); await f.next();
  await page.getByTestId("bike-4").click();
  await page.getByRole("button", { name: "Start auto", exact: true }).click();
  await f.advanceTo(f.race.startedAt - 2200);
  await expect(page.getByRole("alert")).toContainText("Insufficient");
  await expect(page.getByRole("button", { name: /Stop auto/ })).toHaveCount(0);
  await expect(page.getByTestId("bike-wallet")).toContainText("10,000.00");
});
test("lost accepted response recovers without a second debit", async ({ page }) => {
  const f = await setup(page, { lostResponse: true });
  await page.getByTestId("bike-2").click();
  await f.advanceTo(f.race.startedAt - 2200);
  await page.clock.runFor(1500);
  await expect(page.getByRole("alert")).toContainText("recovered");
  await expect(page.getByTestId("bike-wallet")).toContainText("9,990.00");
  expect(f.posts).toHaveLength(1);
});
test("switching tabs disarms auto betting and its staged slip", async ({ page }) => {
  const f = await setup(page);
  await page.getByTestId("bike-4").click();
  await page.getByRole("button", { name: "Start auto", exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await f.advanceTo(f.race.startedAt - 2200);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await f.start(); expect(f.posts).toHaveLength(0);
  await expect(page.getByRole("button", { name: /Stop auto/ })).toHaveCount(0);
});

async function renderedRace(page: Page) {
  const mediaRequests: string[] = [];
  page.on("request", r => { if (/\.(mp4|webm)(?:\?|$)|bikePhotoRenderer/.test(r.url())) mediaRequests.push(r.url()); });
  const f = await setup(page, { holdBetting: true, scene: true });
  const canvas = page.getByTestId("bike-race-canvas");
  await expect(canvas).toHaveAttribute("data-focus-visible", "true", { timeout: 45000 });
  await expect(page.getByTestId("bike-race-fallback")).toHaveCount(0);
  await expect(page.locator("video")).toHaveCount(0);
  return { f, canvas, mediaRequests };
}

test("six live 3D bikes follow the server finish with cameras and responsive layout", async ({ page }) => {
  const { f, canvas, mediaRequests } = await renderedRace(page);
  await expect(canvas).toHaveAttribute("data-camera", "grid");
  const grid = await canvas.getAttribute("data-distances");
  for (const [width, height] of [[1440, 900], [390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await page.clock.runFor(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.getByTestId("bike-6")).toBeVisible();
    await expect(canvas).toHaveAttribute("data-focus-visible", "true");
    if (width === 1440 || width === 390) await page.screenshot({ path: "../../tmp/bike-live-3d-" + width + ".png", fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 60000));
  await f.freshWindow(); await f.start();
  await f.advanceTo(f.race.startedAt + 7000);
  await expect(canvas).not.toHaveAttribute("data-distances", grid!);
  const firstFrame = await canvas.screenshot(), firstDistance = await canvas.getAttribute("data-distances");
  await page.clock.runFor(160);
  expect(await canvas.getAttribute("data-distances")).not.toBe(firstDistance);
  expect((await canvas.screenshot()).equals(firstFrame)).toBe(false);
  for (const [label, view] of [["Broadcast", "broadcast"], ["Trackside", "rail"], ["Leaders", "headon"], ["Wide", "grandstand"]]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.clock.runFor(30);
    await expect(canvas).toHaveAttribute("data-camera", view);
    await expect(canvas).toHaveAttribute("data-focus-visible", "true");
  }
  await page.getByRole("button", { name: "Close-up", exact: true }).click();
  await page.getByRole("button", { name: "Follow Arctic S", exact: true }).click();
  await page.clock.runFor(30);
  await expect(canvas).toHaveAttribute("data-focus-bike", "6");
  await expect(canvas).toHaveAttribute("data-focus-visible", "true");
  await page.screenshot({ path: "../../tmp/bike-live-3d-race.png", fullPage: true });
  await expect(page.getByTestId("bike-winner-shot")).toHaveCount(0);
  await f.finish();
  await expect(canvas).toHaveAttribute("data-order", "3,1,6,4,2,5");
  const distances = (await canvas.getAttribute("data-distances"))!.split(",").map(Number);
  expect(distances.map((distance, i) => ({ distance, id: i + 1 })).sort((a, b) => b.distance - a.distance).map(b => b.id))
    .toEqual([3, 1, 6, 4, 2, 5]);
  await expect(canvas).toHaveAttribute("data-focus-bike", "3");
  await expect(page.getByTestId("bike-race-order").locator("li").first()).toHaveAttribute("data-bike", "3");
  await expect(page.getByTestId("bike-winner-shot")).toContainText("Volt RS");
  await page.screenshot({ path: "../../tmp/bike-live-3d-result.png", fullPage: true });
  await f.next();
  await expect(page.getByTestId("bike-winner-shot")).toHaveCount(0);
  await expect(canvas).toHaveAttribute("data-distances", grid!);
  expect(f.posts).toHaveLength(0); expect(mediaRequests).toEqual([]); expect(f.errors).toEqual([]);
});

test("3D failure keeps betting available, retry and GPU context loss recover", async ({ page }) => {
  const f = await setup(page, { holdBetting: true });
  await expect(page.getByTestId("bike-race-fallback")).toBeVisible();
  await page.getByTestId("bike-3").click();
  await expect(page.getByTestId("bike-3")).toHaveAttribute("data-selected", "true");
  await page.unroute("**/assets/bike-racing/models/rider.glb");
  await page.getByRole("button", { name: "Retry 3D", exact: true }).click();
  const canvas = page.getByTestId("bike-race-canvas");
  await expect(canvas).toHaveAttribute("data-focus-visible", "true", { timeout: 45000 });
  await expect(page.getByTestId("bike-race-fallback")).toHaveCount(0);
  await expect(page.getByTestId("bike-3")).toHaveAttribute("data-selected", "true");
  await canvas.evaluate((c: HTMLCanvasElement) => c.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext());
  await expect(page.getByTestId("bike-race-fallback")).toBeVisible();
  await page.getByRole("button", { name: "Retry 3D", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-focus-visible", "true");
  await expect(page.getByTestId("bike-race-fallback")).toHaveCount(0);
  await f.freshWindow();
  await expect(page.getByTestId("bike-3")).toHaveAttribute("data-selected", "true");
  await f.advanceTo(f.race.startedAt - 2200);
  await expect.poll(() => f.posts.length).toBe(1);
  await f.start(); await f.finish();
  await expect(page.getByTestId("bike-wallet")).toContainText("10,048.20");
  await expect(canvas).toHaveAttribute("data-focus-bike", "3");
  expect(f.errors).toEqual([]);
});

test("without WebGL live timing shows positions and the official winner without video", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: any[]) {
      if (type.includes("webgl")) return null;
      return (original as any).call(this, type, ...args);
    } as typeof original;
  });
  const f = await setup(page, { holdBetting: true, scene: true });
  await expect(page.getByTestId("bike-race-fallback")).toBeVisible({ timeout: 45000 });
  await expect(page.locator("video")).toHaveCount(0);
  await f.freshWindow(); await f.start(); await f.advanceTo(f.race.startedAt + 10000);
  expect(await page.locator(".br-timing-lane b").first().evaluate(el => parseFloat(el.style.left))).toBeGreaterThan(20);
  await f.finish();
  await expect(page.getByTestId("bike-winner-shot")).toContainText("Volt RS");
  await expect(page.getByTestId("bike-race-order").locator("li").first()).toHaveAttribute("data-bike", "3");
  expect(f.errors).toEqual([]);
});
