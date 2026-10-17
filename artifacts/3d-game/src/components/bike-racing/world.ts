import * as T from 'three';
import { TRACK, TRACK_LENGTH, ROAD_WIDTH, sampleTrack, nearestTrackDistance } from './track';
const standard=(color:string,roughness=.85)=>new T.MeshStandardMaterial({color,roughness});
function seeded(seed:number){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};}
const random=seeded(7347);
const textures=new Map<string,T.Texture>();
export async function loadWorldAssets() {
  await Promise.all(['grass_ground-diff.jpg','grass_ground-nor_gl.jpg','aerial_rocks_02-diff.jpg','tree-canopy-0.png','tree-canopy-1.png','grandstand-crowd.png'].map(async name=>{
    if(textures.has(name))return;
    const t=await new T.TextureLoader().loadAsync(`/assets/bike-racing/environment/${name}`);
    t.colorSpace=name.includes('nor_gl')?T.NoColorSpace:T.SRGBColorSpace;t.anisotropy=8;textures.set(name,t);
  }));
}
function surface(name:string,repeat:number) {const t=textures.get(name)!.clone();t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(repeat,repeat);t.needsUpdate=true;return t;}
function noiseTexture(size:number,base:number,variation:number,tint:[number,number,number]) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;const ctx=canvas.getContext('2d')!;
  const pixels=ctx.createImageData(size,size);
  for(let i=0;i<pixels.data.length;i+=4) {const n=base+(random()-.5)*variation;pixels.data[i]=n*tint[0];pixels.data[i+1]=n*tint[1];pixels.data[i+2]=n*tint[2];pixels.data[i+3]=255;}
  ctx.putImageData(pixels,0,0);const tex=new T.CanvasTexture(canvas);tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=8;return tex;
}
function box(parent:T.Object3D,mat:T.Material,x:number,y:number,z:number,w:number,h:number,d:number,rotation=0) {
  const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.set(x,y,z);m.rotation.y=rotation;m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function ribbon(from:number,to:number,height:number,mat:T.Material,kerb=false) {
  const positions:number[]=[],uv:number[]=[],colors:number[]=[],indices:number[]=[];
  for(let i=0;i<TRACK.length;i++) {
    const p=TRACK[i];
    for(const offset of [from,to]) {positions.push(p.x+p.nx*offset,height,p.z+p.nz*offset);uv.push(offset/6,p.distance/10);const c=new T.Color(Math.floor(p.distance/3.4)%2===0?'#c84037':'#e1ddd0');colors.push(c.r,c.g,c.b);}
    if(i<TRACK.length-1){const a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));if(kerb)g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();
  const m=new T.Mesh(g,mat);m.receiveShadow=true;return m;
}
function billboard(text:string,width=1024,height=180,bg='#161f24',fg='#ddff53') {
  const c=document.createElement('canvas');c.width=width;c.height=height;const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,width,height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`italic 900 ${height*.56}px Arial`;ctx.fillText(text,width/2,height/2);
  const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;return new T.MeshStandardMaterial({map:texture,roughness:.65,side:T.DoubleSide});
}
export function createWorld(scene:T.Scene) {
  const asphaltTex=noiseTexture(512,76,42,[1,1.015,1.035]);
  const asphalt=new T.MeshStandardMaterial({map:asphaltTex,bumpMap:asphaltTex,bumpScale:.022,color:'#929ba5',roughness:.91,side:T.DoubleSide});
  const grassTex=surface('grass_ground-diff.jpg',400),grassNormal=surface('grass_ground-nor_gl.jpg',400);
  const grass=new T.MeshStandardMaterial({map:grassTex,normalMap:grassNormal,normalScale:new T.Vector2(.65,.65),color:'#c1c796',roughness:1});
  const ground=new T.Mesh(new T.PlaneGeometry(3500,3500),grass);ground.rotation.x=-Math.PI/2;ground.position.y=-.045;ground.receiveShadow=true;scene.add(ground);
  const gravel=new T.MeshStandardMaterial({map:asphaltTex,color:'#c7b598',roughness:1,side:T.DoubleSide});
  scene.add(ribbon(-ROAD_WIDTH/2-4,ROAD_WIDTH/2+4,-.01,gravel));
  scene.add(ribbon(-ROAD_WIDTH/2,ROAD_WIDTH/2,.025,asphalt));
  const kerbMat=new T.MeshStandardMaterial({vertexColors:true,roughness:.85,side:T.DoubleSide});
  const white=standard('#edece1');white.side=T.DoubleSide;
  for(const side of [-1,1]) {
    const edge=side*ROAD_WIDTH/2;
    scene.add(ribbon(edge,edge+side*.75,.036,kerbMat,true));
    scene.add(ribbon(edge-side*.17,edge-side*.31,.041,white));
  }
  // Instanced Armco rails and fence posts around both sides of the circuit.
  const count=Math.floor(TRACK_LENGTH/5.5)*2,rails=new T.InstancedMesh(new T.BoxGeometry(1,.17,5.6),standard('#adb4b6',.48),count*3);
  const posts=new T.InstancedMesh(new T.BoxGeometry(.12,1.12,.12),standard('#888f94'),count);
  const fencePosts=new T.InstancedMesh(new T.BoxGeometry(.055,2.8,.055),standard('#666e70'),count);
  const dummy=new T.Object3D();let ri=0,pi=0;
  for(let d=0;d<TRACK_LENGTH-5.5;d+=5.5)for(const side of [-1,1]) {
    const p=sampleTrack(d),offset=side*(ROAD_WIDTH/2+5.6),angle=Math.atan2(p.tx,p.tz);
    dummy.rotation.set(0,angle,0);dummy.scale.set(.095,1,1);
    for(let j=0;j<3;j++){dummy.position.set(p.x+p.nx*offset,.40+j*.24,p.z+p.nz*offset);dummy.updateMatrix();rails.setMatrixAt(ri++,dummy.matrix);}
    dummy.scale.set(1,1,1);dummy.position.y=.55;dummy.updateMatrix();posts.setMatrixAt(pi,dummy.matrix);
    dummy.position.set(p.x+p.nx*(offset+side*.4),1.3,p.z+p.nz*(offset+side*.4));dummy.updateMatrix();fencePosts.setMatrixAt(pi++,dummy.matrix);
  }
  rails.count=ri;posts.count=fencePosts.count=pi;rails.receiveShadow=true;scene.add(rails,posts,fencePosts);
  const wireMat=new T.LineBasicMaterial({color:'#889694',transparent:true,opacity:.28});
  for(const side of [-1,1])for(const y of [1.2,1.7,2.2,2.65]) {
    const pts=TRACK.filter((_,i)=>i%6===0).map(p=>new T.Vector3(p.x+p.nx*side*(ROAD_WIDTH/2+6),y,p.z+p.nz*side*(ROAD_WIDTH/2+6)));
    scene.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(pts),wireMat));
  }
  // Start-finish stripe, grid boxes and pit lane.
  for(let x=-6;x<6;x+=.6)for(let j=0;j<3;j++) {
    const p=sampleTrack(j*.6),mat=(Math.round(x/.6)+j)%2===0?white:standard('#171d21');
    const m=box(scene,mat,p.x+p.nx*x,.05,p.z+p.nz*x,.59,.012,.59,Math.atan2(p.tx,p.tz));m.castShadow=false;
  }
  for(let i=0;i<12;i++) {
    const p=sampleTrack(-8-i*6),o=i%2===0?-2.4:2.4;
    const g=new T.Group();g.position.set(p.x+p.nx*o,.06,p.z+p.nz*o);g.rotation.y=Math.atan2(p.tx,p.tz);scene.add(g);
    box(g,white,0,0,0,1.3,.012,.06);box(g,white,-.65,0,-.3,.06,.012,.6);box(g,white,.65,0,-.3,.06,.012,.6);
  }
  const building=standard('#e0dfd5'),dark=standard('#18252c'),roof=standard('#a7afb0'),glass=new T.MeshStandardMaterial({color:'#315764',metalness:.7,roughness:.25});
  const pit=new T.Group();pit.position.set(-27,0,67);scene.add(pit);
  box(pit,building,0,3.2,0,16,6.4,112);box(pit,roof,0,6.6,0,18,.45,114);
  box(pit,glass,8.05,4.8,0,.08,2.3,108);box(pit,dark,8.17,3.5,0,.10,.3,112);
  for(let j=0;j<12;j++){box(pit,dark,8.08,1.5,-50+j*9,.12,2.8,7.8);box(pit,roof,8.2,1.5,-50+j*9,.13,.08,7.5);}
  const pitSign=new T.Mesh(new T.PlaneGeometry(80,1.6),billboard('APEX  /  MOTORSPORT',2048,120));pitSign.position.set(8.3,6,-2);pitSign.rotation.y=Math.PI/2;pit.add(pitSign);
  const stand=new T.Group();stand.position.set(28,0,95);scene.add(stand);
  for(let step=0;step<7;step++) {
    box(stand,standard(step%2===0?'#596875':'#6d7881'),step*.9,1+step*.6,0,1.1,.5,100);
  }
  box(stand,dark,2,6.1,0,13,.24,105);
  for(let z=-48;z<=48;z+=12)box(stand,roof,6.9,3,z,.18,6,.18);
  const crowdTex=surface('grandstand-crowd.png',1);crowdTex.repeat.set(5,1);
  const crowdMat=new T.MeshStandardMaterial({map:crowdTex,roughness:1,side:T.DoubleSide});
  for(let row=0;row<3;row++) {const crowd=new T.Mesh(new T.PlaneGeometry(100,1.45),crowdMat);crowd.position.set(28+row*1.8,1.7+row*1.2,95);crowd.rotation.y=-Math.PI/2;scene.add(crowd);}
  const gantry=new T.Group();scene.add(gantry);
  const p=sampleTrack(7);gantry.position.set(p.x,0,p.z);gantry.rotation.y=Math.atan2(p.tx,p.tz);
  for(const side of [-1,1])box(gantry,roof,side*9,3.3,0,.4,6.6,.4);
  box(gantry,dark,0,6.3,0,19,1.3,.6);
  const sign=new T.Mesh(new T.PlaneGeometry(16,1.12),billboard('A P E X   /   RACING WITHOUT LIMITS',2048,150));sign.position.set(0,6.3,-.32);sign.rotation.y=Math.PI;gantry.add(sign);
  const lights=new T.Group();lights.position.set(0,4.9,0);gantry.add(lights);
  for(let i=0;i<5;i++){const lamp=new T.Mesh(new T.SphereGeometry(.15,12,8),new T.MeshStandardMaterial({color:'#c82e2e',emissive:'#9e1515',emissiveIntensity:.4}));lamp.position.set((i-2)*.48,0,-.3);lights.add(lamp);}
  // Circuit identity boards at the braking zones.
  for(const d of [180,330,580,740,920,1150,1320])for(const side of [-1,1]) {
    const q=sampleTrack(d),board=new T.Mesh(new T.PlaneGeometry(13,1.8),billboard(d%3===0?'RIVIERA CIRCUIT':'APEX  MOTORSPORT'));
    board.position.set(q.x+q.nx*side*13,1.5,q.z+q.nz*side*13);board.rotation.y=Math.atan2(q.tx,q.tz)+side*Math.PI/2;scene.add(board);
  }
  // Trees are instanced to keep draw calls bounded on phones.
  const treeCount=650;
  const foliageMaterials=[0,1].map(i=>new T.MeshBasicMaterial({map:textures.get(`tree-canopy-${i}.png`)!.clone(),alphaTest:.35,side:T.DoubleSide,color:'#ffffff'}));
  const foliage=foliageMaterials.map(mat=>new T.InstancedMesh(new T.PlaneGeometry(1,1),mat,treeCount));
  let ti=0;
  for(let tries=0;tries<2500&&ti<treeCount;tries++) {
    const x=random()*1200-440,z=random()*1100-530;
    if(nearestTrackDistance(x,z)<23||x>-55&&x<70&&z>-25&&z<170)continue;
    const h=7+random()*10,rotation=random()*Math.PI;
    for(let j=0;j<2;j++) {
      dummy.position.set(x,h*.48,z);dummy.rotation.set(0,rotation+j*Math.PI/2,0);dummy.scale.set(h*.9,h,1);dummy.updateMatrix();foliage[j].setMatrixAt(ti,dummy.matrix);
      foliage[j].setColorAt(ti,new T.Color().setHSL(.15+random()*.05,.03+random()*.04,.93+random()*.07));
    }ti++;
  }
  for(const f of foliage){f.count=ti;f.castShadow=true;f.receiveShadow=true;f.customDepthMaterial=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking,map:f.material.map,alphaTest:.43,side:T.DoubleSide});scene.add(f);}
  const hillsGeo=new T.PlaneGeometry(3200,3200,90,90);hillsGeo.rotateX(-Math.PI/2);
  const vertices=hillsGeo.attributes.position;
  for(let i=0;i<vertices.count;i++) {
    const x=vertices.getX(i),z=vertices.getZ(i),r=Math.hypot((x-100)*.9,z);
    const ridge=Math.max(0,Math.min(1,(r-550)/500));
    const h=ridge*(48+28*Math.sin(x*.007)*Math.cos(z*.005)+20*Math.sin(x*.016+z*.009)+8*Math.sin(x*.034-z*.012));
    vertices.setY(i,h-3);
  }
  hillsGeo.computeVertexNormals();
  const hills=new T.Mesh(hillsGeo,new T.MeshStandardMaterial({map:surface('aerial_rocks_02-diff.jpg',32),color:'#8eaa84',roughness:1}));hills.receiveShadow=true;scene.add(hills);
  // Brake distance markers, consistently facing the approaching rider.
  for(const d of [270,590,850,1080,1340])for(let j=1;j<=3;j++) {
    const q=sampleTrack(d-j*28);const board=new T.Mesh(new T.PlaneGeometry(1.7,1.8),billboard(String(j*50),128,128,'#eeeade','#202926'));
    board.position.set(q.x-q.nx*9.4,1.2,q.z-q.nz*9.4);board.rotation.y=Math.atan2(q.tx,q.tz)+Math.PI;scene.add(board);
  }
  return {lights};
}
