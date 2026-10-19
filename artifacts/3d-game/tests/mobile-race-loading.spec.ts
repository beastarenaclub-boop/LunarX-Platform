import { test, expect } from "@playwright/test";
import { setup } from "./horse-live-fixture";

test("phone renders the eight runners without fetching the large Unity runtime", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const unityRequests: string[] = [];
  page.on("request", request => {
    if (request.url().includes("/unity-horse/")) unityRequests.push(request.url());
  });
  // Keep the real Unity manifest available; device selection must happen
  // before requesting it. The fixture intercepts all account and wager APIs.
  const fixture = await setup(page, { renderer: "unity", holdBetting: true });
  const canvas = page.getByTestId("horse-race-canvas");
  // Auto introduces one runner at a time before the start. The rail camera
  // deliberately shows the whole field, so verify that view explicitly.
  await page.getByRole("button", { name: "Rail-side camera", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-visible-runners", "1,2,3,4,5,6,7,8", { timeout: 45000 });
  expect(Number(await canvas.getAttribute("data-frame-count"))).toBeGreaterThan(0);
  expect(unityRequests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  expect(fixture.errors).toEqual([]);
  expect(fixture.posts).toEqual([]);
});
