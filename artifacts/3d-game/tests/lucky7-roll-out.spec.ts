import { expect, test } from "@playwright/test";
import { table } from "./lucky7-table-fixture";
import { DICE_FLIGHT_MS, tableDicePlan, tableDiePose } from "../src/components/lucky7/tableDiceMotion";

test("dice keep turning and sliding late in the roll, then reach rest without a jump", () => {
  expect(DICE_FLIGHT_MS).toBeGreaterThanOrEqual(2200);
  for (let round = 0; round < 30; round++) {
    for (const plan of tableDicePlan(`roll-out-${round}`)) {
      const early = tableDiePose(plan, .7);
      const late = tableDiePose(plan, .9);
      const almost = tableDiePose(plan, .999);
      const rest = tableDiePose(plan, 1);
      // Continued rotation is observable after the old animation had stopped.
      expect(early.rx - late.rx).toBeGreaterThan(.8);
      expect(Math.hypot(late.x - early.x, late.y - early.y)).toBeGreaterThan(4);
      expect(Math.abs(late.rx - rest.rx)).toBeGreaterThan(.2);
      expect(Math.abs(almost.rx - rest.rx)).toBeLessThan(.001);
      expect(Math.hypot(almost.x - rest.x, almost.y - rest.y)).toBeLessThan(.002);
      const speed = (t: number) => Math.abs(tableDiePose(plan, t + .001).rx - tableDiePose(plan, t).rx);
      expect(speed(.75)).toBeGreaterThan(speed(.9));
      expect(speed(.9)).toBeGreaterThan(speed(.99));
      expect(tableDiePose(plan, 1.5)).toEqual(rest);
    }
  }
});

for (const width of [360, 1366]) test(`server settlement does not interrupt the visible roll at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: width === 360 ? 800 : 900 });
  const round = await table(page, false, 0, { bettingMs: 60000 });
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode", "idle");
  const video = page.getByTestId("lucky7-dealer-action-video");
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.getByTestId("lucky7-table-dice").evaluate(svg => {
    const samples: { time: number; rotation: number; x: number; y: number; phase: string }[] = [];
    const die = svg.querySelector('[data-testid="static-die-1"]') as SVGGElement;
    const observer = new MutationObserver(() => {
      samples.push({ time: Number((svg as SVGElement).dataset.mediaMs), rotation: Number(die.dataset.rotation?.split(",")[0]),
        x: Number(die.dataset.x), y: Number(die.dataset.y), phase: (svg as SVGElement).dataset.phase! });
    });
    observer.observe(die, { attributes: true, attributeFilter: ["transform"] });
    (window as any).rollOut = { samples, observer };
  });
  round.reveal();
  // A real round enters settlement after five seconds, before this roll ends.
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime), { intervals: [25] }).toBeGreaterThanOrEqual(5);
  round.settle();
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "roll");
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  await expect(page.getByTestId("badge-dice-total")).toHaveCount(0);
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "rest");
  await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7");
  await expect(page.getByTestId("round-win-dialog")).toBeVisible();
  const samples = await page.evaluate(() => {
    const { samples, observer } = (window as any).rollOut;
    observer.disconnect();
    return samples as { time: number; rotation: number; x: number; y: number; phase: string }[];
  });
  const late = samples.filter(s => s.phase === "flight" && s.time >= 5400 && s.time < 6200);
  expect(late.length).toBeGreaterThan(8);
  expect(Math.abs(late[0].rotation - late.at(-1)!.rotation)).toBeGreaterThan(.6);
  expect(Math.hypot(late[0].x - late.at(-1)!.x, late[0].y - late.at(-1)!.y)).toBeGreaterThan(5);
  // Reaching the exact final server face must not cause a last-frame snap.
  const lastFlight = samples.filter(s => s.phase === "flight").at(-1)!;
  const rest = samples.find(s => s.phase === "rest" && s.time >= 6200)!;
  expect(rest).toBeDefined();
  expect(Math.abs(lastFlight.rotation - rest.rotation)).toBeLessThan(.05);
  expect(Math.hypot(lastFlight.x - rest.x, lastFlight.y - rest.y)).toBeLessThan(.3);
  await info.attach("roll-out-frames", { body: JSON.stringify(samples), contentType: "application/json" });
  await page.getByTestId("round-win-ok").click();
  round.repeatSettlement();
  await expect(page.getByTestId("round-win-dialog")).toHaveCount(0);
  round.nextBetting();
  await expect(page.getByTestId("spot-under")).toBeEnabled();
  await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion", "rest");
});
