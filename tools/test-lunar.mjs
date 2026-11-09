import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url)), api = resolve(root, 'artifacts/api-server');
const require = createRequire(resolve(api, 'package.json'));
const outfile = resolve(api, 'node_modules/.cache/lunar.test.mjs');
await mkdir(resolve(outfile, '..'), { recursive: true });
await require('esbuild').build({entryPoints:[resolve(api,'src/lunar-tests/integration.ts')], outfile,
  bundle:true, platform:'node', format:'esm', packages:'external', loader:{'.sql':'text'},
  plugins:[{name:'isolated-lunar-db',setup(build){
    build.onResolve({filter:/^@workspace\/db$/},()=>({path:resolve(api,'src/demo/database.ts')}));
    // Unused table-game admission pool is imported transitively by bets.
    build.onResolve({filter:/rouletteAdmission$/},()=>({path:'admission',namespace:'test'}));
    build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export async function withRouletteAdmission(_id,fn){return fn();}',loader:'js'}));
  }}]});
const result=spawnSync(process.execPath,['--import','tsx','--test',outfile],{cwd:api,stdio:'inherit',
  env:{...process.env,NODE_ENV:'test',LOG_LEVEL:'silent',DATABASE_URL:'',LUNAR_BROWSER:process.argv.includes('--browser')?'1':''}});
process.exitCode=result.status??1;
