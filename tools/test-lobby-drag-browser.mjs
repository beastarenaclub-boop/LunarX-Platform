import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {defaultLobbyLayout} from '../lib/api-zod/src/lobby-layout.ts';
const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
const {chromium,expect}=require('@playwright/test');
const browser=await chromium.launch({channel:'chrome',headless:true});
const base=process.env.LOBBY_ADMIN_TEST_URL??'http://127.0.0.1:15175/admin/lobby-layout';
const out=process.env.LOBBY_DRAG_OUTPUT??fileURLToPath(new URL('../tmp/lobby-drag/',import.meta.url));
await mkdir(out,{recursive:true});
let saved={revision:0,updatedAt:null,layout:defaultLobbyLayout()},failSave=false,puts=0;
const errors=[];
async function setup(options={}) {
 const context=await browser.newContext({viewport:{width:1440,height:1000},...options});
 const page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;let json={};
  if(path==='/api/auth/me')json={id:'test-admin',email:'test@example.test',role:'admin',status:'active'};
  else if(path==='/api/admin/lobby-layout') {
   if(route.request().method()==='PUT') {
    puts++;
    if(failSave)return route.fulfill({status:500,json:{error:{code:'TEST',message:'Test save failed'}}});
    const input=route.request().postDataJSON();assert.equal(input.revision,saved.revision);
    saved={revision:saved.revision+1,updatedAt:new Date().toISOString(),layout:input.layout};
   }
   json=saved;
  }else if(path==='/api/network/insights/live')json={role:'admin',totals:{totalPlayers:0,online:0,betting:0,sessions:0},items:[],nodes:[]};
  return route.fulfill({json});
 });
 await page.goto(base,{waitUntil:'domcontentloaded'});
 await expect(page.getByTestId('lobby-layout-editor')).toBeVisible();
 return {context,page};
}
const row=(page,id)=>page.getByTestId(`layout-game-${id}`);
const handle=(page,id)=>row(page,id).getByRole('button',{name:/^Drag /});
const ids=page=>page.locator('[data-lobby-sort-id]').evaluateAll(els=>els.map(el=>el.dataset.lobbySortId));
async function mouseStart(page,source,target) {
 await row(page,target).scrollIntoViewIfNeeded();
 await handle(page,source).scrollIntoViewIfNeeded();
 const from=await handle(page,source).boundingBox(),to=await row(page,target).boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
 await page.mouse.move(to.x+to.width/2,to.y+12,{steps:12});
 await expect(row(page,target)).toHaveAttribute('data-drop-edge','before');
}
try {
 const {page,context}=await setup();
 const original=[...saved.layout.orders.casino],a=original[0],b=original[1];
 await mouseStart(page,b,a);await page.screenshot({path:out+'/desktop-drag.png'});await page.mouse.up();
 assert.deepEqual((await ids(page)).slice(0,2),[b,a]);assert.equal(puts,0);
 // Keyboard fallback and cancelled/outside drops must not corrupt draft order.
 await handle(page,b).focus();await page.keyboard.press('ArrowDown');
 assert.deepEqual(await ids(page),original);
 await mouseStart(page,b,a);await page.keyboard.press('Escape');await page.mouse.up();
 assert.deepEqual(await ids(page),original);
 await mouseStart(page,b,a);await page.mouse.move(3,3);await page.mouse.up();
 assert.deepEqual(await ids(page),original);
 await mouseStart(page,b,a);await page.mouse.up();
 failSave=true;await page.getByTestId('save-lobby-layout').click();
 await expect(page.getByRole('alert')).toContainText('Test save failed');
 assert.equal((await ids(page))[0],b);failSave=false;
 await page.getByTestId('save-lobby-layout').click();
 await expect(page.getByRole('status').filter({hasText:'Saved.'})).toBeVisible();
 assert.equal(saved.layout.orders.casino[0],b);
 await page.reload();assert.equal((await idsAfterLoad(page))[0],b);
 // Section order is isolated; filters target positions in the complete list.
 await page.getByRole('tab',{name:'Crypto777 homepage'}).click();
 const cryptoBefore=[...saved.layout.orders.crypto];
 await page.getByLabel('Filter game category').selectOption('instant');
 const filtered=await ids(page);assert(filtered.length>=2);
 await mouseStart(page,filtered[1],filtered[0]);await page.mouse.up();
 await page.getByTestId('save-lobby-layout').click();await expect(page.getByRole('status').filter({hasText:'Saved.'})).toBeVisible();
 const expected=cryptoBefore.filter(id=>id!==filtered[1]);expected.splice(expected.indexOf(filtered[0]),0,filtered[1]);
 assert.deepEqual(saved.layout.orders.crypto,expected);
 assert.equal(saved.layout.orders.casino[0],b);
  const beforeScrollOrder=await ids(page);
  await handle(page,beforeScrollOrder[0]).scrollIntoViewIfNeeded();
  const grip=await handle(page,beforeScrollOrder[0]).boundingBox();
  const scrollStart=await page.evaluate(()=>scrollY);
  await page.mouse.move(grip.x+20,grip.y+20);await page.mouse.down();
  await page.mouse.move(grip.x+20,980,{steps:8});
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(scrollStart);
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.deepEqual(await ids(page),beforeScrollOrder);
 await context.close();
 // Real touch input exercises pointer capture and touch-action on the handle.
 const mobile=await setup({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p=mobile.page,cdp=await mobile.context.newCDPSession(p);
 const touchOrder=await ids(p),first=touchOrder[0],second=touchOrder[1];
 await row(p,first).evaluate(el=>{el.scrollIntoView({block:'start'});window.scrollBy(0,-90);});
 const start=await handle(p,second).boundingBox(),end=await row(p,first).boundingBox();
 assert(start.y<844);
 const sx=start.x+start.width/2,sy=start.y+start.height/2,ex=end.x+end.width/2,ey=end.y+16;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:sx,y:sy}]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:sx+(ex-sx)*i/8,y:sy+(ey-sy)*i/8}]});
 await expect(row(p,first)).toHaveAttribute('data-drop-edge','before');
 await p.screenshot({path:out+'/mobile-drag.png'});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 assert.deepEqual((await ids(p)).slice(0,2),[second,first]);
 assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.getByTestId('save-lobby-layout').click();await expect(p.getByRole('status').filter({hasText:'Saved.'})).toBeVisible();
 assert.equal(saved.layout.orders.casino[0],second);
 await mobile.context.close();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',checks:['mouse drag','keyboard move','Escape and outside cancellation','save failure recovery and reload','filtered full-list insertion','section isolation','edge auto-scroll','real touch drag','mobile width'],puts}));
}finally{await browser.close();}
async function idsAfterLoad(page){await expect(page.locator('[data-lobby-sort-id]').first()).toBeVisible();return ids(page);}
