import * as THREE from "three";
import { trackPoint, type Venue } from "./engine";

const UP = new THREE.Vector3(0, 1, 0);
const temp = new THREE.Object3D();
type Placement = { p: number[]; s?: number[]; r?: number; c?: string };
function material(color: string, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.88, ...extra });
}
function box(
  group: THREE.Group,
  p: number[],
  s: number[],
  mat: THREE.Material,
  rotation = 0,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...(s as [number, number, number])),
    mat,
  );
  mesh.position.set(...(p as [number, number, number]));
  mesh.rotation.y = rotation;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function instances(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  placements: Placement[],
  shadow = false,
) {
  const mesh = new THREE.InstancedMesh(geometry, mat, placements.length);
  placements.forEach(({ p, s = [1, 1, 1], r = 0, c }, i) => {
    temp.position.set(...(p as [number, number, number]));
    temp.scale.set(...(s as [number, number, number]));
    temp.rotation.set(0, r, 0);
    temp.updateMatrix();
    mesh.setMatrixAt(i, temp.matrix);
    if (c) mesh.setColorAt(i, new THREE.Color(c));
  });
  mesh.castShadow = shadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
function rng(seed = 28) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function groundTexture(color: string, turf: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  const random = rng();
  for (let i = 0; i < 18000; i++) {
    ctx.fillStyle =
      random() > 0.5
        ? `rgba(255,255,230,${random() * 0.1})`
        : `rgba(25,20,10,${random() * 0.15})`;
    ctx.fillRect(
      random() * 256,
      random() * 256,
      turf ? 0.7 : random() * 2.5,
      turf ? 2.4 : 1.2,
    );
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(turf ? 55 : 0.2, turf ? 55 : 0.2);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
function labelTexture(text: string, bg = "#173d32", fg = "#f8f4df") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1024, 128);
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 55px Georgia";
  ctx.fillText(text, 512, 65);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
function ovalShape(radius: number) {
  const points: THREE.Vector2[] = [];
  const lane = (radius - 35) / 2.15;
  for (let i = 0; i < 240; i++) {
    const p = trackPoint(i / 240, lane);
    points.push(new THREE.Vector2(p.x, p.z));
  }
  return points;
}
export function buildWorld(venue: Venue) {
  const world = new THREE.Group(),
    random = rng(91),
    night = venue.theme === "night";
  const white = material("#e7e5da"),
    steel = material(night ? "#394255" : "#50615c", { metalness: 0.35 });
  const concrete = material("#bcbcaf"),
    dark = material("#183c32"),
    glass = material(night ? "#facb70" : "#96b8bd", {
      metalness: 0.4,
      roughness: 0.2,
      emissive: night ? "#ad7540" : "#111e20",
      emissiveIntensity: night ? 0.8 : 0.15,
    });
  const terrainMat = material(venue.grass, {
    map: groundTexture("#c6cdad", true),
  });
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1800, 1800),
    terrainMat,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.15;
  ground.receiveShadow = true;
  world.add(ground);
  const shape = new THREE.Shape(ovalShape(54));
  shape.holes.push(new THREE.Path(ovalShape(32).reverse()));
  const track = new THREE.Mesh(
    new THREE.ShapeGeometry(shape, 180),
    material(venue.track, { map: groundTexture("#d3c2a8", false) }),
  );
  track.rotation.x = -Math.PI / 2;
  track.receiveShadow = true;
  world.add(track);
  for (let i = -6; i <= 6; i++)
    box(
      world,
      [i * 10, -0.07, 0],
      [10, 0.025, 55],
      material(i % 2 ? venue.grass : "#608451"),
    );
  // White rails follow the whole circuit, with no missing sections on bends.
  const posts: Placement[] = [],
    rails: Placement[] = [];
  for (const radius of [32, 54]) {
    for (let i = 0; i < 180; i++) {
      const a = trackPoint(i / 180, (radius - 35) / 2.15),
        b = trackPoint((i + 1) / 180, (radius - 35) / 2.15);
      posts.push({ p: [a.x, 0.75, a.z], s: [0.13, 1.5, 0.13] });
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      for (const y of [0.75, 1.36])
        rails.push({
          p: [(a.x + b.x) / 2, y, (a.z + b.z) / 2],
          s: [0.14, 0.15, length + 0.06],
          r: Math.atan2(b.x - a.x, b.z - a.z),
        });
    }
  }
  instances(world, new THREE.BoxGeometry(1, 1, 1), white, [...posts, ...rails]);
  // Tiered, covered grandstands and a seated crowd rendered in just two draw calls.
  const bodies: Placement[] = [],
    heads: Placement[] = [];
  const crowdColors = [
    "#dddad0",
    "#3b6388",
    "#c8a065",
    "#4e6860",
    "#7a506c",
    "#b45045",
    "#394453",
  ];
  for (const side of [-1, 1]) {
    const rows = side === -1 || venue.theme === "marathon" ? 9 : 5;
    for (let row = 0; row < rows; row++) {
      const z = side * (63 + row * 2.15),
        y = 0.5 + row * 0.85;
      box(world, [0, y / 2, z], [154, y, 2.2], concrete);
      box(world, [0, y + 0.22, z], [152, 0.15, 0.6], material("#325b4c"));
      for (let seat = 0; seat < 95; seat++) {
        if (random() < 0.13) continue;
        const x = -74 + seat * 1.55,
          size = 0.85 + random() * 0.3;
        bodies.push({
          p: [x, y + 0.75, z],
          s: [0.43, 0.7 * size, 0.35],
          c: crowdColors[Math.floor(random() * crowdColors.length)],
        });
        heads.push({
          p: [x, y + 1.3 * size, z],
          s: [0.24, 0.27, 0.24],
          c: ["#d9a578", "#b57851", "#8b5a3c", "#e3ba96"][
            Math.floor(random() * 4)
          ],
        });
      }
    }
    const roofY = rows * 0.85 + 5;
    box(
      world,
      [0, roofY, side * (63 + rows)],
      [160, 0.5, rows * 2.2 + 5],
      steel,
    );
    box(
      world,
      [0, roofY - 0.8, side * (60 + rows * 2.1)],
      [155, 2.2, 0.25],
      glass,
    );
    for (let x = -76; x <= 76; x += 19)
      box(
        world,
        [x, roofY / 2, side * (62 + rows * 2)],
        [0.38, roofY, 0.38],
        white,
      );
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(145, 2.3),
      new THREE.MeshStandardMaterial({
        map: labelTexture(
          "T U R F   C L U B     /     W O R L D   R A C I N G",
        ),
        side: THREE.DoubleSide,
      }),
    );
    banner.position.set(0, roofY, side * (59 + (rows > 5 ? 1 : 0)));
    if (side === 1) banner.rotation.y = Math.PI;
    world.add(banner);
  }
  instances(
    world,
    new THREE.CapsuleGeometry(0.5, 0.45, 3, 5),
    material("#ffffff"),
    bodies,
  );
  instances(
    world,
    new THREE.SphereGeometry(1, 6, 4),
    material("#ffffff"),
    heads,
  );
  // Finish gantry, timing tower and painted chequered line.
  for (const z of [-32, -55]) box(world, [0, 4, z], [0.4, 8, 0.4], white);
  const gantry = box(world, [0, 7.8, -43.5], [0.42, 1.2, 23.5], dark);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(22.5, 1.05),
    new THREE.MeshBasicMaterial({
      map: labelTexture("F I N I S H"),
      side: THREE.DoubleSide,
    }),
  );
  sign.position.copy(gantry.position);
  sign.position.x = 0.23;
  sign.rotation.y = Math.PI / 2;
  world.add(sign);
  const checks: Placement[] = [];
  for (let x = 0; x < 3; x++)
    for (let z = 0; z < 30; z++)
      checks.push({
        p: [x * 0.4 - 0.4, 0.025, -32.7 - z * 0.7],
        s: [0.4, 0.03, 0.7],
        c: (x + z) % 2 ? "#f0eee0" : "#2c3932",
      });
  instances(world, new THREE.BoxGeometry(1, 1, 1), white, checks);
  box(world, [-33, 5.8, -18], [17, 8.5, 0.6], dark);
  const board = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 7.5),
    new THREE.MeshBasicMaterial({
      map: labelTexture("TURF CLUB", "#102a25", "#efcf83"),
      side: THREE.DoubleSide,
    }),
  );
  board.position.set(-33, 5.8, -18.4);
  board.rotation.y = Math.PI;
  world.add(board);
  for (const x of [-39, -27]) box(world, [x, 2, -18], [0.4, 4, 0.4], steel);
  // Track-side sponsor boards and distance markers.
  const ads = [
    "THE ROYAL CUP",
    "TURF CLUB",
    venue.name.toUpperCase(),
    "WORLD RACING",
  ];
  for (let i = 0; i < 12; i++) {
    const advert = new THREE.Mesh(
      new THREE.PlaneGeometry(11.5, 1.6),
      new THREE.MeshStandardMaterial({
        map: labelTexture(
          ads[i % 4],
          i % 2 ? "#ded5b9" : "#1d4b3d",
          i % 2 ? "#224538" : "#f1e7cc",
        ),
        side: THREE.DoubleSide,
      }),
    );
    advert.position.set(-66 + i * 12, 1, 58);
    advert.rotation.y = Math.PI;
    world.add(advert);
  }
  const lamps: Placement[] = [];
  for (const x of [-91, -40, 40, 91])
    for (const z of [-89, 89]) {
      box(world, [x, 14, z], [0.45, 28, 0.45], steel);
      box(world, [x, 27.5, z], [5.5, 1.5, 0.6], steel);
      for (let i = 0; i < 5; i++)
        lamps.push({
          p: [x - 2 + i, 27.5, z + (z < 0 ? 0.35 : -0.35)],
          s: [0.75, 0.85, 0.1],
        });
    }
  instances(
    world,
    new THREE.BoxGeometry(1, 1, 1),
    material("#fff2c9", {
      emissive: "#fff2c9",
      emissiveIntensity: night ? 3 : 0.1,
    }),
    lamps,
  );
  // Trees, hills, skyline and shoreline are local procedural assets.
  const trunks: Placement[] = [],
    leaves: Placement[] = [],
    hills: Placement[] = [];
  for (let i = 0; i < 105; i++) {
    const a = random() * Math.PI * 2,
      r = 140 + random() * 140,
      x = Math.cos(a) * r * 1.25,
      z = Math.sin(a) * r;
    if (venue.theme === "coast" && z > 100) continue;
    const height = 5 + random() * 6;
    trunks.push({ p: [x, height / 2, z], s: [0.4, height, 0.4] });
    leaves.push({
      p: [x, height + 1, z],
      s: [3 + random(), venue.theme === "alpine" ? 7 : 4, 3 + random()],
      c: ["#35563e", "#416146", "#547452"][i % 3],
    });
  }
  if (venue.theme !== "desert" && venue.theme !== "night") {
    instances(
      world,
      new THREE.CylinderGeometry(1, 1.2, 1, 5),
      material("#675443"),
      trunks,
    );
    instances(
      world,
      venue.theme === "alpine"
        ? new THREE.ConeGeometry(1, 2, 7)
        : new THREE.IcosahedronGeometry(1, 1),
      material("#ffffff"),
      leaves,
      true,
    );
  }
  if (
    venue.theme === "royal" ||
    venue.theme === "marathon" ||
    venue.theme === "alpine"
  ) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      hills.push({
        p: [Math.cos(a) * 410, -20, Math.sin(a) * 370],
        s: [
          85 + random() * 70,
          venue.theme === "alpine" ? 170 + random() * 100 : 50 + random() * 35,
          90,
        ],
        c: venue.theme === "alpine" ? "#84958f" : "#6d865d",
      });
    }
    instances(
      world,
      venue.theme === "alpine"
        ? new THREE.ConeGeometry(1, 1, 5)
        : new THREE.SphereGeometry(1, 12, 8),
      material("#ffffff"),
      hills,
    );
    if (venue.theme === "alpine")
      instances(
        world,
        new THREE.ConeGeometry(1, 1, 5),
        white,
        hills.map((h) => ({
          p: [h.p[0], h.s![1] * 0.36 - 20, h.p[2]],
          s: [h.s![0] * 0.28, h.s![1] * 0.28, 90 * 0.28],
        })),
      );
  }
  if (venue.theme === "desert" || venue.theme === "night") {
    const buildings: Placement[] = [],
      windows: Placement[] = [];
    for (let i = 0; i < 45; i++) {
      const x = -250 + i * 12,
        height = 10 + random() * 65,
        z = 180 + random() * 60;
      buildings.push({
        p: [x, height / 2, z],
        s: [7 + random() * 5, height, 10],
        c: night ? "#27354b" : "#bfb8a5",
      });
      for (let y = 4; y < height; y += 4)
        windows.push({ p: [x, y, z - 5.1], s: [5, 1.3, 0.1] });
    }
    instances(world, new THREE.BoxGeometry(1, 1, 1), white, buildings);
    instances(world, new THREE.BoxGeometry(1, 1, 1), glass, windows);
    if (venue.theme === "desert") {
      for (let i = 0; i < 25; i++) {
        const x = -160 + i * 13,
          z = -112 - random() * 15;
        box(world, [x, 5, z], [0.6, 10, 0.6], material("#998463"));
        for (let leaf = 0; leaf < 6; leaf++) {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(1, 6, 4),
            material("#637a43"),
          );
          mesh.position.set(x + Math.sin(leaf) * 2, 10, z + Math.cos(leaf) * 2);
          mesh.scale.set(0.8, 0.3, 4);
          mesh.rotation.y = leaf;
          world.add(mesh);
        }
      }
    }
  }
  if (venue.theme === "coast") {
    box(
      world,
      [0, -0.11, 560],
      [1800, 0.05, 860],
      material("#4f9aa8", { metalness: 0.4, roughness: 0.25 }),
    );
    box(world, [0, -0.08, 141], [1700, 0.03, 28], material("#dacba5"));
    for (let i = 0; i < 9; i++)
      box(
        world,
        [0, -0.03, 161 + i * 18],
        [1600, 0.02, 0.5],
        material("#b3d5ce"),
      );
  }
  // Flags near the entrances, matching the meeting's green and gold identity.
  for (let i = 0; i < 8; i++) {
    const x = -64 + i * 18;
    box(world, [x, 8, -87], [0.14, 16, 0.14], white);
    box(
      world,
      [x + 1.35, 14.5, -87],
      [2.7, 1.7, 0.045],
      material(i % 2 ? "#d9bb76" : "#255d4a"),
    );
  }
  return world;
}

export function disposeWorld(world: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  world.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const mat of Array.isArray(object.material)
        ? object.material
        : [object.material])
        materials.add(mat);
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => {
    const mat = m as THREE.MeshStandardMaterial;
    mat.map?.dispose();
    m.dispose();
  });
}

export function riderModel(color: string, id: number) {
  const rider = new THREE.Group(),
    silk = material(color),
    pants = material("#f1eee4"),
    boots = material("#252b29"),
    skin = material("#d1a079");
  function ellipsoid(p: number[], s: number[], mat: THREE.Material) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), mat);
    mesh.position.set(...(p as [number, number, number]));
    mesh.scale.set(...(s as [number, number, number]));
    mesh.castShadow = true;
    rider.add(mesh);
    return mesh;
  }
  function limb(a: number[], b: number[], radius: number, mat: THREE.Material) {
    const start = new THREE.Vector3(...(a as [number, number, number])),
      end = new THREE.Vector3(...(b as [number, number, number]));
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        radius,
        radius * 0.9,
        start.distanceTo(end),
        8,
      ),
      mat,
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(UP, end.sub(start).normalize());
    mesh.castShadow = true;
    rider.add(mesh);
  }
  // Crouched jockey, boots, saddle cloth and reins follow the horse's gallop.
  ellipsoid([0, 2.14, -0.15], [0.64, 0.13, 0.67], silk);
  ellipsoid([0, 2.28, -0.1], [0.38, 0.14, 0.45], boots);
  const torso = ellipsoid([0, 2.85, 0.22], [0.25, 0.4, 0.19], silk);
  torso.rotation.x = 0.9;
  ellipsoid([0, 3.08, 0.58], [0.18, 0.2, 0.18], skin);
  ellipsoid([0, 3.23, 0.57], [0.23, 0.16, 0.23], silk);
  box(rider, [0, 3.17, 0.75], [0.36, 0.035, 0.22], boots);
  for (const side of [-1, 1]) {
    limb([side * 0.17, 2.69, -0.05], [side * 0.5, 2.15, 0.4], 0.13, pants);
    limb([side * 0.5, 2.15, 0.4], [side * 0.55, 1.68, 0.03], 0.1, boots);
    ellipsoid([side * 0.55, 1.66, 0.12], [0.11, 0.09, 0.23], boots);
    limb([side * 0.2, 2.95, 0.35], [side * 0.35, 2.65, 0.56], 0.09, silk);
    limb([side * 0.35, 2.65, 0.56], [side * 0.18, 2.64, 0.94], 0.07, silk);
    ellipsoid([side * 0.18, 2.64, 0.96], [0.07, 0.07, 0.1], skin);
    limb([side * 0.18, 2.64, 0.96], [side * 0.21, 2.8, 1.68], 0.015, boots);
    const number = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.36),
      new THREE.MeshBasicMaterial({
        map: labelTexture(String(id), color, "#ffffff"),
        side: THREE.DoubleSide,
      }),
    );
    number.position.set(side * 0.63, 2.14, -0.18);
    number.rotation.y = (side * Math.PI) / 2;
    rider.add(number);
  }
  return rider;
}
