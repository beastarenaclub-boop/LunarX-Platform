import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const tool=path.resolve(process.argv[2] ?? 'tmp/andar-bahar-live/rife/tool');
const root=path.resolve('tmp/andar-bahar-live/rife/full');
const input=path.join(root,'input'),output=path.join(root,'output');
mkdirSync(input,{recursive:true});mkdirSync(output,{recursive:true});
const ffmpeg=path.resolve('tmp/dt-ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
async function run(exe,args){
 const child=spawn(exe,args,{stdio:['ignore','inherit','inherit'],windowsHide:true});
 const [code]=await once(child,'close');
 if(code!==0)throw new Error(`${path.basename(exe)} exited ${code}`);
}
// Interpolate the scene only. Regenerate the foreground matte afterward so
// a predicted hand edge and its occlusion mask describe the same new frame.
await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',path.resolve('artifacts/3d-game/public/media/andar-bahar-live/dealer-native-v5.mp4'),'-vf','crop=1430:610:0:0',path.join(input,'%08d.png')]);
const frames=readdirSync(input).filter(n=>n.endsWith('.png')).length;
if(frames!==399)throw new Error(`Expected 399 original frames, got ${frames}`);
console.log('Original frames decoded. Preparing intermediate motion frames on the GPU.');
await run(path.join(tool,'rife-ncnn-vulkan.exe'),['-i',input,'-o',output,'-m',path.join(tool,'rife-v4.6'),'-g','1','-j','1:1:1']);
const resultFrames=readdirSync(output).filter(n=>n.endsWith('.png')).length;
if(resultFrames!==798)throw new Error(`Expected 798 prepared frames, got ${resultFrames}`);
await run(ffmpeg,['-hide_banner','-loglevel','error','-y','-framerate','60','-i',path.join(output,'%08d.png'),'-c:v','libx264','-preset','fast','-crf','12','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,'scene-60.mp4')]);
writeFileSync(path.join(root,'interpolation.json'),JSON.stringify({sourceFrames:frames,preparedFrames:resultFrames,sourceFps:30,preparedFps:60,duration:13.3,method:'RIFE 4.6 intermediate frames',originalPerformancePreserved:true,modelSource:'https://github.com/nihui/rife-ncnn-vulkan'},null,2));
console.log(`Prepared ${resultFrames} frames at 60 fps: ${path.join(root,'scene-60.mp4')}`);
