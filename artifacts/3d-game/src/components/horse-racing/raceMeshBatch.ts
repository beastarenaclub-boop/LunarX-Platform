import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Combine rigid equipment with identical materials without changing its shape.
 * Call only on a rigid subtree (jockey/bridle), never the animated horse rig.
 */
export function batchRigidMeshes(root: THREE.Object3D) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const batches = new Map<string, THREE.Mesh[]>();
  root.traverse((object) => {
    if (
      !(object instanceof THREE.Mesh) ||
      object instanceof THREE.SkinnedMesh ||
      Array.isArray(object.material)
    )
      return;
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    const batch = batches.get(key) ?? [];
    batch.push(object);
    batches.set(key, batch);
  });
  const transform = new THREE.Matrix4();
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const geometries = meshes.map((mesh) => {
      const g = mesh.geometry.index
        ? mesh.geometry.toNonIndexed()
        : mesh.geometry.clone();
      g.applyMatrix4(transform.multiplyMatrices(inverse, mesh.matrixWorld));
      return g;
    });
    // Imported garments and procedural accessories may carry different UV/rest
    // attributes. Preserve those used by their shared material when batching.
    const attributes = new Map<string, number>();
    for (const g of geometries)
      for (const [name, attr] of Object.entries(g.attributes))
        attributes.set(name, attr.itemSize);
    for (const g of geometries)
      for (const [name, size] of attributes) {
        if (!g.hasAttribute(name))
          g.setAttribute(
            name,
            new THREE.Float32BufferAttribute(
              new Float32Array(g.attributes.position.count * size),
              size,
            ),
          );
      }
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry) continue;
    const mesh = new THREE.Mesh(geometry, meshes[0].material);
    mesh.name = "batched-racing-equipment";
    mesh.castShadow = meshes[0].castShadow;
    mesh.receiveShadow = meshes[0].receiveShadow;
    mesh.frustumCulled = false;
    for (const source of meshes) source.removeFromParent();
    root.add(mesh);
  }
}
