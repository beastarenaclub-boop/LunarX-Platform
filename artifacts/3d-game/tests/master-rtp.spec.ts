import { test, expect, type Page } from "@playwright/test";
import { mockGames } from "./fixtures/compact-game-data";
const version="a".repeat(32);
async function setup(page:Page){
 await mockGames(page);
 await page.route("**/api/**",async route=>{
  const p=new URL(route.request().url()).pathname, now=Date.now(); let json:unknown;
  const config={enabled:true,houseEdge:.3,masterRtpBps:7000,pricingVersion:version,rtp:.7,version:4,maxMultiplier:100000,minStakePaise:"100",maxStakePaise:"5000000",bettingWindowMs:120000,revealDurationMs:5000,settleDurationMs:5000,coinPayoutVersion:1,sevenPayoutVersion:1,payoutVersion:2};
  if(p.includes("/wallet/"))json={balance:"10000000",currency:"INR"};
  else if(p.startsWith("/api/crash/"))json={id:"crash-test",gameCode:p.split('/')[3],phase:"betting",now,startsAt:now+120000,bettingMs:120000,multiplier:1,nextRoundAt:null,crashPoint:null,serverSeed:null,serverSeedHash:"hash",clientSeed:"client",nonce:0,version:3,bets:[],houseEdge:.3};
  else if(p==="/api/wingo/state" || p==="/api/wingo/session")json={serverTime:now,player:{id:"viewport-test",balance:10000000},round:{payoutVersion:4,period:"30-100",duration:30,start:now,ends:now+120000,commitment:"hash"},history:[],bets:[],summary:{played:0,won:0,profit:0},pending:0,lockSeconds:5,minStake:100,maxStake:5000000,masterRtpBps:7000,pricingVersion:version,returns:{red:1.4,green:1.4,big:1.4,small:1.4,violet:3.5,"0":7,"1":7,"2":7,"3":7,"4":7,"5":7,"6":7,"7":7,"8":7,"9":7}};
  else if(p==="/api/ludo/state")json={serverNow:now,balancePaise:"10000000",enabled:true,entries:[10000,50000,100000],commissionBps:3000,pricingVersion:version,match:null,recent:[]};
  else if(p.includes("/poker/")&&p.endsWith("/table"))json={enabled:true,serverNow:now,balancePaise:"10000000",masterRtpBps:7000,quoteId:"test",quotes:[{id:"p0-back",player:0,kind:"back",label:"Player A Winner",odds:140}],slips:[],recent:[],history:[],round:{id:1,game:"poker-20-20",phase:"betting",phaseEndsAt:now+120000,closesAt:now+120000,revealsAt:now+125000,endsAt:now+130000,commitment:"test",hands:[[null,null],[null,null]],board:[null,null,null,null,null]}};
  else if(p.endsWith("/history"))json=[];
  else if(p.endsWith("/config"))json={...config,multipliers:p.includes('/mines/')?Object.fromEntries(Array.from({length:24},(_,i)=>[i+1,Array(24-i).fill(.75)])):Object.fromEntries(["low","medium","high"].map(r=>[r,Object.fromEntries([8,12,16].map(n=>[n,Array(n+1).fill(.7)]))]))};
  else if(p.endsWith("/round"))json={roundId:"master-test",gameCode:p.split('/')[2],phase:"betting",now,bettingEndsAt:now+120000,revealEndsAt:now+125000,settleEndsAt:now+130000,serverSeedHash:"hash",clientSeed:"client",nonce:0,outcome:null,serverSeed:null,totalStake:"0",playerCount:0,config,liveBets:[],myBets:[],recent:[]};
  else if(p.endsWith('/state'))json={round:null,history:[]};
  else return route.fallback();
  await route.fulfill({json});
 });
}
for(const route of ["jetx","fury","mines","plinko","dice","lucky-7-live","wheel-2-live","coin-flip","7up7down","crazy-time","chicken-road","poker-20-20","wingo"]){
 test(`${route}: player sees 70% RTP on mobile`,async({page},info)=>{
  await setup(page);await page.setViewportSize({width:390,height:844});
  const errors:string[]=[];page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  await page.goto('/'+route);
  await expect(page.getByTestId('rtp-disclosure').first()).toBeVisible();
  await expect(page.getByTestId('rtp-disclosure').first()).toContainText('70.00');
  expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath(`${route}.png`)});
 });
}
test('master form saves 70% only for the selected master with revision',async({page})=>{
 const puts:any[]=[];
 await page.route('**/api/network/rtp**',async route=>{
  if(route.request().method()==='PUT'){puts.push({url:route.request().url(),body:route.request().postDataJSON()});return route.fulfill({json:{id:'a',name:'Master A',playerRtpBps:7000,revision:1}});}
  return route.fulfill({json:{games:['coin-flip','ludo','plinko'],masters:[{id:'a',name:'Master A',playerRtpBps:null,revision:0},{id:'b',name:'Master B',playerRtpBps:9000,revision:2}]}});
 });
 await page.goto('/tests/rtp-panel.html');
 await page.getByLabel('RTP policy for Master A').selectOption('master');
 await page.getByLabel('Player RTP for Master A').fill('70');
 const form=page.locator('form').filter({has:page.getByLabel('Player RTP for Master A')});
 await expect(form).toContainText('30.00%');await form.getByRole('button',{name:'Save RTP',exact:true}).click();
 await expect.poll(()=>puts.length).toBe(1);expect(puts[0].url).toContain('/rtp/a');expect(puts[0].body).toEqual({playerRtpBps:7000,revision:0});
 await expect(page.getByLabel('Player RTP for Master B')).toHaveValue('90');
});
test('Plinko submits reviewed pricing version and refreshes after stale rejection',async({page})=>{
 await setup(page);let body:any;
 await page.route('**/api/plinko/drop',async route=>{body=route.request().postDataJSON();await route.fulfill({status:409,json:{detail:'Payout rules changed. Review current rates.'}});});
 await page.goto('/plinko');await page.getByTestId('btn-plinko-drop').click();
 await expect.poll(()=>body?.pricingVersion).toBe(version);
 await expect(page.getByText('Payout rules changed. Review current rates.').first()).toBeVisible();
});

test('Ludo shows the master commission before joining',async({page},info)=>{
 await setup(page);await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>sessionStorage.setItem('ludo-menu:viewport-test',JSON.stringify({screen:'setup',mode:'online'})));
 await page.goto('/ludo');
 await expect(page.locator('.ld-fee')).toContainText('30.00%');
 await expect(page.locator('.ld-prize')).toContainText('140');
 await page.screenshot({path:info.outputPath('ludo.png')});
});
