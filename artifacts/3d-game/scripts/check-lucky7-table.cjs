const {spawnSync}=require('node:child_process');
const path=require('node:path');
const [movie,ffmpegDirectory]=process.argv.slice(2);
if(!movie||!ffmpegDirectory)throw Error('Usage: node check-lucky7-table.cjs movie.mp4 ffmpeg-directory');
const ffmpeg=path.resolve(ffmpegDirectory,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
const decoded=spawnSync(ffmpeg,['-v','error','-i',path.resolve(movie),'-vf','scale=640:360','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:512*1024*1024,windowsHide:true});
if(decoded.status!==0)throw Error(decoded.error?.message || decoded.stderr.toString());
const stride=640*360*3,frames=Math.floor(decoded.stdout.length/stride);
const areas={leftRail:[25,273,90,15],rightRail:[530,273,85,15],frontRail:[80,350,480,8],hands:[270,230,100,85],background:[500,45,130,155]};
const report={frames,areas:{}};
for(const [name,[x,y,w,h]] of Object.entries(areas)){
 const changes=[];
 for(let frame=1;frame<frames;frame++){
  let difference=0;
  for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++)for(let c=0;c<3;c++){
   const pixel=(row*640+col)*3+c;
   difference+=Math.abs(decoded.stdout[pixel]-decoded.stdout[frame*stride+pixel]);
  }
  changes.push(difference/(w*h*3));
 }
 report.areas[name]={meanDeviation:changes.reduce((a,b)=>a+b,0)/changes.length,maxDeviation:Math.max(...changes)};
}
console.log(JSON.stringify(report,null,2));
if(process.env.REQUIRE_FIXED_TABLE==='1'){
 for(const name of ['leftRail','rightRail','frontRail'])if(report.areas[name].maxDeviation>1.5)throw Error(name+' is moving');
 if(report.areas.hands.maxDeviation<4)throw Error('Dealer action was lost during processing');
}
