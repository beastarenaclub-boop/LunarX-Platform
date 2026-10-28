import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Physical frames surround the studio plates; the machine aperture remains open. */
export function createStudioArchitecture(
  scene: T.Scene,
  onAsset: (state: "ready" | "unavailable") => void = () => {},
) {
  const root = new T.Group();
  root.name = "Mega Ball architectural framing";
  scene.add(root);
  const owned: (T.BufferGeometry | T.Material | T.Texture)[] = [];
  const keep = <U extends T.BufferGeometry | T.Material | T.Texture>(
    value: U,
  ) => {
    owned.push(value);
    return value;
  };
  let disposed = false;

  // Monochrome microfacets provide an immediate metal finish and shallow relief.
  const surface = document.createElement("canvas");
  surface.width = 256;
  surface.height = 512;
  const context = surface.getContext("2d")!;
  context.fillStyle = "#a9a9a9";
  context.fillRect(0, 0, surface.width, surface.height);
  let seed = 93881;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 14000; i++) {
    const x = random() * 256;
    const y = random() * 512;
    const size = 0.7 + random() * 3.2;
    const lightness = 75 + Math.floor(random() * 175);
    context.fillStyle = `rgb(${lightness},${lightness},${lightness})`;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + size, y + size * 0.12);
    context.lineTo(x + size * 0.45, y + size);
    context.closePath();
    context.fill();
  }
  const grain = keep(new T.CanvasTexture(surface));
  grain.wrapS = grain.wrapT = T.RepeatWrapping;
  grain.repeat.set(1, 3);
  const brass = keep(
    new T.MeshStandardMaterial({
      color: "#d2bc86",
      metalness: 0.94,
      roughness: 0.28,
    }),
  );
  const satin = keep(
    new T.MeshStandardMaterial({
      color: "#ad925e",
      metalness: 0.9,
      roughness: 0.4,
    }),
  );
  const emerald = keep(
    new T.MeshPhysicalMaterial({
      color: "#063b31",
      metalness: 0.28,
      roughness: 0.22,
      clearcoat: 0.8,
      clearcoatRoughness: 0.1,
    }),
  );
  const shadow = keep(
    new T.MeshStandardMaterial({
      color: "#151811",
      metalness: 0.35,
      roughness: 0.45,
    }),
  );
  const amberBack = keep(
    new T.MeshStandardMaterial({
      color: "#cd994d",
      metalness: 0.12,
      roughness: 0.62,
      emissive: "#a66d28",
      emissiveIntensity: 0.14,
    }),
  );
  const amber = new T.Color("#cd994d");
  const bonusAmber = new T.Color("#9177c1");
  const glitter = keep(
    new T.MeshStandardMaterial({
      color: "#d6bc7d",
      metalness: 0.86,
      roughness: 0.43,
      roughnessMap: grain,
      bumpMap: grain,
      bumpScale: 0.006,
      emissive: "#76551f",
      emissiveIntensity: 0.09,
    }),
  );
  const goldInlay = keep(
    new T.TextureLoader().load(
      "/media/mega-ball/studio-gold-inlay-v4.png",
      (texture) => {
        if (disposed) return;
        texture.colorSpace = T.SRGBColorSpace;
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        texture.repeat.set(1, 3);
        texture.anisotropy = 4;
        glitter.map = texture;
        glitter.emissiveMap = texture;
        glitter.color.set("#eee0b4");
        glitter.emissive.set("#ffffff");
        glitter.emissiveIntensity = 0.16;
        glitter.needsUpdate = true;
        onAsset("ready");
      },
      undefined,
      () => {
        /* The physical microfacet material remains usable if art is absent. */
        if (!disposed) onAsset("unavailable");
      },
    ),
  );
  // Explicitly own the pending texture as well as its eventual loaded contents.
  goldInlay.name = "Champagne gold inset artwork";
  const light = keep(
    new T.MeshStandardMaterial({
      color: "#fff1cc",
      emissive: "#ffdfa0",
      emissiveIntensity: 2.3,
      roughness: 0.3,
      metalness: 0,
    }),
  );
  const warm = new T.Color("#ffdfa0");
  const violet = new T.Color("#847dff");

  function roundPath(
    path: T.Path,
    width: number,
    height: number,
    radius: number,
  ) {
    const x = -width / 2,
      y = -height / 2;
    path.moveTo(x + radius, y);
    path.lineTo(x + width - radius, y);
    path.quadraticCurveTo(x + width, y, x + width, y + radius);
    path.lineTo(x + width, y + height - radius);
    path.quadraticCurveTo(
      x + width,
      y + height,
      x + width - radius,
      y + height,
    );
    path.lineTo(x + radius, y + height);
    path.quadraticCurveTo(x, y + height, x, y + height - radius);
    path.lineTo(x, y + radius);
    path.quadraticCurveTo(x, y, x + radius, y);
    path.closePath();
  }
  function portal(
    width: number,
    height: number,
    radius: number,
    border: number,
    depth: number,
    material: T.Material,
    position: [number, number, number],
  ) {
    const shape = new T.Shape();
    roundPath(shape, width, height, radius);
    const hole = new T.Path();
    roundPath(
      hole,
      width - border * 2,
      height - border * 2,
      Math.max(0.035, radius - border),
    );
    shape.holes.push(hole);
    const geometry = keep(
      new T.ExtrudeGeometry(shape, {
        depth,
        steps: 1,
        bevelEnabled: true,
        bevelSegments: 3,
        bevelSize: Math.min(0.025, border * 0.2),
        bevelThickness: Math.min(0.018, depth * 0.2),
        curveSegments: 16,
      }),
    );
    const mesh = new T.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  function box(
    width: number,
    height: number,
    depth: number,
    radius: number,
    material: T.Material,
    position: [number, number, number],
  ) {
    const mesh = new T.Mesh(
      keep(new RoundedBoxGeometry(width, height, depth, 3, radius)),
      material,
    );
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }

  // Nested extrusions make a recessed opening with a polished lip and dark seam.
  // They sit behind the live bowl and tracks, and join the existing counter top.
  const amberPanel = box(
    4.4,
    3.28,
    0.08,
    0.045,
    amberBack,
    [0.35, 2.96, -0.82],
  );
  // The broadcast niche is filled by a broad diffuse light, avoiding harsh
  // directional silhouettes from the small extraction fittings on its wall.
  amberPanel.receiveShadow = false;
  portal(5.34, 3.7, 0.3, 0.16, 0.36, satin, [0.35, 2.93, -0.75]);
  portal(5.19, 3.57, 0.25, 0.055, 0.08, brass, [0.35, 2.93, -0.34]);
  portal(5.04, 3.42, 0.22, 0.032, 0.035, light, [0.35, 2.93, -0.31]);
  portal(4.93, 3.31, 0.19, 0.065, 0.2, emerald, [0.35, 2.93, -0.56]);
  for (const x of [-1.96, 2.66]) {
    box(0.43, 2.98, 0.13, 0.045, shadow, [x, 2.94, -0.58]);
    box(0.345, 2.86, 0.05, 0.025, glitter, [x, 2.94, -0.49]);
    for (const edge of [-0.19, 0.19])
      box(0.026, 2.92, 0.035, 0.01, brass, [x + edge, 2.94, -0.445]);
    for (const y of [1.48, 4.4])
      box(0.405, 0.06, 0.14, 0.02, brass, [x, y, -0.43]);
  }
  // Open dark reveal gives the bright inset panels real depth at the machine edges.
  for (const x of [-1.72, 2.42])
    box(0.07, 3.14, 0.22, 0.018, satin, [x, 2.94, -0.63]);
  box(4.37, 0.09, 0.5, 0.035, emerald, [0.35, 4.4, -0.51]);
  box(4.2, 0.018, 0.035, 0.006, light, [0.35, 4.35, -0.23]);
  // Recessed ceiling reflectors are restrained details visible during camera moves.
  for (const x of [-0.95, 1.65]) {
    const lamp = new T.Mesh(
      keep(new T.CylinderGeometry(0.125, 0.145, 0.025, 24)),
      brass,
    );
    lamp.position.set(x, 4.34, -0.36);
    root.add(lamp);
    const diffuser = new T.Mesh(keep(new T.CircleGeometry(0.09, 24)), light);
    diffuser.rotation.x = Math.PI / 2;
    diffuser.position.set(x, 4.321, -0.36);
    root.add(diffuser);
  }

  // The presenter wall is integrated into a matching floor-to-ceiling surround.
  portal(2.7, 4.84, 0.2, 0.075, 0.16, satin, [-3.68, 2.31, -0.94]);
  portal(2.57, 4.71, 0.15, 0.025, 0.03, light, [-3.68, 2.31, -0.755]);

  // Flat, flush brass floor inlays continue the set's sweep into the foreground.
  const floorGold = keep(
    new T.MeshStandardMaterial({
      color: "#ccb77c",
      metalness: 0.88,
      roughness: 0.3,
      transparent: true,
      opacity: 0.65,
      depthWrite: false,
    }),
  );
  for (const [radius, thickness] of [
    [4.9, 0.028],
    [5.15, 0.014],
  ] as const) {
    const arc = new T.Mesh(
      keep(
        new T.RingGeometry(
          radius,
          radius + thickness,
          120,
          1,
          Math.PI + 0.13,
          Math.PI - 0.26,
        ),
      ),
      floorGold,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(-1.65, -0.043, -2.25);
    arc.castShadow = arc.receiveShadow = false;
    root.add(arc);
  }

  let currentBonus = 0;
  return {
    update(bonusLights: boolean, dt = 1 / 60) {
      currentBonus = T.MathUtils.damp(currentBonus, bonusLights ? 1 : 0, 5, dt);
      light.emissive.copy(warm).lerp(violet, currentBonus);
      light.color.setRGB(
        1 - currentBonus * 0.28,
        0.93 - currentBonus * 0.2,
        0.76 + currentBonus * 0.24,
      );
      glitter.emissive.set(bonusLights ? "#8c89c4" : "#fff0ce");
      amberBack.color.copy(amber).lerp(bonusAmber, currentBonus);
      amberBack.emissive.set(bonusLights ? "#48326b" : "#a66d28");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      owned.forEach((resource) => resource.dispose());
    },
  };
}
