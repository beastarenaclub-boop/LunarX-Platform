const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const [source,ffmpegDirectory,output='tmp/lucky7-continuity.json']=process.argv.slice(2);
if(!source||!ffmpegDirectory)throw Error('Usage: node inspect-lucky7-continuity.cjs movie.mp4 ffmpeg-directory report.json');
const executable=name=>path.resolve(ffmpegDirectory,process.platform==='win32'?name+'.exe':name);
const probe=spawnSync(executable('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate','-of','json',source],{encoding:'utf8',windowsHide:true});
if(probe.status!==0)throw Error(probe.stderr);
const [n,d]=JSON.parse(probe.stdout).streams[0].r_frame_rate.split('/').map(Number),fps=n/d;
const decoded=spawnSync(executable('ffmpeg'),['-v','error','-i',source,'-vf','scale=320:180','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:160*1024*1024,windowsHide:true});
if(decoded.status!==0)throw Error(decoded.stderr.toString());
const stride=320*180*3,frames=Math.floor(decoded.stdout.length/stride);
const areas={face:[130,6,54,60],hands:[95,110,135,55],body:[110,64,105,63],background:[0,0,90,130]};
function difference(first,last,area){
  const [x,y,w,h]=area;let total=0;
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)for(let c=0;c<3;c++){
    const pixel=(row*320+col)*3+c;
    total+=Math.abs(decoded.stdout[first*stride+pixel]-decoded.stdout[last*stride+pixel]);
  }
  return total/(w*h*3);
}
const report={source,frames,fps,duration:frames/fps,areas:{},candidates:[],matchedLoops:[]};
for(const [name,area] of Object.entries(areas)){
  const adjacent=Array.from({length:frames-1},(_,i)=>difference(i,i+1,area)).sort((a,b)=>a-b);
  report.areas[name]={adjacentMedian:adjacent[Math.floor(adjacent.length*.5)],adjacentP95:adjacent[Math.floor(adjacent.length*.95)],adjacentMax:adjacent.at(-1),loopJump:difference(frames-1,0,area)};
}
for(let start=Math.ceil(5*fps);start<Math.min(frames-6*fps,9*fps);start++){
  const face=difference(start,frames-1,areas.face),hands=difference(start,frames-1,areas.hands),body=difference(start,frames-1,areas.body);
  report.candidates.push({startFrame:start,startMs:start/fps*1000,seconds:(frames-start)/fps,face,hands,body,score:face+hands+body});
}
report.candidates.sort((a,b)=>a.score-b.score);report.candidates=report.candidates.slice(0,12);
for(let start=Math.ceil(5.5*fps);start<=Math.min(frames-6*fps,9.5*fps);start++){
 for(let end=start+6*fps;end<frames;end++){
  const face=difference(start,end,areas.face),hands=difference(start,end,areas.hands),body=difference(start,end,areas.body);
  report.matchedLoops.push({startFrame:start,endFrame:end,startMs:start/fps*1000,endMs:(end+1)/fps*1000,seconds:(end-start+1)/fps,face,hands,body,score:face*2+hands+body});
 }
}
report.matchedLoops=report.matchedLoops.filter(x=>x.face<4&&x.hands<4&&x.body<4);
for(const loop of report.matchedLoops){
 loop.full=difference(loop.startFrame,loop.endFrame,[0,0,320,180]);
 loop.score=loop.face+loop.hands+loop.body+loop.full*3;
}
report.matchedLoops.sort((a,b)=>a.score-b.score);report.matchedLoops=report.matchedLoops.slice(0,8);
fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
