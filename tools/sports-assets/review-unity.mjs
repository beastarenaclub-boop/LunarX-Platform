import { chromium, expect } from "../../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import { mkdir, writeFile } from "node:fs/promises";

// Real Unity WebGL rendering. Only the GET round clock is held in live play
// for repeatable screenshots; no bets, wallet writes or mocked engine are used.
const base=process.env.UNITY_REVIEW_URL??"http://127.0.0.1:5199";
const output=new URL("../../tmp/unity-sports/review/",import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",
  args:["--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader"]});
const errors=[],failed=[];
let secondInnings=false;
const clockAnchor=Date.now()-17000;
try{
  const page=await browser.newPage({viewport:{width:1440,height:1050}});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  page.on("response",r=>{if(r.url().includes('/unity-sports/')&&r.status()>=400)failed.push({url:r.url(),status:r.status()});});
  await page.route('**/api/virtual-sports/state',async route=>{
    const response=await route.fetch();const state=await response.json();const now=Date.now();
    const elapsed=(now-clockAnchor)%45000;
    const hold=r=>({...r,phase:'live',starts:now-elapsed-20000,closes:now-elapsed,ends:now-elapsed+45000,next:now-elapsed+55000,events:secondInnings&&r.sport==='cricket'?Array.from({length:6},(_,i)=>({at:(i+1)*3500,team:0,points:0,kind:'delivery',text:'Dot ball',score:[0,0]})):[],score:[0,0],winner:null});
    state.serverTime=now;state.rounds=state.rounds.map(hold);state.matches=state.matches?.map(hold);
    await route.fulfill({response,json:state});
  });
  await page.goto(base);
  const scene=page.getByTestId('sports-scene');
  await expect(scene).toHaveAttribute('data-renderer','unity-urp',{timeout:20000});
  await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
  await expect(page.getByRole('combobox',{name:'Choose match'})).toHaveValue('brazil-argentina');
  for(const camera of ['broadcast','cinematic','overhead','player','sideline','stadium']){
    await page.getByRole('combobox',{name:'Camera view'}).selectOption(camera);
    await page.waitForTimeout(3500);
    await scene.screenshot({path:new URL('football-'+camera+'.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  }
  await page.getByRole('combobox',{name:'Choose match'}).selectOption('france-portugal');
  await page.getByRole('combobox',{name:'Player to follow'}).selectOption('21');
  await expect(page.getByRole('combobox',{name:'Camera view'})).toHaveValue('player');
  await expect(page.locator('.vs-player-caption')).toContainText('Portugal');
  await page.getByRole('slider',{name:'Camera zoom'}).fill('1.35');
  await page.getByRole('slider',{name:'Camera angle'}).fill('120');
  await page.waitForTimeout(2500);
  await scene.screenshot({path:new URL('player-21.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  await page.getByRole('slider',{name:'Camera zoom'}).fill('1');
  await page.screenshot({path:new URL('desktop.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('broadcast');
  for(const [sport,count] of [['Cricket',13],['Basketball',10],['Tennis',2],['Formula',0]]){
    await page.getByRole('tab',{name:new RegExp(sport)}).click();
    await expect(scene).toHaveAttribute('data-ready','true',{timeout:45000});
    await expect(scene).toHaveAttribute('data-athletes',String(count));
    await page.waitForTimeout(2500);
    const stageBox=await page.locator('.vs-stage').boundingBox(),betBox=await page.getByTestId('sports-betting-dock').boundingBox();
    expect(stageBox.width).toBeGreaterThan(1200);expect(betBox.y).toBeGreaterThanOrEqual(stageBox.y+stageBox.height);
    await scene.screenshot({path:new URL(sport.toLowerCase()+'.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
    if(sport==='Cricket'){
      await page.getByRole('combobox',{name:'Player to follow'}).selectOption('0');
      await expect(page.locator('.vs-player-caption')).toContainText('India');
      await page.waitForTimeout(1500);
      await scene.screenshot({path:new URL('cricket-innings-1.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
      secondInnings=true;
      await expect(page.locator('.vs-player-caption')).toContainText('Pakistan');
      await expect(page.locator('.vs-match-clock')).toHaveText('2nd innings');
      await page.waitForTimeout(1500);
      await scene.screenshot({path:new URL('cricket-innings-2.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
      await page.getByRole('combobox',{name:'Camera view'}).selectOption('broadcast');
    }
  }
  await page.getByRole('tab',{name:/Football/}).click();
  await expect(scene).toHaveAttribute('data-ready','true');
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('balanced');
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(2000);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
  await page.screenshot({path:new URL('mobile.png',output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
  await writeFile(new URL('report.json',output),JSON.stringify({errors,failed,overflow},null,2));
  if(errors.length||failed.length||overflow)throw new Error(JSON.stringify({errorCount:errors.length,uniqueErrors:[...new Set(errors)],failed,overflow}));
  console.log('Actual Unity WebGL: five sports, six camera views, fixture/player selection, zoom/orbit, large screen with bets below, mobile layout and asset/error checks passed.');
}finally{await browser.close();}
