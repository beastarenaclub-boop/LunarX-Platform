import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const files=['index.html','unity-sports/index.html','unity-sports/ready.json','unity-sports/Build/WebGL.wasm','unity-sports/Build/WebGL.data','unity-sports/Build/WebGL.framework.js','virtual-sports/audio/hi/manifest.json'];
const prefix='/usr/share/nginx/html/';
const output=execFileSync('docker',['run','--rm','--entrypoint','sha256sum','aviator-game-web:sports-broadcast',...files.map(f=>prefix+f)],{encoding:'utf8'});
for(const line of output.trim().split('\n')){
 const [hash,file]=line.trim().split(/\s+/),relative=file.slice(prefix.length);
 const expected=createHash('sha256').update(readFileSync('artifacts/3d-game/dist/public/'+relative)).digest('hex');
 assert.equal(hash,expected,`Deployment contains a stale or incomplete ${relative}`);
}
console.log('Deployment image matches the final website entrypoint, Unity binaries and complete Hindi audio manifest.');
