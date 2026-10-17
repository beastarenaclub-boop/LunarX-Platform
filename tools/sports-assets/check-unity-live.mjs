import { chromium, expect } from "../../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { SPORTS } from "../../lib/virtual-sports/catalog.mjs";

// Read-only production smoke check. Bet/settlement tests use an isolated server.
const base = process.env.UNITY_LIVE_URL ?? "http://127.0.0.1:5200";
const browser = await chromium.launch({ headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  await page.addInitScript(()=>{
    window.__arenaAudio=[];
    const NativeAudio=window.Audio;
    window.Audio=function(...args){const audio=new NativeAudio(...args);window.__arenaAudio.push(audio);return audio;};
    window.Audio.prototype=NativeAudio.prototype;
  });
  const errors = [], failed = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("response", r => { if ((r.url().includes("/unity-sports/")||r.url().includes('/virtual-sports/audio/')) && r.status() >= 400) failed.push(r.url()); });
  assert.equal((await page.request.get(`${base}/api/virtual-sports/state`)).status(), 401);
  const login = await page.request.post(`${base}/api/auth/login`, { data: {
    email: process.env.UNITY_TEST_EMAIL ?? "admin@local.test",
    password: process.env.UNITY_TEST_PASSWORD ?? "Admin@12345",
  } });
  assert.ok(login.ok(), `Local test login returned ${login.status()}`);
  const state = await page.request.get(`${base}/api/virtual-sports/state`);
  assert.equal(state.status(), 200);
  const data=await state.json();assert.equal(data.rounds.length, 5);assert.equal(data.matches.length,17);
  assert.equal(data.matches.filter(r=>r.sport==='football').length,4);
  const wasm = await page.request.head(`${base}/unity-sports/Build/WebGL.wasm`);
  assert.equal(wasm.status(), 200);
  assert.match(wasm.headers()["content-type"], /^application\/wasm/);
  const manifest = await page.request.get(`${base}/unity-sports/ready.json`);
  assert.equal((await manifest.json()).engine, "unity");
  assert.match(manifest.headers()["cache-control"], /no-store/);
  assert.equal((await page.request.get(`${base}/unity-sports/Build/not-a-real-file.wasm`)).status(), 404);
  assert.equal((await page.request.get(`${base}/virtual-sports/audio/missing.ogg`)).status(),404);
  const clips=await (await page.request.get(`${base}/virtual-sports/audio/hi/manifest.json`)).json();
  assert.equal(clips.clips.length,77);
  for(const clip of clips.clips){
    const asset=await page.request.get(`${base}/virtual-sports/audio/hi/${clip.id}.ogg`);
    assert.equal(asset.status(),200);assert.match(asset.headers()['content-type'],/audio\/ogg/);assert.equal((await asset.body()).length,clip.bytes);
  }
  await page.goto(base);
  for (const sport of SPORTS) await expect(page.getByTestId(`card-game-virtual-${sport.id}`)).toBeAttached();
  await page.goto(`${base}/virtual-sports/football`);
  const scene = page.getByTestId("sports-scene");
  await expect(scene).toHaveAttribute("data-renderer", "unity-urp", { timeout: 20000 });
  await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 180000 });
  const originalFrame = await scene.locator("iframe").elementHandle();
  for (const sport of SPORTS) {
    await page.getByRole("tab", { name: new RegExp(sport.short) }).click();
    await expect(scene).toHaveAttribute("data-ready", "true", { timeout: 45000 });
    await expect(scene).toHaveAttribute("data-athletes", String({ football: 22, cricket: 13, basketball: 10, tennis: 2, formula: 0 }[sport.id]));
    await expect(scene).toHaveAttribute("data-vehicles", sport.id === "formula" ? "4" : "0");
    const stage=await page.locator('.vs-stage').boundingBox(),dock=await page.getByTestId('sports-betting-dock').boundingBox();
    assert.ok(stage.width>1200);assert.ok(dock.y>=stage.y+stage.height);
  }
  assert.ok(await originalFrame.evaluate(node => node.isConnected), "Sport changes replaced the Unity iframe");
  await page.getByRole("tab", { name: /Football/ }).click();
  await expect(scene).toHaveAttribute("data-ready", "true");
  await page.getByRole('combobox',{name:'Choose match'}).selectOption('france-portugal');
  await expect(page.locator('.vs-fixture-teams')).toContainText('France vs Portugal');
  await page.getByRole('combobox',{name:'Player to follow'}).selectOption('21');
  await expect(page.getByRole('combobox',{name:'Camera view'})).toHaveValue('player');
  await expect(page.locator('.vs-player-caption')).toContainText('Portugal');
  await expect(page.locator('.vs-squad button')).toHaveCount(22);
  await page.getByRole('button',{name:'Enable Hindi commentary',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__arenaAudio.some(a=>a.src.includes('/audio/hi/')&&!a.paused&&a.currentTime>.1)),{timeout:15000}).toBe(true);
  await page.getByRole('button',{name:'Mute Hindi commentary',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__arenaAudio.every(a=>a.paused))).toBe(true);
  await page.getByRole('slider',{name:'Camera zoom'}).fill('1.3');
  await page.getByRole('slider',{name:'Camera angle'}).fill('120');
  await page.getByRole("combobox", { name: "Camera view" }).selectOption("cinematic");
  await page.getByRole("combobox", { name: "Graphics quality" }).selectOption("high");
  await mkdir("tmp/unity-sports/live", { recursive: true });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: "tmp/unity-sports/live/integrated-desktop.png", fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.getByTestId("sports-place").scrollIntoViewIfNeeded();
    await expect(page.getByTestId("sports-place")).toBeVisible();
  }
  await page.screenshot({ path: "tmp/unity-sports/live/integrated-mobile.png", fullPage: true });
  assert.deepEqual([...new Set(errors)], []);
  assert.deepEqual(failed, []);
  await page.request.post(`${base}/api/auth/logout`);
  console.log("Live website: 17 virtual fixtures, all five Unity sports, camera/player controls, large game with betting below, 77 Hindi audio assets and audible playback/mute, 390/320px layouts, API/auth and static serving passed.");
} finally { await browser.close(); }
