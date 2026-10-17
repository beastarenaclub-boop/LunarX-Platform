import {chromium,expect} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const label=process.argv[2]||'after';
if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid review label');
const out=new URL(`../../tmp/unity-sports/football-performance/${label}/`,import.meta.url);await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
const errors=[],failed=[],checks=[];let elapsed=-9.5,phase='betting';
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('response',r=>{if(r.url().includes('/unity-sports/')&&r.status()>=400)failed.push(r.url());});
 await page.route('**/api/virtual-sports/state',async route=>{
  const response=await route.fetch(),s=await response.json(),now=Date.now();
  const hold=r=>({...r,phase,starts:now-(elapsed+20)*1000,closes:now-elapsed*1000,ends:now+(45-elapsed)*1000,next:now+(55-elapsed)*1000,events:[],score:[0,0],winner:null});
  s.serverTime=now;s.rounds=s.rounds.map(hold);s.matches=s.matches?.map(hold);await route.fulfill({response,json:s});
 });
 await page.goto(process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5198');
 const scene=page.getByTestId('sports-scene');await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
 await page.getByRole('combobox',{name:'Choose match'}).selectOption('france-portugal');
 await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('high');
 await page.getByRole('combobox',{name:'Camera view'}).selectOption('player');
 await page.getByRole('combobox',{name:'Player to follow'}).selectOption('9');
 await page.getByRole('slider',{name:'Camera zoom'}).fill('1.6');
 await page.getByRole('slider',{name:'Camera angle'}).fill('140');
 await page.waitForTimeout(1800);
 const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
 const state=await frame.evaluate(()=>JSON.parse(pendingState));
 // Hold only presentation state from the same-origin parent. The real Unity
 // build, skins, animations, ball motion, rendering and cameras all execute.
 await page.evaluate(s=>{
  window.__footballReviewState=s;
  window.__footballReviewTimer=setInterval(()=>{
   document.querySelector('iframe').contentWindow.postMessage({type:'arena-state',state:window.__footballReviewState},location.origin);
  },16);
 },state);
 for(const [name,time,angle] of [['lineup',-9.5,140],['walkout',-15,140],['backswing',1.18,35],['contact',1.45,35],['follow-through',1.72,35],['running',6,140]]){
  elapsed=time;phase=time<0?'betting':'live';
  await page.evaluate(s=>{window.__footballReviewState={...window.__footballReviewState,...s};},{elapsed,phase,orbit:angle,events:[],followPlayer:9,zoom:time<0?1.6:1.15});
  await page.waitForTimeout(2000);await expect(scene).toHaveAttribute('data-athletes','22');
  await scene.screenshot({path:fileURLToPath(new URL(name+'.png',out))});checks.push(name);console.log('Football pose:',name);
 }
 await page.evaluate(()=>clearInterval(window.__footballReviewTimer));
 await writeFile(new URL('report.json',out),JSON.stringify({checks,errors,failed},null,2));
 expect(errors).toEqual([]);expect(failed).toEqual([]);
 console.log('PASS: compiled football model, entry, strike, follow-through and running captures.');
}finally{await browser.close();}
