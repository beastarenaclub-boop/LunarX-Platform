import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  resolve(root, "artifacts/api-server/package.json"),
);
const { build } = require("esbuild");
const out = resolve(root, "lib/db/node_modules/.cache/handoff-schema.mjs");
await mkdir(resolve(out, ".."), { recursive: true });
await build({
  stdin: {
    contents: String.raw`
import * as schema from "${resolve(root, "lib/db/src/schema/index.ts").replaceAll("\\", "/")}";
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const {generateDrizzleJson,generateMigration}=require('drizzle-kit/api');
const dir=${JSON.stringify(resolve(root, "lib/db/drizzle"))};
const previous=JSON.parse(await readFile(dir+'/meta/0064_snapshot.json','utf8'));
const current=JSON.parse(JSON.stringify(generateDrizzleJson(schema),(_k,v)=>typeof v==='bigint'?String(v):v));
current.id=randomUUID();current.prevId=previous.id;
const statements=await generateMigration(previous,current);
const tag='0065_handoff_game_control';
await writeFile(dir+'/'+tag+'.sql',statements.join('\n--> statement-breakpoint\n')+'\n');
await writeFile(dir+'/meta/0065_snapshot.json',JSON.stringify(current,null,2)+'\n');
const journal=JSON.parse(await readFile(dir+'/meta/_journal.json','utf8'));
if (!journal.entries.some(e=>e.tag===tag)) journal.entries.push({idx:65,version:'7',when:Math.max(Date.now(),journal.entries.at(-1).when+1),tag,breakpoints:true});
await writeFile(dir+'/meta/_journal.json',JSON.stringify(journal,null,2)+'\n');
const all=await generateMigration(generateDrizzleJson({}),current);
await writeFile(${JSON.stringify(resolve(root, "artifacts/api-server/src/demo/schema.generated.sql"))},all.join('\n').replace(/ON DELETE (?:no action|restrict|set null)/gi,'ON DELETE cascade'));
console.log('Prepared migration 0065: '+statements.length+' statements.');
`,
    resolveDir: root,
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
const result = spawnSync(process.execPath, [out], {
  cwd: root,
  stdio: "inherit",
});
process.exitCode = result.status ?? 1;
