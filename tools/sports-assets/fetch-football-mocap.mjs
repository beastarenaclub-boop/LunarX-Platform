// Original CMU capture, retained locally with its source terms and checksum.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('../../.cache/football-pro/mocap/',import.meta.url);
await mkdir(root,{recursive:true});
const files=[];
for(const filename of ['10.asf','10_01.amc','10_04.amc']){
 const url=`http://mocap.cs.cmu.edu/subjects/10/${filename}`;
 const response=await fetch(url,{signal:AbortSignal.timeout(45000)});
 if(!response.ok)throw new Error(`${url}: ${response.status}`);
 const bytes=Buffer.from(await response.arrayBuffer());
 if(!bytes.toString('utf8',0,120).includes('ASF'))throw new Error(`Unexpected source: ${filename}`);
 await writeFile(new URL(filename,root),bytes);
 files.push({filename,url,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
 console.log('CMU motion:',filename,bytes.length);
}
const provenance={source:'Carnegie Mellon University Graphics Lab Motion Capture Database',subject:10,captureRate:120,sourcePage:'http://mocap.cs.cmu.edu/search.php?subjectnumber=10',termsPage:'http://mocap.cs.cmu.edu/',terms:'May be included in commercially-sold products. The motion data itself may not be resold, even in converted form.',files};
await writeFile(new URL('../../artifacts/unity-sports/Assets/Resources/Sports/football-mocap-provenance.json',import.meta.url),JSON.stringify(provenance,null,2)+'\n');
