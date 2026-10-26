import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import manifest from "../src/assets/audio/public-demo/manifest.json" with { type: "json" };

test("imported audio bytes match the captured public source checksums", () => {
  for (const [file, source] of Object.entries(manifest.files)) {
    const bytes = readFileSync(new URL(`../src/assets/audio/public-demo/${file}`, import.meta.url));
    expect(bytes.length, file).toBe(source.bytes);
    expect(createHash("sha256").update(bytes).digest("hex"), file).toBe(source.sha256);
    expect(new URL(source.source).search, "No demo session tokens in source provenance").toBe("");
  }
});

test("every imported cue decodes and its actual sprite segment is audible", async ({ page }) => {
  test.setTimeout(120000);
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  const result = await page.evaluate(async () => {
    const { recordings } = (window as any).soundTest;
    const context = new AudioContext();
    const bank = new recordings.PublicDemoSoundBank(context);
    const manifest = recordings.PUBLIC_DEMO_AUDIO_MANIFEST;
    const games = { ...manifest.games, "7up7down": manifest.seven };
    const errors: string[] = [];
    let count = 0;
    for (const [game, cues] of Object.entries(games)) for (const [cue, spec] of Object.entries(cues as object)) {
      if (!await bank.prepare(game, cue)) { errors.push(`${game}:${cue}: decode failed`); continue; }
      for (let i = 0; i < (Array.isArray(spec) ? spec.length : 1); i++) {
        const { buffer, clip } = bank.take(game, cue);
        const start = clip.offset ?? 0, end = start + (clip.duration ?? buffer.duration);
        if (end > buffer.duration + .002) errors.push(`${game}:${cue}: sprite beyond EOF`);
        let energy = 0, samples = 0;
        const channel = buffer.getChannelData(0);
        for (let at = Math.ceil(start * buffer.sampleRate); at < Math.min(channel.length, end * buffer.sampleRate); at += 16) {
          energy += channel[at] ** 2; samples++;
        }
        if (!Number.isFinite(energy) || Math.sqrt(energy / samples) < .0001) errors.push(`${game}:${cue}: silent segment`);
        count++;
      }
    }
    await context.close();
    return { errors, games: Object.keys(games).length, count };
  });
  expect(result.errors).toEqual([]);
  expect(result.games).toBe(6);
  expect(result.count).toBeGreaterThan(40);
});

test("real playback uses exact decoded recordings and provider sprite timings", async ({ page }) => {
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  const result = await page.evaluate(async () => {
    const { audio, recordings, sources, events } = (window as any).soundTest;
    await audio.unlockAudio();
    const context = new AudioContext(), bank = new recordings.PublicDemoSoundBank(context);
    const failures: string[] = [];
    const games = ["jetx", "aviator", "mines", "tower-rush", "rummy"];
    for (const game of games) {
      await audio.preloadGameAudio(game);
      await bank.prepare(game, "win");
      const expected = bank.take(game, "win");
      audio.setAudioGame(game); audio.playGameSound("win", game);
      const source = sources.at(-1), event = events.at(-1);
      if (!source || source.buffer.length !== expected.buffer.length || event.offset !== (expected.clip.offset ?? 0)) { failures.push(game); continue; }
      const actual = source.buffer.getChannelData(0), original = expected.buffer.getChannelData(0);
      for (let i = 0; i < actual.length; i += 97) if (actual[i] !== original[i]) { failures.push(`${game}: waveform changed`); break; }
      if (expected.clip.duration && event.duration !== expected.clip.duration) failures.push(`${game}: wrong sprite duration`);
    }
    audio.setAudioGame(null); await context.close();
    return { failures, count: events.length };
  });
  expect(result.failures).toEqual([]);
  expect(result.count).toBe(5);
});

test("late downloads cannot play after navigation or restart stopped music", async ({ page }) => {
  await page.route("**/public-demo/**/*.mp3*", async route => {
    if (route.request().resourceType() === "script") return route.continue();
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.continue();
  });
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    await audio.unlockAudio(); audio.setAudioGame("tower-rush");
    audio.playGameSound("select"); audio.startMusic(); audio.stopMusic();
    audio.setAudioGame("coin-flip");
    await audio.preloadGameAudio("tower-rush");
  });
  await page.waitForTimeout(700);
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
});

test("failed exact downloads stay silent instead of substituting synthetic audio", async ({ page }) => {
  await page.route("**/public-demo/**/*.mp3*", route => route.request().resourceType() === "script" ? route.continue() : route.fulfill({ status: 404, body: "missing" }));
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    await audio.unlockAudio(); audio.setAudioGame("mines");
    await audio.preloadGameAudio("mines"); audio.playGameSound("win", "mines");
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
});

test("instant routes retain their own audio identity", async ({ page }) => {
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  const routes = Object.keys(manifest.games);
  expect(await page.evaluate(routes => routes.map(code => (window as any).soundTest.design.audioGameForRoute(`/${code}`)), routes)).toEqual(routes);
});
