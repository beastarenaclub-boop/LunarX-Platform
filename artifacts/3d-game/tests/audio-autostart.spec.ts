import { test as base, expect, chromium, type Page } from "@playwright/test";
import { existsSync } from "node:fs";

const executablePath = existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined;
const test = base.extend({
  page: async ({ baseURL }, use, info) => {
    const blocked = info.titlePath.includes("browser gesture fallback");
    const browser = await chromium.launch({ executablePath, args: [`--autoplay-policy=${blocked ? "document-user-activation-required" : "no-user-gesture-required"}`] });
    const context = await browser.newContext({ baseURL });
    try { await use(await context.newPage()); } finally { await browser.close(); }
  },
});
async function shared(page: Page, route = "/mines") {
  await page.goto(`/tests/fixtures/game-audio.html?autostart=${encodeURIComponent(route)}`);
  await page.waitForFunction(() => Boolean((window as any).autoAudio));
}
const liveLoops = (page: Page) => page.evaluate(() => (window as any).soundTest.events.filter((e: any) => e.loop && !e.ended).length);
const musicPlaying = (page: Page) => page.getByTestId("music").evaluate((el: HTMLAudioElement) => !el.paused && el.currentTime > 0);

test.describe("automatic playback when the browser permits it", () => {

  test("every shared game starts one music loop on entry without a bet; navigation, hide and mute stop it", async ({ page }) => {
    await shared(page);
    const games: string[] = await page.evaluate(() => Object.keys((window as any).soundTest.design.GAME_SOUND_DESIGNS).filter(game => !["baccarat","teen-patti-live","dragon-tiger-one-day"].includes(game)));
    for (const route of [...games.map(game => `/${game}`), "/lottery", "/prize-lotto", "/lunar-colour-trading", "/7up7down", "/tower-rush"]) {
      await page.evaluate(route => (window as any).autoAudio.enter(route), route);
      await expect.poll(() => liveLoops(page), { message: route }).toBe(1);
    }
    await page.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,value:true});document.dispatchEvent(new Event("visibilitychange")); });
    await expect.poll(() => liveLoops(page)).toBe(0);
    await page.evaluate(() => { Object.defineProperty(document,"hidden",{configurable:true,value:false});document.dispatchEvent(new Event("visibilitychange")); });
    await expect.poll(() => liveLoops(page)).toBe(1);
    await page.evaluate(() => (window as any).autoAudio.settings({sound:false}));
    await expect.poll(() => liveLoops(page)).toBe(0);
    await page.locator("#select").click();
    expect(await liveLoops(page)).toBe(0);
    await page.evaluate(() => (window as any).autoAudio.settings({sound:true}));
    await expect.poll(() => liveLoops(page)).toBe(1);
    await page.evaluate(() => (window as any).autoAudio.enter("/"));
    await expect.poll(() => liveLoops(page)).toBe(0);
    await page.reload();
  });

  test("standalone games start music automatically and preserve an explicit mute", async ({ page }) => {
    await page.goto("/tests/fixtures/standalone-audio.html");
    await expect.poll(() => page.evaluate(() => (window as any).audioLoops.filter((e: any) => !e.ended).length)).toBe(1);
    await page.locator("#mute").click();
    await expect.poll(() => page.evaluate(() => (window as any).audioLoops.every((e: any) => e.ended))).toBe(true);
    await page.reload();
    await expect(page.locator("#mute")).toHaveAttribute("aria-pressed","false");
    expect(await page.evaluate(() => (window as any).audioLoops.length)).toBe(0);
  });

  for(const kind of ["baccarat","teen-patti-live","live"])
    test(`${kind} starts its recorded music on entry and stops on exit`, async ({ page }) => {
      const errors: string[] = [];page.on("pageerror",e=>errors.push(e.message));
      await page.goto(`/tests/fixtures/table-audio-autostart.html?kind=${kind}`);
      await expect.poll(() => musicPlaying(page)).toBe(true);
      if(kind === "teen-patti-live")await expect.poll(() => page.getByTestId("ambience").evaluate((el:HTMLAudioElement)=>!el.paused)).toBe(true);
      await page.getByRole("button",{name:"Sound",exact:true}).click();
      await expect.poll(() => musicPlaying(page)).toBe(false);
      await page.getByRole("button",{name:"Sound",exact:true}).click();
      await expect.poll(() => musicPlaying(page)).toBe(true);
      await page.evaluate(()=>{(window as any).oldMusic=document.querySelector('[data-testid="music"]');(window as any).stopTableAudio();});
      expect(await page.evaluate(()=>(window as any).oldMusic.paused)).toBe(true);
      expect(errors).toEqual([]);
    });

  test("sports commentary starts automatically",async({page})=>{
    await page.goto("/tests/fixtures/table-audio-autostart.html?kind=sports");
    await expect(page.getByTestId("voice")).toHaveAttribute("data-playing","true");
    await page.getByRole("button",{name:"Sound",exact:true}).click();
    await expect(page.getByTestId("voice")).toHaveAttribute("data-playing","false");
  });
});

test.describe("browser gesture fallback",()=>{
  test("a normal tap starts standalone music after a blocked automatic attempt",async({page})=>{
    await page.goto("/tests/fixtures/standalone-audio.html");
    await expect(page.locator("#cue")).toBeVisible();
    expect(await page.evaluate(() => (window as any).audioLoops.length)).toBe(0);
    await page.mouse.click(300,80);
    await expect.poll(() => page.evaluate(() => (window as any).audioLoops.filter((e: any) => !e.ended).length)).toBe(1);
  });
  test("a normal click starts shared music without placing a bet or pressing an audio button",async({page})=>{
    await page.goto("/tests/fixtures/game-audio.html?autostart=%2Fmines");
    // Ordinary Playwright evaluate calls grant a CDP user gesture, which can
    // release a pending Web Audio resume. Observe startup without granting one.
    const cdp = await page.context().newCDPSession(page);
    const read = async (expression: string) => (await cdp.send("Runtime.evaluate", { expression, returnByValue: true, userGesture: false })).result.value;
    await expect.poll(() => read("Boolean(window.autoAudio)"), { timeout: 15000 }).toBe(true);
    expect(await read("window.soundTest.events.filter(e => e.loop && !e.ended).length")).toBe(0);
    await page.mouse.click(300,80);
    await expect.poll(()=>liveLoops(page)).toBe(1);
  });
  for(const kind of ["baccarat","teen-patti-live","live","sports"])
    test(`${kind} retries blocked audio on a normal page tap`,async({page})=>{
      await page.goto(`/tests/fixtures/table-audio-autostart.html?kind=${kind}`);
      if(kind==="sports")await expect(page.getByTestId("voice")).toHaveAttribute("data-blocked","true");
      else await expect.poll(()=>musicPlaying(page)).toBe(false);
      await page.mouse.click(300,80);
      if(kind==="sports")await expect(page.getByTestId("voice")).toHaveAttribute("data-playing","true");
      else await expect.poll(()=>musicPlaying(page)).toBe(true);
    });
});
