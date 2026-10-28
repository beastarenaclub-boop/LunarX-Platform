import * as T from "three";

/** A bowed, lacquered television plinth with continuous machined brass profiles. */
export function createStudioCounter(
  parent: T.Group,
  materials: { body: T.Material; brass: T.Material; deck: T.Material },
) {
  const root = new T.Group();
  root.name = "Curved emerald machine counter";
  parent.add(root);
  const owned: T.BufferGeometry[] = [];
  const keep = <U extends T.BufferGeometry>(geometry: U) => {
    owned.push(geometry);
    return geometry;
  };
  function outline(scale: number) {
    const p = new T.Shape();
    p.moveTo(-2.95 * scale, 1.23 * scale);
    p.lineTo(2.95 * scale, 1.23 * scale);
    p.quadraticCurveTo(3.3 * scale, 1.23 * scale, 3.3 * scale, 0.88 * scale);
    p.lineTo(3.3 * scale, -0.86 * scale);
    p.quadraticCurveTo(3.3 * scale, -1.2 * scale, 2.95 * scale, -1.28 * scale);
    p.quadraticCurveTo(0, -1.78 * scale, -2.95 * scale, -1.28 * scale);
    p.quadraticCurveTo(-3.3 * scale, -1.2 * scale, -3.3 * scale, -0.86 * scale);
    p.lineTo(-3.3 * scale, 0.88 * scale);
    p.quadraticCurveTo(-3.3 * scale, 1.23 * scale, -2.95 * scale, 1.23 * scale);
    p.closePath();
    return p;
  }
  function layer(
    scale: number,
    y: number,
    height: number,
    material: T.Material,
    bevel: number,
  ) {
    const geometry = keep(
      new T.ExtrudeGeometry(outline(scale), {
        depth: height,
        steps: 1,
        curveSegments: 36,
        bevelEnabled: bevel > 0,
        bevelSegments: 4,
        bevelSize: bevel,
        bevelThickness: bevel,
      }),
    );
    geometry.rotateX(-Math.PI / 2);
    const object = new T.Mesh(geometry, material);
    object.position.y = y;
    object.castShadow = object.receiveShadow = true;
    root.add(object);
    return object;
  }
  layer(0.965, -1.92, 2.23, materials.body, 0.06);
  layer(0.978, -1.94, 0.035, materials.brass, 0.012);
  layer(0.985, -1.79, 0.018, materials.brass, 0.008);
  layer(1, 0.3, 0.075, materials.brass, 0.025);
  layer(0.988, 0.39, 0.038, materials.deck, 0.012);
  // Front-to-back depth follows the curved surface, so the inlay is never a decal
  // suspended in front of a flat box. The sweep echoes the floor's brass arcs.
  const frontZ = (x: number) =>
    0.965 * (1.53 - 0.25 * (x / (2.95 * 0.965)) ** 2) + 0.062;
  for (const offset of [0, -0.027]) {
    const points = Array.from({ length: 65 }, (_, i) => {
      const u = i / 64;
      const x = -2.78 + u * 5.56;
      return new T.Vector3(
        x,
        -1.15 + 0.6 * Math.sin(u * Math.PI) + offset,
        frontZ(x),
      );
    });
    const curve = new T.CatmullRomCurve3(points);
    const inlay = new T.Mesh(
      keep(
        new T.TubeGeometry(curve, 80, offset === 0 ? 0.009 : 0.003, 8, false),
      ),
      materials.brass,
    );
    root.add(inlay);
  }
  return {
    dispose() {
      parent.remove(root);
      owned.forEach((resource) => resource.dispose());
    },
  };
}
