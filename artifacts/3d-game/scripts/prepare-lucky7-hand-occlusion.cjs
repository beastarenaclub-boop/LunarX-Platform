const {spawnSync}=require('child_process');
const fs=require('fs'),path=require('path');
const [source,ffmpegDirectory]=process.argv.slice(2);
if(!source||!ffmpegDirectory)throw Error('Usage: node prepare-lucky7-hand-occlusion.cjs action-2k.mp4 ffmpeg-directory');
const ffmpeg=path.resolve(ffmpegDirectory,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const decoded=spawnSync(ffmpeg,['-v','error','-i',source,'-vf','scale=960:540','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:400*1024*1024,windowsHide:true});
if(decoded.status!==0)throw Error(decoded.error?.message || decoded.stderr?.toString() || 'Video decode failed');
const raw=decoded.stdout;
const w=300,h=145,x0=340,y0=355,stride=960*540*3;
function simplify(p,tolerance=1){
 if(p.length<3)return p;const [a,b]=[p[0],p.at(-1)];let at=0,distance=0;
 const dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
 for(let i=1;i<p.length-1;i++){const q=p[i],t=den?Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dy)/den)):0;const d=(q[0]-a[0]-t*dx)**2+(q[1]-a[1]-t*dy)**2;if(d>distance){distance=d;at=i;}}
 return distance>tolerance*tolerance?[...simplify(p.slice(0,at+1),tolerance).slice(0,-1),...simplify(p.slice(at),tolerance)]:[a,b];
}
const paths={};
for(let frame=0;frame<raw.length/stride;frame++){
 const pixels=raw.subarray(frame*stride,(frame+1)*stride),mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=((y+y0)*960+x+x0)*3,r=pixels[i],g=pixels[i+1],b=pixels[i+2];
  // Warm ivory die edges must not be mistaken for fingers under amber light.
  mask[y*w+x]=r>75&&r-g>32&&g-b>14&&r-b>58?1:0;
 }
 const edges=new Map(),key=(x,y)=>y*(w+1)+x;
 const add=(a,b)=>{if(!edges.has(a))edges.set(a,[]);edges.get(a).push(b);};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){
  if(!y||!mask[(y-1)*w+x])add(key(x,y),key(x+1,y));
  if(x===w-1||!mask[y*w+x+1])add(key(x+1,y),key(x+1,y+1));
  if(y===h-1||!mask[(y+1)*w+x])add(key(x+1,y+1),key(x,y+1));
  if(!x||!mask[y*w+x-1])add(key(x,y+1),key(x,y));
 }
 const contours=[];
 while(edges.size){
  const first=edges.keys().next().value;let at=first;const points=[];
  do{points.push([at%(w+1),Math.floor(at/(w+1))]);const next=edges.get(at);if(!next)break;const end=next.pop();if(!next.length)edges.delete(at);at=end;}while(at!==first&&points.length<10000);
  if(points.length<15)continue;
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a[0]*b[1]-a[1]*b[0];}
  if(Math.abs(area)<60)continue;
  const p=simplify(points);contours.push(p.map(([x,y],i)=>`${i?'L':'M'}${(x+x0)*2},${(y+y0)*2}`).join('')+'Z');
 }
 paths[frame]=contours.join('');
}
const output=path.resolve(__dirname,'../src/components/lucky7/dealerHandOcclusion.ts');
fs.writeFileSync(output,'// Offline contours measured from the bar take. Keep recorded hands in front of rendered dice.\nconst contours: Record<number,string> = '+JSON.stringify(paths)+';\nexport function dealerHandOcclusion(scene: "idle" | "action", ms: number) {\n return scene === "action" ? contours[Math.floor(ms*24/1000+.001)] ?? "" : "";\n}\n');
console.log(JSON.stringify({output,frames:Object.keys(paths).length,bytes:fs.statSync(output).size}));
