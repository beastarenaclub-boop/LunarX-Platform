import * as THREE from "three";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { BroadcastAssets } from "./BroadcastAssets";
import type { Sport } from "../../../../../lib/virtual-sports/catalog.mjs";
import type { Round } from "../../../../../lib/virtual-sports/store.mjs";
import {
  footballPlayerPosition,
  footballPlay,
  footballGoalReplay,
} from "./FootballMotion";

type V3 = [number, number, number];
const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;

/** Dedicated football renderer: regulation pitch, full bowl, skinned players. */
export function buildFootballScene(
  host: HTMLDivElement,
  sport: Sport,
  quality: string,
  assets: BroadcastAssets,
  read: () => { round?: Round; time: number; camera: string },
  onReady: () => void,
) {
  if (!assets.athlete) throw new Error("Football player asset missing");
  const high = quality === "high";
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, high ? 1.75 : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#18252d");
  scene.fog = new THREE.Fog("#1c2a32", 95, 240);
  scene.environment = assets.daylight;
  scene.environmentIntensity = 0.4;
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 350);
  const materials = new Set<THREE.Material>(),
    textures = new Set<THREE.Texture>();
  const mat = (
    color: THREE.ColorRepresentation,
    roughness = 0.75,
    metalness = 0,
  ) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materials.add(m);
    return m;
  };
  const white = mat("#e0e4de"),
    steel = mat("#73868d", 0.38, 0.65),
    concrete = mat("#080d12"),
    seatMat = mat("#0b1820"),
    black = mat("#080e13");
  const luminous = new THREE.MeshBasicMaterial({ color: "#f1f7ff" });
  materials.add(luminous);
  const make = (
    g: THREE.BufferGeometry,
    m: THREE.Material,
    p: V3,
    parent: THREE.Object3D = scene,
  ) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...p);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const box = (
    size: V3,
    p: V3,
    m: THREE.Material,
    parent: THREE.Object3D = scene,
  ) => make(new THREE.BoxGeometry(...size), m, p, parent);
  const rod = (
    a: V3,
    b: V3,
    r: number,
    m: THREE.Material,
    parent: THREE.Object3D = scene,
  ) => {
    const av = new THREE.Vector3(...a),
      bv = new THREE.Vector3(...b),
      d = bv.clone().sub(av);
    const mesh = make(
      new THREE.CylinderGeometry(r, r, d.length(), 6),
      m,
      av.add(bv).multiplyScalar(0.5).toArray() as V3,
      parent,
    );
    mesh.quaternion.setFromUnitVectors(UP, d.normalize());
    return mesh;
  };
  scene.add(new THREE.HemisphereLight("#d8e6ff", "#354526", 1.3));
  const key = new THREE.DirectionalLight("#f5f5ff", 2.9);
  key.position.set(-35, 70, 25);
  key.castShadow = high;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.left = -64;
  key.shadow.camera.right = 64;
  key.shadow.camera.top = 50;
  key.shadow.camera.bottom = -50;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 160;
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.00015;
  scene.add(key);
  const fill = new THREE.DirectionalLight("#c5e4ff", 1.1);
  fill.position.set(45, 45, -40);
  scene.add(fill);

  // Physical pitch dimensions are meters, with a close-cut PBR surface.
  assets.grass.repeat.set(38, 26);
  assets.normal.repeat.copy(assets.grass.repeat);
  const turf = new THREE.MeshStandardMaterial({
    color: "#749652",
    map: assets.grass,
    normalMap: assets.normal,
    normalScale: new THREE.Vector2(0.24, 0.24),
    roughness: 0.98,
  });
  turf.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPitch;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvPitch=position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vPitch;")
      .replace(
        "#include <color_fragment>",
        "#include <color_fragment>\nfloat detail=dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722)); float stripe=step(0.0,sin((vPitch.x+52.5)*3.14159265/5.25)); diffuseColor.rgb=vec3(0.053,0.124,0.023)*(0.42+detail*12.0)*mix(0.84,1.0,stripe);",
      );
  };
  materials.add(turf);
  const ground = make(new THREE.PlaneGeometry(126, 88), turf, [0, 0, 0]);
  ground.rotation.x = -Math.PI / 2;
  // Fine geometry near the pitch camera preserves real grass depth at boot level.
  const bladeGeometry = new THREE.BufferGeometry();
  bladeGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [
        -0.003, 0, 0, 0.003, 0, 0, 0.001, 0.024, 0, 0, 0, -0.003, 0, 0, 0.003,
        0, 0.02, 0.001,
      ],
      3,
    ),
  );
  bladeGeometry.computeVertexNormals();
  const bladeMat = mat("#527c31");
  bladeMat.side = THREE.DoubleSide;
  const blades = new THREE.InstancedMesh(
      bladeGeometry,
      bladeMat,
      high ? 18000 : 0,
    ),
    bladeDummy = new THREE.Object3D();
  const random = (n: number) => {
    const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  for (let i = 0; i < blades.count; i++) {
    bladeDummy.position.set(
      (random(i) - 0.5) * 28,
      0.002,
      (random(i + 30000) - 0.5) * 24,
    );
    bladeDummy.rotation.y = random(i + 60000) * Math.PI;
    bladeDummy.scale.setScalar(0.65 + random(i + 90000) * 0.6);
    bladeDummy.updateMatrix();
    blades.setMatrixAt(i, bladeDummy.matrix);
    blades.setColorAt(
      i,
      new THREE.Color().setRGB(
        0.65 + random(i + 5) * 0.3,
        0.7 + random(i + 8) * 0.3,
        0.55 + random(i + 2) * 0.3,
      ),
    );
  }
  blades.receiveShadow = true;
  scene.add(blades);
  const marking = mat("#e1e9d2");
  const stripe = (
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    width = 0.12,
  ) => {
    const dx = x2 - x1,
      dz = z2 - z1;
    const m = box(
      [Math.hypot(dx, dz), 0.012, width],
      [(x1 + x2) / 2, 0.018, (z1 + z2) / 2],
      marking,
    );
    m.rotation.y = -Math.atan2(dz, dx);
  };
  const outline = (x1: number, z1: number, x2: number, z2: number) => {
    stripe(x1, z1, x2, z1);
    stripe(x2, z1, x2, z2);
    stripe(x2, z2, x1, z2);
    stripe(x1, z2, x1, z1);
  };
  const arc = (
    x: number,
    z: number,
    r: number,
    start = 0,
    end = Math.PI * 2,
  ) => {
    const g = new THREE.RingGeometry(
      r - 0.06,
      r + 0.06,
      96,
      1,
      start,
      end - start,
    );
    const m = make(g, marking, [x, 0.026, z]);
    m.rotation.x = -Math.PI / 2;
  };
  outline(-52.5, -34, 52.5, 34);
  stripe(0, -34, 0, 34);
  arc(0, 0, 9.15);
  const spot = (x: number, z: number) => {
    const m = make(new THREE.CircleGeometry(0.13, 12), marking, [x, 0.03, z]);
    m.rotation.x = -Math.PI / 2;
  };
  spot(0, 0);
  for (const sign of [-1, 1]) {
    outline(sign * 52.5, -20.16, sign * 36, 20.16);
    outline(sign * 52.5, -9.16, sign * 47, 9.16);
    spot(sign * 41.5, 0);
    arc(
      sign * 41.5,
      0,
      9.15,
      sign === 1 ? Math.PI - 0.925 : -0.925,
      sign === 1 ? Math.PI + 0.925 : 0.925,
    );
    const goal = new THREE.Group();
    goal.position.x = sign * 52.5;
    goal.scale.x = sign;
    scene.add(goal);
    rod([0, 0, -3.66], [0, 2.44, -3.66], 0.06, white, goal);
    rod([0, 0, 3.66], [0, 2.44, 3.66], 0.06, white, goal);
    rod([0, 2.44, -3.66], [0, 2.44, 3.66], 0.06, white, goal);
    for (const z of [-3.66, 3.66]) {
      rod([0, 2.44, z], [2.2, 2.44, z], 0.035, white, goal);
      rod([2.2, 2.44, z], [2.2, 0, z], 0.035, white, goal);
    }
    const points: number[] = [];
    const seg = (a: V3, b: V3) => points.push(...a, ...b);
    for (let z = -3.66; z <= 3.67; z += 0.18) {
      seg([0, 2.44, z], [2.2, 2.44, z]);
      seg([2.2, 2.44, z], [2.2, 0, z]);
    }
    for (let y = 0; y <= 2.45; y += 0.18) {
      seg([2.2, y, -3.66], [2.2, y, 3.66]);
      for (const z of [-3.66, 3.66]) seg([0, y, z], [2.2, y, z]);
    }
    for (let x = 0; x <= 2.21; x += 0.18)
      for (const z of [-3.66, 3.66]) seg([x, 0, z], [x, 2.44, z]);
    const netMat = new THREE.LineBasicMaterial({
      color: "#a4b5b4",
      transparent: true,
      opacity: 0.6,
    });
    materials.add(netMat);
    const netGeometry = new THREE.BufferGeometry();
    netGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(points, 3),
    );
    goal.add(new THREE.LineSegments(netGeometry, netMat));
    for (const z of [-34, 34]) {
      rod([sign * 52.5, 0, z], [sign * 52.5, 1.6, z], 0.025, white);
      const flag = make(
        new THREE.PlaneGeometry(0.45, 0.32),
        mat(sign === 1 ? "#69b779" : "#aabce8"),
        [sign * 52.5 + 0.2, 1.43, z],
      );
      flag.material.side = THREE.DoubleSide;
    }
  }
  // A continuous bowl with two raked tiers, concourses and a cantilevered roof.
  const ringPoint = (angle: number, depth: number, y: number): V3 => {
    const c = Math.cos(angle),
      s = Math.sin(angle);
    return [
      Math.sign(c) * Math.pow(Math.abs(c), 0.48) * (61 + depth),
      y,
      Math.sign(s) * Math.pow(Math.abs(s), 0.48) * (43 + depth * 0.82),
    ];
  };
  const ringSurface = (
    inner: number,
    outer: number,
    y1: number,
    y2: number,
    m: THREE.Material,
  ) => {
    const vertices: number[] = [],
      uv: number[] = [],
      indices: number[] = [];
    for (let i = 0; i <= 160; i++) {
      const a = (i / 160) * Math.PI * 2;
      vertices.push(...ringPoint(a, inner, y1), ...ringPoint(a, outer, y2));
      uv.push(i / 8, 0, i / 8, 1);
      if (i < 160) {
        const k = i * 2;
        indices.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    m.side = THREE.DoubleSide;
    return make(g, m, [0, 0, 0]);
  };
  ringSurface(0, 34, 1.1, 23, concrete);
  ringSurface(34, 34, 23, 30, black);
  ringSurface(32, 2, 30, 27.5, mat("#566774", 0.58, 0.3));
  ringSurface(14, 17, 10.2, 10.2, black);
  ringSurface(0, 0, 0, 1.2, black);
  const seatTransforms: THREE.Matrix4[] = [],
    fanTransforms: THREE.Matrix4[] = [],
    fanIndices: number[] = [];
  const dummy = new THREE.Object3D();
  for (let row = 0; row < 30; row++) {
    const tierGap = row >= 14 ? 2.2 : 0,
      depth = 1.5 + row * 0.9 + tierGap,
      y = 1.4 + row * 0.61 + (row >= 14 ? 1.2 : 0);
    const pts = Array.from(
      { length: 161 },
      (_, i) =>
        new THREE.Vector3(...ringPoint((i / 160) * Math.PI * 2, depth, y)),
    );
    const curve = new THREE.CatmullRomCurve3(pts.slice(0, -1), true);
    const count = Math.floor(curve.getLength() / 0.68);
    const spaced = curve.getSpacedPoints(count);
    for (let j = 0; j < count; j++) {
      // Stair aisles cut across both tiers.
      if (j % 39 < 3) continue;
      const p = spaced[j];
      dummy.position.copy(p);
      dummy.lookAt(0, p.y, 0);
      dummy.scale.set(0.64, 0.14, 0.61);
      dummy.updateMatrix();
      seatTransforms.push(dummy.matrix.clone());
      if ((j + row * 3) % 13 === 0 || (!high && (j + row) % 2 === 0)) continue;
      const cell = (j * 7 + row * 11) % 16,
        standing = [0, 3, 6, 11].includes(cell),
        height = standing ? 1.9 : 1.85;
      dummy.position.y = p.y + height * 0.44 + 0.05;
      dummy.scale.set(1.22, height, 1);
      dummy.updateMatrix();
      fanTransforms.push(dummy.matrix.clone());
      fanIndices.push(cell);
    }
  }
  const seats = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    seatMat,
    seatTransforms.length,
  );
  seatTransforms.forEach((m, i) => seats.setMatrixAt(i, m));
  scene.add(seats);
  const fanGeometry = new THREE.PlaneGeometry(1, 1);
  fanGeometry.setAttribute(
    "aFan",
    new THREE.InstancedBufferAttribute(new Float32Array(fanIndices), 1),
  );
  const fansMat = new THREE.MeshBasicMaterial({
    map: assets.crowd,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    color: "#e5e9e7",
  });
  materials.add(fansMat);
  fansMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float aFan;")
      .replace(
        "#include <uv_vertex>",
        "#include <uv_vertex>\nvMapUv=(vMapUv+vec2(mod(aFan,4.0),3.0-floor(aFan/4.0)))/4.0;",
      );
  };
  const fans = new THREE.InstancedMesh(
    fanGeometry,
    fansMat,
    fanTransforms.length,
  );
  fanTransforms.forEach((m, i) => fans.setMatrixAt(i, m));
  scene.add(fans);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const back = ringPoint(a, 33, 29.4),
      front = ringPoint(a, 2, 27.4),
      bottom = ringPoint(a, 33, 23);
    rod(back, front, 0.18, steel);
    rod(bottom, front, 0.1, steel);
    rod(back, bottom, 0.14, steel);
    if (i % 2 === 0) {
      const light = box([4, 0.12, 0.65], ringPoint(a, 3, 27.1), luminous);
      light.rotation.y = -a;
    }
  }
  const adCanvas = document.createElement("canvas");
  adCanvas.width = 2048;
  adCanvas.height = 128;
  const ctx = adCanvas.getContext("2d")!;
  ctx.fillStyle = "#061d29";
  ctx.fillRect(0, 0, 2048, 128);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "700 49px Arial";
  [
    "ARENA FOOTBALL",
    "THE BEAUTIFUL GAME",
    "VIRTUAL SPORTS",
    "MATCHDAY LIVE",
  ].forEach((s, i) => {
    ctx.fillStyle = i % 2 ? "#d1e5ef" : "#b6ef62";
    ctx.fillText(s, 256 + i * 512, 67);
  });
  const adTexture = new THREE.CanvasTexture(adCanvas);
  adTexture.colorSpace = THREE.SRGBColorSpace;
  adTexture.wrapS = THREE.RepeatWrapping;
  adTexture.repeat.x = 6;
  textures.add(adTexture);
  const adMat = new THREE.MeshBasicMaterial({ map: adTexture });
  materials.add(adMat);
  ringSurface(-1, -1, 0.05, 1.05, adMat);
  // Side-line benches and tunnel give the scene a human scale.
  for (const x of [-18, 18]) {
    box([13, 1, 2.6], [x, 0.5, 39.3], black);
    box([13, 0.18, 3], [x, 2.5, 39.3], steel);
    for (let j = 0; j < 9; j++)
      box([0.7, 0.4, 0.8], [x - 5 + j * 1.25, 1, 39.3], seatMat);
  }
  box([7, 4, 4], [0, 2, 45], black);

  const athletes: Array<{
    group: THREE.Group;
    model: THREE.Object3D;
    mixer: THREE.AnimationMixer;
    actions: Record<string, THREE.AnimationAction>;
    previous: THREE.Vector3;
    heading: number;
    number: number;
  }> = [];
  const clips = assets.athlete.animations;
  const numberTexture = (n: number, team: number) => {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const x = c.getContext("2d")!;
    x.fillStyle = team === 0 ? "#e8efe4" : "#1b2c40";
    x.font = "bold 84px Arial";
    x.textAlign = "center";
    x.fillText(String(n), 64, 99);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    textures.add(t);
    return t;
  };
  for (let i = 0; i < 22; i++) {
    const team = Math.floor(i / 11),
      role = i % 11,
      keeper = role === 0;
    const group = new THREE.Group(),
      model = cloneSkeleton(assets.athlete.scene);
    group.add(model);
    scene.add(group);
    const jersey = keeper
      ? team === 0
        ? "#e9ab3b"
        : "#d676a6"
      : team === 0
        ? "#407453"
        : "#c2d0e6";
    model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      const convert = (source: THREE.Material) => {
        const m = source.clone() as THREE.MeshStandardMaterial;
        materials.add(m);
        if (m.name === "FootballJersey") {
          m.color.set(jersey);
          m.roughness = 0.88;
        }
        if (m.name === "FootballShorts")
          m.color.set(team === 0 ? "#e0e6d6" : "#243650");
        if (m.name === "FootballSocks")
          m.color.set(team === 0 ? "#6b997b" : "#c0cddd");
        if (m.name.includes("body.body"))
          m.color.setRGB(
            1 - (i % 4) * 0.07,
            1 - (i % 3) * 0.045,
            1 - (i % 3) * 0.04,
          );
        return m;
      };
      o.material = Array.isArray(o.material)
        ? o.material.map(convert)
        : convert(o.material);
    });
    // Jersey numbers follow the animated chest bone, instead of floating in world space.
    const chest = model.getObjectByName("Chest");
    let binding: THREE.Matrix4 | undefined;
    model.traverse((o) => {
      if (binding || !(o instanceof THREE.SkinnedMesh)) return;
      const index = o.skeleton.bones.findIndex((b) => b.name === "Chest");
      if (index >= 0) binding = o.skeleton.boneInverses[index];
    });
    if (chest && binding) {
      const m = new THREE.MeshBasicMaterial({
        map: numberTexture(role + 1, team),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      materials.add(m);
      const n = new THREE.Mesh(new THREE.PlaneGeometry(0.23, 0.23), m);
      model.updateMatrixWorld(true);
      n.position.copy(new THREE.Vector3(0, 1.39, -0.135).applyMatrix4(binding));
      n.quaternion
        .setFromRotationMatrix(binding)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI));
      chest.add(n);
    }
    const mixer = new THREE.AnimationMixer(model),
      actions: Record<string, THREE.AnimationAction> = {};
    for (const clip of clips) {
      const a = mixer.clipAction(clip);
      a.play();
      a.setEffectiveWeight(clip.name === "Idle" ? 1 : 0);
      actions[clip.name] = a;
    }
    if (actions.Celebrate) {
      actions.Celebrate.setLoop(THREE.LoopOnce, 1);
      actions.Celebrate.clampWhenFinished = true;
    }
    const p = footballPlayerPosition(i, 0, false);
    group.position.set(p.x, 0, p.z);
    group.rotation.y = team === 0 ? Math.PI / 2 : -Math.PI / 2;
    const scale = 0.96 + (i % 5) * 0.017;
    group.scale.setScalar(scale);
    athletes.push({
      group,
      model,
      mixer,
      actions,
      previous: group.position.clone(),
      heading: group.rotation.y,
      number: i,
    });
  }
  // Truncated-icosahedron panel layout on a physically sized football.
  const ballCanvas = document.createElement("canvas");
  ballCanvas.width = 512;
  ballCanvas.height = 256;
  const bc = ballCanvas.getContext("2d")!;
  bc.fillStyle = "#eeefe7";
  bc.fillRect(0, 0, 512, 256);
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 8; col++) {
      const x = (col + (row % 2) * 0.5) * 64,
        y = 32 + row * 64;
      bc.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        bc.lineTo(x + Math.sin(a) * 19, y + Math.cos(a) * 19);
      }
      bc.closePath();
      bc.fillStyle = "#14232a";
      bc.fill();
      bc.strokeStyle = "#9ca6a3";
      bc.lineWidth = 2;
      bc.stroke();
    }
  const ballTex = new THREE.CanvasTexture(ballCanvas);
  ballTex.colorSpace = THREE.SRGBColorSpace;
  textures.add(ballTex);
  const ballMat = new THREE.MeshStandardMaterial({
    map: ballTex,
    roughness: 0.55,
  });
  materials.add(ballMat);
  const ball = make(
    new THREE.SphereGeometry(0.112, 32, 20),
    ballMat,
    [0, 0.112, 0],
  );
  ball.castShadow = true;
  const contactMat = new THREE.MeshBasicMaterial({
    color: "#14231a",
    transparent: true,
    opacity: 0.23,
    depthWrite: false,
  });
  materials.add(contactMat);
  const contacts = athletes.map(() => {
    const m = make(
      new THREE.CircleGeometry(0.36, 24),
      contactMat,
      [0, 0.022, 0],
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  });
  const ballContact = make(
    new THREE.CircleGeometry(0.17, 24),
    contactMat,
    [0, 0.025, 0],
  );
  ballContact.rotation.x = -Math.PI / 2;
  const replayLabel = document.createElement("div");
  replayLabel.className = "vs-football-replay";
  replayLabel.textContent = "GOAL REPLAY";
  replayLabel.hidden = true;
  host.appendChild(replayLabel);
  const resize = () => {
    const w = host.clientWidth,
      h = host.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();
  const desired = new THREE.Vector3(),
    target = new THREE.Vector3(),
    look = new THREE.Vector3(0, 0.8, 0),
    lastBall = new THREE.Vector3();
  let raf = 0,
    last = performance.now(),
    first = true,
    disposed = false,
    lastReplay = "",
    replayStarted = -100,
    replayTeam = 0;
  const frame = () => {
    if (disposed) return;
    const now = performance.now(),
      dt = Math.min(0.06, (now - last) / 1000);
    last = now;
    const { round, time, camera: mode } = read(),
      live = round?.phase === "live";
    const elapsed = round ? clamp((time - round.closes) / 1000, 0, 45) : 0;
    const event = round?.events.at(-1);
    if (
      event?.kind === "goal" &&
      round?.phase === "live" &&
      elapsed - event.at / 1000 < 3.5
    ) {
      const id = `${round.id}:${event.at}`;
      if (id !== lastReplay) {
        lastReplay = id;
        replayStarted = now / 1000;
        replayTeam = event.team;
        for (const a of athletes)
          if (a.actions.Celebrate) a.actions.Celebrate.reset();
      }
    }
    const replayAge = now / 1000 - replayStarted,
      replaying = live && replayAge < 3.5;
    const play = footballPlay(elapsed, live),
      sign = replayTeam === 0 ? 1 : -1;
    replayLabel.hidden = !replaying;
    host.dataset.sequence = replaying
      ? "goal-replay"
      : live
        ? "match"
        : "warmup";
    athletes.forEach((a, i) => {
      const team = Math.floor(i / 11),
        role = i % 11,
        p = footballPlayerPosition(i, elapsed, live);
      if (replaying) {
        if (i === replayTeam * 11 + 9) {
          p.x = sign * (33 + Math.min(replayAge, 1.2) * 2);
          p.z = -2.5;
        }
        if (i === (1 - replayTeam) * 11) {
          p.x = sign * 51;
          p.z = Math.min(1.6, replayAge * 2);
        }
      }
      a.group.position.set(p.x, 0, p.z);
      const dx = p.x - a.previous.x,
        dz = p.z - a.previous.z,
        speed = Math.min(7, Math.hypot(dx, dz) / Math.max(dt, 0.001));
      const receiver = footballPlayerPosition(play.receiver, elapsed, true);
      const facing =
        replaying && i === replayTeam * 11 + 9
          ? Math.atan2(sign, 0)
          : live && play.carrier === i && play.kicking
            ? Math.atan2(receiver.x - p.x, receiver.z - p.z)
            : speed > 0.3
              ? Math.atan2(dx, dz)
              : Math.atan2(play.ball.x - p.x, play.ball.z - p.z);
      a.heading +=
        Math.atan2(Math.sin(facing - a.heading), Math.cos(facing - a.heading)) *
        (1 - Math.exp(-dt * 10));
      a.group.rotation.y = a.heading;
      const shooting =
        replaying && i === replayTeam * 11 + 9 && replayAge < 0.9;
      const celebrating = replaying && team === replayTeam && replayAge > 1.3;
      const kicking =
        shooting || (live && !replaying && play.kicking && play.carrier === i);
      const weights = {
        Idle: 1,
        Walk: 0,
        Jog: 0,
        Sprint: 0,
        Kick: 0,
        Celebrate: 0,
      };
      if (celebrating) {
        weights.Idle = 0;
        weights.Celebrate = 1;
      } else if (kicking) {
        weights.Idle = 0;
        weights.Kick = 1;
        if (a.actions.Kick)
          a.actions.Kick.time = shooting
            ? replayAge
            : (((elapsed / 2.7) % 1) - 0.36) / 0.22;
      } else if (live && speed > 0.25) {
        weights.Idle = 0;
        if (speed < 1.6) weights.Walk = 1;
        else if (speed < 4.3) weights.Jog = 1;
        else weights.Sprint = 1;
      }
      for (const [name, action] of Object.entries(a.actions)) {
        const weight = weights[name as keyof typeof weights] ?? 0;
        action.setEffectiveWeight(
          THREE.MathUtils.lerp(
            action.getEffectiveWeight(),
            weight,
            1 - Math.exp(-dt * 12),
          ),
        );
        action.timeScale =
          name === "Walk"
            ? clamp(speed / 1.3, 0.5, 1.7)
            : name === "Jog"
              ? clamp(speed / 3.2, 0.6, 1.5)
              : name === "Sprint"
                ? clamp(speed / 5.8, 0.7, 1.3)
                : 1;
      }
      a.mixer.update(dt);
      a.previous.copy(a.group.position);
      contacts[i].position.set(p.x, 0.024, p.z);
      // The keeper reaches across the goal mouth during the revealed goal replay.
      if (replaying && role === 0 && team !== replayTeam) {
        a.group.rotation.z =
          -sign * Math.sin((Math.min(1, replayAge / 1.1) * Math.PI) / 2) * 0.9;
        a.group.position.y = 0.2;
      } else a.group.rotation.z = 0;
    });
    const bp = replaying
      ? footballGoalReplay(replayTeam, replayAge)
      : play.ball;
    ball.position.set(bp.x, bp.y, bp.z);
    const distance = ball.position.distanceTo(lastBall);
    if (distance < 5) {
      ball.rotation.z -= distance / 0.112;
      ball.rotation.x += distance / 0.22;
    }
    lastBall.copy(ball.position);
    ballContact.position.set(bp.x, 0.028, bp.z);
    const narrow = camera.aspect < 1.25;
    blades.visible = high && mode === "cinematic";
    if (blades.visible) {
      const focus =
        athletes[replaying ? replayTeam * 11 + 9 : live ? play.carrier : 9]
          .group.position;
      blades.position.set(
        clamp(Math.round(focus.x / 6) * 6, -38, 38),
        0,
        clamp(Math.round(focus.z / 6) * 6, -20, 20),
      );
    }
    if (mode === "overhead") {
      desired.set(bp.x * 0.28, 105, narrow ? 40 : 14);
      target.set(bp.x * 0.28, 0, 0);
    } else if (mode === "cinematic") {
      const player =
        athletes[replaying ? replayTeam * 11 + 9 : live ? play.carrier : 9]
          .group.position;
      desired.set(player.x - 6, 2.5, player.z + 8);
      target.set(player.x + 1, 0.95, player.z);
    } else if (replaying) {
      desired.set(sign * 40, 7, 19);
      target.set(sign * 45, 1, 0);
    } else {
      desired.set(bp.x * 0.65, 20, narrow ? 59 : 47);
      target.set(bp.x * 0.7, 0.45, bp.z * 0.28 - 1);
    }
    const f = first
      ? 1
      : 1 - Math.exp(-dt * (mode === "cinematic" ? 3.4 : 2.7));
    camera.position.lerp(desired, f);
    look.lerp(target, f);
    camera.lookAt(look);
    first = false;
    renderer.render(scene, camera);
    host.dataset.athletes = "22";
    host.dataset.vehicles = "0";
    host.dataset.triangles = String(renderer.info.render.triangles);
    host.dataset.renderer = "football-pro";
    host.dataset.crowd = String(fanTransforms.length);
    onReady();
    raf = requestAnimationFrame(frame);
  };
  frame();
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    athletes.forEach((a) => {
      a.mixer.stopAllAction();
      a.mixer.uncacheRoot(a.model);
    });
    const geometries = new Set<THREE.BufferGeometry>();
    scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line)
        geometries.add(o.geometry);
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
    assets.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    replayLabel.remove();
  };
}
