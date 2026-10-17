import { chromium, expect } from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Exercise the compiled WebGL player. Only GET match clocks are controlled.
const output=new URL('../../tmp/unity-sports/cricket-review/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
let elapsed=0,phase='betting',secondInnings=false;
const errors=[],failed=[],checks=[];
try {
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  page.on('response',r=>{if(r.url().includes('/unity-sports/')&&r.status()>=400)failed.push(r.url());});
  const base=process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5198';
  const baseline=await (await page.request.get(base+'/api/virtual-sports/state')).json();
  await page.route('**/api/virtual-sports/state',async route=>{
    const s=structuredClone(baseline),now=Date.now();
    const hold=r=>({...r,phase,starts:now-(elapsed+20)*1000,closes:now-elapsed*1000,ends:now+(45-elapsed)*1000,next:now+(55-elapsed)*1000,
      events:secondInnings&&r.sport==='cricket'?Array.from({length:6},(_,i)=>({at:(i+1)*3500,team:0,points:0,kind:'delivery',text:'Dot ball',score:[0,0]})):[],score:[0,0],winner:null});
    s.serverTime=now;s.rounds=s.rounds.map(hold);s.matches=s.matches?.map(hold);
    await route.fulfill({json:s});
  });
  await page.goto(base+'/?sport=cricket');
  const scene=page.getByTestId('sports-scene');
  await page.getByRole('tab',{name:/Cricket/}).click();
  await expect(scene).toHaveAttribute('data-renderer','unity-urp',{timeout:25000});
  await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
  await expect(scene).toHaveAttribute('data-athletes','13');
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('high');
  const shot=async name=>{
    await scene.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2300);
    await scene.screenshot({path:fileURLToPath(new URL(name+'.png',output))});
    checks.push(name);console.log('Captured actual Unity:',name);
  };
  for(const camera of ['broadcast','cinematic','player','sideline','overhead','stadium']) {
    await page.getByRole('combobox',{name:'Camera view'}).selectOption(camera);
    if(camera==='player') {
      await page.getByRole('combobox',{name:'Player to follow'}).selectOption('0');
      await page.getByRole('slider',{name:'Camera angle'}).fill('235');
    }
    await shot(camera);
  }
  phase='live';elapsed=1.2;
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('broadcast');await shot('bowling');
  elapsed=1.95;
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('cinematic');await shot('batting');
  secondInnings=true;elapsed=23.4;
  await page.getByRole('combobox',{name:'Player to follow'}).selectOption('0');
  await expect(page.locator('.vs-match-clock')).toHaveText('2nd innings',{timeout:15000});
  await expect(page.locator('.vs-player-caption')).toContainText('Pakistan');await shot('second-innings');
  for(const quality of ['auto','balanced']) {
    await page.getByRole('combobox',{name:'Graphics quality'}).selectOption(quality);await shot(quality);
  }
  for(const width of [390,320]) {
    await page.setViewportSize({width,height:844});await shot('mobile-'+width);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await page.setViewportSize({width:1440,height:1050});
  await page.getByRole('tab',{name:/Football/}).click();
  await expect(scene).toHaveAttribute('data-athletes','22',{timeout:30000});
  await page.getByRole('tab',{name:/Cricket/}).click();
  await expect(scene).toHaveAttribute('data-athletes','13',{timeout:30000});
  await shot('reloaded-cricket');
  const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
  const metrics=await frame.evaluate(()=>window.arenaMetrics);
  await writeFile(new URL('report.json',output),JSON.stringify({checks,errors,failed,metrics},null,2));
  expect(errors).toEqual([]);expect(failed).toEqual([]);
  console.log('PASS: cricket WebGL cameras, live motion, innings switch, quality modes, mobile and venue reload.',JSON.stringify(metrics));
} finally {await browser.close();}
