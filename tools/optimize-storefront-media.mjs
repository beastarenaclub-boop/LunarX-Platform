// Lossy WebP delivery copies; source PNG artwork remains untouched.
// Run with the installed Chrome used by the browser tests.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../artifacts/3d-game/package.json',import.meta.url));
const {chromium}=require('@playwright/test');
const root=path.resolve('artifacts/3d-game/public/media/b2c');
const output=path.join(root,'optimized');fs.mkdirSync(output,{recursive:true});
const specifications={
 'casino-atlas.png':{},'instant-atlas.png':{},'sports-atlas.png':{},
 'crash-games-banner.png':{mobile:768},'casino-banner.png':{mobile:768},'instant-games-banner.png':{mobile:768},
 'lottery.png':{maxWidth:560},'player-avatar.png':{maxWidth:160},'brand-logo.png':{maxWidth:684,quality:.94},
};
const browser=await chromium.launch({channel:'chrome',headless:true});
const manifest={};
try{
 const page=await browser.newPage();
 for(const [name,settings] of Object.entries(specifications)){
  const source=fs.readFileSync(path.join(root,name));
  const encode=async maxWidth=>{
   const result=await page.evaluate(async({data,maxWidth,quality})=>{
    const image=new Image();image.src=data;await image.decode();
    const scale=Math.min(1,(maxWidth||image.naturalWidth)/image.naturalWidth);
    const canvas=document.createElement('canvas');canvas.width=Math.round(image.naturalWidth*scale);canvas.height=Math.round(image.naturalHeight*scale);
    const ctx=canvas.getContext('2d');ctx.imageSmoothingQuality='high';ctx.drawImage(image,0,0,canvas.width,canvas.height);
    return {data:canvas.toDataURL('image/webp',quality),width:canvas.width,height:canvas.height};
   },{data:`data:image/png;base64,${source.toString('base64')}`,maxWidth,quality:settings.quality??.88});
   if(!result.data.startsWith('data:image/webp;'))throw Error('WebP encoder unavailable');
   const bytes=Buffer.from(result.data.split(',')[1],'base64');
   const hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
   const target=`${name.slice(0,-4)}${settings.mobile&&maxWidth===settings.mobile?'-mobile':''}.${hash}.webp`;
   fs.writeFileSync(path.join(output,target),bytes);
   return {src:`optimized/${target}`,width:result.width,height:result.height,bytes:bytes.length};
  };
  manifest[name]={...await encode(settings.maxWidth),sourceBytes:source.length};
  if(settings.mobile)manifest[name].mobile=await encode(settings.mobile);
  console.log(JSON.stringify({name,before:source.length,after:manifest[name].bytes,mobile:manifest[name].mobile?.bytes}));
 }
 fs.writeFileSync('artifacts/3d-game/src/components/b2c/optimized-media.json',JSON.stringify(manifest,null,2)+'\n');
}finally{await browser.close();}
