import {chromium} from '@playwright/test';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage(),started=Date.now();
  page.on('console',m=>console.log('CONSOLE',m.type(),m.text()));
  page.on('pageerror',e=>console.log('ERROR',e.message));
  page.on('requestfinished',r=>console.log('LOADED',Date.now()-started,new URL(r.url()).pathname));
  page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
  await page.addInitScript(()=>localStorage.setItem('apex.settings.v1',JSON.stringify({quality:'performance',mode:'free',sound:false})));
  await page.goto('http://127.0.0.1:5193');
  await page.waitForSelector('.start-button',{timeout:90000});
  console.log('READY_MS',Date.now()-started);
  await page.screenshot({path:'tmp/bike-validation/inspection-mobile.png'});
  console.log('DONE');
}finally{await browser.close();}
