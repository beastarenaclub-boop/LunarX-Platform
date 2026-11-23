import {test, expect, type Page} from "@playwright/test";
import {mockGames} from "./fixtures/compact-game-data";

type Receipt = {id:string; panel:number; stakeAmount:string; status:string; multiplier:number|null; payoutAmount:string};
async function rounds(page:Page) {
  await mockGames(page);
  await page.setViewportSize({width:390,height:844});
  const state = {phase:"flying", id:"crash-first", stall:false, fail:false, posts:[] as {panel:number;stakeAmount:string;roundId:string}[], receipts:[] as Receipt[]};
  await page.route("**/api/crash/**", async route => {
    if (state.stall) return;
    if (state.fail) return route.fulfill({status:503,json:{message:"Temporary network failure"}});
    const now=Date.now();
    await route.fulfill({json:{id:state.id,gameCode:"lunar",phase:state.phase,now,
      startsAt:state.phase === "betting" ? now+20000 : now-Math.log(1.5)*10000,
      bettingMs:20000,multiplier:state.phase === "betting" ? 1 : 1.5,
      nextRoundAt:state.phase === "crashed" ? now+300 : null,
      crashPoint:state.phase === "crashed" ? 1.5 : null,
      serverSeed:state.phase === "crashed" ? "revealed" : null,
      serverSeedHash:"committed",clientSeed:"test",nonce:0,version:3,bets:state.receipts}});
  });
  await page.route("**/api/bets/place", async route => {
    const body=route.request().postDataJSON();state.posts.push(body);
    const receipt={id:`accepted-${state.posts.length}`,panel:body.panel,stakeAmount:body.stakeAmount,status:"placed",multiplier:null,payoutAmount:"0"};
    state.receipts.push(receipt);
    await route.fulfill({json:receipt});
  });
  return state;
}

test("mobile next-round taps queue once, cancel independently and place only in the next betting window", async ({page},info)=>{
  const state=await rounds(page);
  await page.goto("/aviator-pro");
  await expect(page.getByTestId("btn-bet-0")).toContainText("Next round");
  await page.getByTestId("input-amount-0").fill("125");
  await page.getByTestId("btn-bet-0").click();
  await page.getByTestId("btn-bet-1").click();
  await expect(page.getByTestId("btn-cancel-queue-0")).toContainText("125.00");
  await expect(page.getByTestId("btn-cancel-queue-0")).toContainText("Not charged yet");
  await page.getByTestId("btn-cancel-queue-1").click();
  expect(state.posts).toHaveLength(0);
  state.phase="crashed";
  await expect(page.getByTestId("text-crash-multiplier")).toHaveText("1.50x");
  state.id="crash-second";state.phase="betting";
  await expect.poll(()=>state.posts.length).toBe(1);
  expect(state.posts[0]).toMatchObject({panel:0,stakeAmount:"12500",roundId:"crash-second"});
  await expect(page.getByTestId("aviator-countdown")).toContainText("Place your bets");
  await expect(page.getByTestId("bet-accepted-0")).toContainText("Bet placed");
  await expect(page.getByTestId("btn-bet-1")).toBeEnabled();
  await page.screenshot({path:info.outputPath("portrait-betting.png")});
  state.phase="flying";
  await expect(page.getByTestId("btn-cashout-0")).toBeEnabled();
  await page.waitForTimeout(800);
  expect(state.posts).toHaveLength(1);
  await page.setViewportSize({width:844,height:390});
  const canvas=page.getByTestId("aviator-canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(()=>canvas.evaluate(el=>el.clientWidth)).toBeGreaterThan(390);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator(".animate-sunburst")).toHaveCSS("width", /px$/);
  await page.screenshot({path:info.outputPath("landscape-flight.png")});
});

test("stalled snapshots hold the confirmed multiplier, report reconnecting and recover after timeout", async ({page})=>{
  const state=await rounds(page);
  await page.goto("/aviator-pro");
  await expect(page.getByTestId("text-multiplier")).toHaveText("1.50x");
  state.stall=true;
  await expect(page.getByText("Reconnecting… showing the last confirmed value")).toBeVisible({timeout:5000});
  await expect(page.getByTestId("text-multiplier")).toHaveText("1.50x");
  await expect(page.getByTestId("btn-bet-0")).toBeDisabled();
  state.stall=false;state.phase="crashed";
  await expect(page.getByTestId("text-crash-multiplier")).toHaveText("1.50x",{timeout:12000});
});

test("failed initial connection has a clear state and queue does not survive reload", async ({page})=>{
  const state=await rounds(page);state.fail=true;
  await page.goto("/aviator-pro");
  await expect(page.getByText("Connecting to next round…")).toBeVisible();
  await expect(page.getByTestId("text-crash-multiplier")).toHaveCount(0);
  state.fail=false;
  await expect(page.getByTestId("btn-bet-0")).toBeEnabled();
  await page.getByTestId("btn-bet-0").click();
  await expect(page.getByTestId("btn-cancel-queue-0")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("btn-bet-0")).toBeEnabled();
  await expect(page.getByTestId("btn-cancel-queue-0")).toHaveCount(0);
  expect(state.posts).toHaveLength(0);
});

test("a late placement response cannot restore cashout after the round crashes", async ({page})=>{
  const state=await rounds(page);state.phase="betting";
  let release:()=>void=()=>{};
  const gate=new Promise<void>(resolve=>{release=resolve;});
  let requested=false;
  await page.route("**/api/bets/place",async route=>{
    requested=true;await gate;
    await route.fulfill({json:{id:"late",panel:0,stakeAmount:"1000",status:"placed",payoutAmount:"0"}});
  });
  await page.goto("/aviator-pro");
  await page.getByTestId("btn-bet-0").click();
  await expect.poll(()=>requested).toBe(true);
  await expect(page.getByTestId("bet-accepted-0")).toContainText("Placing bet");
  state.phase="crashed";
  await expect(page.getByTestId("text-crash-multiplier")).toBeVisible();
  release();
  await expect(page.getByTestId("bet-accepted-0")).toHaveCount(0);
  await expect(page.getByTestId("btn-cashout-0")).toHaveCount(0);
});
