import { test, expect, type Page } from "@playwright/test";
import { collectionMultiplier, collectionPayout, towerPayout, type CollectionRound } from "@workspace/api-zod/instant-collection";
import { mockGames } from "./fixtures/compact-game-data";

// Record short animation states in the page so slow test-runner round trips
// cannot miss a two-second notice or the 820ms control lock.
async function recordTowerTransitions(page: Page) {
  await page.evaluate(() => {
    const state = { notices: [] as string[], lockedDrop: false, fall: false };
    (window as any).__towerTransitions = state;
    new MutationObserver(() => {
      const notice = document.querySelector('[data-testid="tower-level-up"]')?.textContent;
      if (notice && !state.notices.includes(notice)) state.notices.push(notice);
      const phase = document.querySelector('[data-testid="tower-scene"]')?.getAttribute('data-phase');
      const play = document.querySelector<HTMLButtonElement>('[data-testid="collection-play"]');
      const cashout = document.querySelector<HTMLButtonElement>('[data-testid="collection-cashout"]');
      if (phase === 'drop' && play?.disabled && cashout?.disabled) state.lockedDrop = true;
      if (phase === 'fall') state.fall = true;
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
}

async function tower(page: Page, options: { version?: 1 | 2 | 3 | 4; resumeStep?: number; loseAt?: number; dropPlace?: boolean; dropMove?: boolean; delay?: number; rtp?: number; cap?: number } = {}) {
  await mockGames(page);
  let balance = 1000000n, round: CollectionRound | null = null, dropped = false;
  let configRtp = options.rtp ?? .97;
  const posts: { path: string; input: any }[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/reports/gameresults?**", route => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/wallet/balance?**", route => route.fulfill({ json: { balance: balance.toString(), currency: "INR", scope: "lunar", walletId: "shared" } }));
  await page.route("**/api/instant/tower-rush/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/config")) return route.fulfill({ json: { towerPayoutVersion: options.version ?? 1, enabled: true, minStakePaise: "100", maxStakePaise: "1000000", rtp: configRtp, maxMultiplier: options.cap ?? (options.version === 4 ? 1.9 : 1000) } });
    if (path.endsWith("/state")) return route.fulfill({ json: { round: round?.status === "active" ? round : null, history: round ? [round] : [] } });
    const input = route.request().postDataJSON(); posts.push({ path, input });
    if (path.endsWith("/place")) {
      if (round?.requestId !== input.requestId) {
        balance -= BigInt(input.stakeAmount);
        round = { towerPayoutVersion: options.version ?? 1, id: `tower-${posts.length}`, gameCode: "tower-rush", requestId: input.requestId, status: "active", stakeAmount: input.stakeAmount, payoutAmount: "0", cashoutAmount: input.stakeAmount, multiplier: 1, step: 0, options: input.options, revealed: [], hazards: null, outcome: [], serverSeedHash: "commitment", serverSeed: null, clientSeed: input.clientSeed, createdAt: new Date().toISOString(), rtp: configRtp, maxMultiplier: options.cap ?? (options.version === 4 ? 1.9 : 1000) };
        if (options.resumeStep) round.step = options.resumeStep;
      }
      if (options.dropPlace && !dropped) { dropped = true; return route.abort("connectionreset"); }
    } else if (round?.status === "active") {
      expect(input.expectedStep).toBe(round.step);
      if (input.action === "reveal") {
        expect(input.cell).toBe(0);
        round.revealed.push(input.cell);
        if ((options.loseAt ?? (options.version === 2 ? 35 : -1)) === round.step + 1) round.status = "lost";
        else {
          round.step++;
          round.multiplier = collectionMultiplier("tower", round.step, round.options, round.rtp, round.maxMultiplier, round.towerPayoutVersion);
          round.cashoutAmount = towerPayout(BigInt(round.stakeAmount), round.multiplier, round.towerPayoutVersion).toString();
        }
      } else round.status = "cashed_out";
      if (round.status !== "active") {
        round.serverSeed = "revealed-seed";
        round.payoutAmount = round.status === "lost" ? "0" : round.cashoutAmount;
        balance += BigInt(round.payoutAmount);
      }
      if (options.dropMove && !dropped) { dropped = true; return route.abort("connectionreset"); }
    }
    if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay));
    return route.fulfill({ json: round });
  });
  await page.goto("/tower-rush");
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  return { posts, errors, get balance() { return balance; }, setRtp(value: number) { configRtp = value; } };
}

test("v4 five-floor level-up offers 150 rupees and credits the same amount", async ({page},testInfo) => {
  const f=await tower(page,{version:4,resumeStep:4});
  await recordTowerTransitions(page);
  await page.getByRole('textbox',{name:'Bet amount'}).fill('100');
  await expect(page.getByTestId('tower-payout-ladder')).toContainText('150.00');
  await expect(page.getByTestId('tower-payout-ladder')).toContainText('190.00');
  await page.getByTestId('collection-play').click();
  expect(f.posts[0].input.towerPayoutVersion).toBe(4);
  await page.getByTestId('collection-play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__towerTransitions.notices.join(' '))).toContain('150.00 TOTAL RETURN');
  await expect(page.getByTestId('collection-cashout')).toContainText('150.00');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:testInfo.outputPath('floor-five-150.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.reload();await expect(page.getByTestId('collection-cashout')).toContainText('150.00');
  await page.getByTestId('collection-cashout').click();
  await expect(page.getByTestId('collection-result')).toContainText('150.00');
  expect(f.balance).toBe(1005000n);expect(f.errors).toEqual([]);
});

test("v4 pauses auto at the 190-rupee plateau but still permits more floors", async ({page}) => {
  const f=await tower(page,{version:4,resumeStep:24});
  await page.getByTestId('collection-play').click();
  await page.getByRole('checkbox',{name:/Auto build/}).check();
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','25');
  await expect(page.getByTestId('collection-cashout')).toContainText('190.00');
  await expect(page.getByRole('checkbox',{name:/Auto build/})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:/Auto build/})).toBeDisabled();
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','26');
  await expect(page.getByTestId('collection-cashout')).toContainText('190.00');
  await page.getByTestId('collection-cashout').click();
  expect(f.balance).toBe(1009000n);expect(f.errors).toEqual([]);
});

test("level-up visuals appear at five floors, keep cash-out available and do not replay on reload", async ({ page }, testInfo) => {
  const f = await tower(page, {version:3,resumeStep:4});
  await recordTowerTransitions(page);
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('tower-level-effects')).toHaveCount(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByTestId('collection-play').click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__towerTransitions.notices.join(' '))).toContain('FLOOR 5');
  await expect(page.getByTestId('tower-level-effects')).toHaveAttribute('data-tier','1');
  await expect(page.getByTestId('collection-cashout')).toBeEnabled();
  await page.setViewportSize({width:390,height:844});
  await page.getByTestId('tower-scene').locator('..').screenshot({path:testInfo.outputPath('level-up-mobile.png')});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.reload();
  await expect(page.getByTestId('tower-level-effects')).toHaveAttribute('data-tier','1');
  await expect(page.getByTestId('tower-level-up')).toHaveCount(0);
  await page.getByTestId('collection-cashout').click();
  await expect(page.getByTestId('collection-result')).toContainText('Returned to your wallet');
  await expect(page.getByTestId('tower-level-effects')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("v3 has no floor limit, builds past 35 and restores a cashable round", async ({ page }) => {
  const f = await tower(page, {version:3,resumeStep:34});
  await expect(page.locator('.tr-guide')).toContainText('Every floor can fall');
  await expect(page.locator('.tr-floor-track')).toHaveAttribute('aria-label', /no final floor/);
  await page.getByTestId('collection-play').click();
  expect(f.posts[0].input.towerPayoutVersion).toBe(3);
  for (let step=35;step<=37;step++) {
    await page.getByTestId('collection-play').click();
    await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step',String(step));
  }
  await expect(page.getByText('Floor 35 always falls', {exact:false})).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','37');
  await expect(page.locator('.tr-score strong')).toContainText('1.241');
  await page.getByTestId('collection-cashout').click();
  await expect(page.getByTestId('collection-result')).toContainText('Returned to your wallet');
  expect(f.posts.filter(p=>p.input.action==='cashout')).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("v3 can fall on the first build and explains the new rules", async ({page}) => {
  const f=await tower(page,{version:3,loseAt:1});
  await expect(page.locator('.tr-score strong')).toContainText('0.001');
  await page.getByRole('button',{name:'Game rules',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('No floors are guaranteed safe');
  await expect(page.getByRole('dialog')).toContainText('no maximum floor');
  await page.keyboard.press('Escape');
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('collection-result')).toContainText('No return this round');
  expect(f.posts.filter(p=>p.path.endsWith('/place'))).toHaveLength(1);
  expect(f.balance).toBe(990000n);
  expect(f.errors).toEqual([]);
});

test("high tower fractures, falls to the street and keeps rubble until a new round", async ({ page }, testInfo) => {
  const f = await tower(page, {version:2,resumeStep:30,loseAt:31});
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','30');
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-renderer','webgl',{timeout:45000});
  await page.emulateMedia({reducedMotion:'no-preference'});
  const canvas=page.locator('.tr-3d-canvas');
  await expect.poll(()=>canvas.getAttribute('data-camera-lift')).not.toBe('0.000');
  await page.evaluate(()=>{
    (window as any).fallSamples=[];
    (window as any).fallTimer=setInterval(()=>{const el=document.querySelector('.tr-3d-canvas') as HTMLElement;(window as any).fallSamples.push({...el.dataset});},30);
  });
  await page.getByTestId('collection-play').click();
  await expect(canvas).toHaveAttribute('data-collapse-phase','falling');
  await expect(page.getByTestId('collection-play')).toBeDisabled();
  await page.getByTestId('tower-scene').screenshot({path:testInfo.outputPath('falling.png')});
  await expect(canvas).toHaveAttribute('data-collapse-phase','settled');
  await expect(canvas).toHaveAttribute('data-debris-count','22');
  await expect(canvas).toHaveAttribute('data-camera-lift','0.000');
  await page.getByTestId('tower-scene').screenshot({path:testInfo.outputPath('rubble.png')});
  const samples=await page.evaluate(()=>{clearInterval((window as any).fallTimer);return (window as any).fallSamples;});
  expect(samples.some((s:any)=>s.collapsePhase==='falling'&&Number(s.debrisMinY)>20&&Number(s.fallStartY)>50)).toBe(true);
  expect(samples.some((s:any)=>s.collapsePhase==='impact'&&Number(s.debrisMaxY)<2)).toBe(true);
  await page.waitForTimeout(1500);
  await expect(canvas).toHaveAttribute('data-debris-count','22');
  await page.reload();
  await expect(canvas).toHaveAttribute('data-collapse-phase','settled',{timeout:45000});
  await expect(canvas).toHaveAttribute('data-debris-count','22');
  await page.setViewportSize({width:390,height:844});
  await expect(canvas).toHaveAttribute('data-camera-lift','0.000');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByTestId('tower-scene').screenshot({path:testInfo.outputPath('mobile-rubble.png')});
  await page.emulateMedia({reducedMotion:'reduce'});
  await canvas.evaluate(el=>(el as HTMLCanvasElement).getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext());
  await expect(page.getByTestId('tower-fallback-debris')).toHaveCount(10);
  await expect(page.getByTestId('tower-fallback-scene')).toHaveAttribute('data-collapse-phase','settled');
  await page.getByTestId('tower-scene').screenshot({path:testInfo.outputPath('fallback-rubble.png')});
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('tower-fallback-debris')).toHaveCount(0);
  expect(f.errors).toEqual([]);
});

test("BUILD drops one block, restores the tower and cashes out exactly once", async ({ page }) => {
  const f = await tower(page, { delay: 120 });
  await page.getByRole("textbox", { name: "Bet amount" }).fill("123.45");
  await page.getByTestId("collection-play").dblclick({ delay: 30 });
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  expect(f.posts).toHaveLength(2);
  for (let step = 2; step <= 4; step++) {
    await page.getByTestId("collection-play").click();
    await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", String(step));
  }
  await page.reload();
  await expect(page.getByTestId("tower-floor")).toHaveCount(4);
  await expect(page.getByRole("textbox", { name: "Bet amount" })).toHaveValue("123.45");
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).not.toBeChecked();
  const count = f.posts.length;
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.posts.length).toBe(count + 1);
  expect(f.balance).toBe(987655n + collectionPayout(12345n, collectionMultiplier("tower", 4, { difficulty: "easy", mines: 3, choice: "heads" })));
  expect(f.errors).toEqual([]);
});

test("v2 displays .001x and ten-paise cash-out, with clear rules and no mobile overflow", async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  const f=await tower(page,{version:2});
  await expect(page.locator('.tr-score')).toContainText('0.001');
  await page.getByTestId('collection-play').click();
  await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','1');
  await expect(page.getByTestId('collection-cashout')).toContainText('0.10');
  expect(f.posts.find(p=>p.path.endsWith('/place'))?.input.towerPayoutVersion).toBe(2);
  await page.getByRole('button',{name:'Game rules',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('Floors 1–19 are guaranteed safe');
  await expect(page.getByRole('dialog')).toContainText('0.001×');
  await page.keyboard.press('Escape');
  await page.getByTestId('collection-cashout').click();
  await expect(page.locator('.tr-result-card')).toContainText('0.10');
  expect(f.balance).toBe(990010n);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  expect(f.errors).toEqual([]);
});

test("v2 reaches 1x at floor 30, restores after reload and crashes on its fixed floor 35", async ({ page }) => {
  const f=await tower(page,{version:2,loseAt:35});
  for(let floor=1;floor<=34;floor++) {
    await page.getByTestId('collection-play').click();
    await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step',String(floor));
    if(floor===19) await expect(page.locator('.tr-score')).toContainText('0.621');
    if(floor===30) {
      await expect(page.locator('.tr-score')).toContainText('1.000');
      await expect(page.getByTestId('collection-cashout')).toContainText('100.00');
      await page.reload();
      await expect(page.getByTestId('tower-scene')).toHaveAttribute('data-step','30');
      await expect(page.locator('.tr-score')).toContainText('1.000');
    }
  }
  await expect(page.getByRole('checkbox',{name:/Auto build/})).toBeDisabled();
  await expect(page.locator('.tr-page')).toContainText('Floor 35 always falls');
  await page.getByTestId('collection-play').click();
  await expect(page.locator('.tr-result-card')).toContainText('TOWER FELL');
  expect(f.balance).toBe(990000n);
  expect(f.posts.filter(p=>p.path.endsWith('/place'))).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("block landing and failure animate while controls are locked", async ({ page }) => {
  const f = await tower(page, { loseAt: 2 });
  await recordTowerTransitions(page);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByTestId("collection-play").click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__towerTransitions.lockedDrop)).toBe(true);
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  await page.getByTestId("collection-play").click();
  await expect.poll(()=>page.evaluate(()=>(window as any).__towerTransitions.fall)).toBe(true);
  await expect(page.locator(".tr-result-loss")).toContainText("TOWER FELL");
  await expect(page.getByTestId("collection-cashout")).toBeDisabled();
  expect(f.balance).toBe(990000n);
  expect(f.errors).toEqual([]);
});

test("auto build continues beyond ten floors on the same stake until cash-out", async ({ page }) => {
  const f = await tower(page);
  await page.getByRole("checkbox", { name: /Auto build/ }).check();
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "12", { timeout: 45000 });
  await page.getByTestId("collection-cashout").click();
  await expect(page.locator(".tr-result-card")).toContainText("SUCCESSFULLY COLLECTED");
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).not.toBeChecked();
  await page.waitForTimeout(2000);
  expect(f.posts.filter(p => p.path.endsWith("/place"))).toHaveLength(1);
  expect(f.posts.filter(p => p.input.action === "reveal")).toHaveLength(12);
  expect(f.balance).toBeGreaterThan(1000000n);
});

test("auto build stops on loss and tab exit", async ({ page }) => {
  const f = await tower(page, { loseAt: 3 });
  await page.getByRole("checkbox", { name: /Auto build/ }).check();
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).not.toBeChecked();
  await page.waitForTimeout(1900);
  expect(f.posts).toHaveLength(2);
  await page.getByRole("checkbox", { name: /Auto build/ }).check();
  await expect(page.locator(".tr-result-loss")).toBeVisible();
  await page.waitForTimeout(1900);
  expect(f.posts).toHaveLength(4);
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).not.toBeChecked();
});

test("lost placement response recovers the same stake without an automatic reveal", async ({ page }) => {
  const f = await tower(page, { dropPlace: true });
  await page.getByTestId("collection-play").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  await page.reload();
  await expect(page.getByTestId("collection-play")).toBeEnabled();
  expect(f.posts).toHaveLength(1);
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-play")).not.toContainText("RECOVER");
  expect(f.posts).toHaveLength(2);
  expect(f.posts[1].input.requestId).toBe(f.posts[0].input.requestId);
  expect(f.posts.some(p => p.input.action === "reveal")).toBe(false);
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.posts.filter(p => p.path.endsWith("/place"))).toHaveLength(2);
  expect(f.balance).toBe(1000000n);
});

test("lost move reply restores the confirmed floor and pauses auto play", async ({ page }) => {
  const f = await tower(page, { dropMove: true });
  await page.getByRole("checkbox", { name: /Auto build/ }).check();
  await page.getByTestId("collection-play").click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).not.toBeChecked();
  await page.waitForTimeout(1900);
  expect(f.posts).toHaveLength(2);
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("145.00");
});

test("active round retains the admin RTP snapshot and payout cap", async ({ page }) => {
  const f = await tower(page, { rtp: .85, cap: 2 });
  await expect(page.locator(".tr-score")).toContainText("1.27");
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-cashout")).toContainText("127.00");
  f.setRtp(.50);
  await page.reload();
  await expect(page.locator(".tr-score")).toContainText("1.91");
  await page.getByTestId("collection-play").click();
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("collection-cashout")).toContainText("200.00");
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("200.00");
});

test("reference scene and controls fit mobile, desktop and landscape", async ({ page }) => {
  const f = await tower(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: "../../tmp/tower-reference/desktop-ready.png", fullPage: true });
  for (let i = 1; i <= 5; i++) {
    await page.getByTestId("collection-play").click();
    await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", String(i));
  }
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("collection-play")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const scene = await page.getByTestId("tower-scene").boundingBox();
    expect(scene!.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `../../tmp/tower-reference/layout-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Game rules", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("no final floor");
  await expect(page.getByRole("dialog")).toContainText("timing the crane is visual only");
  expect(f.errors).toEqual([]);
});

test("GPU scene renders textured floors, follows the tower and keeps draw calls bounded", async ({ page }) => {
  test.setTimeout(90000);
  const f = await tower(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 45000 });
  await page.screenshot({ path: "../../tmp/tower-reference/3d-desktop-ready.png", fullPage: true });
  for (let step = 1; step <= 6; step++) {
    await page.getByTestId("collection-play").click();
    await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", String(step));
  }
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(page.locator(".tr-3d-canvas")).toHaveAttribute("data-draw-calls", /\d+/, { timeout: 10000 });
  await expect(page.locator(".tr-3d-canvas")).toHaveAttribute("data-art-style", "runway-reference-v4");
  const stats = await page.locator(".tr-3d-canvas").evaluate(el => ({ calls: Number((el as HTMLElement).dataset.drawCalls), triangles: Number((el as HTMLElement).dataset.triangles), fps: Number((el as HTMLElement).dataset.fps) }));
  expect(stats.calls).toBeLessThan(180);
  expect(stats.triangles).toBeLessThan(60000);
  console.log("Tower WebGL metrics", stats);
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 740], [844, 390]]) {
    await page.setViewportSize({ width, height });
    await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl");
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `../../tmp/tower-reference/3d-layout-${width}.png`, fullPage: true });
  }
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.errors).toEqual([]);
});

test("GPU context loss falls back without losing the active round", async ({ page }) => {
  const f = await tower(page);
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 45000 });
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  await page.locator(".tr-3d-canvas").evaluate(el => {
    const context = (el as HTMLCanvasElement).getContext("webgl2");
    const extension = context?.getExtension("WEBGL_lose_context");
    if (!extension) throw new Error("Test browser cannot simulate context loss");
    extension.loseContext();
  });
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "fallback");
  await expect(page.getByTestId("tower-fallback-scene")).toBeVisible();
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.errors).toEqual([]);
});


test("unlimited floors survive reload, stay bounded and can cash out beyond the old API limit", async ({ page }) => {
  const f = await tower(page);
  for (let step = 1; step <= 30; step++) {
    await page.getByTestId("collection-play").click();
    await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", String(step));
  }
  await expect(page.locator(".tr-cap-note")).toContainText("Maximum return");
  await expect(page.getByRole("checkbox", { name: /Auto build/ })).toBeDisabled();
  await page.reload();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "30");
  await expect(page.getByTestId("tower-floor")).toHaveCount(12);
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 45000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "../../tmp/tower-reference/endless-floor-30.png", fullPage: true });
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  expect(f.posts.filter(p => p.path.endsWith("/place"))).toHaveLength(1);
  expect(f.errors).toEqual([]);
});

test("animation control overrides reduced motion explicitly and persists", async ({ page }) => {
  const f = await tower(page);
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 45000 });
  await page.getByRole("button", { name: "Enable animations", exact: true }).click();
  await page.waitForTimeout(400);
  const canvas = page.locator(".tr-3d-canvas");
  const moving = await canvas.screenshot();
  await page.waitForTimeout(600);
  expect(Buffer.compare(moving, await canvas.screenshot())).not.toBe(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Pause animations", exact: true })).toBeVisible();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-renderer", "webgl", { timeout: 45000 });
  await page.getByRole("button", { name: "Pause animations", exact: true }).click();
  await page.waitForTimeout(400);
  const paused = await canvas.screenshot();
  await page.waitForTimeout(600);
  const still = await canvas.screenshot();
  // Composited transparent pixels can differ by one colour level in Chrome.
  // Compare decoded pixels, rather than PNG compression bytes.
  const maxChange = await page.evaluate(async ([before, after]) => {
    const pixels = async (base64: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode();
      const surface = document.createElement("canvas"); surface.width = image.width; surface.height = image.height;
      const ctx = surface.getContext("2d")!; ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, surface.width, surface.height).data;
    };
    const [a, b] = await Promise.all([pixels(before), pixels(after)]);
    if (a.length !== b.length) return 255;
    return a.reduce((max, value, index) => Math.max(max, Math.abs(value - b[index])), 0);
  }, [paused.toString("base64"), still.toString("base64")]);
  expect(maxChange).toBeLessThanOrEqual(1);
  expect(f.errors).toEqual([]);
});

test("confirmed extra floors reuse receipts without refetching wallet and state", async ({ page }) => {
  const f = await tower(page);
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "1");
  await page.waitForTimeout(400);
  const reads: string[] = [];
  page.on("request", request => { if (request.method() === "GET" && /\/instant\/tower-rush\/state|\/wallet\/balance/.test(request.url())) reads.push(request.url()); });
  await page.getByTestId("collection-play").click();
  await expect(page.getByTestId("tower-scene")).toHaveAttribute("data-step", "2");
  await page.waitForTimeout(400);
  expect(reads).toEqual([]);
  await page.getByTestId("collection-cashout").click();
  await expect(page.getByTestId("collection-result")).toContainText("Returned to your wallet");
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  expect(f.errors).toEqual([]);
});
