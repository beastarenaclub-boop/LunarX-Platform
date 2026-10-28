import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { REEL_VALUES, multiplierReelPosition } from "./showTimeline";
import { brushedMetalTexture } from "./studioMaterials";
import {
  multiplierDoorArtwork,
  multiplierGlassArtwork,
  multiplierLogoArtwork,
  multiplierTileArtwork,
} from "./multiplierArtwork";
import type { MachineFrame } from "./machineTimeline";

function roundedPath(
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
  path.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  path.lineTo(x + radius, y + height);
  path.quadraticCurveTo(x, y + height, x, y + height - radius);
  path.lineTo(x, y + radius);
  path.quadraticCurveTo(x, y, x + radius, y);
}

/** A physical belt of reusable enamel tiles. Outcomes still come only from the server. */
export function createMultiplierCabinet(scene: T.Scene) {
  const root = new T.Group();
  root.position.set(-5.65, 2.18, 0.1);
  scene.add(root);
  const owned = new Set<T.Material | T.BufferGeometry | T.Texture>();
  const keep = <U extends T.Material | T.BufferGeometry | T.Texture>(
    r: U,
  ): U => {
    owned.add(r);
    return r;
  };
  const machining = keep(brushedMetalTexture());
  const brass = keep(
    new T.MeshStandardMaterial({
      color: "#c6a567",
      metalness: 0.92,
      roughness: 0.25,
      roughnessMap: machining,
      bumpMap: machining,
      bumpScale: 0.0005,
    }),
  );
  const shadowBrass = keep(
    new T.MeshStandardMaterial({
      color: "#665027",
      metalness: 0.85,
      roughness: 0.35,
    }),
  );
  const polished = keep(
    new T.MeshStandardMaterial({
      color: "#edcf94",
      metalness: 0.95,
      roughness: 0.16,
    }),
  );
  const emerald = keep(
    new T.MeshPhysicalMaterial({
      color: "#092f24",
      metalness: 0.32,
      roughness: 0.24,
      clearcoat: 0.65,
      clearcoatRoughness: 0.16,
    }),
  );
  const black = keep(
    new T.MeshStandardMaterial({
      color: "#020d0a",
      metalness: 0.1,
      roughness: 0.64,
    }),
  );
  const led = keep(
    new T.MeshBasicMaterial({ color: "#ffe5ae", toneMapped: false }),
  );
  const add = (
    geometry: T.BufferGeometry,
    material: T.Material,
    x = 0,
    y = 0,
    z = 0,
    parent: T.Object3D = root,
  ) => {
    const object = new T.Mesh(keep(geometry), material);
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  };
  const box = (
    w: number,
    h: number,
    d: number,
    material: T.Material,
    x: number,
    y: number,
    z: number,
    parent: T.Object3D = root,
  ) =>
    add(
      new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d, 0.12) * 0.25),
      material,
      x,
      y,
      z,
      parent,
    );
  const surround = (
    w: number,
    h: number,
    border: number,
    radius: number,
    depth: number,
    material: T.Material,
    z: number,
    parent: T.Object3D = root,
  ) => {
    const shape = new T.Shape();
    roundedPath(shape, w, h, radius);
    const hole = new T.Path();
    roundedPath(
      hole,
      w - border * 2,
      h - border * 2,
      Math.max(0.025, radius - border),
    );
    shape.holes.push(hole);
    return add(
      new T.ExtrudeGeometry(shape, {
        depth,
        bevelEnabled: true,
        bevelSize: Math.min(border * 0.2, 0.018),
        bevelThickness: 0.018,
        bevelSegments: 3,
        curveSegments: 12,
        steps: 1,
      }),
      material,
      0,
      0,
      z,
      parent,
    );
  };
  box(1.94, 4.42, 0.58, shadowBrass, 0, 0, -0.51);
  box(1.83, 4.32, 0.45, emerald, 0, 0, -0.47);
  surround(1.94, 4.43, 0.09, 0.24, 0.1, brass, 0.22);
  surround(1.76, 4.25, 0.028, 0.19, 0.025, led, 0.34);
  surround(1.66, 4.14, 0.075, 0.19, 0.1, polished, 0.37);
  surround(1.48, 3.94, 0.042, 0.15, 0.08, shadowBrass, 0.4);
  box(1.43, 3.89, 0.12, black, 0, 0, -0.27);
  box(1.94, 0.075, 0.7, polished, 0, -2.18, -0.03);
  const screwGeometry = keep(new T.CylinderGeometry(0.014, 0.014, 0.009, 12));
  for (const x of [-0.924, 0.924]) {
    for (const y of [-1.92, -0.65, 0.65, 1.92]) {
      const screw = new T.Mesh(screwGeometry, polished);
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, y, 0.347);
      root.add(screw);
    }
  }

  const aperturePlanes = [
    new T.Plane(new T.Vector3(0, -1, 0), root.position.y + 1.86),
    new T.Plane(new T.Vector3(0, 1, 0), -root.position.y + 1.86),
  ];
  const tileBrass = keep(brass.clone());
  tileBrass.clippingPlanes = aperturePlanes;
  const materials = new Map<number, T.MeshPhysicalMaterial>();
  for (const value of new Set(REEL_VALUES)) {
    const map = keep(multiplierTileArtwork(value));
    materials.set(
      value,
      keep(
        new T.MeshPhysicalMaterial({
          map,
          roughness: 0.3,
          metalness: 0.28,
          clearcoat: 0.65,
          clearcoatRoughness: 0.19,
          emissiveMap: map,
          emissive: "#ffffff",
          emissiveIntensity: 0.15,
          clippingPlanes: aperturePlanes,
        }),
      ),
    );
  }
  const faceGeometry = keep(new T.PlaneGeometry(1.278, 0.594, 20, 3));
  const positions = faceGeometry.getAttribute("position");
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    positions.setZ(i, 0.022 * (1 - (x / 0.639) ** 2));
  }
  faceGeometry.computeVertexNormals();
  const tileGeometry = keep(
    new RoundedBoxGeometry(1.33, 0.636, 0.11, 2, 0.018),
  );
  const tiles = Array.from({ length: 9 }, () => {
    const group = new T.Group();
    const body = new T.Mesh(tileGeometry, tileBrass);
    group.add(body);
    const face = new T.Mesh(faceGeometry, materials.values().next().value!);
    face.position.z = 0.057;
    group.add(face);
    root.add(group);
    return { group, face, value: -1 };
  });

  const glass = keep(
    new T.MeshPhysicalMaterial({
      color: "#cfe9dd",
      transparent: true,
      opacity: 0.055,
      roughness: 0.05,
      metalness: 0,
      clearcoat: 1,
      depthWrite: false,
    }),
  );
  add(new T.PlaneGeometry(1.39, 3.75), glass, 0, 0, 0.52);
  const glassArtwork = keep(multiplierGlassArtwork());
  add(
    new T.PlaneGeometry(1.39, 3.75),
    keep(
      new T.MeshBasicMaterial({
        map: glassArtwork,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    ),
    0,
    0,
    0.535,
  );
  const pointer = keep(
    new T.MeshStandardMaterial({
      color: "#f5d998",
      metalness: 0.6,
      roughness: 0.2,
      emissive: "#b47e24",
      emissiveIntensity: 0.2,
    }),
  );
  const selector = new T.Group();
  root.add(selector);
  for (const y of [-0.328, 0.328])
    box(1.43, 0.018, 0.035, polished, 0, y, 0.56, selector);
  for (const side of [-1, 1]) {
    const arrow = new T.Shape();
    arrow.moveTo(side * 0.02, 0);
    arrow.lineTo(side * 0.15, 0.07);
    arrow.lineTo(side * 0.15, -0.07);
    arrow.closePath();
    add(
      new T.ExtrudeGeometry(arrow, {
        depth: 0.018,
        bevelEnabled: true,
        bevelSize: 0.005,
        bevelThickness: 0.005,
        bevelSegments: 2,
      }),
      pointer,
      side * 0.66,
      0,
      0.57,
      selector,
    );
  }

  const doorClip = [
    new T.Plane(new T.Vector3(-1, 0, 0), root.position.x + 0.715),
    new T.Plane(new T.Vector3(1, 0, 0), -root.position.x + 0.715),
  ];
  const doorMetal = keep(brass.clone());
  doorMetal.clippingPlanes = doorClip;
  const doorTexture = keep(multiplierDoorArtwork());
  const doors = [-1, 1].map((side) => {
    const group = new T.Group();
    group.position.set(side * 0.3575, 0, 0.63);
    root.add(group);
    box(0.715, 3.83, 0.07, doorMetal, 0, 0, 0, group);
    const map = keep(doorTexture.clone());
    map.repeat.x = 0.5;
    map.offset.x = side < 0 ? 0 : 0.5;
    const material = keep(
      new T.MeshPhysicalMaterial({
        map,
        metalness: 0.25,
        roughness: 0.38,
        clearcoat: 0.45,
        clearcoatRoughness: 0.2,
        emissiveMap: map,
        emissive: "#ffffff",
        emissiveIntensity: 0.08,
        clippingPlanes: doorClip,
      }),
    );
    add(new T.PlaneGeometry(0.707, 3.805), material, 0, 0, 0.04, group);
    return group;
  });
  const logo = keep(multiplierLogoArtwork());
  const logoMaterial = keep(
    new T.MeshPhysicalMaterial({
      map: logo,
      transparent: true,
      alphaTest: 0.1,
      metalness: 0.28,
      roughness: 0.3,
      clearcoat: 0.5,
      emissiveMap: logo,
      emissive: "#ffffff",
      emissiveIntensity: 0.12,
      clippingPlanes: doorClip,
    }),
  );
  add(
    new T.PlaneGeometry(1.19, 1.19),
    logoMaterial,
    -0.3575,
    0.4,
    0.065,
    doors[1],
  );

  return {
    update(frame: MachineFrame, multiplier: number | null, motion: boolean) {
      const row =
        !motion && !frame.multiplierVisible
          ? 0
          : multiplierReelPosition(frame.reelSpin, multiplier ?? 5);
      const first = Math.floor(row) - 4;
      tiles.forEach((tile, i) => {
        const index = first + i;
        const value =
          REEL_VALUES[
            ((index % REEL_VALUES.length) + REEL_VALUES.length) %
              REEL_VALUES.length
          ];
        if (tile.value !== value) {
          tile.face.material = materials.get(value)!;
          tile.value = value;
        }
        const distance = (row - index) * 0.658;
        const angle = distance / 3.8;
        tile.group.position.set(
          0,
          3.8 * Math.sin(angle),
          0.34 - 3.8 * (1 - Math.cos(angle)),
        );
        tile.group.rotation.x = -angle;
        tile.group.visible = Math.abs(distance) < 2.7;
      });
      doors.forEach((door, i) => {
        const side = i === 0 ? -1 : 1;
        door.visible = frame.reelOpen < 1;
        door.position.x = side * (0.3575 + frame.reelOpen * 1.37);
      });
      selector.visible = frame.reelOpen > 0;
      pointer.emissiveIntensity = frame.multiplierVisible ? 0.65 : 0.12;
      led.color.set(frame.bonusLights ? "#b3b7ff" : "#ffe5ae");
      root.userData.reelPosition = row;
      root.userData.selectedMultiplier = frame.multiplierVisible
        ? multiplier
        : null;
      // Report the value physically aligned with the arrows, not a copy of the
      // desired outcome. Browser checks can catch a belt/label alignment error.
      const center = Math.round(row);
      return {
        centerValue:
          REEL_VALUES[
            ((center % REEL_VALUES.length) + REEL_VALUES.length) %
              REEL_VALUES.length
          ],
        centerOffset: row - center,
      };
    },
    dispose() {
      owned.forEach((resource) => resource.dispose());
      scene.remove(root);
    },
  };
}
