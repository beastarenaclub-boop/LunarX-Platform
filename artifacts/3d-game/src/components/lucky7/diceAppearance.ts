import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/** Box face order: +X, -X, +Y, -Y, +Z, -Z; opposite values sum to seven. */
export const FACE_VALUES = [1, 6, 2, 5, 3, 4] as const;
export const FACE_ATLAS = { size: 256, padding: 8, columns: 3, rows: 2 } as const;
const pitch = FACE_ATLAS.size + FACE_ATLAS.padding * 2;
const width = pitch * FACE_ATLAS.columns;
const height = pitch * FACE_ATLAS.rows;
const PIPS: Record<number, [number, number][]> = {
  1: [[1,1]], 2: [[0,0],[2,2]], 3: [[0,0],[1,1],[2,2]],
  4: [[0,0],[2,0],[0,2],[2,2]], 5: [[0,0],[2,0],[1,1],[0,2],[2,2]],
  6: [[0,0],[2,0],[0,1],[2,1],[0,2],[2,2]],
};

/** Six face tiles in one texture let each rounded die render in one draw. */
export const dieGeometry = new RoundedBoxGeometry(1, 1, 1, 3, .09);
const uv = dieGeometry.getAttribute("uv");
for (const group of dieGeometry.groups) {
  const face = group.materialIndex!;
  const left = (face % FACE_ATLAS.columns) * pitch + FACE_ATLAS.padding;
  const bottom = height - (Math.floor(face / FACE_ATLAS.columns) * pitch + FACE_ATLAS.padding + FACE_ATLAS.size);
  for (let i = group.start; i < group.start + group.count; i++) {
    uv.setXY(i, (left + uv.getX(i) * FACE_ATLAS.size) / width,
      (bottom + uv.getY(i) * FACE_ATLAS.size) / height);
  }
}
dieGeometry.clearGroups();
uv.needsUpdate = true;

let material: THREE.MeshStandardMaterial | undefined;
export function dieMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  FACE_VALUES.forEach((value, face) => {
    const left = (face % FACE_ATLAS.columns) * pitch;
    const top = Math.floor(face / FACE_ATLAS.columns) * pitch;
    const gradient = ctx.createLinearGradient(left, top, left + pitch, top + pitch);
    gradient.addColorStop(0, "#ffffff"); gradient.addColorStop(1, "#e7e5e4");
    ctx.fillStyle = gradient; ctx.fillRect(left, top, pitch, pitch);
    const cell = FACE_ATLAS.size / 4, radius = FACE_ATLAS.size * .072;
    for (const [col, row] of PIPS[value]) {
      const x = left + FACE_ATLAS.padding + cell * (col + 1);
      const y = top + FACE_ATLAS.padding + cell * (row + 1);
      ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = value === 1 ? "#dc2626" : "#18181b"; ctx.fill();
      ctx.beginPath(); ctx.arc(x - radius * .28, y - radius * .28, radius * .42, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.16)"; ctx.fill();
    }
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  material = new THREE.MeshStandardMaterial({ map: texture, roughness: .32, metalness: .04 });
  return material;
}

let contactTexture: THREE.CanvasTexture | undefined;
export function contactShadowTexture(): THREE.CanvasTexture {
  if (contactTexture) return contactTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(64,64,12,64,64,64);
  gradient.addColorStop(0,"rgba(8,16,12,1)");
  gradient.addColorStop(.45,"rgba(8,16,12,.55)");
  gradient.addColorStop(1,"rgba(8,16,12,0)");
  ctx.fillStyle = gradient; ctx.fillRect(0,0,128,128);
  contactTexture = new THREE.CanvasTexture(canvas);
  contactTexture.colorSpace = THREE.SRGBColorSpace;
  return contactTexture;
}
