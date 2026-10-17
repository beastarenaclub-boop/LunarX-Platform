import { test, expect, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";

/** Measure samples after the master gain, not just calls to source.start(). */
async function meter(page: Page) {
  await page.addInitScript(() => {
    const state = { peak: 0, rms: 0, sources: 0 };
    (window as any).playbackMeter = state;
    const meters: AnalyserNode[] = [];
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination: AudioNode | AudioParam, ...args: number[]) {
      if (destination instanceof AudioDestinationNode) {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        connect.call(this, analyser);
        connect.call(analyser, destination);
        meters.push(analyser);
        return destination;
      }
      return (connect as any).call(this, destination, ...args);
    } as typeof connect;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof start>) {
      state.sources++;
      return start.apply(this, args);
    };
    const samples = new Float32Array(2048);
    setInterval(() => {
      for (const analyser of meters) {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const value of samples) { energy += value * value; state.peak = Math.max(state.peak, Math.abs(value)); }
        state.rms = Math.max(state.rms, Math.sqrt(energy / samples.length));
      }
    }, 8);
  });
}
const reset = (page: Page) => page.evaluate(() => Object.assign((window as any).playbackMeter, { peak: 0, rms: 0, sources: 0 }));
const level = (page: Page) => page.evaluate(() => (window as any).playbackMeter.rms as number);

test("served Colour Trading outputs selection audio through its mixer and mutes it", async ({ page }) => {
  await mockGames(page, { sound: true });
  await meter(page);
  await page.goto("/lunar-colour-trading");
  await page.locator(".color-option.green").click();
  await expect.poll(() => level(page), { timeout: 5000 }).toBeGreaterThan(.001);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await page.waitForTimeout(150); // Let the analyser's previous audio window drain.
  await reset(page);
  await page.locator(".color-option.red").click();
  await page.waitForTimeout(250);
  expect(await level(page)).toBe(0);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.locator(".color-option.violet").click();
  await expect.poll(() => level(page)).toBeGreaterThan(.001);
});

test("served Vegetable Bowl outputs pick and collection sounds and respects mute", async ({ page }) => {
  await mockGames(page, { sound: true });
  await meter(page);
  let revealStarted = 0;
  await page.route("**/api/vegetable-bowl/round", async route => {
    const now = Date.now();
    await route.fulfill({ json: {
      roundId: "audible-harvest", gameCode: "vegetable-bowl", phase: revealStarted ? "reveal" : "betting", now,
      bettingEndsAt: revealStarted || now + 120000,
      revealEndsAt: revealStarted ? revealStarted + 6000 : now + 126000,
      settleEndsAt: now + 130000,
      config: { enabled: true, minStakePaise: "100", maxStakePaise: "1000000", bettingWindowMs: 120000, revealDurationMs: 6000, settleDurationMs: 5000 },
      outcome: revealStarted ? { total: 3, winner: "normal", vegetables: ["carrot", "tomato", "pepper"] } : null,
      serverSeedHash: "test", clientSeed: "test", nonce: 1, serverSeed: null,
      totalStake: "0", playerCount: 0, liveBets: [], myBets: [], recent: [],
    } });
  });
  await page.goto("/vegetable-bowl");
  await page.locator('[data-mode="hard"]').click();
  await expect.poll(() => level(page)).toBeGreaterThan(.001);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await page.waitForTimeout(150);
  await reset(page);
  await page.locator('[data-mode="normal"]').click();
  await page.waitForTimeout(250);
  expect(await level(page)).toBe(0);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await reset(page);
  revealStarted = Date.now();
  await expect.poll(() => level(page), { timeout: 12000 }).toBeGreaterThan(.001);
  await expect(page.locator(".vb-harvest-svg")).toHaveAttribute("aria-label", /[1-3] collected/);
});
