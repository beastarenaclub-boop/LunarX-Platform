import { test, expect, type Page } from "@playwright/test";

import { cameraFixture, removeVisitor } from "./visitor-fixture";

test.afterEach(async ({ page }) => {
  await removeVisitor(page.request);
});

declare global {
  interface Window {
    entryAudioProbe: { contexts: AudioContext[]; analysers: AnalyserNode[] };
  }
}

async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    window.entryAudioProbe = { contexts: [], analysers: [] };
    const NativeContext = window.AudioContext;
    window.AudioContext = class extends NativeContext {
      constructor(options?: AudioContextOptions) {
        super(options);
        window.entryAudioProbe.contexts.push(this);
      }
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (
      this: AudioNode,
      destination: AudioNode | AudioParam,
      ...args: number[]
    ) {
      if (destination === this.context.destination) {
        const analyser = this.context.createAnalyser();
        window.entryAudioProbe.analysers.push(analyser);
        Reflect.apply(connect, this, [analyser]);
        Reflect.apply(connect, analyser, [destination]);
        return destination;
      }
      return Reflect.apply(connect, this, [destination, ...args]);
    } as typeof connect;
  });
}
async function audioState(page: Page) {
  return page.evaluate(
    () => window.entryAudioProbe.contexts.at(-1)?.state || "absent",
  );
}
async function expectAudible(page: Page) {
  await expect.poll(() => audioState(page)).toBe("running");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const analyser = window.entryAudioProbe.analysers.at(-1);
        if (!analyser) return 0;
        const values = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(values);
        return Math.sqrt(
          values.reduce((sum, value) => sum + value * value, 0) / values.length,
        );
      }),
    )
    .toBeGreaterThan(0.0001);
}

test("sound starts on interaction, mute persists, background audio continues, and mobile still fits", async ({
  page,
}) => {
  await observeAudio(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Rotate upper triangle fragment" }),
  ).toBeEnabled();
  expect(await audioState(page)).toBe("absent");
  await page
    .getByRole("button", { name: "Rotate upper triangle fragment" })
    .click();
  await expectAudible(page);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(() => audioState(page)).toBe("suspended");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable sound", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rotate upper triangle fragment" })
    .click();
  expect(await audioState(page)).toBe("absent");
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expectAudible(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectAudible(page);
  await page.evaluate(() => {
    Reflect.deleteProperty(document, "hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectAudible(page);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <= innerWidth &&
        document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/entry-audio-mobile.png",
    fullPage: true,
  });
});

test("continuous audio survives walk pause and entry-to-login navigation with one context", async ({
  page,
}) => {
  test.setTimeout(60000);
  await cameraFixture(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await observeAudio(page);
  await page.goto("/");
  const documentId = await page.evaluate(() => {
    document.documentElement.dataset.audioDocument = crypto.randomUUID();
    return document.documentElement.dataset.audioDocument;
  });
  await page.getByRole("button", { name: "Start sound", exact: true }).click();
  await expectAudible(page);
  await page.screenshot({
    path: "test-results/entry-audio-puzzle.png",
    fullPage: true,
  });
  for (const [part, turns] of [
    ["upper", 2],
    ["left", 1],
    ["right", 2],
  ] as const)
    for (let i = 0; i < turns; i++)
      await page
        .getByRole("button", { name: `Rotate ${part} triangle fragment` })
        .click();
  await expect(
    page.getByRole("heading", { name: "The passage awakens." }),
  ).toBeVisible();
  await expectAudible(page);
  await page.getByRole("button", { name: "Pause walk" }).click();
  await expectAudible(page);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await expect.poll(() => audioState(page)).toBe("suspended");
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Mute sound", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectAudible(page);
  await page.getByRole("button", { name: "Continue walking" }).click();
  await expectAudible(page);
  await expect(
    page.getByRole("heading", { name: "Every lock has a secret." }),
  ).toBeVisible();
  for (const spot of ["lantern alcove", "cracked stone", "stone pedestal"]) {
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/api/entry/search")),
      page.getByRole("button", { name: `Search ${spot}`, exact: true }).click(),
    ]);
    if ((await response.json()).found) break;
  }
  await page.getByRole("button", { name: "Pick up the hidden key" }).click();
  await expectAudible(page);
  await page
    .getByRole("button", { name: "Unlock the gate with the key" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("button", { name: "Mute sound", exact: true }),
  ).toBeVisible();
  await expectAudible(page);
  expect(
    await page.evaluate(() => document.documentElement.dataset.audioDocument),
  ).toBe(documentId);
  expect(
    await page.evaluate(() => window.entryAudioProbe.contexts.length),
  ).toBe(1);
  await page.getByRole("button", { name: "Mute sound", exact: true }).click();
  await page.getByRole("link", { name: "Member login", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Member login." }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enable sound", exact: true }),
  ).toBeVisible();
  expect(await audioState(page)).toBe("suspended");
  await page.getByRole("button", { name: "Enable sound", exact: true }).click();
  await expectAudible(page);
  await page.getByRole("link", { name: "Create account", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Member signup." }),
  ).toBeVisible();
  await expectAudible(page);
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Member login." }),
  ).toBeVisible();
  await expectAudible(page);
  expect(
    await page.evaluate(() => document.documentElement.dataset.audioDocument),
  ).toBe(documentId);
  expect(
    await page.evaluate(() => window.entryAudioProbe.contexts.length),
  ).toBe(1);
  expect(errors).toEqual([]);
});

test("entry remains usable when Web Audio is unavailable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { value: undefined });
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Rotate left triangle fragment" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Rotate upper triangle fragment" })
    .click();
  await expect(
    page.getByRole("button", { name: "Sound unavailable" }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
});
