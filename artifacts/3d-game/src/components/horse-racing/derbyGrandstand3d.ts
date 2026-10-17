import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const ROOT = "/assets/horse-racing/realistic/derby/";
let crowd: THREE.Texture | undefined;
export async function loadDerbyStand() {
  crowd ??= await new THREE.TextureLoader().loadAsync(
    `${ROOT}grandstand-crowd-v1.png`,
  );
  crowd.colorSpace = THREE.SRGBColorSpace;
  crowd.anisotropy = 8;
}

/** Volumetric architecture, with a photographic crowd plate on the upper tiers.
 * The lower stand keeps its individually modelled, instanced spectators.
 */
export function derbyGrandstand(night: boolean) {
  const group = new THREE.Group();
  group.name = "derby-grandstand";
  const cream = new THREE.MeshStandardMaterial({
    color: "#e0dfd4",
    roughness: 0.8,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: "#d1d4ce",
    roughness: 0.65,
  });
  const roof = new THREE.MeshStandardMaterial({
    color: "#29423e",
    roughness: 0.6,
    metalness: 0.2,
  });
  const brick = new THREE.MeshStandardMaterial({
    color: "#9b7560",
    roughness: 0.96,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: "#6a858b",
    metalness: 0.35,
    roughness: 0.28,
    emissive: night ? "#a57d45" : "#000000",
    emissiveIntensity: 0.45,
  });
  const boxes = new Map<THREE.Material, { p: number[]; s: number[] }[]>();
  const box = (p: number[], s: number[], material: THREE.Material) => {
    const batch = boxes.get(material) ?? [];
    batch.push({ p, s });
    boxes.set(material, batch);
  };
  // Long galleries behind both straights keep the venue visible in tracking shots.
  for (const side of [-1, 1]) {
    const z = side * 96;
    box([0, 8.4, z], [174, 16.8, 13], cream);
    box([0, 2.1, z - side * 6.6], [174, 4.2, 0.22], brick);
    for (let x = -80; x <= 80; x += 8) {
      box([x, 13.8, z - side * 6.6], [6.7, 3.6, 0.24], glass);
      box([x, 13.8, z - side * 6.78], [0.14, 3.7, 0.12], trim);
      box([x, 5.7, z - side * 7.1], [0.3, 11.4, 0.45], trim);
    }
    box([0, 16.95, z], [180, 0.5, 17.5], roof);
    box([0, 11.8, z - side * 7.3], [178, 0.35, 2.8], trim);
    const map = crowd!.clone();
    map.needsUpdate = true;
    const people = new THREE.MeshBasicMaterial({
      map,
      color: night ? "#aaaeb7" : "#f1f0e7",
      side: THREE.DoubleSide,
    });
    const crowdRows: THREE.BufferGeometry[] = [];
    // Each photographed row occupies its own step, so side shots have real depth.
    for (let bay = 0; bay < 7; bay++) {
      for (let row = 0; row < 5; row++) {
        const geometry = new THREE.PlaneGeometry(23.4, 1.23);
        const uv = geometry.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setY(i, (row + uv.getY(i)) / 5);
        const x = -72 + bay * 24,
          y = 5.9 + row * 1.2,
          z = side * (87.2 + row * 0.46);
        geometry.rotateY(side === 1 ? Math.PI : 0).translate(x, y, z);
        crowdRows.push(geometry);
        box([x, y - 0.6, z], [23.7, 0.16, 1.3], trim);
      }
    }
    group.add(new THREE.Mesh(mergeGeometries(crowdRows), people));
    crowdRows.forEach((g) => g.dispose());
    // Pavilions and slender spires give the course a recognisable race-day skyline.
    for (const x of [-53, 53]) {
      box([x, 18.6, z], [9.2, 4.2, 10], cream);
      for (const dx of [-2.7, 0, 2.7])
        box([x + dx, 18.7, z - side * 5.08], [1.8, 2.6, 0.16], glass);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(7.1, 5.2, 4), roof);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(x, 23.3, z);
      cap.castShadow = true;
      group.add(cap);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5.2, 8), roof);
      spire.position.set(x, 28.1, z);
      group.add(spire);
    }
  }
  const dummy = new THREE.Object3D();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  for (const [material, placements] of boxes) {
    const mesh = new THREE.InstancedMesh(cube, material, placements.length);
    placements.forEach(({ p, s }, index) => {
      dummy.position.set(...(p as [number, number, number]));
      dummy.scale.set(...(s as [number, number, number]));
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
