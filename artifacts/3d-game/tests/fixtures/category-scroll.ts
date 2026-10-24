import { expect, type Locator, type Page } from "@playwright/test";

export async function checkCategoryScrolling(page: Page, nav: Locator) {
  await nav.scrollIntoViewIfNeeded();
  const bounds = (await nav.boundingBox())!;
  const startX = bounds.x + bounds.width * .85;
  const endX = bounds.x + bounds.width * .2;
  const y = bounds.y + bounds.height / 2;
  const position = () => nav.evaluate(element => element.scrollLeft);
  const selected = () => nav.locator('[aria-pressed="true"]').textContent();
  const originalSelection = await selected();
  const before = await position();

  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(position).toBeGreaterThan(before + 60);
  expect(await selected()).toBe(originalSelection);

  const dragged = await position();
  await page.mouse.move(endX, y);
  await page.mouse.down();
  await page.mouse.move(startX, y, { steps: 12 });
  await page.mouse.up();
  await expect.poll(position).toBeLessThan(dragged - 60);
  expect(await selected()).toBe(originalSelection);

  // Browser-level touch input exercises native swiping, including touch-action.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const beforeTouch = await position();
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: startX, y }] });
  for (let step = 1; step <= 8; step++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: startX + (endX - startX) * step / 8, y }],
    });
    await page.waitForTimeout(25);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect.poll(position).toBeGreaterThan(beforeTouch + 60);
  expect(await selected()).toBe(originalSelection);
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await cdp.detach();

  await nav.getByRole("button", { name: "Poker", exact: true }).click();
  await expect(nav.getByRole("button", { name: "Poker", exact: true })).toHaveAttribute("aria-pressed", "true");
}
