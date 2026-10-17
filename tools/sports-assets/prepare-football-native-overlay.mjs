// Update only the compiled Unity player over a tagged local website image.
// The existing application shell and API remain supplied by that base image.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const source=resolve('artifacts/3d-game/public/unity-sports');
const target=resolve('tmp/unity-football-performance-overlay');
const manifest=JSON.parse(await readFile(resolve(source,'ready.json'),'utf8'));
if(manifest.engine!=='unity'||manifest.sports?.length!==5)throw new Error('A completed five-sport Unity build is required.');
await mkdir(resolve(target,'public'),{recursive:true});
await cp(source,resolve(target,'public/unity-sports'),{recursive:true});
await writeFile(resolve(target,'Dockerfile'),'FROM aviator-game-web:before-football-performance-20261016\nCOPY public/unity-sports/ /usr/share/nginx/html/unity-sports/\n');
console.log('Prepared native football update:',target);
