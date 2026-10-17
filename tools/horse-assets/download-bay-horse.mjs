// Free, unauthenticated CC0 download from the author's published catalog.
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const output=new URL('../../.cache/horse-v4/',import.meta.url);
await mkdir(output,{recursive:true});
const metadata=await fetch('https://grab3d.com/api/v1/models/horse.json').then(r=>{
  if(!r.ok)throw new Error(`Horse catalog: HTTP ${r.status}`);return r.json();
});
const model=metadata.model??metadata;
if(model.license!=='CC0-1.0')throw new Error('Review the current source license before importing.');
const glb=model.files.find(f=>f.format==='glb'&&f.variant==='full');
for(const [url,name] of [[glb.url,'horse-source.glb'],[model.origin.licenseUrl,'LICENSE-grab3d.txt']]){
  const response=await fetch(url);if(!response.ok)throw new Error(`Download: HTTP ${response.status}`);
  const buffer=Buffer.from(await response.arrayBuffer());
  await writeFile(new URL(name,output),buffer);
  console.log(name,buffer.length,createHash('sha256').update(buffer).digest('hex'));
}
await writeFile(new URL('source.json',output),JSON.stringify(model,null,2));
