import { expect, test, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
import { table } from "./lucky7-table-fixture";

async function ready(page: Page) {
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.locator("#enable").click();
  await page.evaluate(() => (window as any).soundTest.audio.unlockAudio());
}

test("Fury uses a real helicopter loop with headroom and quiet UI confirmations", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(async () => {
    const { design } = (window as any).soundTest;
    const url = "/src/game/furySounds.ts";
    const { furyEngineRate } = await import(/* @vite-ignore */ url);
    const cues = ["select", "bet", "clear", "tick", "win"];
    const asset = "/src/assets/audio/fury/helicopter-rotor.wav?url";
    const { default: rotorUrl } = await import(/* @vite-ignore */ asset);
    const context = new OfflineAudioContext(1, 32000, 32000);
    const recording = await context.decodeAudioData(await (await fetch(rotorUrl)).arrayBuffer());
    return {
      rates: [0, 1400, 7400, 60000].map(furyEngineRate),
      clips: [...cues, "engine"].map(cue => {
        const pcm: Float32Array = cue === "engine" ? recording.getChannelData(0) : design.renderGameSound("fury", cue);
        let peak = 0, energy = 0, step = 0;
        for (let i = 0; i < pcm.length; i++) {
          peak = Math.max(peak, Math.abs(pcm[i]));
          energy += pcm[i] ** 2;
          if (i) step = Math.max(step, Math.abs(pcm[i] - pcm[i - 1]));
        }
        return { cue, peak, rms: Math.sqrt(energy / pcm.length), seam: Math.abs(pcm[0] - pcm[pcm.length - 1]), step, first: pcm[0], last: pcm[pcm.length - 1], duration: cue === "engine" ? recording.duration : pcm.length / 24000 };
      }),
    };
  });
  expect(result.rates).toEqual([.96, 1, 1.02, 1.02]);
  for (const clip of result.clips) {
    expect(clip.peak, clip.cue).toBeLessThan(.83);
    expect(clip.rms, clip.cue).toBeGreaterThan(.005);
    if (clip.cue === "engine") {
      expect(clip.duration).toBe(8);
      expect(clip.rms).toBeGreaterThan(.1);
      expect(clip.seam).toBeLessThan(.003);
    } else {
      expect(Math.abs(clip.first), clip.cue).toBeLessThan(.001);
      expect(Math.abs(clip.last), clip.cue).toBeLessThan(.001);
    }
  }
});

test("Fury runs one engine, changes speed through takeoff, and stops on crash, mute and route exit", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("fury");
    await audio.preloadGameAudio("fury");
    audio.sfx.takeoff("lunar"); audio.sfx.engineStart("lunar"); audio.sfx.engineIntensity(2, 7400, "lunar"); audio.sfx.crash("lunar");
    if ((window as any).soundTest.events.length) throw new Error("A previous game's callback played Fury audio");
    audio.sfx.takeoff();
    for (let i = 0; i < 20; i++) audio.sfx.engineIntensity(1, 0);
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.filter((e: any) => e.loop).length)).toBe(1);
  expect(await page.evaluate(() => (window as any).soundTest.events.find((e: any) => e.loop).duration)).toBe(8);
  expect(await page.evaluate(() => (window as any).soundTest.sources.find((s: AudioBufferSourceNode) => s.loop).playbackRate.value)).toBeCloseTo(.96, 2);
  await page.evaluate(() => (window as any).soundTest.audio.sfx.engineIntensity(2.1, 7400));
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.sources.find((s: AudioBufferSourceNode) => s.loop).playbackRate.value)).toBeGreaterThan(1.01);
  await page.evaluate(() => (window as any).soundTest.audio.sfx.crash());
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.find((e: any) => e.loop).ended)).toBe(true);
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(1);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    audio.sfx.engineIntensity(3, 11000);
    audio.setVolumes(0, .8, .25, .8);
    audio.sfx.engineIntensity(3, 11000);
  });
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
  const before = await page.evaluate(() => (window as any).soundTest.events.length);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    audio.setVolumes(.7, .8, .25, .8);
    audio.sfx.engineIntensity(3, 11000);
    audio.setAudioGame(null);
    audio.sfx.engineStart(); audio.sfx.takeoff(); audio.sfx.cashout();
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(before + 1);
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
});

test("Fury stays quiet if its helicopter recording fails to load", async ({ page }) => {
  await page.route("**/helicopter-rotor.wav", route => route.abort());
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("fury");
    await audio.preloadGameAudio("fury");
    audio.sfx.takeoff(); audio.sfx.engineIntensity(1, 0);
    await audio.preloadGameAudio("fury");
  });
  expect(await page.evaluate(() => (window as any).soundTest.events)).toEqual([]);
});

test("Fury cancels a pending helicopter start when leaving the game", async ({ page }) => {
  await page.route("**/helicopter-rotor.wav", async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.continue();
  });
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("fury");
    audio.sfx.engineIntensity(1, 0);
    audio.setAudioGame(null);
    await audio.preloadGameAudio("fury");
  });
  expect(await page.evaluate(() => (window as any).soundTest.events)).toEqual([]);
});

async function slowDevice(page: Page) {
  await page.addInitScript(() => {
    const NativeAudioContext = AudioContext;
    window.AudioContext = class extends NativeAudioContext {
      private starting?: Promise<void>;
      constructor(options?: AudioContextOptions) {
        super(options);
        Object.defineProperty(this, "state", { configurable: true, value: "suspended" });
      }
      resume() {
        // Each gesture must reach the native context, including after a blocked
        // automatic attempt. Only the simulated device wake-up is shared.
        const resumed = super.resume();
        return this.starting ??= resumed
          .then(() => new Promise<void>(resolve => setTimeout(resolve, 400)))
          .then(() => { Reflect.deleteProperty(this, "state"); });
      }
    };
  });
}

test("a slow device keeps only the latest first-click cue and cancels it on navigation", async ({ page }) => {
  await slowDevice(page);
  await page.goto("/tests/fixtures/game-audio.html");
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.evaluate(() => (window as any).soundTest.audio.setAudioGame("vegetable-bowl"));
  await page.locator("#select").click();
  await page.locator("#select").click();
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.length)).toBe(1);
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).soundTest));
  await page.evaluate(() => (window as any).soundTest.audio.setAudioGame("vegetable-bowl"));
  await page.locator("#select").click();
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("wingo");
    await audio.unlockAudio();
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
});

test("standalone first-click audio survives a slow device wake-up", async ({ page }) => {
  await slowDevice(page);
  await page.goto("/tests/fixtures/standalone-audio.html");
  await page.locator("#cue").click();
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).audioLoops.filter((e: any) => !e.ended).length)).toBe(1);
});

test("all 28 game designs produce distinct, audible, bounded original cues", async ({ page }) => {
  await ready(page);
  const result = await page.evaluate(() => {
    const { design } = (window as any).soundTest;
    const cues = ["select", "bet", "clear", "deal", "reveal", "roll", "impact", "settle", "win", "lose", "launch", "crash", "engine", "music", "tick"];
    const failures: string[] = [];
    const signatures = new Set<string>();
    for (const game of Object.keys(design.GAME_SOUND_DESIGNS)) {
      for (const cue of game === "chicken-road" ? [...cues, "idle"] : cues) {
        const samples: Float32Array = design.renderGameSound(game, cue);
        let peak = 0, energy = 0, hash = 2166136261, previous = samples[0], maxStep = 0;
        for (const sample of samples) {
          if (!Number.isFinite(sample)) failures.push(`${game}:${cue}: non-finite`);
          peak = Math.max(peak, Math.abs(sample)); energy += sample * sample;
          maxStep = Math.max(maxStep, Math.abs(sample - previous)); previous = sample;
          hash = Math.imul(hash ^ Math.round(sample * 1e7), 16777619);
        }
        if (peak > .81 || Math.sqrt(energy / samples.length) < .001) failures.push(`${game}:${cue}: bad level`);
        if (cue === "win") signatures.add(String(hash));
        if (cue === "engine" && Math.abs(samples[0] - samples.at(-1)!) > maxStep + .00001) failures.push(`${game}: loop seam`);
      }
    }
    return { failures, unique: signatures.size, count: Object.keys(design.GAME_SOUND_DESIGNS).length,
      routes: ["/play", "/aviator", "/lunar-colour-trading", "/rummy", "/", "/wallet"].map(design.audioGameForRoute) };
  });
  expect(result.failures).toEqual([]);
  expect(result.count).toBe(28);
  expect(result.unique).toBe(result.count);
  expect(result.routes).toEqual(["lunar", "aviator", "wingo", "rummy", null, null]);
});

test("a cold-cache first click is audible without fetching a sound file", async ({ page }) => {
  const audioRequests: string[] = [];
  page.on("request", r => { if (r.resourceType() !== "script" && /\.(mp3|wav|ogg)(\?|$)/.test(r.url())) audioRequests.push(r.url()); });
  await ready(page);
  await page.evaluate(() => (window as any).soundTest.audio.setAudioGame("plinko"));
  await page.locator("#select").click();
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.length)).toBe(1);
  expect(audioRequests).toEqual([]);
});

test("route changes stop loops and receipts; inactive game callbacks cannot leak sound", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    await audio.preloadGameAudio("aviator");
    audio.setAudioGame("aviator"); audio.sfx.engineStart(); audio.startMusic(); audio.sfx.cashout();
  });
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.length)).toBe(3);
  const count = await page.evaluate(() => {
    const { audio, events } = (window as any).soundTest;
    audio.setAudioGame("rummy");
    audio.playGameSound("win", "aviator");
    audio.sfx.takeoff(); audio.sfx.engineStart(); audio.sfx.crash();
    return events.length;
  });
  expect(count).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
  await page.locator("#select").click();
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(4);
  await page.evaluate(() => { const {audio} = (window as any).soundTest; audio.setAudioGame(null); audio.sfx.click(); audio.sfx.winCelebration("rummy"); });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(4);
});

test("mute and hidden tabs cancel effects, and zero volume suppresses new cues", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    await audio.preloadGameAudio("jetx");
    audio.setAudioGame("jetx"); audio.sfx.engineStart(); audio.playGameSound("win");
    audio.setVolumes(.7, 0, .25, .8); audio.playGameSound("bet");
  });
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(2);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    audio.setVolumes(0, .8, .25, .8); audio.sfx.engineStart(); audio.playGameSound("win");
    audio.setVolumes(.7, .8, .25, .8); audio.sfx.engineStart();
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange"));
    audio.playGameSound("bet"); audio.sfx.engineStart();
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(3);
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
});

test("rapid Lucky 7 impacts play one complete recording without repeated percussion", async ({ page }) => {
  await ready(page);
  const counts = await page.evaluate(async () => {
    const { audio, events, sources } = (window as any).soundTest;
    audio.setAudioGame("lucky-7");
    await audio.preloadTableAudio("lucky-7");
    audio.sfx.diceThrow();
    const airborne = events.length;
    for (let i = 0; i < 100; i++) audio.sfx.diceImpact(1);
    return { count: events.length, airborne, duration: sources[0].buffer.duration };
  });
  expect(counts.airborne).toBe(0);
  expect(counts.count).toBe(1);
  expect(counts.duration).toBeCloseTo(1.797, 2);
});

test("Lucky 7 preloads real dice, varies contacts, and stops recordings on mute", async ({ page }) => {
  await ready(page);
  await page.evaluate(async () => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("lucky-7");
    await audio.preloadTableAudio("lucky-7");
    audio.sfx.diceThrow();
    audio.sfx.diceImpact(1);
  });
  await page.waitForTimeout(70);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    for (const strength of [.7, .46, .3, .19, .11, .06]) audio.sfx.diceImpact(strength);
    audio.sfx.diceSettle();
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events[0].ended)).toBe(true);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    audio.sfx.diceThrow(); audio.sfx.diceImpact(1);
  });
  const result = await page.evaluate(() => {
    const { sources, audio } = (window as any).soundTest;
    const durations = sources.map((s: AudioBufferSourceNode) => s.buffer!.duration);
    const first = sources[0].buffer.getChannelData(0);
    const second = sources[1].buffer.getChannelData(0);
    const different = first.some((sample: number, i: number) => sample !== second[i]);
    audio.setVolumes(.7, 0, .25, .8);
    audio.sfx.diceThrow(); audio.sfx.diceImpact(1);
    return { durations, different, count: sources.length };
  });
  expect(result.durations[0]).toBeCloseTo(1.797, 2);
  expect(result.durations[1]).toBeCloseTo(1.797, 2);
  expect(result.different).toBe(true);
  expect(result.count).toBe(2);
  await expect.poll(() => page.evaluate(() => (window as any).soundTest.events.every((e: any) => e.ended))).toBe(true);
});

test("missing Lucky 7 recordings never become synthetic drums or delayed rolls", async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/audio\/lucky7\/roll-.*\.wav$/, async route => {
    await gate;
    await route.continue();
  });
  await ready(page);
  await page.evaluate(() => {
    const { audio } = (window as any).soundTest;
    audio.setAudioGame("lucky-7");
    audio.sfx.diceThrow(); audio.sfx.diceImpact(1); audio.sfx.diceSettle();
  });
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
  release();
  await page.evaluate(() => (window as any).soundTest.audio.preloadTableAudio("lucky-7"));
  expect(await page.evaluate(() => (window as any).soundTest.events.length)).toBe(0);
});

for (const physical of [true, false]) {
  test(`Lucky 7 dice contacts follow the ${physical ? "dealer frames" : "fallback animation"}`, async ({ page }) => {
    test.setTimeout(90000);
    if (!physical) await page.route(/naina-bar-natural-action.*\.(mp4|webm)(\?|$)/, route =>
      route.request().resourceType() === "script" ? route.continue() : route.abort());
    const round = await table(page, false, 0, { sound: true, bettingMs: 60000 });
    await page.getByTestId("btn-lucky7-sound").click();
    await page.getByTestId("btn-lucky7-sound").click();
    if (physical) {
      await expect.poll(() => page.getByTestId("lucky7-dealer-action-video").evaluate(el => (el as HTMLVideoElement).readyState), { timeout: 20000 }).toBeGreaterThanOrEqual(2);
    }
    await page.evaluate(async () => {
      const moduleUrl = "/src/game/audio.ts";
      const { sfx, preloadTableAudio } = await import(/* @vite-ignore */ moduleUrl);
      await preloadTableAudio("lucky-7");
      (window as any).diceCues = [];
      (window as any).recordedRolls = [];
      const start = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof start>) {
        if (this.buffer && this.buffer.duration > 1.79 && this.buffer.duration < 1.81) {
          (window as any).recordedRolls.push(performance.now());
        }
        return start.apply(this, args);
      };
      for (const name of ["diceThrow", "diceImpact", "diceSettle"]) {
        const original = sfx[name];
        sfx[name] = (strength?: number) => {
          const dice = document.querySelector('[data-testid="lucky7-table-dice"]') as SVGElement;
          (window as any).diceCues.push({ name, strength, ms: Number(dice.dataset.mediaMs), at: performance.now() });
          original(strength);
        };
      }
    });
    round.reveal();
    await expect(page.getByTestId("badge-dice-total")).toHaveAttribute("data-total", "7", { timeout: 10000 });
    const cues = await page.evaluate(() => (window as any).diceCues as {name: string; strength: number; ms: number; at: number}[]);
    expect(cues[0].name).toBe("diceThrow");
    expect(cues.at(-1)!.name).toBe("diceSettle");
    const hits = cues.filter(cue => cue.name === "diceImpact");
    expect(hits.length).toBe(7);
    for (let i = 1; i < hits.length; i++) expect(hits[i].strength).toBeLessThan(hits[i - 1].strength);
    const firstContact = physical ? hits[0].ms - 93 / 24 * 1000 : hits[0].at - cues[0].at;
    expect(firstContact).toBeGreaterThanOrEqual(500);
    expect(firstContact).toBeLessThan(640);
    const recordings = await page.evaluate(() => (window as any).recordedRolls as number[]);
    expect(recordings).toHaveLength(1);
    expect(Math.abs(recordings[0] - hits[0].at)).toBeLessThan(60);
    round.repeatResult();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).diceCues.length)).toBe(cues.length);
  });
}

test("browsers without Web Audio keep controls usable", async ({ page }) => {
  await page.addInitScript(() => { (window as any).AudioContext = undefined; (window as any).webkitAudioContext = undefined; });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await ready(page);
  await page.evaluate(() => { const {audio} = (window as any).soundTest; audio.setAudioGame("mines"); audio.sfx.mineReveal(); audio.startMusic(); audio.stopMusic(); });
  await page.locator("#select").click();
  expect(errors).toEqual([]);
});

test("standalone sounds unlock on the first selection and persist mute across reloads", async ({ page }) => {
  await page.goto("/tests/fixtures/standalone-audio.html");
  await page.locator("#cue").click();
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.length)).toBe(1);
  await page.locator("#mute").click();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.every((e: any) => e.ended))).toBe(true);
  await page.locator("#cue").click();
  expect(await page.evaluate(() => (window as any).audioEvents.length)).toBe(1);
  await page.reload();
  await expect(page.locator("#mute")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#cue").click();
  expect(await page.evaluate(() => (window as any).audioEvents.length)).toBe(0);
  await page.locator("#mute").click();
  await page.locator("#cue").click();
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.length)).toBe(1);
});

test("embedded colour trading shares the casino mute control and plays selection cues", async ({ page }) => {
  await mockGames(page);
  await page.addInitScript(() => {
    localStorage.setItem("aviator:v1", JSON.stringify({ settings: { onboarded: true, sound: true, music: false } }));
    (window as any).audioEvents = [];
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...args: Parameters<typeof start>) {
      (window as any).audioEvents.push(this.buffer?.length);
      return start.apply(this, args);
    };
  });
  await page.goto("/lunar-colour-trading");
  await page.locator(".color-option.green").click();
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.length)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  const before = await page.evaluate(() => (window as any).audioEvents.length);
  await page.locator(".color-option.red").click();
  expect(await page.evaluate(() => (window as any).audioEvents.length)).toBe(before);
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await page.locator(".color-option.violet").click();
  await expect.poll(() => page.evaluate(() => (window as any).audioEvents.length)).toBeGreaterThan(before);
  expect(await page.locator("[data-game-viewport]").count()).toBe(1);
});
