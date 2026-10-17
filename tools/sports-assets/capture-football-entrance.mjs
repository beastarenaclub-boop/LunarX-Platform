import { chromium, expect } from '../../artifacts/3d-game/node_modules/@playwright/test/index.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const out=new URL('../../tmp/unity-sports/matchday/',import.meta.url);
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']});
let started=0;
try {
  const page=await browser.newPage({viewport:{width:1280,height:920}});
  await page.route('**/api/virtual-sports/state',async route=>{
    try {
      const response=await route.fetch(),state=await response.json(),now=Date.now();
      const closes=(started||now)+20000;
      const hold=r=>({...r,phase:now<closes?'betting':'live',starts:closes-20000,closes,ends:closes+45000,next:closes+55000,events:[],score:[0,0],winner:null});
      state.serverTime=now;state.rounds=state.rounds.map(hold);state.matches=state.matches?.map(hold);
      await route.fulfill({response,json:state});
    }catch(e){if(!page.isClosed())throw e;}
  });
  await page.goto(process.env.UNITY_REVIEW_URL||'http://127.0.0.1:5198');
  const scene=page.getByTestId('sports-scene');
  await expect(scene).toHaveAttribute('data-ready','true',{timeout:180000});
  await page.getByRole('combobox',{name:'Graphics quality'}).selectOption('high');
  await page.getByRole('button',{name:'Fullscreen match'}).click();
  const frame=page.frames().find(f=>f.url().includes('/unity-sports/'));
  await frame.evaluate(()=>{
    window.__entranceChunks=[];
    const stream=document.querySelector('canvas').captureStream(30);
    window.__entranceRecorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:3500000});
    window.__entranceRecorder.ondataavailable=e=>{if(e.data.size)window.__entranceChunks.push(e.data);};
    window.__entranceRecorder.start();
  });
  started=Date.now();
  for(const stage of ['walkout','lineup','taking-positions','kickoff','live']) {
    await expect(scene).toHaveAttribute('data-presentation',stage,{timeout:18000});
    console.log('Continuous clock:',stage);
  }
  await page.waitForTimeout(1500);
  const encoded=await frame.evaluate(()=>new Promise(resolve=>{
    const recorder=window.__entranceRecorder;
    recorder.onstop=async()=>{
      const blob=new Blob(window.__entranceChunks,{type:'video/webm'});
      recorder.stream.getTracks().forEach(t=>t.stop());
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(blob);
    };recorder.stop();
  }));
  await writeFile(new URL('entrance-to-kickoff.webm',out),Buffer.from(encoded,'base64'));
  console.log('Continuous entrance-to-kickoff recording saved.');
}finally{await browser.close();}
