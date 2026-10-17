import * as THREE from "three";

/** Small details follow the animated surface, including the head's gallop motion. */
export function horseTack(mesh: THREE.Mesh, root: THREE.Group) {
  const position = mesh.geometry.attributes.position;
  const anchors: Array<{
    index: number;
    offset: THREE.Vector3;
    point: THREE.Vector3;
  }> = [];
  function anchor(x: number, y: number, z: number, out = 0) {
    let closest = 0,
      distance = Infinity;
    for (let i = 0; i < position.count; i++) {
      const d =
        (position.getX(i) * 0.018 - x) ** 2 +
        (position.getY(i) * 0.018 - y) ** 2 +
        (position.getZ(i) * 0.018 - z) ** 2;
      if (d < distance) {
        distance = d;
        closest = i;
      }
    }
    const a = {
      index: closest,
      offset: new THREE.Vector3(out, 0, 0),
      point: new THREE.Vector3(),
    };
    anchors.push(a);
    return a;
  }
  const leather = new THREE.MeshStandardMaterial({
    color: "#291a12",
    roughness: 0.58,
  });
  const dark = new THREE.MeshPhysicalMaterial({
    color: "#0d0b09",
    roughness: 0.12,
    clearcoat: 1,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: "#c3a777",
    metalness: 0.8,
    roughness: 0.3,
  });
  const sphere = new THREE.SphereGeometry(1, 12, 8),
    cylinder = new THREE.CylinderGeometry(0.017, 0.017, 1, 6);
  const details: Array<{
    object: THREE.Mesh;
    anchor: ReturnType<typeof anchor>;
  }> = [];
  const straps: Array<{
    object: THREE.Mesh;
    a: ReturnType<typeof anchor>;
    b: ReturnType<typeof anchor>;
  }> = [];
  function strap(a: ReturnType<typeof anchor>, b: ReturnType<typeof anchor>) {
    const object = new THREE.Mesh(cylinder, leather);
    root.add(object);
    straps.push({ object, a, b });
  }
  for (const side of [-1, 1]) {
    const eye = anchor(side * 0.2, 2.94, 1.91, side * 0.012);
    const eyeball = new THREE.Mesh(sphere, dark);
    eyeball.scale.set(0.028, 0.043, 0.055);
    root.add(eyeball);
    details.push({ object: eyeball, anchor: eye });
    const nose = anchor(side * 0.12, 2.23, 2.22, side * 0.008);
    const nostril = new THREE.Mesh(sphere, dark);
    nostril.scale.set(0.02, 0.045, 0.058);
    root.add(nostril);
    details.push({ object: nostril, anchor: nose });
    const poll = anchor(side * 0.16, 3.1, 1.72, side * 0.018);
    const cheek = anchor(side * 0.2, 2.83, 1.97, side * 0.018);
    const muzzle = anchor(side * 0.14, 2.34, 2.2, side * 0.018);
    strap(poll, cheek);
    strap(cheek, muzzle);
    const bridge = anchor(0, 2.41, 2.25);
    bridge.offset.z = 0.02;
    strap(muzzle, bridge);
    const buckle = new THREE.Mesh(
      new THREE.TorusGeometry(0.038, 0.009, 5, 12),
      metal,
    );
    buckle.rotation.y = Math.PI / 2;
    root.add(buckle);
    details.push({ object: buckle, anchor: cheek });
  }
  const muzzle = anchor(0, 2.24, 2.28);
  const up = new THREE.Vector3(0, 1, 0),
    direction = new THREE.Vector3();
  return () => {
    for (const a of anchors)
      mesh
        .getVertexPosition(a.index, a.point)
        .multiplyScalar(0.018)
        .add(a.offset);
    for (const d of details) d.object.position.copy(d.anchor.point);
    for (const s of straps) {
      s.object.position.copy(s.a.point).add(s.b.point).multiplyScalar(0.5);
      direction.copy(s.b.point).sub(s.a.point);
      s.object.scale.y = direction.length();
      s.object.quaternion.setFromUnitVectors(up, direction.normalize());
    }
    return muzzle.point.z;
  };
}
