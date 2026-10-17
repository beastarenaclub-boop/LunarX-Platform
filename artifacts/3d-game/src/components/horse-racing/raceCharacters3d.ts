import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import {
  characterRestSpace,
  dressRider,
  racewearAccents,
} from "./raceCharacterDetail";
import { riderEquipment, racingSaddle } from "./raceEquipment3d";
import { batchRigidMeshes } from "./raceMeshBatch";

const ASSETS = "/assets/horse-racing/realistic/";
type CharacterAssets = [GLTF, GLTF, THREE.Texture, THREE.Texture, GLTF];
let assets: Promise<CharacterAssets> | undefined;
export const loadCharacters = () =>
  (assets ??= Promise.all([
    new GLTFLoader().loadAsync(`${ASSETS}earth/thoroughbred-v2.glb`),
    new GLTFLoader().loadAsync(`${ASSETS}performance/jockey-mounted-v3.glb`),
    new THREE.TextureLoader()
      .loadAsync(`${ASSETS}higgsfield/coat-detail-v1.png`)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(3.5, 3.5);
        texture.anisotropy = 8;
        return texture;
      }),
    new THREE.TextureLoader()
      .loadAsync(`${ASSETS}racewear/thoroughbred-coat-v2.png`)
      .then((texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.flipY = false;
        texture.anisotropy = 8;
        return texture;
      }),
    new GLTFLoader().loadAsync(
      `${ASSETS}performance/thoroughbred-field-v3.glb`,
    ),
  ]).catch((error) => {
    assets = undefined;
    throw error;
  }));

function tube(points: number[][], radius: number, material: THREE.Material) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...(p as [number, number, number]))),
  );
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, 18, radius, 5, false),
    material,
  );
  mesh.castShadow = true;
  return mesh;
}

export function racingCharacter(
  models: CharacterAssets,
  color: string,
  coat: string,
  id: number,
) {
  // Natural bay/chestnut/dapple tones; silk colour remains the runner identifier.
  const naturalCoats = [
    "#3b332c",
    "#815c41",
    "#69483a",
    "#aaa89f",
    "#332f2b",
    "#80503a",
    "#af9f84",
    "#594333",
  ];
  coat = naturalCoats[id - 1] ?? coat;
  const root = new THREE.Group();
  const horse = clone(models[0].scene),
    jockey = new THREE.Group();
  const rider = clone(models[1].scene);
  jockey.add(rider);
  root.add(horse, jockey);
  const riderMixer = new THREE.AnimationMixer(rider);
  // The unchanged mounted pose is baked into the mesh; the whole jockey still
  // follows each gallop. No unused 52-bone rider palettes need updating.
  const mixer = new THREE.AnimationMixer(horse);
  const gallop = mixer.clipAction(
    models[0].animations.find((c) => c.name === "Gallop")!,
  );
  const idle = mixer.clipAction(
    models[0].animations.find((c) => c.name === "Idle")!,
  );
  idle.play();
  mixer.setTime(0);
  root.updateMatrixWorld(true);
  characterRestSpace(horse);
  characterRestSpace(rider);
  const fieldMeshes = new Map<string, THREE.SkinnedMesh>();
  models[4].scene.traverse((o) => {
    if (o instanceof THREE.SkinnedMesh)
      fieldMeshes.set((o.material as THREE.Material).name, o);
  });
  const horseLods: {
    mesh: THREE.Mesh;
    detail: THREE.BufferGeometry;
    field: THREE.BufferGeometry;
  }[] = [];
  horse.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.frustumCulled = false;
    o.castShadow = o.receiveShadow = true;
    const source = o.material as THREE.MeshStandardMaterial;
    const field = fieldMeshes.get(source.name);
    if (field && o instanceof THREE.SkinnedMesh) {
      // Both meshes are exported from the same bind pose. Check the joint order
      // before sharing this skeleton so a future asset cannot silently deform.
      if (
        field.skeleton.bones.some(
          (b, i) => b.name !== o.skeleton.bones[i]?.name,
        )
      )
        throw new Error("Horse detail mesh has incompatible joints");
      horseLods.push({ mesh: o, detail: o.geometry, field: field.geometry });
    }
    const m =
      source.name === "Material"
        ? new THREE.MeshPhysicalMaterial({
            name: source.name,
            map: models[3],
            normalMap: source.normalMap,
            bumpMap: models[2].clone(),
            bumpScale: 0.0018,
            roughness: 0.54,
            clearcoat: 0.035,
            clearcoatRoughness: 0.6,
            specularIntensity: 0.42,
            sheen: 0.08,
            sheenRoughness: 0.8,
            sheenColor: new THREE.Color(coat),
          })
        : source.clone();
    o.material = m;
    if (m.name === "Material") {
      if (m.bumpMap) m.bumpMap.needsUpdate = true;
      m.normalScale.setScalar(0.72);
      const tint = new THREE.Color(coat);
      m.onBeforeCompile = (shader) => {
        shader.uniforms.coatColor = { value: tint };
        shader.uniforms.coatGrain = { value: m.bumpMap };
        shader.uniforms.coatId = { value: id };
        shader.vertexShader =
          `attribute vec3 raceRest; varying vec3 coatPosition;\n${shader.vertexShader}`.replace(
            "#include <begin_vertex>",
            "#include <begin_vertex>\ncoatPosition = raceRest;",
          );
        shader.fragmentShader =
          `uniform vec3 coatColor; uniform float coatId; uniform sampler2D coatGrain; varying vec3 coatPosition;\n${shader.fragmentShader}`.replace(
            "#include <map_fragment>",
            `
          #include <map_fragment>
          float luminance = dot(diffuseColor.rgb, vec3(.2126,.7152,.0722));
          float lowChannel = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
          float highChannel = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
          // Keep the facial blaze and socks, without copying the source pinto
          // patches onto every runner's barrel and hindquarters.
          float socks = (1. - smoothstep(.25,.53,coatPosition.y)) * smoothstep(.12,.21,coatPosition.y);
          float blaze = smoothstep(2.32,2.55,coatPosition.z) * smoothstep(2.38,2.68,coatPosition.y)
            * (1. - smoothstep(.025,.10,abs(coatPosition.x))) * step(.5,mod(coatId,3.));
          float markingArea = max(blaze, socks);
          float whiteMarking = smoothstep(.12,.3,lowChannel) * (1.0-smoothstep(.10,.25,highChannel-lowChannel)) * markingArea;
          float coatDetail = clamp(pow(max(luminance,.002) / .12, .24), .74, 1.20);
          vec3 coatNeighbour = (texture2D(map,vMapUv+vec2(.004,0.)).rgb
            + texture2D(map,vMapUv-vec2(.004,0.)).rgb
            + texture2D(map,vMapUv+vec2(0.,.004)).rgb
            + texture2D(map,vMapUv-vec2(0.,.004)).rgb)*.25;
          float skinDetail = clamp(luminance/max(dot(coatNeighbour,vec3(.2126,.7152,.0722)),.002),.65,1.4);
          coatDetail *= mix(1.,skinDetail,.44);
          float face = smoothstep(2.02,2.4,coatPosition.z) * smoothstep(1.9,2.15,coatPosition.y);
          coatDetail = mix(coatDetail,clamp(pow(max(luminance,.002)/.12,.55),.26,1.2),face);
          float grain = dot(texture2D(coatGrain, vBumpMapUv).rgb, vec3(.2126,.7152,.0722));
          float hairDetail = clamp(.83 + sqrt(max(grain, .001)) * .44, .91, 1.1);
          // Dark points on lower legs and muzzle, with warm flank variation.
          float points = 1.0 - smoothstep(.48, 1.3, coatPosition.y);
          float muzzle = smoothstep(2.25, 2.8, coatPosition.z) * (1.0 - smoothstep(2.35, 2.9, coatPosition.y));
          vec3 dyedCoat = coatColor * coatDetail * hairDetail;
          dyedCoat *= 1.0 - max(points * .38, muzzle * .45);
          float flank = exp(-pow((coatPosition.z + .15) * 1.1, 2.))
            * (1. - smoothstep(1.55,2.2,coatPosition.y)) * smoothstep(1.,1.45,coatPosition.y);
          dyedCoat *= mix(vec3(1.), vec3(1.16,1.04,.94), flank);
          float dapple = sin(coatPosition.z*22.+sin(coatPosition.y*13.))
            * sin(coatPosition.y*24.+sin(coatPosition.x*18.));
          dyedCoat *= 1. + dapple*.065 * (1.-step(.1,abs(coatId-4.)));
          diffuseColor.rgb = mix(dyedCoat, vec3(.62,.59,.52) * coatDetail, whiteMarking);
          float hoof = 1. - smoothstep(.18,.27,coatPosition.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.046,.040,.032)*hairDetail, hoof);
          float soil = (1.-smoothstep(.12,.66,coatPosition.y)) * (.5+grain*.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.14,.092,.049), soil*.22);
        `,
          );
        // Retain the anatomical normal map, then add the generated short coat.
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_maps>",
          `#include <normal_fragment_maps>
           normal = perturbNormalArb(-vViewPosition, normal, dHdxy_fwd(), faceDirection);`,
        );
      };
      m.customProgramCacheKey = () => "racehorse-skinned-rest-coat-v4";
    } else if (m.name === "Material.003") {
      m.color.set(id === 4 || id === 7 ? "#767268" : "#28221e");
      m.alphaTest = 0.24;
      m.transparent = false;
      m.side = THREE.DoubleSide;
      m.roughness = 0.95;
    } else if (m.name === "Eye_brown") {
      m.color.set("#221910");
      m.roughness = 0.16;
      m.metalness = 0;
    }
  });
  horseLods.forEach((lod) => {
    lod.mesh.geometry = lod.field;
  });
  characterRestSpace(horse);
  let detailed = false;
  const setDetail = (next: boolean) => {
    if (detailed === next) return;
    detailed = next;
    horseLods.forEach((lod) => {
      lod.mesh.geometry = next ? lod.detail : lod.field;
    });
  };
  dressRider(rider, id, color);
  jockey.add(riderEquipment(racewearAccents[id - 1], id === 2 || id === 7));
  root.updateMatrixWorld(true);

  const leather = new THREE.MeshStandardMaterial({
    color: "#201710",
    roughness: 0.39,
    side: THREE.DoubleSide,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#b6afa1",
    metalness: 0.8,
    roughness: 0.28,
  });
  const silk = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.38,
    side: THREE.DoubleSide,
  });
  // Curved saddlecloth conforms to the back and falls down both flanks.
  const pad = new THREE.PlaneGeometry(1.52, 1.6, 24, 4);
  const positions = pad.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      z = positions.getY(i);
    positions.setXYZ(i, x * 0.92, 2.48 - 1.05 * x * x, z - 0.16);
  }
  pad.computeVertexNormals();
  const cloth = new THREE.Mesh(pad, silk);
  cloth.castShadow = true;
  root.add(cloth);
  root.add(racingSaddle(leather, metal));
  for (const side of [-1, 1]) {
    root.add(
      tube(
        [
          [side * 0.42, 2.48, 0.15],
          [side * 0.72, 2.2, 0.12],
          [side * 0.7, 1.99, 0.32],
        ],
        0.019,
        leather,
      ),
    );
    const stirrup = new THREE.Mesh(
      new THREE.TorusGeometry(0.13, 0.014, 6, 20),
      metal,
    );
    stirrup.position.set(side * 0.7, 1.98, 0.32);
    stirrup.rotation.y = Math.PI / 2;
    stirrup.scale.y = 0.8;
    root.add(stirrup);
  }
  const head = rider.getObjectByName("mixamorigHead")!;
  const headPosition = head.getWorldPosition(new THREE.Vector3());
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.57),
    silk.clone(),
  );
  helmet.scale.set(0.171, 0.185, 0.195);
  helmet.position.copy(headPosition).add(new THREE.Vector3(0, 0.275, 0.022));
  helmet.castShadow = true;
  const whiteSilk = new THREE.MeshStandardMaterial({
    color: racewearAccents[id - 1],
    roughness: 0.36,
  });
  for (const start of [Math.PI * 0.46, Math.PI * 1.46]) {
    helmet.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(
          1.006,
          8,
          16,
          start,
          Math.PI * 0.08,
          0,
          Math.PI * 0.57,
        ),
        whiteSilk,
      ),
    );
  }
  jockey.add(helmet);
  const brim = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 8), leather);
  brim.scale.set(0.18, 0.012, 0.13);
  brim.position.copy(headPosition).add(new THREE.Vector3(0, 0.225, 0.17));
  jockey.add(brim);
  const goggles = new THREE.Group();
  const lens = new THREE.MeshPhysicalMaterial({
    color: "#18252c",
    roughness: 0.12,
    metalness: 0.28,
    clearcoat: 1,
  });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), lens);
    eye.scale.set(0.062, 0.035, 0.018);
    eye.position.set(
      side * 0.064,
      headPosition.y + 0.155,
      headPosition.z + 0.196,
    );
    goggles.add(eye);
    goggles.add(
      tube(
        [
          [side * 0.125, headPosition.y + 0.155, headPosition.z + 0.193],
          [side * 0.151, headPosition.y + 0.17, headPosition.z + 0.08],
          [side * 0.145, headPosition.y + 0.17, headPosition.z - 0.08],
        ],
        0.011,
        leather,
      ),
    );
  }
  goggles.add(
    tube(
      [
        [-0.02, headPosition.y + 0.159, headPosition.z + 0.203],
        [0, headPosition.y + 0.169, headPosition.z + 0.216],
        [0.02, headPosition.y + 0.159, headPosition.z + 0.203],
      ],
      0.009,
      leather,
    ),
  );
  jockey.add(goggles);
  jockey.add(
    tube(
      [
        [-0.135, headPosition.y + 0.2, headPosition.z + 0.015],
        [-0.1, headPosition.y + 0.045, headPosition.z + 0.055],
        [0, headPosition.y + 0.015, headPosition.z + 0.13],
        [0.1, headPosition.y + 0.045, headPosition.z + 0.055],
        [0.135, headPosition.y + 0.2, headPosition.z + 0.015],
      ],
      0.009,
      leather,
    ),
  );

  const headBone = horse.getObjectByName("Bone002")!;
  const bridle = new THREE.Group();
  for (const side of [-1, 1]) {
    bridle.add(
      tube(
        [
          [side * 0.22, 2.97, 2.03],
          [side * 0.255, 2.66, 2.35],
          [side * 0.24, 2.22, 2.6],
        ],
        0.018,
        leather,
      ),
    );
    const bit = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.008, 6, 16),
      metal,
    );
    bit.position.set(side * 0.25, 2.22, 2.6);
    bit.rotation.y = Math.PI / 2;
    bridle.add(bit);
  }
  bridle.add(
    tube(
      [
        [-0.25, 2.22, 2.6],
        [-0.15, 2.28, 2.73],
        [0.15, 2.28, 2.73],
        [0.25, 2.22, 2.6],
      ],
      0.026,
      leather,
    ),
  );
  bridle.add(
    tube(
      [
        [-0.24, 2.92, 2.18],
        [0, 2.96, 2.34],
        [0.24, 2.92, 2.18],
      ],
      0.021,
      leather,
    ),
  );
  root.add(bridle);
  root.updateMatrixWorld(true);
  headBone.attach(bridle);
  const reinGeometry = new THREE.BufferGeometry();
  reinGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(4 * 3), 3),
  );
  const reins = new THREE.LineSegments(
    reinGeometry,
    new THREE.LineBasicMaterial({ color: "#352a1c" }),
  );
  root.add(reins);
  const bitPoints = [-1, 1].map(
    (side) => new THREE.Vector3(side * 0.25, 2.22, 2.6),
  );
  const muzzleAnchor = new THREE.Vector3(0, 2.1, 2.83);
  // Store attachments in head-bone space so they stay with the animated head.
  bitPoints.forEach((v) => headBone.worldToLocal(v));
  headBone.worldToLocal(muzzleAnchor);
  const point = new THREE.Vector3();
  const inverseRoot = new THREE.Matrix4();
  // Hand anchors are fixed in the mounted pose; only the jockey group's bounce
  // moves them. Resolve the names and attachment positions once at loading.
  const handPoints = ["mixamorigRightHand", "mixamorigLeftHand"].map((name) =>
    rider.getObjectByName(name)!.getWorldPosition(new THREE.Vector3()),
  );
  const hoofBones = [
    "HoofFront_L",
    "HoofFront_R",
    "HoofHind_L",
    "HoofHind_R",
  ].map((name) => horse.getObjectByName(name)!);
  const hoofAnchors = hoofBones.map((bone) => {
    const anchor = bone.getWorldPosition(new THREE.Vector3());
    anchor.y -= 0.23;
    return bone.worldToLocal(anchor);
  });
  const hoofPoints = hoofBones.map(() => new THREE.Vector3());
  function hoofPositions() {
    hoofBones.forEach((bone, i) => {
      bone.updateWorldMatrix(true, false);
      hoofPoints[i].copy(hoofAnchors[i]).applyMatrix4(bone.matrixWorld);
    });
    return hoofPoints;
  }
  let racing = false;
  function animate(time: number, isRacing: boolean) {
    if (racing !== isRacing) {
      racing = isRacing;
      mixer.stopAllAction();
      (racing ? gallop : idle).reset().play();
    }
    mixer.setTime(time);
  }
  function updateTack() {
    // Update just the head's ancestry. Traversing every mesh and bone here and
    // again for every hoof used to repeat most of the scene traversal per frame.
    headBone.updateWorldMatrix(true, false);
    inverseRoot.copy(root.matrixWorld).invert();
    jockey.updateMatrix();
    for (let i = 0; i < 2; i++) {
      point
        .copy(bitPoints[i])
        .applyMatrix4(headBone.matrixWorld)
        .applyMatrix4(inverseRoot);
      reinGeometry.attributes.position.setXYZ(i * 2, point.x, point.y, point.z);
      point.copy(handPoints[i]).applyMatrix4(jockey.matrix);
      reinGeometry.attributes.position.setXYZ(
        i * 2 + 1,
        point.x,
        point.y,
        point.z + 0.075,
      );
    }
    reinGeometry.attributes.position.needsUpdate = true;
    reins.frustumCulled = false;
    point
      .copy(muzzleAnchor)
      .applyMatrix4(headBone.matrixWorld)
      .applyMatrix4(inverseRoot);
    return point.z;
  }
  // Tiny reins, eye shells, buckles and seams cannot contribute a meaningful
  // silhouette to a 1024 px track shadow. Keep shadows on the horse, garments
  // and helmet, avoiding dozens of redundant shadow draws per runner.
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material as THREE.Material;
    object.castShadow =
      object === helmet ||
      ["Material", "RaceSilk", "VitPants", "VitSkin"].includes(material.name);
  });
  batchRigidMeshes(jockey);
  batchRigidMeshes(bridle);
  return {
    root,
    horse,
    jockey,
    mixer,
    riderMixer,
    animate,
    setDetail,
    updateTack,
    hoofPositions,
    id,
  };
}
