import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = path.resolve('artifacts/3d-game/src/assets/audio/public-demo');
const file = path.join(root, 'manifest.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
const original = 'tower-rush/sounds.mp3';
const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
let total = 0;
for (const [cue, offset, duration] of [['bet',1,1.7],['reveal',4,1.3],['crash',30,1.7],['win',32,2.6]]) {
  const relative = `tower-rush/${cue}-compact-v4.mp3`, output = path.join(root, relative);
  execFileSync(ffmpeg, ['-hide_banner','-loglevel','error','-y','-i',path.join(root,original),'-ss',String(offset),'-t',String(duration),'-map_metadata','-1','-codec:a','libmp3lame','-b:a','128k',output], {windowsHide:true});
  const data = fs.readFileSync(output); total += data.length;
  manifest.files[relative] = { ...manifest.files[original], sha256:createHash('sha256').update(data).digest('hex'), bytes:data.length, derivedFrom:original, sourceOffset:offset, sourceDuration:duration };
  manifest.games['tower-rush'][cue] = {file:relative, duration};
}
manifest.games['tower-rush'].lose = {...manifest.games['tower-rush'].crash};
fs.writeFileSync(file, JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({originalBytes:manifest.files[original].bytes,compactCueBytes:total}));
