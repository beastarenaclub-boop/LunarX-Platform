import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync,copyFileSync } from 'node:fs';
import { resolve,join } from 'node:path';

// Replace only the previously bundled virtual-sports module. The deployed
// API's other routes and workers remain byte-for-byte from the running image.
const target=resolve('tmp/unity-sports-api-overlay');mkdirSync(target,{recursive:true});
const image=execFileSync('docker',['inspect','--format','{{.Image}}','aviator-game-api-1'],{encoding:'utf8'}).trim();
execFileSync('docker',['image','tag',image,'aviator-game-api:before-sports-broadcast']);
execFileSync('docker',['cp','aviator-game-api-1:/app/artifacts/api-server/dist/index.mjs',join(target,'original-index.mjs')]);
const original=readFileSync(join(target,'original-index.mjs'),'utf8');
const start=original.indexOf('// ../../lib/virtual-sports/store.mjs');
const end=original.indexOf('// src/routes/virtualSports.ts',start);
if(start<0||end<start||!original.slice(start,end).includes('function createSportsStore('))throw new Error('Deployed sports module markers do not match; no deployment prepared.');
const replacement="import { createSportsStore, SportsError } from './virtual-sports/store.mjs';\n\n";
writeFileSync(join(target,'index.mjs'),(original.slice(0,start)+replacement+original.slice(end)).replace(/^\/\/# sourceMappingURL=.*$/m,''));
mkdirSync(join(target,'virtual-sports'),{recursive:true});
for(const file of ['store.mjs','catalog.mjs','fixtures.mjs'])copyFileSync(resolve('lib/virtual-sports',file),join(target,'virtual-sports',file));
writeFileSync(join(target,'Dockerfile'),'FROM aviator-game-api:before-sports-broadcast\nCOPY index.mjs /app/artifacts/api-server/dist/index.mjs\nCOPY virtual-sports/ /app/artifacts/api-server/dist/virtual-sports/\n');
execFileSync(process.execPath,['--check',join(target,'index.mjs')],{stdio:'inherit'});
console.log('Prepared sports-only API overlay; original deployed API image retained.');
