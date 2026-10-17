import * as THREE from "three";
import { trackPoint } from "./race3dMath";

let loam: THREE.Texture;
let loading: Promise<void> | undefined;
export function loadRacingDirt() {
  return (loading ??= new THREE.TextureLoader()
    .loadAsync("/assets/horse-racing/realistic/earth/racing-loam-v1.png")
    .then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 16;
      loam = texture;
    })
    .catch((error) => {
      loading = undefined;
      throw error;
    }));
}

/** Photographic granular soil, damp compaction and shallow harrow relief.
 * Both colour and the lighting normal use the same two-scale height field.
 */
export function racingDirtMaterial(desert: boolean) {
  const map = loam.clone();
  map.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    color: desert ? "#cdbca5" : "#aba092",
    map,
    bumpMap: map,
    bumpScale: 0.022,
    roughness: 0.96,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader =
      `varying vec3 soilPosition;\n${shader.vertexShader}`.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nsoilPosition = (modelMatrix * vec4(transformed,1.)).xyz;",
      );
    shader.fragmentShader =
      `varying vec3 soilPosition;\n${shader.fragmentShader}`
        .replace(
          "#include <map_pars_fragment>",
          `#include <map_pars_fragment>
       float earthHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
       float earthNoise(vec2 p) {
         vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
         return mix(mix(earthHash(i),earthHash(i+vec2(1.,0.)),f.x),
           mix(earthHash(i+vec2(0.,1.)),earthHash(i+vec2(1.)),f.x),f.y);
       }
       vec3 earthSample(vec2 p) {
         vec3 nearSoil=texture2D(map,p*.29).rgb;
         vec3 crossSoil=texture2D(map,mat2(.8,.6,-.6,.8)*p*.61+vec2(.37,.19)).rgb;
         return mix(nearSoil,crossSoil,.24+.22*earthNoise(p*.39));
       }`,
        )
        .replace(
          "#include <map_fragment>",
          `vec2 earthP=soilPosition.xz;
       vec3 earthColor=earthSample(earthP);
       float compaction=earthNoise(earthP*.14)*.65+earthNoise(earthP*.43)*.35;
       float trackRadius=length(vec2(max(abs(earthP.x)-70.,0.),earthP.y));
       float furrowPhase=trackRadius*44.+earthNoise(earthP*1.3)*1.6;
       float furrow=pow(.5+.5*sin(furrowPhase),7.)
         * (1.-smoothstep(.4,2.,fwidth(furrowPhase)));
       float churn=smoothstep(.27,.73,earthNoise(earthP*.65));
       diffuseColor.rgb *= earthColor * mix(.72,1.2,compaction);
       diffuseColor.rgb *= 1.-furrow*.16*(1.-churn*.7);
       float soilHeight=dot(earthColor,vec3(.2126,.7152,.0722))*.075
         - furrow*.003*(1.-churn*.7);`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          `normal=perturbNormalArb(-vViewPosition,normal,
         vec2(dFdx(soilHeight),dFdy(soilHeight)),faceDirection);`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          "#include <roughnessmap_fragment>\nroughnessFactor=clamp(.80+compaction*.18,.8,.99);",
        );
  };
  material.customProgramCacheKey = () => "granular-racing-loam-v1";
  return material;
}

/** Small physical clods and inset hoof scuffs: two instanced draws per octant. */
export function racingDirtDetails(phone: boolean) {
  const group = new THREE.Group();
  let seed = 1741;
  const random = () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const clodGeometry = new THREE.IcosahedronGeometry(1, 0);
  const clodMaterial = new THREE.MeshStandardMaterial({
    color: "#796048",
    roughness: 1,
  });
  // The open U-shaped impression has a dark pressed centre and raised earthy
  // rim, with a rounded toe. Geometry, rather than black painted circles.
  const vertices: number[] = [],
    colors: number[] = [];
  for (let i = 0; i < 18; i++) {
    const a = -Math.PI * 0.18 + (i / 18) * Math.PI * 1.36;
    const b = -Math.PI * 0.18 + ((i + 1) / 18) * Math.PI * 1.36;
    const point = (angle: number, r: number, y: number) => [
      Math.cos(angle) * 0.115 * r,
      y,
      Math.sin(angle) * 0.145 * r,
    ];
    for (const [angle, r, y] of [
      [a, 0.76, 0.001],
      [a, 1, 0.004],
      [b, 1, 0.004],
      [a, 0.76, 0.001],
      [b, 1, 0.004],
      [b, 0.76, 0.001],
    ]) {
      vertices.push(...point(angle, r, y));
      colors.push(...(r < 0.8 ? [0.048, 0.026, 0.012] : [0.12, 0.076, 0.041]));
    }
  }
  const scuffGeometry = new THREE.BufferGeometry();
  scuffGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  scuffGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3),
  );
  scuffGeometry.computeVertexNormals();
  const scuffMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  for (let octant = 0; octant < 8; octant++) {
    const count = phone ? 150 : 400;
    const clods = new THREE.InstancedMesh(clodGeometry, clodMaterial, count);
    const scuffs = new THREE.InstancedMesh(scuffGeometry, scuffMaterial, count);
    for (let i = 0; i < count; i++) {
      const progress = (octant + random()) / 8;
      const radius = 32.7 + random() * 20.6;
      const p = trackPoint(progress, (radius - 35) / 2.15);
      dummy.position.set(p.x, 0.007, p.z);
      dummy.rotation.set(0, p.heading + (random() - 0.5) * 0.8, 0);
      const size = 0.72 + random() * 0.85;
      dummy.scale.set(size, 1, size);
      dummy.updateMatrix();
      scuffs.setMatrixAt(i, dummy.matrix);
      dummy.position.x += (random() - 0.5) * 0.9;
      dummy.position.z += (random() - 0.5) * 0.9;
      dummy.position.y = 0.012;
      const width = 0.017 + Math.pow(random(), 3) * 0.065;
      dummy.scale.set(
        width,
        width * (0.3 + random() * 0.3),
        width * (0.7 + random() * 0.6),
      );
      dummy.rotation.set(random() * 2, random() * 6, random());
      dummy.updateMatrix();
      clods.setMatrixAt(i, dummy.matrix);
      color.setScalar(0.62 + random() * 0.65);
      clods.setColorAt(i, color);
    }
    clods.receiveShadow = scuffs.receiveShadow = true;
    clods.computeBoundingSphere();
    scuffs.computeBoundingSphere();
    group.add(clods, scuffs);
  }
  return group;
}
