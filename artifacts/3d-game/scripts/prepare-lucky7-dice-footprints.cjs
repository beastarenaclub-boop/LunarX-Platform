const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const [action,idle,ffmpegDirectory]=process.argv.slice(2);
if(!action||!idle||!ffmpegDirectory)throw Error('Usage: node prepare-lucky7-dice-footprints.cjs action.mp4 idle.mp4 ffmpeg-directory');
const ffmpeg=path.resolve(ffmpegDirectory,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
function track(source){
 const decoded=spawnSync(ffmpeg,['-v','error','-i',source,'-vf','scale=960:540','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:700*1024*1024,windowsHide:true});
 if(decoded.status!==0)throw Error(decoded.stderr.toString());
 const width=960,height=540,stride=width*height*3,records=[];
 for(let frame=0;frame<decoded.stdout.length/stride;frame++){
  const pixels=decoded.stdout.subarray(frame*stride,(frame+1)*stride),seen=new Uint8Array(width*height),boxes=[];
  const match=i=>{const r=pixels[i*3],g=pixels[i*3+1],b=pixels[i*3+2];return r>175&&g>170&&b>135&&r-g<35&&g-b<60;};
  for(let y=375;y<510;y++)for(let x=350;x<640;x++){
   const i=y*width+x;if(seen[i]||!match(i))continue;
   const stack=[i];seen[i]=1;let x0=x,x1=x,y0=y,y1=y,area=0;
   while(stack.length){
    const k=stack.pop(),xx=k%width,yy=Math.floor(k/width);area++;x0=Math.min(x0,xx);x1=Math.max(x1,xx);y0=Math.min(y0,yy);y1=Math.max(y1,yy);
    for(const n of [k-1,k+1,k-width,k+width]){
     const nx=n%width,ny=Math.floor(n/width);if(nx<350||nx>=640||ny<375||ny>=510||seen[n]||!match(n))continue;
     seen[n]=1;stack.push(n);
    }
   }
   if(area>=100)boxes.push({x:x0*2,y:y0*2,w:(x1-x0+1)*2,h:(y1-y0+1)*2,area});
  }
  // Include the small original contact shadow; hand contours cut fingers back
  // out of these localized repairs. No broad table-sized replacement layer.
  records.push(boxes.sort((a,b)=>b.area-a.area).slice(0,2).map(b=>[b.x-24,b.y-18,b.w+48,b.h+50]));
 }
 return records;
}
const flight=track(action),rest=track(idle);
const output=path.resolve(__dirname,'../src/components/lucky7/dealerDiceFootprints.ts');
fs.writeFileSync(output,'// Offline measured native bodies and contact shadows, 24 fps.\nconst actionFootprints: number[][][] = '+JSON.stringify(flight)+';\nconst idleFootprints: number[][][] = '+JSON.stringify(rest)+';\nexport function nativeDiceFootprints(scene: "idle" | "action", ms: number) {\n const frames=scene === "action" ? actionFootprints : idleFootprints;\n return frames[Math.max(0,Math.min(frames.length-1,Math.floor(ms*24/1000+.001)))];\n}\n');
console.log(JSON.stringify({output,actionFrames:flight.length,idleFrames:rest.length}));
