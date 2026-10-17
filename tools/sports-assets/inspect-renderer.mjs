import {chromium,expect} from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('console',m=>{if(/renderer|graphics|webgl|webgpu/i.test(m.text()))console.log(m.text().slice(0,500));});
 await page.goto('http://127.0.0.1:5199');await expect(page.getByTestId('sports-scene')).toHaveAttribute('data-ready','true',{timeout:180000});
 const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
 console.log(await frame.evaluate(()=>({module:Object.keys(instance.Module).filter(k=>/gl|canvas|frame|render/i.test(k)),ctx:instance.Module.ctx?.constructor?.name,gl:instance.Module.GLctx?.constructor?.name,draw:document.querySelector('canvas').getContext('webgl2')?.drawElements.toString(),hidden:document.hidden})));
 console.log(await frame.evaluate(()=>new Promise(resolve=>{const c=document.querySelector('canvas'),gl=c.getContext('webgl2');let draws=0,frames=0;const original=gl.drawElements;gl.drawElements=function(...a){draws++;return original.apply(this,a)};const tick=()=>{frames++;if(frames<100)requestAnimationFrame(tick);else resolve({draws,frames});};requestAnimationFrame(tick);}))); 
}finally{await browser.close();}
