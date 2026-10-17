import { chromium } from "../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import { existsSync, mkdirSync } from "node:fs";
import { SPORTS } from "../lib/virtual-sports/catalog.mjs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(chrome) ? { executablePath: chrome } : {}),
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
    deviceScaleFactor: 1,
  });
  await page.goto("http://127.0.0.1:5198/");
  mkdirSync("artifacts/3d-game/public/media/virtual-sports", {
    recursive: true,
  });
  for (const sport of SPORTS) {
    await page.getByRole("tab", { name: new RegExp(sport.short) }).click();
    await page.waitForSelector(
      '[data-testid="sports-scene"][data-ready="true"]',
    );
    await page.waitForTimeout(900);
    // Capture the venue, without the ten-second result card covering the play.
    if (await page.getByTestId("sports-result").isVisible()) {
      await page
        .getByTestId("sports-result")
        .waitFor({ state: "hidden", timeout: 16000 });
      await page.waitForTimeout(900);
    }
    await page.locator(".vs-scene-host canvas").screenshot({
      path: `artifacts/3d-game/public/media/virtual-sports/${sport.id}.jpg`,
      type: "jpeg",
      quality: 90,
    });
    console.log(`Saved ${sport.name} preview`);
  }
} finally {
  await browser.close();
}
