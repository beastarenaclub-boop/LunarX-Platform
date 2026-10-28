import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { createPresenter } from "./presenter";
import { createMultiplierCabinet } from "./multiplierCabinet";
import { createStudioFloor } from "./studioFloor";
import { createStudioArchitecture } from "./studioArchitecture";
import { createStudioCounter } from "./studioCounter";
import type { ShowCamera } from "./showTimeline";
import {
  studioEnvironment,
  brushedMetalTexture,
  contactShadowTexture,
  surfaceMicrotexture,
} from "./studioMaterials";
import {
  MACHINE_NUMBERS,
  RELEASE_POINT,
  RACK_POINT,
  chuteProgress,
  type MachineFrame,
} from "./machineTimeline";

export interface MachineSceneState {
  roundId: string | null;
  frame: MachineFrame;
  running: boolean;
  motion: boolean;
  multiplier: number | null;
}
const CENTER = new T.Vector3(-1.35, 2.25, 0);
const RADIUS = 1.22;
const BALL_RADIUS = 0.145;
const THROAT = new T.Vector3(-1.35, 3.34, 0);
const smooth = (n: number) => {
  const x = T.MathUtils.clamp(n, 0, 1);
  return x * x * (3 - 2 * x);
};

function paintedNumber(n: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(0.5, 0.5);
  ctx.fillStyle = ["#eee9d9", "#087f4c", "#dbb425"][n % 3];
  ctx.fillRect(0, 0, 1024, 512);
  ctx.strokeStyle = "rgba(18,46,30,.14)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 25);
  ctx.lineTo(1024, 25);
  ctx.moveTo(0, 487);
  ctx.lineTo(1024, 487);
  ctx.stroke();
  for (const x of [0, 512, 1024]) {
    ctx.fillStyle = "#fffdf1";
    ctx.beginPath();
    ctx.arc(x, 256, 118, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = n % 3 === 0 ? "#207951" : "#c3c3a8";
    ctx.stroke();
    ctx.fillStyle = "#081b14";
    ctx.font = "bold 146px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(n), x, 261);
    if (n === 6 || n === 9) ctx.fillRect(x - 24, 328, 48, 5);
  }
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** All 51 numbered meshes persist. No decorative or duplicate balls are spawned. */
export function createMachineRenderer(
  canvas: HTMLCanvasElement,
  latest: () => MachineSceneState,
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.transmissionResolutionScale = 1;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  const scene = new T.Scene();
  const machineRoot = new T.Group();
  machineRoot.scale.setScalar(0.78);
  machineRoot.position.set(0.35, 1.5, 0);
  scene.add(machineRoot);
  scene.background = new T.Color("#031b17");
  const environment = studioEnvironment(renderer);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.65;

  const resources: (T.BufferGeometry | T.Material | T.Texture)[] = [];
  function keep<U extends T.BufferGeometry | T.Material | T.Texture>(
    resource: U,
  ): U {
    resources.push(resource);
    return resource;
  }
  const machining = keep(brushedMetalTexture());
  const microtexture = keep(surfaceMicrotexture());
  const gold = keep(
    new T.MeshStandardMaterial({
      color: "#bc9958",
      metalness: 0.95,
      roughness: 0.3,
      roughnessMap: machining,
      bumpMap: machining,
      bumpScale: 0.0007,
      side: T.DoubleSide,
    }),
  );
  const brass = keep(
    new T.MeshStandardMaterial({
      color: "#d9bc82",
      metalness: 1,
      roughness: 0.23,
    }),
  );
  const steel = keep(
    new T.MeshStandardMaterial({
      color: "#dce1df",
      metalness: 1,
      roughness: 0.24,
      roughnessMap: machining,
      bumpMap: machining,
      bumpScale: 0.0004,
    }),
  );
  const rubber = keep(
    new T.MeshStandardMaterial({ color: "#171e1c", roughness: 0.87 }),
  );
  const dark = keep(
    new T.MeshPhysicalMaterial({
      color: "#126851",
      metalness: 0.16,
      roughness: 0.22,
      roughnessMap: microtexture,
      clearcoat: 0.85,
      clearcoatRoughness: 0.12,
    }),
  );
  const black = keep(
    new T.MeshStandardMaterial({
      color: "#031710",
      metalness: 0.3,
      roughness: 0.2,
    }),
  );
  const glass = keep(
    new T.MeshPhysicalMaterial({
      color: "#ffffff",
      transmission: 1,
      thickness: 0.012,
      roughness: 0,
      ior: 1.47,
      metalness: 0,
      envMapIntensity: 0.9,
      clearcoat: 0.12,
      clearcoatRoughness: 0.02,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    }),
  );
  const tubeGlass = keep(
    new T.MeshPhysicalMaterial({
      color: "#ffffff",
      transmission: 0,
      thickness: 0.025,
      roughness: 0.035,
      transparent: true,
      opacity: 0.15,
      depthWrite: false,
      clearcoat: 1,
      envMapIntensity: 1.3,
      side: T.DoubleSide,
    }),
  );
  const ballGeometry = keep(new T.SphereGeometry(BALL_RADIUS, 40, 28));
  const temp = new T.Vector3();

  function mesh(
    geometry: T.BufferGeometry,
    material: T.Material,
    position: [number, number, number],
  ) {
    const object = new T.Mesh(keep(geometry), material);
    object.position.set(...position);
    object.castShadow = true;
    object.receiveShadow = true;
    machineRoot.add(object);
    return object;
  }
  const box = (
    w: number,
    h: number,
    d: number,
    mat: T.Material,
    p: [number, number, number],
  ) =>
    mesh(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d, 0.15) * 0.23),
      mat,
      p,
    );
  const cylinder = (
    r1: number,
    r2: number,
    h: number,
    mat: T.Material,
    p: [number, number, number],
  ) => mesh(new T.CylinderGeometry(r1, r2, h, 64), mat, p);
  function label(
    text: string,
    w: number,
    h: number,
    p: [number, number, number],
    color = "#f0d994",
  ) {
    const c = document.createElement("canvas");
    c.width = 768;
    c.height = 256;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 86px Georgia";
    ctx.fillStyle = color;
    ctx.fillText(text, 384, 128, 730);
    const texture = keep(new T.CanvasTexture(c));
    texture.colorSpace = T.SRGBColorSpace;
    const material = keep(
      new T.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    return mesh(new T.PlaneGeometry(w, h), material, p);
  }

  // Only the empty architecture is an image. Every machine part and ball is 3D.
  const backdrop = keep(
    new T.MeshBasicMaterial({ color: "#ffffff", toneMapped: false }),
  );
  canvas.dataset.studioAsset = "loading";
  const architecture = keep(
    new T.TextureLoader().load(
      "/media/mega-ball/studio-backplate-v2.png",
      () => {
        if (!disposed) canvas.dataset.studioAsset = "ready";
      },
      undefined,
      () => {
        if (!disposed) {
          canvas.dataset.studioAsset = "unavailable";
          backdrop.map = null;
          backdrop.color.set("#846336");
          backdrop.needsUpdate = true;
        }
      },
    ),
  );
  architecture.colorSpace = T.SRGBColorSpace;
  architecture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy(),
  );
  backdrop.map = architecture;
  const bonusWash = { value: 0 };
  backdrop.onBeforeCompile = (shader) => {
    shader.uniforms.bonusWash = bonusWash;
    shader.fragmentShader =
      `uniform float bonusWash;\n${shader.fragmentShader}`.replace(
        "#include <map_fragment>",
        `#include <map_fragment>
       #ifdef USE_MAP
       float panel = smoothstep(.24,.34,vMapUv.x)*(1.-smoothstep(.66,.76,vMapUv.x));
       float lightness = dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
       vec3 violet = vec3(.12,.045,.26)+lightness*vec3(.52,.24,.74);
       diffuseColor.rgb = mix(diffuseColor.rgb,violet,panel*bonusWash*.88);
       #endif`,
      );
  };
  const studioWall = mesh(
    new T.PlaneGeometry(19.5, 7.8),
    backdrop,
    [0, 2.5, -2.3],
  );
  studioWall.castShadow = studioWall.receiveShadow = false;
  scene.add(studioWall);
  // Photographic stamped brass relief: grain, concealed lamps and real seams.
  const wallTexture = keep(
    new T.TextureLoader().load(
      "/media/mega-ball/studio-relief-v3.png",
      () => {
        if (!disposed) canvas.dataset.reliefAsset = "ready";
      },
      undefined,
      () => {
        if (!disposed) canvas.dataset.reliefAsset = "unavailable";
      },
    ),
  );
  wallTexture.colorSpace = T.SRGBColorSpace;
  wallTexture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const reliefMaterial = keep(
    new T.MeshBasicMaterial({ map: wallTexture, toneMapped: false }),
  );
  const wall = mesh(
    new T.PlaneGeometry(2.52, 4.68),
    reliefMaterial,
    [-3.68, 2.31, -0.84],
  );
  wall.castShadow = wall.receiveShadow = false;
  scene.add(wall);
  canvas.dataset.reliefAsset = "loading";
  canvas.dataset.inlayAsset = "loading";
  const studioSet = createStudioArchitecture(scene, (status) => {
    if (!disposed) canvas.dataset.inlayAsset = status;
  });
  const floor = createStudioFloor(scene, {
    exclude: [studioWall],
    strength: 0.16,
  });
  const deck = keep(
    new T.MeshPhysicalMaterial({
      color: "#164c3e",
      metalness: 0.25,
      roughness: 0.19,
      roughnessMap: microtexture,
      clearcoat: 0.9,
      clearcoatRoughness: 0.09,
      envMapIntensity: 0.75,
    }),
  );
  const counter = createStudioCounter(machineRoot, { body: dark, brass, deck });
  const shadowMaterial = keep(
    new T.MeshBasicMaterial({
      map: keep(contactShadowTexture()),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const contact = mesh(
    new T.PlaneGeometry(2.7, 2),
    shadowMaterial,
    [-1.35, 0.458, 0],
  );
  contact.rotation.x = -Math.PI / 2;
  contact.castShadow = contact.receiveShadow = false;
  const hostShadow = mesh(
    new T.PlaneGeometry(1.6, 0.75),
    shadowMaterial,
    [-3.45, -0.025, 0.35],
  );
  hostShadow.rotation.x = -Math.PI / 2;
  hostShadow.castShadow = hostShadow.receiveShadow = false;
  scene.add(hostShadow);
  const receiver = mesh(
    new T.PlaneGeometry(6.47, 2.53),
    keep(new T.ShadowMaterial({ opacity: 0.24 })),
    [0, 0.46, 0],
  );
  receiver.rotation.x = -Math.PI / 2;
  receiver.castShadow = false;

  // Glass globe, steel collars, actual upper extraction gate, and air impeller.
  cylinder(0.77, 0.81, 0.09, steel, [-1.35, 0.515, 0]);
  cylinder(0.72, 0.75, 0.035, rubber, [-1.35, 0.577, 0]);
  mesh(
    new T.LatheGeometry(
      [
        new T.Vector2(0.7, 0),
        new T.Vector2(0.71, 0.06),
        new T.Vector2(0.57, 0.12),
        new T.Vector2(0.47, 0.27),
        new T.Vector2(0.52, 0.31),
        new T.Vector2(0.62, 0.34),
      ],
      80,
    ),
    steel,
    [-1.35, 0.59, 0],
  );
  cylinder(0.64, 0.64, 0.045, rubber, [-1.35, 0.95, 0]);
  cylinder(0.66, 0.66, 0.045, steel, [-1.35, 0.99, 0]);
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const vent = box(0.035, 0.09, 0.018, rubber, [
      -1.35 + Math.sin(a) * 0.667,
      0.66,
      Math.cos(a) * 0.667,
    ]);
    vent.rotation.y = a;
  }
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    const screw = cylinder(0.022, 0.022, 0.013, brass, [
      -1.35 + Math.cos(a) * 0.71,
      0.568,
      Math.sin(a) * 0.71,
    ]);
    const slot = box(0.026, 0.002, 0.005, rubber, [
      screw.position.x,
      0.576,
      screw.position.z,
    ]);
    slot.rotation.y = a;
  }
  const globe = mesh(
    new T.SphereGeometry(RADIUS + 0.035, 64, 40),
    glass,
    [-1.35, 2.25, 0],
  );
  globe.castShadow = globe.receiveShadow = false;
  const rimMaterial = keep(
    new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      vertexShader: `varying vec3 vNormal; varying vec3 vView; void main(){vec4 p=modelViewMatrix*vec4(position,1.0);vNormal=normalize(normalMatrix*normal);vView=normalize(-p.xyz);gl_Position=projectionMatrix*p;}`,
      fragmentShader: `varying vec3 vNormal; varying vec3 vView; void main(){vec3 n=normalize(vNormal);vec3 v=normalize(vView);float rim=pow(1.0-abs(dot(n,v)),4.0);gl_FragColor=vec4(0.9,0.97,0.96,rim*0.2);}`,
    }),
  );
  const glassRim = mesh(
    new T.SphereGeometry(RADIUS + 0.039, 64, 40),
    rimMaterial,
    [-1.35, 2.25, 0],
  );
  glassRim.castShadow = false;
  const seam = mesh(
    new T.TorusGeometry(RADIUS + 0.018, 0.008, 8, 112),
    tubeGlass,
    [-1.35, 2.25, 0.015],
  );
  seam.castShadow = false;
  for (let i = 0; i < 10; i++) {
    const a = ((i + 0.5) / 10) * Math.PI * 2;
    const x = -1.35 + Math.cos(a) * 1.242,
      y = 2.25 + Math.sin(a) * 1.242;
    const fastener = cylinder(0.023, 0.023, 0.05, steel, [x, y, 0.02]);
    fastener.rotation.x = Math.PI / 2;
    const slot = box(0.021, 0.004, 0.003, rubber, [x, y, 0.047]);
    slot.rotation.z = a;
  }
  cylinder(0.2, 0.2, 0.32, tubeGlass, [-1.35, 3.48, 0]);
  const gateCollar = mesh(
    new T.TorusGeometry(0.23, 0.022, 12, 48),
    steel,
    [-1.35, 3.65, 0],
  );
  gateCollar.rotation.x = Math.PI / 2;
  for (const z of [-0.19, 0.19])
    box(0.56, 0.045, 0.07, steel, [-1.35, 3.68, z]);
  for (const x of [-1.595, -1.105]) box(0.07, 0.045, 0.31, steel, [x, 3.68, 0]);
  for (const x of [-1.55, -1.15])
    cylinder(0.025, 0.025, 0.09, steel, [x, 3.72, 0.16]);
  // Clear extraction housing, threaded posts and pneumatic piston behind the gate.
  const acrylic = keep(
    new T.MeshPhysicalMaterial({
      color: "#e5fff7",
      transparent: true,
      opacity: 0.12,
      roughness: 0.03,
      metalness: 0,
      clearcoat: 1,
      depthWrite: false,
      envMapIntensity: 1.1,
    }),
  );
  box(0.68, 0.065, 0.55, acrylic, [-1.35, 3.79, 0]);
  box(0.68, 0.065, 0.55, acrylic, [-1.35, 3.28, 0]);
  for (const x of [-1.65, -1.05]) {
    const post = cylinder(0.018, 0.018, 0.48, steel, [x, 3.53, -0.2]);
    for (const y of [3.3, 3.78])
      cylinder(0.037, 0.037, 0.035, steel, [x, y, post.position.z]);
  }
  const airPiston = cylinder(0.048, 0.048, 0.47, steel, [-1.35, 3.69, -0.25]);
  airPiston.rotation.z = Math.PI / 2;
  const gate = box(0.38, 0.04, 0.38, steel, [-1.35, 3.36, 0]);
  const impeller = new T.Group();
  impeller.position.set(-1.35, 1.08, 0);
  machineRoot.add(impeller);
  for (let i = 0; i < 5; i++) {
    const blade = new T.Mesh(keep(new T.BoxGeometry(0.72, 0.025, 0.13)), brass);
    blade.rotation.y = (i * Math.PI * 2) / 5;
    blade.position.set(
      Math.cos(blade.rotation.y) * 0.18,
      0,
      Math.sin(blade.rotation.y) * 0.18,
    );
    impeller.add(blade);
  }
  const inlet = cylinder(0.13, 0.17, 0.13, black, [-1.35, 1.15, 0]);
  inlet.castShadow = false;

  // A continuous, gently descending acrylic S-track like a broadcast machine.
  const points = [
    THROAT.clone(),
    new T.Vector3(-1.35, 3.74, 0),
    new T.Vector3(-0.95, 3.76, 0.14),
    new T.Vector3(1.95, 3.48, 0.14),
    new T.Vector3(2.15, 3.26, 0.14),
    new T.Vector3(1.95, 3.06, 0.14),
    new T.Vector3(0.38, 2.86, 0.14),
    new T.Vector3(0.15, 2.65, 0.14),
    new T.Vector3(0.38, 2.45, 0.14),
    new T.Vector3(1.95, 2.25, 0.14),
    new T.Vector3(2.15, 2.02, 0.14),
    new T.Vector3(1.95, 1.81, 0.14),
    new T.Vector3(1.22, 1.57, 0.8),
    new T.Vector3(1.22, 1.42, 0.8),
  ];
  const chutePath = new T.CatmullRomCurve3(points);
  const chuteMesh = mesh(
    new T.TubeGeometry(
      new T.CatmullRomCurve3(points.slice(1)),
      240,
      0.18,
      20,
      false,
    ),
    tubeGlass,
    [0, 0, 0],
  );
  chuteMesh.castShadow = false;
  for (const side of [-1, 1]) {
    const rail = new T.CatmullRomCurve3(
      points
        .slice(2)
        .map((p) => p.clone().add(new T.Vector3(0, -0.11, side * 0.13))),
    );
    mesh(new T.TubeGeometry(rail, 240, 0.008, 8, false), steel, [0, 0, 0]);
  }
  for (let i = 0; i < 7; i++) {
    const t = (i + 1) / 8;
    const collar = mesh(
      new T.TorusGeometry(0.187, 0.012, 8, 24),
      steel,
      [0, 0, 0],
    );
    collar.position.copy(chutePath.getPointAt(t));
    collar.quaternion.setFromUnitVectors(
      new T.Vector3(0, 0, 1),
      chutePath.getTangentAt(t),
    );
  }
  box(0.075, 3, 0.075, steel, [1.1, 1.97, -0.19]);
  for (const y of [3.47, 2.84, 2.25]) box(0.45, 0.055, 0.4, steel, [1.1, y, 0]);
  box(0.63, 0.12, 0.65, steel, [1.22, 1.2, 0.8]);
  cylinder(0.25, 0.27, 0.08, rubber, [1.22, 1.3, 0.8]);
  cylinder(0.31, 0.33, 0.06, steel, [1.22, 1.255, 0.8]);
  box(3.05, 0.08, 1.05, steel, [1.61, 0.52, 0.8]);
  box(3, 0.13, 0.4, black, [1.61, 0.61, 0.54]);
  for (const z of [0.32, 0.78, 1.26])
    box(3.1, 0.045, 0.025, steel, [1.61, z < 0.78 ? 0.73 : 0.59, z]);
  label("M E G A   B A L L", 1.5, 0.16, [0, 0.31, 1.333], "#cfb77c");
  function rackPosition(index: number) {
    if (index === 20) return new T.Vector3(2.78, 1.08, 0.8);
    return new T.Vector3(
      0.25 + (index % 10) * 0.3,
      index < 10 ? 0.82 : 0.69,
      index < 10 ? 0.54 : 1.03,
    );
  }
  for (let i = 0; i < 20; i++) {
    const p = rackPosition(i);
    const seat = mesh(new T.TorusGeometry(0.123, 0.012, 8, 24), rubber, [
      p.x,
      p.y - 0.107,
      p.z,
    ]);
    seat.rotation.x = Math.PI / 2;
  }
  cylinder(0.25, 0.3, 0.36, gold, [2.78, 0.73, 0.8]);
  label("MEGA", 0.6, 0.17, [2.78, 0.68, 1.12]);

  // Soft studio reflections and a real shadow under each glossy numbered ball.
  scene.add(new T.HemisphereLight("#fffaf1", "#25372d", 0.35));
  const key = new T.DirectionalLight("#fff3de", 1.25);
  key.position.set(-3, 7, 5);
  key.castShadow = true;
  const shadowSize = window.innerWidth > 700 ? 2048 : 1024;
  key.shadow.mapSize.set(shadowSize, shadowSize);
  key.shadow.radius = 4;
  Object.assign(key.shadow.camera, {
    left: -5,
    right: 5,
    top: 5,
    bottom: -5,
    near: 0.5,
    far: 20,
  });
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const fill = new T.PointLight("#f4f7ff", 6, 14, 2);
  fill.position.set(3, 4.5, 3);
  scene.add(fill);
  const frontFill = new T.DirectionalLight("#fff7e8", 0.42);
  frontFill.position.set(1, 3.2, 8);
  scene.add(frontFill);
  const rim = new T.PointLight("#fff1ce", 4, 10, 2);
  rim.position.set(-2, 3.7, -0.8);
  scene.add(rim);
  const bonusLight = new T.PointLight("#6a48ff", 0, 12, 2);
  bonusLight.position.set(0, 3.6, 1.7);
  scene.add(bonusLight);
  const presenter = createPresenter(scene, canvas);
  const cabinet = createMultiplierCabinet(scene);

  let seed = 481;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const balls = MACHINE_NUMBERS.map((number) => {
    const texture = keep(paintedNumber(number));
    const material = keep(
      new T.MeshPhysicalMaterial({
        map: texture,
        roughness: 0.19,
        roughnessMap: microtexture,
        bumpMap: microtexture,
        bumpScale: 0.00016,
        metalness: 0,
        clearcoat: 0.8,
        clearcoatRoughness: 0.1,
      }),
    );
    const object = new T.Mesh(ballGeometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    object.userData.number = number;
    machineRoot.add(object);
    return {
      number,
      mesh: object,
      velocity: new T.Vector3(),
      spin: new T.Vector3(random(), random(), random()),
      zone: "bowl",
    };
  });
  function resetBalls() {
    seed = 481;
    const placed: T.Vector3[] = [];
    for (const ball of balls) {
      let candidate = new T.Vector3();
      for (let attempt = 0; attempt < 5000; attempt++) {
        candidate.set(
          (random() - 0.5) * 1.9,
          -0.94 + random() * 1.35,
          (random() - 0.5) * 1.9,
        );
        if (
          candidate.length() < RADIUS - BALL_RADIUS - 0.02 &&
          placed.every(
            (p) => p.distanceToSquared(candidate) > (BALL_RADIUS * 2.03) ** 2,
          )
        )
          break;
      }
      placed.push(candidate.clone());
      ball.mesh.position.copy(candidate.add(CENTER));
      ball.velocity.set((random() - 0.5) * 0.6, 0, (random() - 0.5) * 0.6);
      ball.mesh.rotation.set(random() * 6, random() * 6, random() * 6);
      ball.zone = "bowl";
    }
  }
  resetBalls();
  const camera = new T.PerspectiveCamera(38, 1, 0.05, 60);
  const target = new T.Vector3(-1.7, 2.05, 0);
  const cameraTarget = new T.Vector3(),
    cameraPosition = new T.Vector3();
  const shots: Record<
    ShowCamera,
    {
      center: [number, number, number];
      width: number;
      height: number;
      tilt: number;
    }
  > = {
    wide: { center: [-1.8, 2.28, 0.55], width: 10.8, height: 5.32, tilt: 0.35 },
    machine: { center: [0.35, 3.1, 0.6], width: 6.0, height: 3.9, tilt: 0.3 },
    chute: { center: [0.4, 3.72, 0.15], width: 4.5, height: 2.7, tilt: 0.14 },
    multiplier: {
      center: [-4, 2.05, 0.15],
      width: 6.8,
      height: 4.95,
      tilt: 0.35,
    },
    mega: {
      center: [-0.703, 4.246, 0.04],
      width: 1.34,
      height: 0.64,
      tilt: 0.06,
    },
  };
  const fitShot = (name: ShowCamera) => {
    const shot = shots[name],
      halfFov = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    const distance = Math.max(
      shot.height / (2 * halfFov),
      shot.width / (2 * halfFov * camera.aspect),
    );
    cameraTarget.set(...shot.center);
    cameraPosition
      .copy(cameraTarget)
      .add(new T.Vector3(0, shot.tilt, distance));
    return distance;
  };
  const resize = () => {
    const rect = canvas.parentElement!.getBoundingClientRect();
    const width = Math.max(1, rect.width),
      height = Math.max(1, rect.height);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    const halfFov = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    camera.updateProjectionMatrix();
    // Anchor the architecture to the wide shot so camera moves also move the set.
    const distance = fitShot("wide");
    const studioCamera = camera.clone();
    studioCamera.position.copy(cameraPosition);
    studioCamera.lookAt(cameraTarget);
    const backdropDepth = distance + 3;
    studioWall.quaternion.copy(studioCamera.quaternion);
    studioWall.position
      .copy(studioCamera.position)
      .addScaledVector(
        studioCamera.getWorldDirection(new T.Vector3()),
        backdropDepth,
      );
    const cover =
      Math.max(
        (2 * backdropDepth * halfFov) / 7.8,
        (2 * backdropDepth * halfFov * camera.aspect) / 19.5,
      ) * 1.25;
    studioWall.scale.setScalar(cover);
    studioWall.position.y += 0.35;
    // A layout/orientation change must fit immediately; interpolating from the
    // previous aspect ratio briefly crops the host and cabinet. Show cuts still
    // use the smooth interpolation in render().
    fitShot(latest().frame.camera);
    camera.position.copy(cameraPosition);
    target.copy(cameraTarget);
    camera.lookAt(target);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas.parentElement!);
  resize();
  let raf = 0,
    previous = performance.now(),
    lastRound: string | null | undefined,
    activeKey = "",
    activeStart = THROAT.clone(),
    disposed = false,
    lastInventory = "";
  const normal = new T.Vector3();
  function physics(dt: number, state: MachineSceneState, time: number) {
    const free = balls.filter(
      (b) =>
        state.frame.bowl.includes(b.number) &&
        b.number !== state.frame.active?.number,
    );
    for (const ball of free) {
      const p = ball.mesh.position,
        v = ball.velocity,
        n = ball.number;
      v.y -= 5.7 * dt;
      if (state.running) {
        // Air rises from the impeller; the glass wall contains every unselected ball.
        const radial = Math.hypot(p.x - CENTER.x, p.z);
        v.y += (radial < 0.66 ? 12 : 1.5) * dt;
        v.x +=
          (Math.sin(time * 2.1 + n * 2.7) * 4 + (p.z - CENTER.z) * 1.9) * dt;
        v.z +=
          (Math.cos(time * 1.7 + n * 1.3) * 4 - (p.x - CENTER.x) * 1.9) * dt;
      }
      v.multiplyScalar(Math.exp(-0.2 * dt));
      v.clampLength(0, 4.8);
      p.addScaledVector(v, dt);
      normal.copy(p).sub(CENTER);
      const limit = RADIUS - BALL_RADIUS;
      if (normal.length() > limit) {
        normal.normalize();
        p.copy(CENTER).addScaledVector(normal, limit);
        const dot = v.dot(normal);
        if (dot > 0) v.addScaledVector(normal, -1.75 * dot);
      }
      ball.mesh.rotation.x += ball.spin.x * v.length() * dt * 3;
      ball.mesh.rotation.z += ball.spin.z * v.length() * dt * 3;
    }
    for (let i = 0; i < free.length; i++)
      for (let j = i + 1; j < free.length; j++) {
        const a = free[i],
          b = free[j];
        normal.copy(a.mesh.position).sub(b.mesh.position);
        const length = normal.length(),
          diameter = BALL_RADIUS * 2;
        if (length <= 0.0001 || length >= diameter) continue;
        normal.multiplyScalar(1 / length);
        a.mesh.position.addScaledVector(normal, (diameter - length) * 0.5);
        b.mesh.position.addScaledVector(normal, -(diameter - length) * 0.5);
        const approach = temp.copy(a.velocity).sub(b.velocity).dot(normal);
        if (approach < 0) {
          a.velocity.addScaledVector(normal, -approach * 0.84);
          b.velocity.addScaledVector(normal, approach * 0.84);
        }
      }
    // Contact resolution must not push a ball through the glass.
    for (const ball of free) {
      normal
        .copy(ball.mesh.position)
        .sub(CENTER)
        .clampLength(0, RADIUS - BALL_RADIUS);
      ball.mesh.position.copy(CENTER).add(normal);
    }
  }
  function render(now: number) {
    if (disposed) return;
    raf = requestAnimationFrame(render);
    if (document.hidden) {
      presenter.update(false, false);
      previous = now;
      return;
    }
    const dt = Math.min(0.032, Math.max(0.001, (now - previous) / 1000));
    previous = now;
    const state = latest(),
      frame = state.frame;
    const reelPresentation = cabinet.update(
      frame,
      state.multiplier,
      state.motion,
    );
    studioSet.update(frame.bonusLights, dt);
    presenter.update(
      state.motion,
      frame.camera === "wide" || frame.camera === "multiplier",
      `${state.roundId}:${frame.stage}`,
      frame.bonusLights,
    );
    if (lastRound !== state.roundId) {
      resetBalls();
      activeKey = "";
      lastRound = state.roundId;
    }
    const active = frame.active;
    const key = active ? `${state.roundId}:${active.index}` : "";
    if (key !== activeKey) {
      activeKey = key;
      if (active) activeStart.copy(balls[active.number - 1].mesh.position);
    }
    if (state.motion) {
      for (let step = 0; step < 2; step++) physics(dt / 2, state, now / 1000);
      impeller.rotation.y += dt * (state.running ? 18 : 1);
    }
    for (const ball of balls) {
      const drawnIndex = frame.drawn.indexOf(ball.number);
      ball.zone = "bowl";
      if (drawnIndex >= 0) {
        ball.zone = "rack";
        ball.mesh.position.copy(rackPosition(drawnIndex));
        ball.mesh.rotation.set(0, -Math.PI / 2, 0);
      }
      if (active?.number === ball.number && active.travel < RACK_POINT) {
        if (!active.released) {
          if (state.motion)
            ball.mesh.position.lerpVectors(
              activeStart,
              THROAT,
              smooth(active.travel / RELEASE_POINT),
            );
        } else {
          ball.zone = "chute";
          let t = chuteProgress(active.travel);
          if (!state.motion) ball.mesh.position.copy(chutePath.getPointAt(1));
          else if (active.mega && t < 0.45) {
            ball.mesh.position.copy(
              chutePath.getPointAt(0.016 * smooth(t / 0.12)),
            );
            ball.mesh.rotation.set(0, -Math.PI / 2, 0);
          } else {
            if (active.mega) t = Math.max(0, (t - 0.45) / 0.55);
            if (t < 0.77)
              ball.mesh.position.copy(
                chutePath.getPointAt(
                  active.mega ? 0.016 + 0.984 * (t / 0.77) : t / 0.77,
                ),
              );
            else
              ball.mesh.position.lerpVectors(
                chutePath.getPointAt(1),
                rackPosition(active.index),
                smooth((t - 0.77) / 0.23),
              );
            if (t < 0.77) ball.mesh.rotation.set(t * 18, -Math.PI / 2, t * 5);
          }
        }
      }
    }
    gate.position.x =
      -1.35 +
      (active && active.travel > 0.14 && active.travel < 0.35 ? 0.34 : 0);
    const bonus = frame.bonusLights;
    bonusWash.value = T.MathUtils.damp(bonusWash.value, bonus ? 1 : 0, 5, dt);
    reliefMaterial.color.lerp(
      new T.Color(bonus ? "#c1c6ff" : "#ffffff"),
      1 - Math.exp(-dt * 4),
    );
    bonusLight.intensity = T.MathUtils.damp(
      bonusLight.intensity,
      bonus ? 14 : 0,
      5,
      dt,
    );
    backdrop.color.lerp(
      new T.Color(
        canvas.dataset.studioAsset === "unavailable"
          ? bonus
            ? "#655776"
            : "#846336"
          : bonus
            ? "#d9cafa"
            : "#ffffff",
      ),
      1 - Math.exp(-dt * 4),
    );
    fitShot(frame.camera);
    const blend = state.motion ? 1 - Math.exp(-dt * 5) : 1;
    camera.position.lerp(cameraPosition, blend);
    target.lerp(cameraTarget, blend);
    camera.lookAt(target);
    if (canvas.dataset.showStage !== frame.stage)
      canvas.dataset.showStage = frame.stage;
    if (canvas.dataset.cameraShot !== frame.camera)
      canvas.dataset.cameraShot = frame.camera;
    canvas.dataset.reelState = frame.multiplierVisible
      ? "selected"
      : frame.stage === "multiplier-spinning"
        ? "spinning"
        : frame.reelOpen > 0
          ? "opening"
          : "closed";
    canvas.dataset.reelValue = frame.multiplierVisible
      ? String(reelPresentation.centerValue)
      : "";
    canvas.dataset.reelOffset = String(reelPresentation.centerOffset);
    canvas.dataset.resultVisible = String(frame.resultVisible);
    const inventory = `${frame.drawn.join(",")}:${frame.chute ?? ""}`;
    if (inventory !== lastInventory) {
      lastInventory = inventory;
      for (const zone of ["bowl", "chute", "rack"])
        canvas.dataset[`${zone}Numbers`] = balls
          .filter((b) => b.zone === zone)
          .map((b) => b.number)
          .join(",");
      canvas.dataset.totalBalls = String(balls.length);
      canvas.dataset.currentNumber = String(frame.current ?? "");
    }
    renderer.render(scene, camera);
  }
  render(performance.now());
  canvas.dataset.renderer = "webgl";
  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    observer.disconnect();
    presenter.dispose();
    cabinet.dispose();
    studioSet.dispose();
    counter.dispose();
    floor.dispose();
    resources.forEach((r) => r.dispose());
    environment.dispose();
    renderer.dispose();
  };
}
