import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";
import {
  makeHorsePlan,
  HORSE_RACE_SPEED,
  RACING_HORSES,
} from "@workspace/api-zod/horse-racing-game";

test("losing WebGL preserves the live round and its winner in the compatibility view", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await setup(page, {
    holdBetting: true,
    pauseClock: true,
    readyTimeout: 60000,
  });
  await f.start();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  const roundId = f.race.id,
    winner = f.race.plan.order[0];
  await page.getByTestId("horse-race-canvas").evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const gl = canvas.getContext("webgl2");
    gl!.getExtension("WEBGL_lose_context")!.loseContext();
  });
  const canvas = page.getByTestId("horse-race-canvas");
  // Resource decoding continues while the race clock is paused. Let fallback
  // frames paint without allowing a slow GPU to skip to the following round.
  await expect
    .poll(
      async () => {
        await page.clock.runFor(100);
        return canvas.getAttribute("data-renderer");
      },
      { timeout: 30000 },
    )
    .toBe("canvas-compatibility");
  await expect(canvas).toHaveAttribute("data-race-id", roundId);
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await expect(canvas).toHaveAttribute("data-character-set", "shared-horse-v1");
  await expect(canvas).toHaveAttribute(
    "data-character-presentation",
    "higgsfield-side-profile",
  );
  await f.advanceTo(
    f.race.startedAt + f.race.plan.runners[winner - 1].finishTime * 1000,
  );
  await expect(canvas).toHaveAttribute("data-camera", "winner");
  await expect(canvas).toHaveAttribute("data-focus-horse", String(winner));
  await expect(page.getByTestId("horse-winner-shot")).toBeVisible();
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});

test("finish highlights the winner without isolating it and resets the full pack", async ({
  page,
}) => {
  test.setTimeout(120000);
  const f = await setup(page);
  const canvas = page.getByTestId("horse-race-canvas");
  await expect(canvas).toHaveAttribute("data-renderer", "webgl-3d");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1500));
  await page.screenshot({
    path: "test-results/horse-3d-start.png",
    fullPage: true,
  });
  await f.start();
  const plan = f.race.plan,
    winner = plan.order[0];
  expect(plan.duration).toBeCloseTo(
    makeHorsePlan(plan.seed, plan.venueId).duration / HORSE_RACE_SPEED,
    8,
  );
  await page
    .getByRole("button", { name: "Close-up camera", exact: true })
    .click();
  const crossing =
    f.race.startedAt + plan.runners[winner - 1].finishTime * 1000;
  await page.clock.fastForward(
    Math.max(1, crossing - 250 - (await page.evaluate(() => Date.now()))),
  );
  await page.clock.runFor(100);
  await expect(canvas).toHaveAttribute("data-camera", "closeup");
  await expect(page.getByTestId("horse-winner-shot")).toHaveCount(0);
  await page.clock.runFor(300);
  await expect(canvas).toHaveAttribute("data-camera", "winner");
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await expect(canvas).toHaveAttribute("data-focus-horse", String(winner));
  await expect(page.getByTestId("horse-winner-shot")).toContainText(
    RACING_HORSES[winner - 1].name,
  );
  await page.screenshot({
    path: "test-results/horse-3d-winner.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.runFor(200);
  await page.screenshot({
    path: "test-results/horse-3d-winner-mobile.png",
    fullPage: true,
  });
  await f.next();
  await expect(canvas).toHaveAttribute("data-pose", "standing");
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  await expect(canvas).toHaveAttribute("data-camera", "closeup");
  await expect(page.getByTestId("horse-winner-shot")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Broadcast camera", exact: true })
    .click();
  await page.clock.runFor(1100);
  await expect(canvas).toHaveAttribute(
    "data-visible-runners",
    "1,2,3,4,5,6,7,8",
  );
  expect(f.posts).toHaveLength(0);
  expect(f.errors).toEqual([]);
});
