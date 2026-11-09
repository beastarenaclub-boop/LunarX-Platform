import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import provenance from "../src/assets/audio/lunar-kit/manifest.json" with { type: "json" };

test("Lunar recordings match the supplied handoff archive", () => {
  for (const [file, info] of Object.entries(provenance.files)) {
    const bytes = readFileSync(new URL(`../src/assets/audio/lunar-kit/${file}`, import.meta.url));
    expect(bytes.length, file).toBe(info.bytes);
    expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(info.sha256);
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
});

test("canonical Lunar plays the kit recordings and no generated engine hum", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { audio, design, events, sources } = (window as any).soundTest;
    const ctx = new AudioContext();
    const decode = async (file: string) => ctx.decodeAudioData(await (await fetch(`/src/assets/audio/lunar-kit/${file}`)).arrayBuffer());
    const expected = await Promise.all(["click.mp3", "takeoff.mp3", "cashout.mp3", "flyAway.mp3", "ambient.mp3"].map(decode));
    audio.setAudioGame("lunar"); await audio.preloadGameAudio("lunar"); await audio.unlockAudio();
    const start = events.length;
    audio.sfx.engineStart("lunar"); audio.sfx.engineIntensity(5, 8000, "lunar");
    const engineVoices = events.length - start;
    const actual: AudioBuffer[] = [];
    for (const action of [() => audio.sfx.click(), () => audio.sfx.takeoff("lunar"), () => audio.sfx.cashout(), () => audio.sfx.crash("lunar")]) {
      action(); actual.push(sources.at(-1)?.buffer);
    }
    audio.startMusic();
    for (let i = 0; i < 100 && events.length < start + 5; i++) await new Promise(r => setTimeout(r, 20));
    actual.push(sources.at(-1)?.buffer);
    const errors: string[] = [];
    expected.forEach((buffer, index) => {
      if (actual[index]?.length !== buffer.length || actual[index]?.numberOfChannels !== buffer.numberOfChannels) { errors.push(`buffer ${index}`); return; }
      let energy = 0;
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const a = actual[index].getChannelData(channel), b = buffer.getChannelData(channel);
        for (let j = 0; j < b.length; j++) { if (a[j] !== b[j]) errors.push(`waveform ${index}`); energy += b[j] ** 2; }
      }
      // The supplied UI click is deliberately very quiet; normalize for clip length.
      if (Math.sqrt(energy / (buffer.length * buffer.numberOfChannels)) < .00001) errors.push(`silent ${index}`);
    });
    const musicLoops = events.slice(start).filter((e: any) => e.loop).length;
    const aliases = ["/aviator-pro", "/play"].map(design.audioGameForRoute);
    audio.setAudioGame(null); await ctx.close();
    return { errors, engineVoices, musicLoops, aliases, count: events.length - start };
  });
  expect(result).toEqual({ errors: [], engineVoices: 0, musicLoops: 1, aliases: ["lunar", "lunar"], count: 5 });
});

test("Lunar respects sound mute, music stop and route exit", async ({ page }) => {
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("lunar"); await audio.preloadGameAudio("lunar"); audio.startMusic();
  });
  const loops = () => page.evaluate(() => (window as any).soundTest.events.filter((e: any) => e.loop && !e.ended).length);
  await expect.poll(loops).toBe(1);
  await page.evaluate(() => (window as any).soundTest.audio.stopMusic());
  await expect.poll(loops).toBe(0);
  expect(await page.evaluate(() => {
    const { audio, events } = (window as any).soundTest;
    audio.setVolumes(0, .8, .25, .8); const start = events.length;
    audio.sfx.takeoff("lunar"); audio.sfx.cashout(); audio.sfx.crash("lunar"); audio.startMusic();
    return events.length - start;
  })).toBe(0);
  await page.evaluate(() => { const { audio } = (window as any).soundTest; audio.setVolumes(.7, .8, .25, .8); audio.startMusic(); });
  await expect.poll(loops).toBe(1);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(loops).toBe(0);
  await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, value: false }); document.dispatchEvent(new Event("visibilitychange")); });
  await expect.poll(loops).toBe(1);
  await page.evaluate(() => (window as any).soundTest.audio.setAudioGame(null));
  await expect.poll(loops).toBe(0);
  expect(await page.evaluate(() => {
    const { audio, events } = (window as any).soundTest; const start = events.length;
    audio.sfx.takeoff("lunar"); audio.sfx.engineIntensity(4, 7000, "lunar"); audio.sfx.crash("lunar");
    return events.length - start;
  })).toBe(0);
});

for (const failure of [false, true]) test(`Lunar ${failure ? "failed" : "late"} downloads cannot leak or fall back to old sounds`, async ({ page }) => {
  await page.route("**/lunar-kit/*.mp3*", async route => {
    if (route.request().resourceType() === "script") return route.continue();
    if (failure) return route.fulfill({ status: 404, body: "missing" });
    await new Promise(r => setTimeout(r, 500)); await route.continue();
  });
  await page.evaluate(async failure => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("lunar"); audio.sfx.takeoff("lunar"); audio.startMusic();
    if (!failure) { audio.stopMusic(); audio.setAudioGame(null); }
    await audio.preloadGameAudio("lunar");
  }, failure);
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
});
