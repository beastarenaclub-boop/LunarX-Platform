import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

test("Unity receives the live race and winner without changing the wallet", async ({
  page,
}) => {
  test.setTimeout(300000);
  const fixture = await setup(page, {
    renderer: "unity",
    holdBetting: true,
    readyTimeout: 180000,
  });
  const stage = page.getByTestId("horse-race-stage");
  await expect(stage).toHaveAttribute("data-renderer", "unity-urp", {
    timeout: 180000,
  });
  await expect(stage).toHaveAttribute("data-ready", "true", {
    timeout: 180000,
  });
  const frame = page
    .frames()
    .find((f) => f.url().includes("/unity-horse/index.html"))!;
  await frame.evaluate(() =>
    window.addEventListener("message", (event) => {
      if (event.data?.type === "horse-unity-state")
        (window as any).reviewRaceFrame = event.data.state;
      if (event.data?.type === "horse-unity-sponsor")
        (window as any).reviewSponsor = event.data.sponsor;
    }),
  );
  await expect
    .poll(() => frame.evaluate(() => (window as any).reviewRaceFrame?.running))
    .toBe(false);
  await fixture.start();
  await expect
    .poll(() => frame.evaluate(() => (window as any).reviewRaceFrame?.running))
    .toBe(true);
  expect(
    await frame.evaluate(() => (window as any).reviewRaceFrame.runners.length),
  ).toBe(8);
  await fixture.finish();
  await expect(page.getByTestId("horse-winner-shot")).toBeVisible();
  expect(
    await frame.evaluate(() => (window as any).reviewRaceFrame.winner),
  ).toBe(fixture.race.plan.order[0]);
  expect(fixture.posts).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("Unity betting screen accepts a test slip, locks at the start and settles the server winner", async ({ page }) => {
  test.setTimeout(300000);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.addInitScript(() => localStorage.setItem("horse-racing:camera:v2", "rail"));
  // All API requests are intercepted by the fixture; no real funds are used.
  const fixture = await setup(page, { renderer: "unity", holdBetting: true, readyTimeout: 180000 });
  await expect(page.getByTestId("horse-race-stage")).toHaveAttribute("data-ready", "true", { timeout: 180000 });
  const layout = await page.getByTestId("horse-race-stage").evaluate(element => ({
    width: element.clientWidth,
    parentWidth: element.parentElement!.clientWidth,
    iframeWidth: element.querySelector("iframe")!.clientWidth,
  }));
  // The horse viewport must fill its own stage, independent of dealer-table CSS.
  expect(layout.width).toBeGreaterThan(layout.parentWidth * .98);
  expect(Math.abs(layout.width - layout.iframeWidth)).toBeLessThan(3);
  const winner = fixture.race.plan.order[0];
  const round = fixture.race.id;
  const starts = fixture.race.startedAt;
  await page.getByTestId("chip-100").click();
  await page.getByTestId(`horse-${winner}`).click();
  await page.clock.runFor(3500);
  await expect.poll(() => fixture.posts.length).toBe(1);
  expect(fixture.posts[0].roundId).toBe(round);
  expect(fixture.posts[0].bets).toEqual([{ horseId: winner, amountPaise: "10000" }]);
  expect(fixture.race.startedAt).toBe(starts);
  await expect(page.getByTestId("horse-wallet")).toContainText("9,900.00");
  await expect(page.getByTestId("horse-betting-dock")).toContainText("BET ACCEPTED");
  await fixture.start();
  await expect(page.getByTestId("horse-1")).toBeDisabled();
  await page.clock.runFor(2500);
  const screenshot = new URL("../../../tmp/unity-horse/review/betting-race-v4.png", import.meta.url);
  await mkdir(new URL(".", screenshot), { recursive: true });
  await page.screenshot({ path: fileURLToPath(screenshot), fullPage: true });
  await fixture.finish();
  await expect(page.getByTestId(`horse-${winner}`)).toHaveAttribute("data-winner", "true");
  const multiplier = fixture.race.config.horses[winner - 1].multiplier;
  const expectedBalance = (9900 + Math.round(multiplier * 100)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  await expect(page.getByTestId("horse-wallet")).toContainText(expectedBalance);
  expect(fixture.posts).toHaveLength(1);
  expect(fixture.errors).toEqual([]);
});
