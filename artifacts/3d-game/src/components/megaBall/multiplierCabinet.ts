import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { REEL_VALUES, multiplierReelPosition } from "./showTimeline";
import type { MachineFrame } from "./machineTimeline";

export function createMultiplierCabinet(scene: T.Scene) {
  const root = new T.Group();
  root.position.set(-5.65, 2.18, 0.1);
  scene.add(root);
  const owned: (T.Material | T.BufferGeometry | T.Texture)[] = [];
  const keep = <U extends T.Material | T.BufferGeometry | T.Texture>(r: U) => {
    owned.push(r);
    return r;
  };
  const brass = keep(
    new T.MeshStandardMaterial({
      color: "#cfb077",
      metalness: 0.85,
      roughness: 0.29,
    }),
  );
  const emerald = keep(
    new T.MeshStandardMaterial({
      color: "#082d25",
      metalness: 0.35,
      roughness: 0.35,
    }),
  );
  const trim = keep(
    new T.MeshBasicMaterial({ color: "#ffe4a4", toneMapped: false }),
  );
  const addBox = (
    w: number,
    h: number,
    d: number,
    material: T.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const m = new T.Mesh(
      keep(new RoundedBoxGeometry(w, h, d, 2, 0.035)),
      material,
    );
    m.position.set(x, y, z);
    root.add(m);
    return m;
  };
  addBox(1.82, 4.36, 0.42, brass, 0, 0, -0.16);
  addBox(1.64, 4.18, 0.25, emerald, 0, 0, 0.09);
  const black = keep(new T.MeshBasicMaterial({ color: "#031c20" }));
  addBox(1.38, 3.76, 0.1, black, 0, 0, 0.25);
  for (const x of [-0.83, 0.83]) addBox(0.027, 4.12, 0.025, trim, x, 0, 0.28);
  const strip = document.createElement("canvas");
  strip.width = 512;
  strip.height = REEL_VALUES.length * 256;
  const ctx = strip.getContext("2d")!;
  REEL_VALUES.forEach((n, i) => {
    const y = i * 256,
      fill = ctx.createLinearGradient(0, y, 512, y + 256);
    fill.addColorStop(
      0,
      n === 100 ? "#785221" : n === 20 ? "#422b5e" : "#034b50",
    );
    fill.addColorStop(0.5, "#133e3a");
    fill.addColorStop(1, "#021d21");
    ctx.fillStyle = fill;
    ctx.fillRect(0, y, 512, 256);
    ctx.strokeStyle = "#b5a56a";
    ctx.lineWidth = 9;
    ctx.strokeRect(12, y + 9, 488, 238);
    ctx.fillStyle = "#f0d688";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 158px Georgia";
    ctx.fillText(`${n}x`, 256, y + 137);
  });
  const texture = keep(new T.CanvasTexture(strip));
  texture.colorSpace = T.SRGBColorSpace;
  texture.wrapT = T.RepeatWrapping;
  texture.repeat.y = 5 / REEL_VALUES.length;
  const reel = new T.Mesh(
    keep(new T.PlaneGeometry(1.3, 3.6)),
    keep(new T.MeshBasicMaterial({ map: texture, toneMapped: false })),
  );
  reel.position.z = 0.316;
  root.add(reel);
  const selected = keep(
    new T.MeshBasicMaterial({
      color: "#ffe08a",
      transparent: true,
      opacity: 0.25,
      toneMapped: false,
    }),
  );
  const selection = addBox(1.36, 0.7, 0.01, selected, 0, 0, 0.33);
  for (const y of [-0.36, 0.36]) addBox(1.48, 0.035, 0.04, brass, 0, y, 0.37);
  const badge = document.createElement("canvas");
  badge.width = 512;
  badge.height = 1024;
  const b = badge.getContext("2d")!;
  const enamel = b.createLinearGradient(0, 0, 512, 0);
  enamel.addColorStop(0, "#032e22");
  enamel.addColorStop(0.32, "#12553b");
  enamel.addColorStop(0.55, "#0a3c29");
  enamel.addColorStop(1, "#03271e");
  b.fillStyle = enamel;
  b.fillRect(0, 0, 512, 1024);
  // Fine enamel flecks and layered brass profiles give the logo door depth.
  let seed = 9137;
  for (let i = 0; i < 22000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = seed % 512;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const y = seed % 1024;
    b.fillStyle = i % 4 === 0 ? "rgba(239,219,141,.2)" : "rgba(0,12,8,.2)";
    b.fillRect(x, y, 1.5, 1.5);
  }
  const metal = b.createLinearGradient(0, 0, 512, 1000);
  for (const [stop, color] of [
    [0, "#806134"],
    [0.19, "#fff1b7"],
    [0.43, "#b18a3e"],
    [0.59, "#f3dda0"],
    [0.82, "#80602f"],
    [1, "#dec282"],
  ] as const)
    metal.addColorStop(stop, color);
  b.strokeStyle = metal;
  b.lineWidth = 13;
  b.strokeRect(17, 17, 478, 990);
  b.lineWidth = 2;
  b.strokeRect(34, 34, 444, 956);
  b.fillStyle = "#032c22";
  b.beginPath();
  b.arc(256, 447, 208, 0, Math.PI * 2);
  b.fill();
  b.lineWidth = 10;
  b.stroke();
  b.lineWidth = 2;
  b.beginPath();
  b.arc(256, 447, 195, 0, Math.PI * 2);
  b.stroke();
  b.textAlign = "center";
  b.font = "900 100px Georgia";
  for (let depth = 7; depth >= 0; depth--) {
    b.fillStyle = depth ? "#705320" : metal;
    b.fillText("MEGA", 256 + depth * 0.4, 425 + depth);
    b.fillText("BALL", 256 + depth * 0.4, 535 + depth);
  }
  b.fillStyle = "#dfc682";
  b.font = "19px Arial";
  b.fillText("M U L T I P L I E R", 256, 776);
  const logo = keep(new T.CanvasTexture(badge));
  logo.colorSpace = T.SRGBColorSpace;
  const door = new T.Mesh(
    keep(new T.PlaneGeometry(1.43, 3.83)),
    keep(
      new T.MeshBasicMaterial({
        map: logo,
        toneMapped: false,
        clippingPlanes: [
          new T.Plane(new T.Vector3(-1, 0, 0), root.position.x + 0.715),
        ],
      }),
    ),
  );
  door.position.z = 0.41;
  root.add(door);
  return {
    update(frame: MachineFrame, multiplier: number | null, motion: boolean) {
      const row = multiplierReelPosition(frame.reelSpin, multiplier ?? 5);
      texture.offset.y = 1 - (row + 0.5 + 2.5) / REEL_VALUES.length;
      if (!motion && !frame.multiplierVisible)
        texture.offset.y = 1 - 3 / REEL_VALUES.length;
      door.visible = frame.reelOpen < 1;
      door.position.x = frame.reelOpen * 1.45;
      selected.opacity = frame.multiplierVisible ? 0.2 : 0.055;
      trim.color.set(frame.bonusLights ? "#9b98ff" : "#ffe4a4");
      selection.visible = frame.reelOpen > 0;
    },
    dispose() {
      owned.forEach((r) => r.dispose());
      scene.remove(root);
    },
  };
}
