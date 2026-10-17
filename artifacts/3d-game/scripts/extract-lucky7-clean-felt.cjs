const {spawnSync}=require('node:child_process');
const path=require('node:path');
const [source,output,ffmpegDirectory]=process.argv.slice(2);
if(!source||!output||!ffmpegDirectory)throw Error('Usage: node extract-lucky7-clean-felt.cjs master.mp4 felt.png ffmpeg-directory');
const ffmpeg=path.resolve(ffmpegDirectory,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
// Same table depth and lighting, using unoccupied felt on its right side.
// The center is shaded while dice are held, so a center-frame donor bakes
// that hand shadow into every later throw. Runtime footprints sample only
// the clear middle columns of this donor, never its wood rail/upper left.
const encoded=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',source,'-frames:v','1','-vf','crop=768:280:1730:1040',output],{windowsHide:true});
if(encoded.status!==0)throw Error(encoded.error?.message || encoded.stderr.toString());
console.log(JSON.stringify({output,width:768,height:280,sourceX:1730,sourceY:1040,sourceFrame:0}));
