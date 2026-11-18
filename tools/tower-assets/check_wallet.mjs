import {createRequire} from 'node:module';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {unlinkSync} from 'node:fs';
const root=process.cwd(),api=path.join(root,'artifacts/api-server');
const require=createRequire(path.join(api,'package.json'));
const {build}=require('esbuild');
const output=path.join(api,'.tower-rules-wallet-check.mjs');
await build({entryPoints:[path.join(api,'src/services/__tests__/towerRules.integration.ts')],outfile:output,platform:'node',format:'esm',bundle:true,nodePaths:[path.join(api,'node_modules')],packages:'bundle',external:['@electric-sql/pglite','pino','pino-pretty'],loader:{'.sql':'text'},define:{__DEMO_WORKER__:'false'},banner:{js:"import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);"},plugins:[{name:'isolated-db',setup(build){build.onResolve({filter:/^@workspace\/db$/},()=>({path:path.join(api,'src/demo/database.ts')}));}}]});
try {const result=spawnSync(process.execPath,[output],{cwd:root,stdio:'inherit',env:{...process.env,NODE_ENV:'production',LOG_LEVEL:'silent',DATABASE_URL:'postgresql://invalid@127.0.0.1:1/forbidden'}});process.exitCode=result.status??1;}
finally{unlinkSync(output);}
