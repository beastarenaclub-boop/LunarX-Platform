import { chromium } from "../../artifacts/3d-game/node_modules/@playwright/test/index.mjs";
import assert from "node:assert/strict";

// Exercises the real React page and API with an explicit iframe fixture.
// This verifies message isolation, not actual Unity rendering.
const url=process.env.UNITY_BRIDGE_TEST_URL ?? "http://127.0.0.1:5199";
const browser=await chromium.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",
  args:["--enable-webgl","--ignore-gpu-blocklist","--enable-unsafe-swiftshader"]});
try {
  const page=await browser.newPage({viewport:{width:1280,height:920}});
  page.setDefaultTimeout(20000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/unity-sports/ready.json",r=>r.fulfill({json:{engine:"unity",sports:["football","cricket","basketball","tennis","formula"]}}));
  await page.route("**/unity-sports/index.html",r=>r.fulfill({contentType:"text/html",body:`<!doctype html><body style="background:#11202a;color:white">Unity bridge test fixture<script>
    window.received=[];window.instanceToken=Math.random();
    addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==parent||e.data.type!=='arena-state')return;
      window.received.push(e.data.state);const s=e.data.state;
      parent.postMessage({type:'arena-ready',sport:s.sport,athletes:{football:22,cricket:13,basketball:10,tennis:2,formula:0}[s.sport],vehicles:s.sport==='formula'?4:0},location.origin);});
    parent.postMessage({type:'arena-loaded'},location.origin);
  </script>`}));
  await page.goto(url);
  console.log('Bridge test: page loaded');
  const scene=page.getByTestId("sports-scene");
  await scene.locator("iframe").waitFor();
  console.log('Bridge test: Unity iframe mounted');
  await page.waitForFunction(()=>document.querySelector('[data-testid="sports-scene"]')?.getAttribute('data-ready')==='true');
  let frame=page.frames().find(f=>f.url().endsWith('/unity-sports/index.html'));
  const token=await frame.evaluate(()=>window.instanceToken);
  for(const sport of ["Football","Cricket","Basketball","Tennis","Formula"]){
    await page.getByRole('tab',{name:new RegExp(sport)}).click();
    await page.waitForFunction(id=>document.querySelector('iframe')?.contentWindow.received?.at(-1)?.sport===id,sport.toLowerCase());
    assert.equal(await frame.evaluate(()=>window.instanceToken),token,'Sport switches must retain the WASM instance');
    console.log('Bridge test: '+sport);
  }
  await page.getByRole('combobox',{name:'Camera view'}).selectOption('cinematic');
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('balanced');
  await page.waitForFunction(()=>document.querySelector('iframe')?.contentWindow.received?.at(-1)?.quality==='balanced');
  const messages=await frame.evaluate(()=>window.received);
  assert.equal(messages.at(-1).camera,'cinematic');
  assert(messages.every(m=>!('account' in m)&&!('balance' in m)&&!('winner' in m)&&!('bets' in m)),'Private wallet or hidden outcome sent to renderer');
  assert(messages.every(m=>Number.isFinite(m.elapsed)&&m.elapsed>=-20&&m.elapsed<=45));
  // Same-origin messages from a different source must not alter ready/error state.
  await page.evaluate(()=>window.postMessage({type:'arena-error',message:'forged'},location.origin));
  await page.waitForTimeout(250);
  assert.equal(await scene.getAttribute('data-ready'),'true');
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: five sports, one retained iframe, camera/quality updates, presentation-only payload, source validation, mobile widths. Unity graphics NOT exercised by this fixture.');
} finally {await browser.close();}
