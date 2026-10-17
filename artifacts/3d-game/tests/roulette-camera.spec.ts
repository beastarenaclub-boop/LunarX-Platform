import { test, expect } from "@playwright/test";
import { studio } from "./fixtures/roulette";

test.setTimeout(90000);
for (const width of [1366, 390]) {
  test(`camera zoom preserves the controlled wheel and result timing at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 960 });
    const game = await studio(page);
    const idle = page.getByTestId("roulette-dealer-idle");
    const scene = page.getByTestId("roulette-camera-scene");
    await expect.poll(() => idle.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(.1);
    await idle.evaluate(el => { (window as any).__sameWheelVideo = el; });
    await page.getByTestId("roulette-controlled-wheel").evaluate(el => { (window as any).__sameControlledWheel = el; });
    await page.getByRole("button", { name: "Show wheel close-up" }).click();
    await expect.poll(() => scene.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1.52, 2);
    expect(await idle.evaluate(el => el === (window as any).__sameWheelVideo)).toBe(true);
    expect(await page.getByTestId("roulette-controlled-wheel").evaluate(el => el === (window as any).__sameControlledWheel)).toBe(true);
    await expect(page.getByTestId("roulette-model-canvas")).toHaveCount(0);
    await expect(scene.locator("video")).toHaveCount(2);
    await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath("same-wheel-focus.png") });
    await page.getByRole("button", { name: "Hide wheel close-up" }).click();
    await expect.poll(() => scene.evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)).toBeCloseTo(1, 2);
    game.betting("camera-result", 2000);
    await expect(page.getByTestId("roulette-dealer-stage")).toHaveAttribute("data-dealer-state", "release");
    game.reveal(23);
    await expect(page.getByTestId("wheel-result")).toHaveCount(0);
    await expect(page.getByTestId("wheel-result")).toHaveText("23", { timeout: 8000 });
    await expect.poll(() => idle.evaluate(el => (el as HTMLVideoElement).paused)).toBe(false);
    await expect(page.getByTestId("roulette-controlled-wheel")).toHaveAttribute("data-landed-pocket", "23");
    expect(await idle.evaluate(el => el === (window as any).__sameWheelVideo)).toBe(true);
    await page.getByTestId("roulette-dealer-stage").screenshot({ path: info.outputPath("same-wheel-result.png") });
    game.betting("camera-next", 120000);
    await expect.poll(() => idle.evaluate(el => (el as HTMLVideoElement).paused)).toBe(false);
    await expect(page.getByTestId("wheel-result")).toHaveCount(0);
    expect(game.errors).toEqual([]);
  });
}

test("louder roulette mix routes through a limiter and still mutes its rolling loop", async ({ page }) => {
  await page.addInitScript(() => {
    const graph = { gains: [] as GainNode[], edges: [] as [AudioNode, AudioNode][], started: [] as AudioBufferSourceNode[], stopped: new Set<AudioBufferSourceNode>() };
    (window as any).__rouletteAudio = graph;
    const createGain = AudioContext.prototype.createGain;
    AudioContext.prototype.createGain = function() { const gain = createGain.call(this); graph.gains.push(gain); return gain; };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination: any, ...rest: any[]) {
      if (destination instanceof AudioNode) graph.edges.push([this, destination]);
      return (connect as any).call(this, destination, ...rest);
    } as typeof connect;
    const createSource = AudioContext.prototype.createBufferSource;
    AudioContext.prototype.createBufferSource = function() {
      const source = createSource.call(this), start = source.start.bind(source), stop = source.stop.bind(source);
      source.start = (...args) => { graph.started.push(source); start(...args); };
      source.stop = (...args) => { graph.stopped.add(source); stop(...args); };
      return source;
    };
  });
  const game = await studio(page);
  await page.getByRole("button", { name: "Enable roulette sound" }).click();
  await page.getByTestId("cell-7").click();
  game.betting("audio-throw", 2200);
  await expect.poll(() => page.evaluate(() => {
    const graph = (window as any).__rouletteAudio;
    return graph.started.some((s: AudioBufferSourceNode) => s.loop && !graph.stopped.has(s));
  })).toBe(true);
  const limited = await page.evaluate(() => {
    const graph = (window as any).__rouletteAudio;
    const boost = graph.gains.find((g: GainNode) => Math.abs(g.gain.value - 1.65) < .001);
    const limiter = graph.edges.find(([from, to]: AudioNode[]) => from === boost && to instanceof DynamicsCompressorNode)?.[1];
    const loop = graph.started.find((s: AudioBufferSourceNode) => s.loop && !graph.stopped.has(s));
    let frontier = [loop];
    const seen = new Set();
    while (frontier.length) {
      const node = frontier.pop();
      if (node === limiter) return limiter.threshold.value === -3 && limiter.ratio.value === 20;
      if (seen.has(node)) continue;
      seen.add(node);
      frontier.push(...graph.edges.filter(([from]: AudioNode[]) => from === node).map(([, to]: AudioNode[]) => to));
    }
    return false;
  });
  expect(limited).toBe(true);
  await page.getByRole("button", { name: "Mute roulette sound" }).click();
  await expect.poll(() => page.evaluate(() => {
    const graph = (window as any).__rouletteAudio;
    return graph.started.filter((s: AudioBufferSourceNode) => s.loop && !graph.stopped.has(s)).length;
  })).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("aviator:v1")!).settings.sound)).toBe(false);
  expect(game.errors).toEqual([]);
});
