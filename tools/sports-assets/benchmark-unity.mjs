import { chromium, expect } from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
const label=process.argv[2]||'current';
const output=new URL('../../tmp/unity-sports/performance/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const anchor=Date.now();
 await page.route('**/api/virtual-sports/state',async route=>{
  try{
  const response=await route.fetch();const s=await response.json(),now=Date.now(),elapsed=(17000+now-anchor)%45000;
  const hold=r=>({...r,phase:'live',starts:now-elapsed-20000,closes:now-elapsed,ends:now-elapsed+45000,next:now-elapsed+55000,events:[],score:[0,0],winner:null});
  s.serverTime=now;s.rounds=s.rounds.map(hold);s.matches=s.matches?.map(hold);await route.fulfill({response,json:s});
  }catch(e){if(!page.isClosed())throw e;}
 });
 await page.goto(process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5198');
 const scene=page.getByTestId('sports-scene');await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
 const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
 await frame.evaluate(()=>{
  // Count actual GL submissions; requestAnimationFrame alone also counts frames
  // where a throttled Unity player did not render anything.
  window.__arenaSamples=[];let calls=0,triangles=0,last=0;
  for(const proto of [document.querySelector('canvas').getContext('webgl2')]){
   for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
    const original=proto[name];if(!original)continue;
    proto[name]=function(...args){calls++;triangles+=(name.includes('Elements')?args[1]:args[2])/3*(name.includes('Instanced')?args.at(-1):1);return original.apply(this,args);};
   }
  }
  const frame=t=>{if(calls){if(last)window.__arenaSamples.push({ms:t-last,calls,triangles});last=t;calls=0;triangles=0;}requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
 const results=[];
 for(const quality of (process.env.ARENA_QUALITIES||'high,balanced').split(',')){
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption(quality);
  for(const camera of ['broadcast','player']){
   await page.getByRole('combobox',{name:'Camera view'}).selectOption(camera);
   if(camera==='player') {await page.getByRole('slider',{name:'Camera zoom'}).fill('1.6');await page.getByRole('slider',{name:'Camera angle'}).fill('35');}
   await page.waitForTimeout(5000);await frame.evaluate(()=>{window.__arenaSamples=[];});await page.waitForTimeout(10000);
   const data=await frame.evaluate(()=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');return {frames:window.__arenaSamples,engineFPS:window.arenaMetrics?.fps,canvas:[c.width,c.height],gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unavailable'};});
   if(!data.frames.length)throw new Error('No actual WebGL frames sampled');
   const sorted=data.frames.map(f=>f.ms).sort((a,b)=>a-b),total=data.frames.reduce((s,f)=>s+f.ms,0);
   results.push({quality,camera,canvas:data.canvas,gpu:data.gpu,frames:data.frames.length,engineFPS:data.engineFPS,fps:+(data.frames.length*1000/total).toFixed(1),p95ms:sorted[Math.floor(sorted.length*.95)],drawCalls:Math.round(data.frames.reduce((s,f)=>s+f.calls,0)/data.frames.length),triangles:Math.round(data.frames.reduce((s,f)=>s+f.triangles,0)/data.frames.length)});
   await scene.screenshot({path:new URL(`${label}-${quality}-${camera}.png`,output).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
  }
 }
 await writeFile(new URL(`${label}.json`,output),JSON.stringify({results,errors},null,2));console.log(JSON.stringify({results,errors}));
}finally{await browser.close();}
