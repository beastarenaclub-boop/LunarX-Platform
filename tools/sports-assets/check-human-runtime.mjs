import {chromium,expect} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5199');
 const scene=page.getByTestId('sports-scene');await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
 await expect(page.getByRole('combobox',{name:'Graphics quality'})).toHaveValue('auto');
 const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
 await expect.poll(()=>frame.evaluate(()=>window.arenaMetrics?.fps??0),{timeout:30000}).toBeGreaterThan(0);
 let metrics=await frame.evaluate(()=>window.arenaMetrics);
 assert.ok(metrics.width<=1280&&metrics.width*metrics.height<=923000);
 // Intercept actual draw calls on the created context (Unity replaces some
 // prototype bindings during initialization, so install this after ready).
 await frame.evaluate(()=>{window.__draws=0;window.__indices=0;const gl=instance.Module.ctx;for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const original=gl[name];gl[name]=function(...args){window.__draws++;window.__indices+=(name.includes('Elements')?args[1]:args[2])*(name.includes('Instanced')?args.at(-1):1);return original.apply(this,args);};}});
 await page.evaluate(()=>{const spacer=document.createElement('div');spacer.id='arena-offscreen-test';spacer.style.height='200vh';document.body.appendChild(spacer);window.scrollTo(0,document.documentElement.scrollHeight);});await page.waitForTimeout(1500);
 const stopped=await frame.evaluate(()=>window.__draws),indices=await frame.evaluate(()=>window.__indices);await page.waitForTimeout(1500);
 // Unity still presents a tiny fullscreen surface at its 4 Hz idle rate.
 // No stadium/character geometry should be submitted while offscreen.
 assert.ok(await frame.evaluate(()=>window.__indices)-indices<=384,'Offscreen Unity continued submitting scene geometry');
 assert.ok(await frame.evaluate(()=>window.__draws)-stopped<=24,'Offscreen Unity did not throttle presentation');
 await scene.scrollIntoViewIfNeeded();await page.waitForTimeout(1500);
 assert.ok(await frame.evaluate(()=>window.__draws)>stopped,'Unity camera did not resume');
 await page.evaluate(()=>document.getElementById('arena-offscreen-test')?.remove());
 await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('high');await page.waitForTimeout(1000);
 assert.equal(await frame.evaluate(()=>quality),'high');
 await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('auto');
 await page.setViewportSize({width:390,height:844});await scene.scrollIntoViewIfNeeded();await page.waitForTimeout(2000);
 const dimensions=await frame.evaluate(()=>({width:canvas.width,height:canvas.height,clientWidth:canvas.clientWidth}));
 assert.ok(dimensions.width<=1280&&dimensions.width*dimensions.height<=923000);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 assert.deepEqual(errors,[]);console.log(JSON.stringify({auto:metrics,mobile:dimensions,offscreenPauseAndResume:true,errors}));
}finally{await browser.close();}
