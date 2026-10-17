import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Small sewn/leather details share materials and are merged into three draws. */
export function riderEquipment(accent: string, warmLeather: boolean) {
  const group = new THREE.Group();
  const batches: THREE.BufferGeometry[][] = [[], [], []];
  const materials = [
    new THREE.MeshStandardMaterial({
      color: warmLeather ? "#382a20" : "#1c2022",
      roughness: 0.42,
    }),
    new THREE.MeshStandardMaterial({ color: accent, roughness: 0.65 }),
    new THREE.MeshStandardMaterial({
      color: "#7e8382",
      roughness: 0.36,
      metalness: 0.72,
    }),
  ];
  const dummy = new THREE.Object3D();
  function piece(
    g: THREE.BufferGeometry,
    p: THREE.Vector3,
    scale: THREE.Vector3,
    rotation: THREE.Quaternion,
    material = 0,
  ) {
    dummy.position.copy(p);
    dummy.scale.copy(scale);
    dummy.quaternion.copy(rotation);
    dummy.updateMatrix();
    g.applyMatrix4(dummy.matrix);
    g.deleteAttribute("uv");
    batches[material].push(g);
  }
  const up = new THREE.Vector3(0, 1, 0),
    unit = new THREE.Vector3(1, 1, 1);
  for (const side of [-1, 1]) {
    const hand = new THREE.Vector3(side * 0.246, 2.535, 0.91),
      elbow = new THREE.Vector3(side * 0.295, 2.492, 0.563);
    const forearm = hand.clone().sub(elbow).normalize();
    const cuffRotation = new THREE.Quaternion().setFromUnitVectors(up, forearm);
    piece(
      new THREE.CylinderGeometry(0.05, 0.049, 0.038, 16, 1, true),
      hand.clone().addScaledVector(forearm, -0.036),
      unit,
      cuffRotation,
      1,
    );
    piece(
      new THREE.CylinderGeometry(0.048, 0.047, 0.018, 16, 1, true),
      hand.clone().addScaledVector(forearm, -0.005),
      unit,
      cuffRotation,
    );
    const knee = new THREE.Vector3(side * 0.607, 2.52, 0.635),
      foot = new THREE.Vector3(side * 0.689, 1.969, 0.34);
    const shin = foot.clone().sub(knee).normalize();
    const bootRotation = new THREE.Quaternion().setFromUnitVectors(up, shin);
    piece(
      new THREE.CylinderGeometry(0.093, 0.089, 0.028, 20, 1, true),
      knee.clone().lerp(foot, 0.18),
      unit,
      bootRotation,
    );
    piece(
      new THREE.BoxGeometry(0.151, 0.022, 0.275),
      new THREE.Vector3(side * 0.688, 1.855, 0.437),
      unit,
      new THREE.Quaternion(),
    );
    piece(
      new THREE.BoxGeometry(0.132, 0.042, 0.07),
      new THREE.Vector3(side * 0.688, 1.854, 0.322),
      unit,
      new THREE.Quaternion(),
    );
    const buckle = new THREE.TorusGeometry(0.021, 0.003, 5, 12);
    piece(
      buckle,
      new THREE.Vector3(side * 0.747, 2.3, 0.514),
      new THREE.Vector3(1, 1.35, 1),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        Math.PI / 2,
      ),
      2,
    );
  }
  // Stand collar with a thin contrasting sewn edge at the base of the neck.
  const collarRotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    Math.PI / 2 + 0.16,
  );
  piece(
    new THREE.TorusGeometry(0.083, 0.016, 6, 28),
    new THREE.Vector3(0, 2.866, 0.767),
    new THREE.Vector3(1, 1.07, 1),
    collarRotation,
    1,
  );
  batches.forEach((geometries, i) => {
    const geometry = mergeGeometries(geometries, false)!;
    geometries.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(geometry, materials[i]);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  });
  return group;
}

/** A curved English race saddle, cut leather flaps, piping and a real girth. */
export function racingSaddle(leather: THREE.Material, metal: THREE.Material) {
  const group = new THREE.Group();
  const seatGeometry = new THREE.PlaneGeometry(0.68, 1.04, 16, 20),
    p = seatGeometry.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      z = p.getY(i);
    p.setXYZ(
      i,
      x * (0.83 + 0.17 * Math.cos(z * 4)),
      2.555 + Math.pow(z / 0.52, 2) * 0.073 + Math.pow(x / 0.34, 2) * 0.022,
      z - 0.1,
    );
  }
  seatGeometry.computeVertexNormals();
  const seat = new THREE.Mesh(seatGeometry, leather);
  seat.castShadow = true;
  group.add(seat);
  function strap(points: number[][], radius: number, mat: THREE.Material) {
    const curve = new THREE.CatmullRomCurve3(
      points.map((p) => new THREE.Vector3(...(p as [number, number, number]))),
    );
    const mesh = new THREE.Mesh(
      new THREE.TubeGeometry(curve, 24, radius, 5, false),
      mat,
    );
    mesh.castShadow = true;
    group.add(mesh);
  }
  for (const side of [-1, 1]) {
    const flap = new THREE.Shape();
    flap.moveTo(-0.47, 2.5);
    flap.bezierCurveTo(-0.28, 2.58, 0.39, 2.52, 0.47, 2.36);
    flap.bezierCurveTo(0.41, 2.15, 0.08, 2.08, -0.27, 2.16);
    flap.bezierCurveTo(-0.44, 2.22, -0.47, 2.36, -0.47, 2.5);
    const geometry = new THREE.ShapeGeometry(flap, 18),
      a = geometry.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const z = a.getX(i),
        y = a.getY(i);
      a.setXYZ(i, side * (0.37 + (2.5 - y) * 0.78), y, z - 0.12);
    }
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, leather);
    mesh.castShadow = true;
    group.add(mesh);
    strap(
      [
        [side * 0.31, 2.61, -0.62],
        [side * 0.34, 2.56, -0.25],
        [side * 0.34, 2.57, 0.19],
        [side * 0.3, 2.63, 0.41],
      ],
      0.008,
      leather,
    );
  }
  // A wide flat leather girth follows the barrel below the saddlecloth.
  const points = [
    [-0.38, 2.47, 0.28],
    [-0.6, 2.13, 0.28],
    [-0.52, 1.73, 0.28],
    [-0.29, 1.57, 0.28],
    [0, 1.53, 0.28],
    [0.29, 1.57, 0.28],
    [0.52, 1.73, 0.28],
    [0.6, 2.13, 0.28],
    [0.38, 2.47, 0.28],
  ];
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...(p as [number, number, number]))),
  );
  const strip = new THREE.PlaneGeometry(0.15, 1, 1, 48),
    v = strip.attributes.position;
  for (let i = 0; i < v.count; i++) {
    const offset = v.getX(i),
      t = v.getY(i) + 0.5,
      point = curve.getPoint(t);
    v.setXYZ(i, point.x, point.y, point.z + offset);
  }
  strip.computeVertexNormals();
  const girth = new THREE.Mesh(strip, leather);
  girth.castShadow = true;
  group.add(girth);
  for (const side of [-1, 1]) {
    const buckle = new THREE.Mesh(
      new THREE.TorusGeometry(0.043, 0.006, 6, 16),
      metal,
    );
    buckle.position.set(side * 0.61, 2.05, 0.28);
    buckle.rotation.y = Math.PI / 2;
    buckle.scale.y = 1.3;
    group.add(buckle);
  }
  const merged = new THREE.Group();
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const object of group.children) {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    mesh.updateMatrix();
    const geometry = mesh.geometry.applyMatrix4(mesh.matrix);
    geometry.deleteAttribute("uv");
    const batch = batches.get(mesh.material) ?? [];
    batch.push(geometry);
    batches.set(mesh.material, batch);
  }
  for (const [material, geometries] of batches) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false)!, material);
    mesh.castShadow = mesh.receiveShadow = true;
    merged.add(mesh);
    geometries.forEach((g) => g.dispose());
  }
  return merged;
}
