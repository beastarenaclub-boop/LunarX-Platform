import { chromium, expect } from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

// Real compiled Unity rendering; only read-only match-clock responses are held
// at repeatable times. No wagers or wallet mutations are made by this review.
const base=process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5198';
const out=new URL('../../tmp/unity-sports/matchday/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
let elapsed=-16,phase='betting',goal=false;
const errors=[],failed=[],checks=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.url().includes('/unity-sports/')&&r.status()>=400)failed.push(r.url());});
  await page.route('**/api/virtual-sports/state',async route=>{
    try {
      const response=await route.fetch(),state=await response.json(),now=Date.now();
      const hold=r=>({...r,phase,starts:now-(elapsed+20)*1000,closes:now-elapsed*1000,ends:now+(45-elapsed)*1000,next:now+(55-elapsed)*1000,
        events:goal?[{at:13000,team:0,points:1,kind:'goal',text:'Goal',score:[1,0]}]:[],score:goal?[1,0]:[0,0],winner:phase==='result'?1:null});
      state.serverTime=now;state.rounds=state.rounds.map(hold);state.matches=state.matches?.map(hold);
      await route.fulfill({response,json:state});
    } catch(e) { if(!page.isClosed())throw e; }
  });
  await page.goto(base);
  const scene=page.getByTestId('sports-scene');
  await expect(scene).toHaveAttribute('data-renderer','unity-urp',{timeout:20000});
  await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
  const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
  await frame.evaluate(()=>{window.__matchdayInstance='retained';});
  const shot=async name=>{await page.waitForTimeout(1800);await scene.screenshot({path:new URL(name+'.png',out).pathname.replace(/^\/([A-Za-z]:)/,'$1')});};
  for(const [seconds,stage] of [[-16,'walkout'],[-9.5,'lineup'],[-4,'taking-positions'],[-.4,'kickoff'],[6,'live']]) {
    elapsed=seconds;phase=seconds<0?'betting':'live';
    await expect(scene).toHaveAttribute('data-presentation',stage,{timeout:15000});
    await expect(scene).toHaveAttribute('data-athletes','22');
    await expect(scene).toHaveAttribute('data-officials','3');
    await shot(stage);checks.push(stage);console.log('Match stage:',stage);
  }
  for(const [fixture,venue] of [['classic','Emerald Park'],['france-portugal','Grand Stade'],['england-spain','Crown Stadium'],['brazil-argentina','Estadio Arena']]) {
    await page.getByRole('combobox',{name:'Choose match'}).selectOption(fixture);
    await expect(scene).toHaveAttribute('data-venue',venue,{timeout:20000});
    await page.getByRole('combobox',{name:'Camera view'}).selectOption('sideline');
    await shot(fixture);checks.push(venue);
    expect(await frame.evaluate(()=>window.__matchdayInstance)).toBe('retained');
  }
  for(const camera of ['broadcast','cinematic','overhead','player','stadium']) {
    await page.getByRole('combobox',{name:'Camera view'}).selectOption(camera);
    if(camera==='player')await page.getByRole('combobox',{name:'Player to follow'}).selectOption('9');
    await shot(camera);checks.push(camera);
  }
  elapsed=14.2;goal=true;
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('broadcast');
  await expect(scene).toHaveAttribute('data-presentation','goal-replay',{timeout:15000});
  await expect(page.locator('.vs-goal-replay-label')).toBeVisible();await shot('goal-replay');
  phase='result';elapsed=45;goal=false;
  await expect(scene).toHaveAttribute('data-presentation','full-time',{timeout:15000});await shot('full-time');
  phase='betting';elapsed=-16;
  await expect(scene).toHaveAttribute('data-presentation','walkout',{timeout:15000});checks.push('next-round-reset');
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('balanced');
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await shot('mobile-'+width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await writeFile(new URL('report.json',out),JSON.stringify({checks,errors,failed},null,2));
  expect(errors).toEqual([]);expect(failed).toEqual([]);
  console.log('PASS: actual Unity entry, lineup, kickoff, 4 venues, cameras, replay, round reset and mobile layouts.');
} finally {await browser.close();}
