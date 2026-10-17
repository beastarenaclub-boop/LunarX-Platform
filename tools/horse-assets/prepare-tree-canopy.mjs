// Preserve complete leaf silhouettes instead of collapsing every leaf away.
import { NodeIO } from '../../.cache/horse-v4/rig-tools/node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS } from '../../.cache/horse-v4/rig-tools/node_modules/@gltf-transform/extensions/dist/index.js';
import { prune } from '../../.cache/horse-v4/rig-tools/node_modules/@gltf-transform/functions/dist/index.js';
import { readFile, writeFile } from 'node:fs/promises';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc=await io.read('.cache/horse-realism/tree/island_tree_01.gltf');
const leaf=doc.getRoot().listMeshes()[0].listPrimitives().find(p=>p.getMaterial().getName().endsWith('leaves'));
const position=leaf.getAttribute('POSITION'),normal=leaf.getAttribute('NORMAL'),uv=leaf.getAttribute('TEXCOORD_0');
const indices=leaf.getIndices().getArray(),p=[],n=[],t=[],tri=[];
let kept=0;
for(let offset=0;offset<indices.length;offset+=72){
  const ids=[...new Set(indices.slice(offset,offset+72))];
  if(ids.length!==21)throw new Error('Unexpected leaf topology; review the source before sampling.');
  const id=offset/72;
  if(((Math.imul(id,1664525)+1013904223)>>>0)%8!==0)continue;
  const uvs=ids.map(i=>uv.getElement(i,[]));
  const lo=[Math.min(...uvs.map(v=>v[0])),Math.min(...uvs.map(v=>v[1]))];
  const hi=[Math.max(...uvs.map(v=>v[0])),Math.max(...uvs.map(v=>v[1]))];
  // Source vertices follow the tapered leaf outline. Taking its nearest
  // corners collapses the tip to a needle. Fit a plane in UV space instead.
  const points=ids.map(i=>position.getElement(i,[]));
  const center=[0,1,2].map(axis=>points.reduce((sum,v)=>sum+v[axis],0)/ids.length);
  const mean=[0,1].map(axis=>uvs.reduce((sum,v)=>sum+v[axis],0)/ids.length);
  let uu=0,vv=0,uvCross=0;const pu=[0,0,0],pv=[0,0,0],averageNormal=[0,0,0];
  for(let k=0;k<ids.length;k++){
    const u=uvs[k][0]-mean[0],v=uvs[k][1]-mean[1];uu+=u*u;vv+=v*v;uvCross+=u*v;
    const norm=normal.getElement(ids[k],[]);
    for(let axis=0;axis<3;axis++){pu[axis]+=u*(points[k][axis]-center[axis]);pv[axis]+=v*(points[k][axis]-center[axis]);averageNormal[axis]+=norm[axis];}
  }
  const det=uu*vv-uvCross*uvCross;
  const alongU=pu.map((v,i)=>(v*vv-pv[i]*uvCross)/det),alongV=pv.map((v,i)=>(v*uu-pu[i]*uvCross)/det);
  const normalLength=Math.hypot(...averageNormal);const flatNormal=averageNormal.map(v=>v/normalLength);
  const corners=[[lo[0],lo[1]],[hi[0],lo[1]],[hi[0],hi[1]],[lo[0],hi[1]]];
  const base=p.length/3;
  for(let k=0;k<4;k++){
    p.push(...center.map((v,axis)=>v+((corners[k][0]-mean[0])*alongU[axis]+(corners[k][1]-mean[1])*alongV[axis])*2.7));
    n.push(...flatNormal);t.push(...corners[k]);
  }
  tri.push(base,base+1,base+2,base,base+2,base+3);kept++;
}
const buffer=doc.getRoot().listBuffers()[0];
const attribute=(type,data)=>doc.createAccessor().setBuffer(buffer).setType(type).setArray(data);
leaf.setAttribute('POSITION',attribute('VEC3',new Float32Array(p)))
 .setAttribute('NORMAL',attribute('VEC3',new Float32Array(n)))
 .setAttribute('TEXCOORD_0',attribute('VEC2',new Float32Array(t))).setAttribute('TANGENT',null)
 .setIndices(attribute('SCALAR',new Uint32Array(tri)));
await doc.transform(prune());
await io.write('.cache/horse-v4/tree-canopy.glb',doc);
const metadata=JSON.parse(await readFile('.cache/horse-v4/tree-source.json','utf8'));
const url=metadata.leaves_alpha['1k'].png.url;
const response=await fetch(url);if(!response.ok)throw new Error('Leaf alpha download failed');
await writeFile('.cache/horse-v4/tree-leaf-alpha.png',Buffer.from(await response.arrayBuffer()));
console.log(JSON.stringify({leaves:kept,leafTriangles:tri.length/3,sourceTriangles:indices.length/3,alpha:url}));
