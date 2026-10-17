import { chromium } from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import { writeFile, mkdir } from 'node:fs/promises';
const browser = await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:720}});
  await page.addInitScript(()=>{
    window.renderSamples=[];let draws=0,triangles=0,last=0;
    window.resetRenderSamples=()=>{window.renderSamples=[];window.sampleStarted=performance.now();last=window.sampleStarted;draws=triangles=0;};
    for(const name of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){
      const original=WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name]=function(...args){draws++;triangles+=(name.includes('Elements')?args[1]:args[2])/3*(name.includes('Instanced')?args.at(-1):1);return original.apply(this,args)};
    }
    const original=window.requestAnimationFrame;
    window.requestAnimationFrame=function(callback){return original.call(window,time=>{
      if(draws){window.renderSamples.push({dt:time-last,draws,triangles});last=time;draws=triangles=0;}
      callback(time);
    })};
  });
  await page.goto(process.env.HORSE_UNITY_URL??'http://127.0.0.1:5288/unity-horse/index.html');
  await page.waitForFunction(()=>window.horseUnityReady,null,{timeout:240000});
  console.log('Loaded',await page.evaluate(()=>({keys:Object.keys(window.horseUnity),module:Object.keys(window.horseUnity.Module??{}).filter(k=>/metric|loop|fps|time/i.test(k))})));
  const report={};
  for(const camera of ['rail','broadcast','grandstand']){
    await page.locator('#camera').selectOption(camera);await page.locator('#restart').click();
    await page.waitForTimeout(6500);await page.evaluate(()=>window.resetRenderSamples());await page.waitForTimeout(10000);
    report[camera]=await page.evaluate(()=>{
      const gl=document.querySelector('canvas').getContext('webgl2'),ext=gl.getExtension('WEBGL_debug_renderer_info');
      const s=window.renderSamples.filter(s=>s.dt>0),d=s.map(s=>s.dt).sort((a,b)=>a-b),measuredSeconds=(performance.now()-window.sampleStarted)/1000;
      return {frames:s.length,measuredSeconds,fps:s.length/measuredSeconds,p50Ms:d[Math.floor(d.length*.5)],p95Ms:d[Math.floor(d.length*.95)],maxFrameMs:d.at(-1),stallsOver250Ms:d.filter(ms=>ms>250).length,drawCalls:Math.round(s.reduce((v,s)=>v+s.draws,0)/s.length),triangles:Math.round(s.reduce((v,s)=>v+s.triangles,0)/s.length),gpu:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',width:gl.drawingBufferWidth,height:gl.drawingBufferHeight,native:window.horseUnity.GetMetricsInfo?.()};
    });console.log(camera,JSON.stringify(report[camera]));
    if(process.env.HORSE_BENCHMARK_SCREENSHOTS==='1')await page.screenshot({path:`tmp/unity-horse/review/benchmark-v4-${camera}.png`});
  }
  await mkdir('tmp/unity-horse/review',{recursive:true});
  await writeFile(process.env.HORSE_BENCHMARK_OUTPUT??'tmp/unity-horse/review/performance-latest.json',JSON.stringify(report,null,2));
} finally {await browser.close()}
