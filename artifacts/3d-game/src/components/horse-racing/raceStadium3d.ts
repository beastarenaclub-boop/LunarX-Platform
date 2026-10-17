import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { stadiumAudience, type SpectatorSeat } from "./stadiumAudience3d";

const ROOT = "/assets/horse-racing/realistic/stadium/";
let atlas: THREE.Texture, facade: THREE.Texture;
export async function loadStadiumAssets() {
  [atlas, facade] = await Promise.all(
    ["spectators-atlas-v1.png", "hospitality-facade-v1.png"].map(
      async (name) => {
        const texture = await new THREE.TextureLoader().loadAsync(ROOT + name);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 8;
        return texture;
      },
    ),
  );
}

type Position = [number, number, number];
type Placement = { p: Position; s: Position; rotation?: THREE.Quaternion };
/** Complete oval stadium with deep seating decks, curved end terraces,
 * hospitality galleries, structural roofs and individually placed spectators. */
export function buildStadium(
  theme: string,
  time: { value: number },
  phone: boolean,
) {
  const group = new THREE.Group();
  group.name = "racecourse-stadium";
  const night = theme === "night",
    classic = theme === "royal" || theme === "marathon";
  let seed = 814;
  const random = () =>
    (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const standard = (color: string, roughness = 0.8, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const cream = standard(night ? "#969eaa" : "#d9d5c9");
  const stone = standard("#97998e");
  const darkConcrete = standard("#525c56");
  const trim = standard("#e0e0d5", 0.5, 0.18);
  const steel = standard(night ? "#343e53" : "#28443c", 0.5, 0.48);
  const roof = standard(night ? "#354254" : "#50645e", 0.66, 0.3);
  const seatsMat = standard("#214d40", 0.65);
  const hedge = standard("#294725", 0.96);
  const redFlowers = standard("#78393a", 0.92);
  const gold = standard("#b9a274", 0.45, 0.4);
  const glass = new THREE.MeshStandardMaterial({
    color: night ? "#a29269" : "#425e62",
    roughness: 0.19,
    metalness: 0.65,
    emissive: night ? "#a78a55" : "#17242a",
    emissiveIntensity: night ? 0.4 : 0.08,
  });
  const boxes = new Map<THREE.Material, Placement[]>();
  const tubes = new Map<THREE.Material, Placement[]>();
  const geometries = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const box = (
    p: Position,
    s: Position,
    mat: THREE.Material,
    rotation?: THREE.Quaternion,
  ) => {
    const batch = boxes.get(mat) ?? [];
    batch.push({ p, s, rotation });
    boxes.set(mat, batch);
  };
  const beam = (a: Position, b: Position, width: number, mat = steel) => {
    const delta = new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
    const batch = tubes.get(mat) ?? [];
    batch.push({
      p: a.map((v, i) => (v + b[i]) / 2) as Position,
      s: [width, delta.length(), width],
      rotation: new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        delta.normalize(),
      ),
    });
    tubes.set(mat, batch);
  };
  const addGeometry = (g: THREE.BufferGeometry, mat: THREE.Material) => {
    const batch = geometries.get(mat) ?? [];
    batch.push(g);
    geometries.set(mat, batch);
  };
  const surface = (
    a: Position,
    b: Position,
    c: Position,
    d: Position,
    mat: THREE.Material,
  ) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3),
    );
    g.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2),
    );
    g.computeVertexNormals();
    addGeometry(g, mat);
  };
  const stoneNoise = document.createElement("canvas");
  stoneNoise.width = stoneNoise.height = 128;
  const ctx = stoneNoise.getContext("2d")!;
  ctx.fillStyle = "#e6e4dc";
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2500; i++) {
    ctx.fillStyle = `rgba(60,54,46,${random() * 0.1})`;
    ctx.fillRect(random() * 128, random() * 128, 1, 1 + random() * 2);
  }
  const grain = new THREE.CanvasTexture(stoneNoise);
  grain.colorSpace = THREE.SRGBColorSpace;
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping;
  grain.repeat.set(3, 1);
  cream.map = grain;
  stone.map = grain;
  darkConcrete.map = grain;
  const audience: SpectatorSeat[][] = [];
  const seat = (
    batch: SpectatorSeat[],
    x: number,
    y: number,
    z: number,
    shade: number,
  ) => {
    if (random() < 0.015) return;
    batch.push({ x, y, z, shade });
  };
  const facadeMap = facade.clone();
  facadeMap.needsUpdate = true;
  const facadeMat = new THREE.MeshBasicMaterial({
    map: facadeMap,
    color: night ? "#aaaeb4" : "#e1e0d8",
    side: THREE.DoubleSide,
  });
  roof.side = stone.side = darkConcrete.side = THREE.DoubleSide;

  for (const side of [-1, 1]) {
    const people: SpectatorSeat[] = [];
    audience.push(people);
    // Two seating decks with walkable stair aisles and a concourse between them.
    for (const [rows, baseY, baseZ] of [
      [14, 0.48, 65],
      [11, 7.7, 82],
    ] as const) {
      for (let row = 0; row < rows; row++) {
        const y = baseY + row * 0.39,
          z = side * (baseZ + row * 0.86);
        box([0, y - 0.16, z], [140, 0.32, 0.9], stone);
        box([0, y - 0.34, z - side * 0.4], [140, 0.11, 0.08], darkConcrete);
        for (let column = 0; column < 192; column++) {
          const x = -69 + column * 0.724;
          if ([-53, -18, 18, 53].some((a) => Math.abs(x - a) < 1.18)) continue;
          seat(people, x + (row % 2 ? 0.14 : 0), y, z, baseY > 2 ? 0.72 : 0.95);
          if (row % 2 === 0)
            box([x, y + 0.48, z + side * 0.17], [0.48, 0.43, 0.1], seatsMat);
        }
        for (const x of [-53, -18, 18, 53]) {
          box([x, y + 0.025, z], [1.8, 0.05, 0.85], trim);
          if (row % 2 === 0) beam([x, y, z], [x, y + 0.95, z], 0.04, steel);
          if (row < rows - 1)
            beam([x, y + 0.96, z], [x, y + 1.35, z + side * 0.86], 0.04, steel);
        }
      }
      const frontZ = side * (baseZ - 0.75);
      beam([-70, baseY + 1.1, frontZ], [70, baseY + 1.1, frontZ], 0.055, steel);
      beam(
        [-70, baseY + 0.38, frontZ],
        [70, baseY + 0.38, frontZ],
        0.035,
        steel,
      );
      for (let x = -70; x <= 70; x += 1.4)
        beam([x, baseY - 0.1, frontZ], [x, baseY + 1.1, frontZ], 0.04, steel);
    }
    // Recessed portals and elevated concourse under the upper seating.
    box([0, 6.75, side * 81], [142, 0.42, 6.8], cream);
    box([0, 6.6, side * 77.5], [142, 0.3, 0.26], trim);
    for (const x of [-53, -18, 18, 53]) {
      box([x, 5.5, side * 80.6], [4.3, 2.5, 0.2], darkConcrete);
      box([x - 2.3, 5.5, side * 80.3], [0.35, 2.7, 0.5], cream);
      box([x + 2.3, 5.5, side * 80.3], [0.35, 2.7, 0.5], cream);
    }
    // Pitched metal skin, deep fascia and triangulated roof trusses.
    surface(
      [-73, 15.25, side * 78],
      [73, 15.25, side * 78],
      [73, 17.65, side * 98],
      [-73, 17.65, side * 98],
      roof,
    );
    box([0, 15.04, side * 78], [146, 0.45, 0.28], trim);
    box([0, 14.78, side * 78.2], [146, 0.13, 0.5], steel);
    for (let x = -70; x <= 70; x += 7) {
      beam([x, 6.6, side * 94.5], [x, 20.5, side * 94.5], 0.16, trim);
      beam([x, 14.75, side * 78.2], [x, 17.3, side * 98], 0.13, trim);
      beam([x, 14.75, side * 78.2], [x, 14.8, side * 96], 0.11, steel);
      beam([x, 14.8, side * 86], [x, 16.75, side * 94.5], 0.09, trim);
      beam([x, 14.8, side * 94.5], [x, 15.8, side * 86], 0.09, trim);
    }
    for (let x = -72; x <= 72; x += 1.8)
      beam([x, 15.3, side * 78], [x, 17.7, side * 98], 0.025, roof);
    // Textured hospitality bays, projecting balconies, structural mullions.
    box([0, 10.8, side * 101], [143, 21.6, 5], cream);
    box([0, 13.8, side * 98.44], [141, 5.4, 0.15], darkConcrete);
    for (let bay = 0; bay < 8; bay++) {
      const x = -63 + bay * 18;
      const plane = new THREE.PlaneGeometry(17.8, 5.6);
      plane.rotateY(side === 1 ? Math.PI : 0).translate(x, 20.6, side * 98.42);
      addGeometry(plane, facadeMat);
      // The overview also sees the public entrance elevation behind the stands.
      for (const [y, height] of [
        [3.2, 6],
        [9.2, 6],
        [15.2, 6],
        [21.75, 7],
      ]) {
        const rear = new THREE.PlaneGeometry(17.8, height);
        rear.rotateY(side === 1 ? 0 : Math.PI).translate(x, y, side * 103.54);
        addGeometry(rear, facadeMat);
        box([x - 9, y, side * 103.65], [0.34, height, 0.4], trim);
        box([x, y + height / 2, side * 103.72], [18, 0.22, 0.55], cream);
      }
      box([x, 1.7, side * 103.64], [2.6, 3.4, 0.15], glass);
      box([x, 3.52, side * 104.8], [4.6, 0.18, 2.8], steel);
      for (const offset of [-2, 2])
        beam(
          [x + offset, 0, side * 105.7],
          [x + offset, 3.45, side * 105.7],
          0.08,
          trim,
        );
      box([x - 9, 20.6, side * 98.16], [0.27, 5.9, 0.5], trim);
      box([x, 17.7, side * 96.5], [17.8, 0.28, 4.6], cream);
      box([x, 17.51, side * 94.1], [17.8, 0.15, 0.18], steel);
      for (let row = 0; row < 2; row++)
        for (let col = 0; col < 23; col++)
          seat(
            people,
            x - 8.1 + col * 0.72,
            17.9,
            side * (94.9 + row * 1.05),
            0.86,
          );
      beam(
        [x - 8.8, 18.8, side * 94],
        [x + 8.8, 18.8, side * 94],
        0.055,
        steel,
      );
      for (let col = -8; col <= 8; col += 0.8)
        beam(
          [x + col, 17.8, side * 94],
          [x + col, 18.8, side * 94],
          0.03,
          steel,
        );
    }
    surface(
      [-74, 23.6, side * 96],
      [74, 23.6, side * 96],
      [74, 25.5, side * 104],
      [-74, 25.5, side * 104],
      roof,
    );
    box([0, 23.42, side * 96], [148, 0.44, 0.32], trim);
    if (classic)
      for (const x of [-31, 31]) {
        const z = side * 102;
        addGeometry(
          new THREE.CylinderGeometry(3.5, 3.5, 4.8, 8).translate(x, 27.4, z),
          cream,
        );
        for (let face = 0; face < 8; face++) {
          const a = (face * Math.PI) / 4;
          const window = new THREE.PlaneGeometry(1.65, 2.5);
          window
            .rotateY(a)
            .translate(x + Math.sin(a) * 3.27, 27.6, z + Math.cos(a) * 3.27);
          addGeometry(window, glass);
        }
        addGeometry(
          new THREE.ConeGeometry(4.65, 3.1, 8).translate(x, 31, z),
          roof,
        );
        addGeometry(
          new THREE.ConeGeometry(1.3, 7.5, 8).translate(x, 36.3, z),
          roof,
        );
        addGeometry(
          new THREE.SphereGeometry(0.2, 8, 6).translate(x, 40.1, z),
          gold,
        );
        for (const y of [25, 29.85])
          addGeometry(
            new THREE.CylinderGeometry(3.72, 3.72, 0.22, 8).translate(x, y, z),
            trim,
          );
      }
  }
  // Filled curved terraces at both turns, divided by radial stair aisles.
  for (const end of [-1, 1]) {
    const people: SpectatorSeat[] = [];
    audience.push(people);
    for (let row = 0; row < 9; row++) {
      const radius = 65 + row * 0.9,
        y = 0.48 + row * 0.4;
      for (let part = 0; part < 96; part++) {
        const a = -Math.PI / 2 + (part / 96) * Math.PI;
        const b = -Math.PI / 2 + ((part + 1) / 96) * Math.PI;
        const point = (angle: number, r: number, height: number): Position => [
          end * (70 + Math.cos(angle) * r),
          height,
          Math.sin(angle) * r,
        ];
        surface(
          point(a, radius - 0.4, y),
          point(b, radius - 0.4, y),
          point(b, radius + 0.5, y),
          point(a, radius + 0.5, y),
          stone,
        );
        surface(
          point(a, radius - 0.4, y - 0.4),
          point(b, radius - 0.4, y - 0.4),
          point(b, radius - 0.4, y),
          point(a, radius - 0.4, y),
          darkConcrete,
        );
      }
      const count = Math.floor((Math.PI * radius) / 0.73);
      for (let col = 0; col < count; col++) {
        if (col % 36 < 3) continue;
        const a = -Math.PI / 2 + ((col + 0.5) / count) * Math.PI;
        seat(
          people,
          end * (70 + Math.cos(a) * radius),
          y,
          Math.sin(a) * radius,
          0.92,
        );
      }
    }
    for (let part = 0; part < 9; part++) {
      const a = -Math.PI / 2 + (part / 8) * Math.PI;
      beam(
        [end * (70 + Math.cos(a) * 65), 1.45, Math.sin(a) * 65],
        [end * (70 + Math.cos(a) * 73), 5.05, Math.sin(a) * 73],
        0.05,
        steel,
      );
    }
  }
  // Clipped planting and rose beds separate the terraces from the running rail.
  for (let i = 0; i < 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    const x = (Math.cos(a) >= 0 ? 70 : -70) + Math.cos(a) * 61.5;
    const z = Math.sin(a) * 61.5;
    const rotation = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      -a,
    );
    box([x, 0.43, z], [1.6, 0.85, 1.4], hedge, rotation);
    if (i % 2 === 0) box([x, 0.91, z], [1.35, 0.15, 1.1], redFlowers, rotation);
  }
  for (const side of [-1, 1]) {
    box([0, 0.43, side * 61.5], [140, 0.85, 1.4], hedge);
    box([0, 0.9, side * 61.5], [140, 0.12, 1.1], redFlowers);
  }
  const lighting = new THREE.MeshStandardMaterial({
    color: "#fff2cf",
    emissive: "#fff2cf",
    emissiveIntensity: night ? 3 : 0.25,
  });
  for (const x of [-72, -24, 24, 72])
    for (const side of [-1, 1]) {
      beam([x, 0, side * 111], [x, 36, side * 111], 0.28, steel);
      box([x, 35.8, side * 111], [5.2, 1.55, 0.75], steel);
      for (let col = -2; col <= 2; col++)
        for (const y of [35.4, 36.2])
          box([x + col * 0.9, y, side * 110.58], [0.64, 0.54, 0.13], lighting);
    }
  // Architecture is instanced by material; crowd sectors can be culled separately.
  const dummy = new THREE.Object3D();
  const identity = new THREE.Quaternion();
  const cube = new THREE.BoxGeometry(1, 1, 1),
    cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 6);
  for (const [batches, geometry] of [
    [boxes, cube],
    [tubes, cylinder],
  ] as const) {
    for (const [mat, items] of batches) {
      const mesh = new THREE.InstancedMesh(geometry, mat, items.length);
      items.forEach((item, index) => {
        dummy.position.set(...item.p);
        dummy.scale.set(...item.s);
        dummy.quaternion.copy(item.rotation ?? identity);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
      });
      mesh.castShadow = mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  for (const [mat, items] of geometries) {
    // Non-indexed primitives share one layout with the authored terrace quads.
    const normalized = items.map((g) => (g.index ? g.toNonIndexed() : g));
    const mesh = new THREE.Mesh(mergeGeometries(normalized), mat);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
    new Set([...items, ...normalized]).forEach((g) => g.dispose());
  }
  audience.forEach((people, index) =>
    group.add(stadiumAudience(atlas, people, time, phone, 904 + index * 127)),
  );
  group.userData.spectatorCount = audience.reduce(
    (sum, people) => sum + people.length,
    0,
  );
  group.userData.audienceSections = audience.length;
  group.userData.revision = "full-racecourse-v2";
  return group;
}
