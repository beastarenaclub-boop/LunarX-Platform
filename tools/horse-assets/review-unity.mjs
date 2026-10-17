import {
  chromium,
  expect,
} from "../../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = new URL("../../tmp/unity-horse/review/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--enable-unsafe-swiftshader",
  ],
});
const errors = [],
  failed = [];
let spectators = 0;
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 810 },
  });
  page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE ERROR", e.message); });
  page.on("console", (m) => {
    if (m.type() === "error") { errors.push(m.text()); console.log("BROWSER ERROR", m.text()); }
    const scene = m.text().match(/(\d+) (?:seated 3D|scanned) spectators/);
    if (scene) spectators = Number(scene[1]);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !r.url().endsWith("favicon.ico"))
      failed.push({ url: r.url(), status: r.status() });
  });
  await page.goto(
    process.env.HORSE_UNITY_URL ??
      "http://127.0.0.1:5288/unity-horse/index.html",
  );
  await page.waitForFunction(() => window.horseUnityReady, null, {
    timeout: 240000,
  });
  await page.waitForTimeout(7000);
  for (const camera of [
    "broadcast",
    "rail",
    "headon",
    "grandstand",
    "closeup",
  ]) {
    await page.locator("#camera").selectOption(camera);
    await page.waitForTimeout(1200);
    await page.screenshot({
      path: fileURLToPath(new URL(camera + ".png", output)),
    });
  }
  await page.locator("#restart").click();
  await expect
    .poll(() => page.evaluate(() => window.horseFrame.elapsed))
    .toBeLessThan(0);
  await page.waitForTimeout(6500);
  const before = await page.evaluate(() => window.horseFrame.runners[0].x);
  await page.waitForTimeout(1000);
  const after = await page.evaluate(() => window.horseFrame.runners[0].x);
  expect(Math.abs(after - before)).toBeGreaterThan(0.1);
  await page.locator("#pause").click();
  const held = await page.evaluate(() => window.horseFrame.elapsed);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.horseFrame.elapsed)).toBe(held);
  await page.locator("#pause").click();
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: fileURLToPath(new URL("mobile-landscape.png", output)),
  });
  await page.setViewportSize({ width: 1440, height: 810 });
  await page.locator("#venue").selectOption("night");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: fileURLToPath(new URL("floodlit.png", output)) });
  expect(spectators).toBeGreaterThan(1000);
  const report = {
    errors: [...new Set(errors)],
    failed,
    moving: before !== after,
    pause: true,
    cameras: 5,
    spectators,
    floodlit: true,
  };
  await writeFile(
    new URL("report.json", output),
    JSON.stringify(report, null, 2),
  );
  if (errors.length || failed.length) throw new Error(JSON.stringify(report));
  console.log(
    "Unity WebAssembly loaded; five cameras, race movement, restart, pause and mobile landscape passed.",
  );
} finally {
  await browser.close();
}
