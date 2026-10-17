import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let riderTemplate:T.Group|null=null;
export async function loadRider() {if(!riderTemplate)riderTemplate=(await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/rider.glb`)).scene;}

export type BikeModel={root:T.Group;body:T.Group;wheels:T.Group[]};
const material=(color:string,metalness=.1,roughness=.45)=>new T.MeshStandardMaterial({color,metalness,roughness});
function mesh(parent:T.Group,geometry:T.BufferGeometry,mat:T.Material,x=0,y=0,z=0,scale?:number[]) {
  const m=new T.Mesh(geometry,mat);m.position.set(x,y,z);if(scale)m.scale.set(...scale as [number,number,number]);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;
}
function rod(parent:T.Group,a:number[],b:number[],radius:number,mat:T.Material,r2=radius) {
  const start=new T.Vector3(...a as [number,number,number]),end=new T.Vector3(...b as [number,number,number]);
  const m=mesh(parent,new T.CylinderGeometry(r2,radius,start.distanceTo(end),12),mat);
  m.position.copy(start).lerp(end,.5);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),end.sub(start).normalize());return m;
}
function ellipsoid(parent:T.Group,mat:T.Material,p:number[],s:number[]) {return mesh(parent,new T.SphereGeometry(1,24,16),mat,...p as [number,number,number],s);}
// Elliptical sections form smooth, tapered fairings instead of stacked primitives.
function loft(parent:T.Group,sections:number[][],mat:T.Material) {
  const vertices:number[]=[],indices:number[]=[],segments=32;
  for(const [z,y,w,h] of sections)for(let i=0;i<=segments;i++) {
    const a=i/segments*Math.PI*2;vertices.push(Math.cos(a)*w,y+Math.sin(a)*h,z);
  }
  for(let j=0;j<sections.length-1;j++)for(let i=0;i<segments;i++) {
    const a=j*(segments+1)+i,b=a+segments+1;indices.push(a,a+1,b,b,a+1,b+1);
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();return mesh(parent,g,mat);
}
function panel(parent:T.Group,points:number[][],mat:T.Material) {
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(points.flat(),3));
  const indices:number[]=[];for(let i=1;i<points.length-1;i++)indices.push(0,i,i+1);g.setIndex(indices);g.computeVertexNormals();return mesh(parent,g,mat);
}
function combine(group:T.Group) {
  group.updateMatrixWorld(true);
  const batches=new Map<T.Material,T.BufferGeometry[]>();
  group.traverse(o=>{if(o instanceof T.Mesh && !Array.isArray(o.material)) {const g=o.geometry.clone().applyMatrix4(o.matrixWorld);for(const attribute of Object.keys(g.attributes))if(attribute!=='position'&&attribute!=='normal')g.deleteAttribute(attribute);const gs=batches.get(o.material)||[];gs.push(g);batches.set(o.material,gs);}});
  const old:T.Mesh[]=[];group.traverse(o=>{if(o instanceof T.Mesh)old.push(o);});group.clear();for(const m of old)m.geometry.dispose();
  for(const [mat,geometries]of batches) {const g=mergeGeometries(geometries,false);if(g)mesh(group,g,mat);for(const source of geometries)source.dispose();}
}
export function createBike(color='#197bee',accent='#f14751',rider=true):BikeModel {
  const root=new T.Group(),body=new T.Group();root.add(body);
  const paint=new T.MeshPhysicalMaterial({color,metalness:.35,roughness:.32,clearcoat:1,clearcoatRoughness:.18,side:T.DoubleSide});
  const stripe=new T.MeshStandardMaterial({color:accent,roughness:.36,metalness:.25,side:T.DoubleSide});
  const carbon=material('#10151d',.45,.38),metal=material('#828991',.85,.28),dark=material('#1b2026',.75,.34),rubber=material('#101215',0,.86);
  const white=new T.MeshStandardMaterial({color:'#e8edf5',metalness:.3,roughness:.3,side:T.DoubleSide});
  const gold=material('#c8a150',.8,.24),leather=material('#161b24',.08,.63),seam=material('#333c49',.16,.58);
  const glass=new T.MeshPhysicalMaterial({color:'#839eac',metalness:.35,roughness:.12,transparent:true,opacity:.58,side:T.DoubleSide,clearcoat:1});
  const glow=new T.MeshStandardMaterial({color:'#f0faff',emissive:'#b9e4ff',emissiveIntensity:2});
  const tailLight=new T.MeshStandardMaterial({color:'#ff2634',emissive:'#ff1122',emissiveIntensity:2});
  const wheels:T.Group[]=[];
  for(const z of [-.84,.88]) {
    const wheel=new T.Group();wheel.position.set(0,.365,z);root.add(wheel);wheels.push(wheel);
    const tyre=mesh(wheel,new T.TorusGeometry(.272,.098,16,48),rubber);tyre.rotation.y=Math.PI/2;
    for(const side of [-1,1]) {
      const rim=mesh(wheel,new T.TorusGeometry(.229,.018,8,40),dark,side*.052);rim.rotation.y=Math.PI/2;
      const trim=mesh(wheel,new T.TorusGeometry(.24,.005,6,40),paint,side*.075);trim.rotation.y=Math.PI/2;
      const disc=mesh(wheel,new T.CylinderGeometry(.189,.189,.009,48),metal,side*.083);disc.rotation.z=Math.PI/2;
      const hub=mesh(wheel,new T.CylinderGeometry(.062,.062,.022,24),dark,side*.09);hub.rotation.z=Math.PI/2;
      for(let j=0;j<24;j++) {
        const a=j/24*Math.PI*2;
        const hole=mesh(wheel,new T.CircleGeometry(.007,6),rubber,side*.089,Math.sin(a)*.161,Math.cos(a)*.161);hole.rotation.y=side*Math.PI/2;
      }
      for(let j=0;j<6;j++) {
        const a=j/6*Math.PI*2;
        rod(wheel,[side*.055,Math.sin(a)*.05,Math.cos(a)*.05],[side*.055,Math.sin(a+.18)*.227,Math.cos(a+.18)*.227],.015,dark);
      }
    }
    // Merge in wheel-local space, keeping the complete wheel independently animated.
    const pos=wheel.position.clone();wheel.position.set(0,0,0);combine(wheel);wheel.position.copy(pos);
  }
  for(const side of [-1,1]) {
    rod(body,[side*.14,.37,.88],[side*.17,1.05,.61],.035,gold);
    rod(body,[side*.17,.36,.88],[side*.17,.65,.78],.043,metal);
    rod(body,[side*.15,.37,-.84],[side*.19,.51,-.15],.046,dark);
    rod(body,[side*.21,.57,-.39],[side*.17,.92,.46],.037,metal);
    rod(body,[side*.21,.57,-.39],[side*.18,1.0,-.31],.025,dark);
    const caliper=mesh(body,new T.BoxGeometry(.08,.12,.10),gold,side*.14,.42,.99);caliper.rotation.x=-.25;
    rod(body,[side*.18,.65,-.32],[side*.35,.65,-.33],.025,metal);
  }
  ellipsoid(body,dark,[0,.55,0],[.23,.25,.29]);
  for(const side of [-1,1]) {const cover=mesh(body,new T.CylinderGeometry(.125,.125,.08,24),dark,side*.21,.55,0);cover.rotation.z=Math.PI/2;}
  loft(body,[[-.68,.76,.015,.02],[-.48,.72,.18,.18],[-.2,.66,.27,.29],[.26,.65,.28,.26],[.52,.75,.26,.23],[.6,.79,.02,.02]],carbon);
  loft(body,[[-.42,.96,.1,.06],[-.26,1.02,.22,.16],[.02,1.05,.25,.17],[.28,1.01,.205,.16],[.48,.94,.13,.11]],paint);
  const cap=mesh(body,new T.CylinderGeometry(.06,.06,.008,24),metal,0,1.215,0);
  cap.rotation.x=-.1;
  loft(body,[[-1.09,1.02,.01,.025],[-.92,1.045,.17,.07],[-.65,1.00,.2,.10],[-.35,.965,.16,.05]],paint);
  ellipsoid(body,rubber,[0,1.035,-.52],[.17,.037,.29]);
  mesh(body,new T.BoxGeometry(.18,.026,.04),tailLight,0,1.037,-1.025);
  loft(body,[[.29,.99,.21,.12],[.48,1.055,.3,.2],[.77,1.06,.32,.16],[.99,.975,.25,.09],[1.1,.96,.02,.025]],paint);
  for(const side of [-1,1]) {
    panel(body,[[side*.285,1.02,.7],[side*.32,.88,.4],[side*.25,.4,.1],[side*.22,.38,-.25],[side*.31,.78,-.02]],paint);
    panel(body,[[side*.325,.88,.42],[side*.323,.82,.36],[side*.259,.48,.02],[side*.234,.43,-.2],[side*.277,.6,-.12]],stripe);
    panel(body,[[side*.321,.92,.47],[side*.325,.88,.40],[side*.303,.72,.02],[side*.3,.8,-.01]],white);
    panel(body,[[side*.33,.9,.37],[side*.333,.82,.18],[side*.3,.76,-.03],[side*.302,.88,.05]],carbon);
    const light=ellipsoid(body,glow,[side*.195,1.022,.973],[.083,.018,.025]);light.rotation.z=side*.15;
    rod(body,[side*.24,1.15,.63],[side*.43,1.2,.66],.018,carbon);
    ellipsoid(body,carbon,[side*.45,1.2,.66],[.09,.04,.043]);
    panel(body,[[side*.27,.89,.8],[side*.45,.82,.86],[side*.45,.8,.65],[side*.28,.83,.61]],carbon);
    rod(body,[side*.12,1.08,.48],[side*.35,1.075,.44],.026,metal);
    rod(body,[side*.25,1.075,.45],[side*.38,1.075,.42],.031,rubber);
    rod(body,[side*.31,1.07,.49],[side*.39,1.07,.51],.01,metal);
  }
  // Curved double-bubble racing screen.
  const screenPoints:number[]=[],screenIndices:number[]=[];
  for(let row=0;row<=10;row++)for(let col=0;col<=20;col++) {
    const u=col/20*2-1,v=row/10;
    screenPoints.push(u*(.21-v*.035),1.12+v*.27+(1-u*u)*.06,.81-v*.41);
  }
  for(let r=0;r<10;r++)for(let c=0;c<20;c++){const a=r*21+c;screenIndices.push(a,a+1,a+21,a+1,a+22,a+21);}
  const sg=new T.BufferGeometry();sg.setAttribute('position',new T.Float32BufferAttribute(screenPoints,3));sg.setIndex(screenIndices);sg.computeVertexNormals();mesh(body,sg,glass);
  // Front fender, exhaust, chain and sprocket.
  const fender=mesh(body,new T.TorusGeometry(.398,.052,8,24,Math.PI*.73),paint,0,.365,.88);fender.rotation.set(0,Math.PI/2,Math.PI*.13);fender.scale.z=2.8;
  rod(body,[.21,.38,.25],[.27,.27,-.28],.042,metal);
  rod(body,[.27,.27,-.28],[.31,.48,-.76],.071,dark,.055);
  const exhaust=mesh(body,new T.CylinderGeometry(.053,.053,.035,20),metal,.31,.48,-.77);exhaust.rotation.x=-.4;
  rod(body,[-.18,.5,-.12],[-.18,.51,-.83],.012,gold);
  rod(body,[-.18,.42,-.12],[-.18,.23,-.83],.012,gold);
  const sprocket=mesh(body,new T.TorusGeometry(.12,.012,6,32),gold,-.17,.365,-.84);sprocket.rotation.y=Math.PI/2;
  if(rider) {
    if(riderTemplate) {
      const fitted=riderTemplate.clone(true);
      fitted.traverse(o=>{if(o instanceof T.Mesh){o.geometry=o.geometry.clone();o.material=(o.material as T.MeshStandardMaterial).clone();if(o.material.name==='SuitAccent')o.material.color.set(accent);}});
      body.add(fitted);
    }
    if(!riderTemplate) {
    // A tucked racing posture, with articulated arms and knees wrapped around the tank.
    const torso=ellipsoid(body,leather,[0,1.32,-.17],[.245,.205,.40]);torso.rotation.x=-.44;
    const back=ellipsoid(body,carbon,[0,1.51,-.22],[.16,.10,.24]);back.rotation.x=-.42;
    ellipsoid(body,leather,[0,1.12,-.51],[.235,.17,.21]);
    for(const side of [-1,1]) {
      const shoulder=[side*.23,1.45,.06],elbow=[side*.37,1.18,.14],hand=[side*.33,1.105,.43];
      rod(body,shoulder,elbow,.10,leather,.11);ellipsoid(body,seam,elbow,[.097,.1,.1]);rod(body,elbow,hand,.069,leather,.082);
      ellipsoid(body,leather,hand,[.072,.064,.092]);
      ellipsoid(body,stripe,[side*.235,1.46,.05],[.026,.082,.09]);
      rod(body,[side*.26,1.4,-.025],[side*.29,1.27,.04],.011,stripe);
      const hip=[side*.16,1.14,-.52],knee=[side*.35,.8,-.06],ankle=[side*.31,.56,-.48];
      rod(body,hip,knee,.126,leather,.106);ellipsoid(body,carbon,knee,[.105,.13,.095]);
      ellipsoid(body,stripe,[side*.437,.81,-.065],[.017,.072,.07]);
      rod(body,knee,ankle,.073,leather,.09);rod(body,[side*.285,1.045,-.39],[side*.375,.86,-.115],.012,stripe);
      const boot=ellipsoid(body,carbon,[side*.31,.58,-.36],[.081,.077,.18]);boot.rotation.x=-.3;
      ellipsoid(body,white,[side*.384,.60,-.43],[.012,.052,.058]);
      rod(body,[side*.13,1.48,-.39],[side*.15,1.54,-.1],.011,stripe);
    }
    rod(body,[0,1.43,.11],[0,1.49,.32],.10,leather);
    }
    const helmetGroup=new T.Group();body.add(helmetGroup);
    if(riderTemplate) {riderTemplate.updateMatrixWorld(true);const anchor=riderTemplate.getObjectByName('HelmetAnchor');if(anchor)helmetGroup.position.copy(anchor.getWorldPosition(new T.Vector3())).sub(new T.Vector3(0,1.555,.43));}
    const helmet=ellipsoid(helmetGroup,carbon,[0,1.555,.43],[.208,.235,.255]);helmet.rotation.x=.25;
    const visorMat=new T.MeshPhysicalMaterial({color:'#08111c',metalness:.8,roughness:.09,clearcoat:1});
    // Visor hugs the helmet shell rather than protruding as a separate sphere.
    const visor=mesh(helmetGroup,new T.SphereGeometry(1,40,14,.38,Math.PI-.76,1.0,.70),visorMat,0,1.555,.432,[.212,.239,.261]);
    visor.rotation.y=0;
    for(const side of [-1,1]) {
      rod(helmetGroup,[side*.075,1.773,.41],[side*.124,1.724,.568],.004,stripe);
      rod(helmetGroup,[side*.13,1.72,.26],[side*.194,1.653,.4],.004,stripe);
      ellipsoid(helmetGroup,metal,[side*.208,1.55,.445],[.005,.021,.023]);
    }
    ellipsoid(helmetGroup,stripe,[0,1.40,.595],[.13,.006,.018]);
  }
  combine(body);
  return {root,body,wheels};
}
