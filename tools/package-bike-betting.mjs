import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const base=process.cwd(), output=path.join(base,'exports/bike-racing-live-3d-2026-10-03');
await mkdir(output,{recursive:true});
const skipped=new Set(['node_modules','dist','.git','.cache','data','uploads','test-results']);
const filter=source=>!path.relative(base,source).split(path.sep).some(part=>skipped.has(part)||part.startsWith('.env')||part.startsWith('test-results')) && !/\.(log|tsbuildinfo)$/.test(source);
const copy=async(from,to=from)=>{
  if(existsSync(path.join(base,from))) await cp(path.join(base,from),path.join(output,to),{recursive:true,filter});
};
for(const file of ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','docker-compose.yml','.dockerignore','START-BIKE-GAME.cmd']) await copy(file);
await copy('lib');
for(const name of ['3d-game','api-server','admin-panel','horse-riding']) {
  const dir=`artifacts/${name}`;
  for(const entry of await readdir(path.join(base,dir),{withFileTypes:true})) {
    if(entry.isDirectory()&&!['src','public','tests','scripts'].includes(entry.name))continue;
    if(!entry.isDirectory()&&!/^(package\.json|.*config\.(ts|json)|Dockerfile|nginx\.conf|index\.html|components\.json|build\.mjs|\.dockerignore)$/.test(entry.name))continue;
    await copy(`${dir}/${entry.name}`);
  }
}
await copy('tools/start-bike.mjs'); await copy('tools/package-bike-betting.mjs');
await copy('docs/bike-racing.md','README.md'); await copy('docs/shared-wallet.md','docs/shared-wallet.md');
for(const name of ['bike-live-3d-1440.png','bike-live-3d-390.png','bike-live-3d-race.png','bike-live-3d-result.png']) await copy(`tmp/${name}`,`validation/${name}`);
await copy('tmp/bike-live-3d-browser-tests.json','validation/browser-tests.json');
await copy('tmp/bike-live-3d-verification.json','validation/verification.json');
// Keep this export focused on the integrated product, with no dangling arcade commands.
const pkg=JSON.parse(await readFile(path.join(output,'package.json'),'utf8'));
for(const key of Object.keys(pkg.scripts))if(key.startsWith('bike:arcade:')||key.startsWith('lottery:'))delete pkg.scripts[key];
delete pkg.scripts['assets:table'];
await writeFile(path.join(output,'package.json'),JSON.stringify(pkg,null,2)+'\n');
console.log(`Complete source, local assets, API, migrations, shared wallet and Docker launcher: ${output}`);
