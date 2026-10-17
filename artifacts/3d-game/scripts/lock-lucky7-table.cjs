const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

// Freeze only unoccupied foreground furniture. The dealer, hands, dice and
// background patrons retain their original video frames and native speed.
const [input,output,ffmpegDirectory]=process.argv.slice(2);
if(!input||!output||!ffmpegDirectory)throw Error('Usage: node lock-lucky7-table.cjs input.mp4 output.mp4 ffmpeg-directory');
const executable=name=>path.resolve(ffmpegDirectory,process.platform==='win32'?name+'.exe':name);
const source=path.resolve(input),destination=path.resolve(output);
if(source===destination)throw Error('Use a separate output; preserve the generated master');
const result=spawnSync(executable('ffprobe'),['-v','error','-select_streams','v:0','-show_entries','stream=width,height,r_frame_rate,duration','-of','json',source],{encoding:'utf8',windowsHide:true});
if(result.status!==0)throw Error(result.stderr);
const stream=JSON.parse(result.stdout).streams[0];
if(stream.width!==2560||stream.height!==1440)throw Error('This measured table mask requires a 2560x1440 source');
const rate=stream.r_frame_rate;
// Coordinates leave a generous clear corridor around both forearms and all
// center dice motion. A 12-pixel join blends only empty felt, never a hand.
const mask='255*max(clip((Y-1310)/12,0,1),clip((Y-1050)/12,0,1)*max(clip((550-X)/12,0,1),clip((X-2010)/12,0,1)))';
const filters=`[0:v]split[scene][first];[first]select='eq(n,0)',setpts=PTS-STARTPTS,split[plate][mask];[mask]format=gray,geq=lum='${mask}'[alpha];[plate][alpha]alphamerge,loop=loop=-1:size=1:start=0,setpts=N/(${rate})/TB[fixed];[scene][fixed]overlay=shortest=1:format=auto,format=yuv420p[out]`;
fs.mkdirSync(path.dirname(destination),{recursive:true});
const encode=spawnSync(executable('ffmpeg'),['-hide_banner','-loglevel','error','-y','-i',source,'-filter_complex_threads','2','-filter_complex',filters,'-map','[out]','-an','-t',stream.duration,'-r',rate,'-c:v','libx264','-profile:v','high','-preset','fast','-tune','fastdecode','-crf','18','-g','24','-threads','2','-movflags','+faststart',destination],{stdio:'inherit',windowsHide:true});
if(encode.status!==0)throw Error('Table stabilization failed');
console.log(JSON.stringify({output:destination,width:stream.width,height:stream.height,fps:rate,duration:stream.duration,fixedTable:true}));
