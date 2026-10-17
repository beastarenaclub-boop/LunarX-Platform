import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

for (const mobile of [false, true]) {
  test(`broadcast horses, introductions, camera views and finish on ${mobile ? "mobile" : "desktop"}`, async ({
    page,
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize(
      mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
    );
    const shaderErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /THREE|WebGL|shader|GL_INVALID/i.test(message.text())
      )
        shaderErrors.push(message.text());
    });
    const f = await setup(page, { pauseClock: true, readyTimeout: 90000 });
    const canvas = page.getByTestId("horse-race-canvas");
    await page.clock.runFor(250);
    await expect(canvas).toHaveAttribute(
      "data-character-presentation",
      "skinned-3d",
    );
    await expect(canvas).toHaveAttribute("data-track-surface", "turf");
    await expect(canvas).toHaveAttribute("data-camera", "parade");
    const intro = page.getByTestId("horse-runner-intro");
    const first = await intro.getAttribute("data-horse-id");
    await page.locator(".hr-race-picture").screenshot({
      path: `test-results/horse-broadcast-${mobile ? "mobile" : "desktop"}-intro.png`,
    });
    await f.advanceTo(f.race.bettingOpensAt + 7000);
    await expect(intro).not.toHaveAttribute("data-horse-id", first!);
    await expect(canvas).toHaveAttribute(
      "data-focus-horse",
      (await intro.getAttribute("data-horse-id"))!,
    );
    await f.advanceTo(f.race.startedAt - 2500);
    await expect(page.getByTestId("horse-starting-field")).toBeVisible();
    await expect(intro).toHaveCount(0);
    await f.start();
    await expect(
      page.getByTestId("horse-broadcast-leaderboard").locator(":scope > div"),
    ).toHaveCount(8);
    await expect(canvas).toHaveAttribute(
      "data-visible-runners",
      "1,2,3,4,5,6,7,8",
    );
    const poses = new Set<string>();
    for (const [name, mode] of [
      ["Rail-side", "rail"],
      ["Broadcast", "broadcast"],
      ["Grandstand", "grandstand"],
      ["Front", "headon"],
      ["Close-up", "closeup"],
    ]) {
      await page
        .getByRole("button", { name: name + " camera", exact: true })
        .click();
      await page.clock.runFor(220);
      await expect(canvas).toHaveAttribute("data-camera", mode);
      poses.add((await canvas.getAttribute("data-camera-position"))!);
      const bounds: number[][] = JSON.parse(
        (await canvas.getAttribute("data-runner-bounds"))!,
      );
      expect(bounds).toHaveLength(8);
      for (const [, left, top, width, height] of bounds) {
        expect(width).toBeGreaterThan(2);
        expect(height).toBeGreaterThan(5);
        expect(left).toBeGreaterThan(-10);
        expect(left + width).toBeLessThan(1290);
        expect(top).toBeGreaterThan(-10);
        expect(top + height).toBeLessThan(730);
      }
      await page.locator(".hr-race-picture").screenshot({
        path: `test-results/horse-broadcast-${mobile ? "mobile" : "desktop"}-${mode}.png`,
      });
    }
    expect(poses.size).toBe(5);
    const winner = f.race.plan.order[0];
    await f.advanceTo(
      f.race.startedAt + f.race.plan.runners[winner - 1].finishTime * 1000,
    );
    await expect(canvas).toHaveAttribute("data-camera", "winner");
    await expect(canvas).toHaveAttribute("data-focus-horse", String(winner));
    await expect(page.getByTestId("horse-winner-shot")).toBeVisible();
    await page.locator(".hr-race-picture").screenshot({
      path: `test-results/horse-broadcast-${mobile ? "mobile" : "desktop"}-winner.png`,
    });
    await f.next();
    await expect(page.getByTestId("horse-winner-shot")).toHaveCount(0);
    await expect(canvas).toHaveAttribute("data-pose", "standing");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    expect(f.posts).toHaveLength(0);
    expect(f.errors).toEqual([]);
    expect(shaderErrors).toEqual([]);
  });
}
