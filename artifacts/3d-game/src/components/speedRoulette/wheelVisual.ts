import * as THREE from "three";
import { EUROPEAN_WHEEL_ORDER, pocketColor } from "../roulette/wheelData";
import { WHEEL } from "./wheelMotion";
import { PHOTO } from "./photographicTable";

const TAU = Math.PI * 2, OUTER = 138, NUMBER_INNER = 115;

/** Radial mesh, with the pocket floor genuinely below its raised brass frets. */
function band(inner: number, outer: number, zInner: number, zOuter = zInner) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [], count = 444;
  for (let i = 0; i <= count; i++) {
    const a = i / count * TAU;
    for (const [r, z] of [[inner, zInner], [outer, zOuter]]) {
      const x = Math.sin(a) * r, y = -Math.cos(a) * r; positions.push(x, y, z); uv.push(.5 + x / (2 * OUTER), .5 - y / (2 * OUTER));
    }
    if (i < count) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(indices); g.computeVertexNormals(); return g;
}

function numberTexture() {
  const size = 2048, c = document.createElement("canvas"); c.width = c.height = size;
  const ctx = c.getContext("2d")!; ctx.translate(size / 2, size / 2); ctx.scale(size / (OUTER * 2), size / (OUTER * 2));
  const step = TAU / 37;
  EUROPEAN_WHEEL_ORDER.forEach((n, i) => {
    const a = WHEEL.zeroAngle + i * step;
    ctx.beginPath(); ctx.arc(0, 0, OUTER + 1, a - Math.PI / 2 - step / 2, a - Math.PI / 2 + step / 2); ctx.arc(0, 0, NUMBER_INNER - 1, a - Math.PI / 2 + step / 2, a - Math.PI / 2 - step / 2, true); ctx.closePath();
    ctx.fillStyle = n === 0 ? "#087c34" : pocketColor(n) === "red" ? "#c71a0d" : "#13110e"; ctx.fill();
    // Thin separators leave breathing room around the two-digit numerals.
    ctx.strokeStyle = "#efd9a7"; ctx.lineWidth = .28; ctx.stroke();
    ctx.save(); ctx.rotate(a); ctx.translate(0, -126.5); ctx.scale(.74, 1);
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = "17px 'Times New Roman', Georgia, serif";
    ctx.fillStyle = "#fff7d7"; ctx.fillText(String(n), 0, .5); ctx.restore();
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

export function createWheelRotor() {
  const rotor = new THREE.Group(), geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const geo = <T extends THREE.BufferGeometry>(g: T) => { geometries.push(g); return g; };
  const mat = <T extends THREE.Material>(m: T) => { materials.push(m); return m; };
  const gold = mat(new THREE.MeshStandardMaterial({ color: "#bd8b26", metalness: 1, roughness: .29, envMapIntensity: .65, side: THREE.DoubleSide }));
  const floorMaterial = mat(new THREE.MeshBasicMaterial({ color: "#c1a44e", toneMapped: false, side: THREE.DoubleSide }));
  const add = (g: THREE.BufferGeometry, m: THREE.Material) => { const mesh = new THREE.Mesh(geo(g), m); rotor.add(mesh); return mesh; };
  // A continuous opaque base masks the old photographed printed ring.
  add(band(81.5, 139, -4.5), mat(new THREE.MeshBasicMaterial({ color: "#9d7e35", side: THREE.DoubleSide })));
  add(band(84, NUMBER_INNER, WHEEL.pocketFloor), floorMaterial);
  add(band(82.5, 85, 2.5, WHEEL.pocketFloor), gold);
  add(band(113.5, 115.5, WHEEL.pocketFloor, 2.5), gold);
  add(band(81.8, 84.2, 2.5), gold);
  add(band(114.5, 116, 2.5), gold);
  const numbers = numberTexture(); textures.push(numbers);
  add(band(NUMBER_INNER, OUTER, 2.2, .7), mat(new THREE.MeshBasicMaterial({ map: numbers, toneMapped: false, side: THREE.DoubleSide })));
  add(band(137.5, 139, .8), gold);
  // Instanced radial walls are genuine geometry; they occlude a seated ball.
  const fretGeometry = geo(new THREE.BoxGeometry(.6, 29.5, 7));
  const frets = new THREE.InstancedMesh(fretGeometry, gold, 37), transform = new THREE.Object3D();
  const anchors: THREE.Object3D[] = [];
  EUROPEAN_WHEEL_ORDER.forEach((n, i) => {
    const a = WHEEL.zeroAngle + (i + .5) * TAU / 37;
    transform.position.set(Math.sin(a) * 99.5, -Math.cos(a) * 99.5, -.5); transform.rotation.z = a; transform.updateMatrix(); frets.setMatrixAt(i, transform.matrix);
    const center = WHEEL.zeroAngle + i * TAU / 37, anchor = new THREE.Object3D();
    anchor.name = `pocket-${n}`; anchor.position.set(Math.sin(center) * WHEEL.pocketRadius, -Math.cos(center) * WHEEL.pocketRadius, WHEEL.pocketFloor + WHEEL.ballRadius); rotor.add(anchor); anchors.push(anchor);
  });
  frets.instanceMatrix.needsUpdate = true; rotor.add(frets);
  return {
    rotor, anchors,
    setPhotographicFloor(image: HTMLImageElement) {
      // Preserve the reference's fine brass grain on the recessed surfaces.
      // The narrow area behind the spindle samples the opposite brass surface.
      const c = document.createElement("canvas"); c.width = c.height = 1024; const ctx = c.getContext("2d")!, scale = 1024 / (OUTER * 2);
      ctx.drawImage(image, PHOTO.wheelX - OUTER, PHOTO.wheelY - OUTER * PHOTO.wheelScaleY, OUTER * 2, OUTER * 2 * PHOTO.wheelScaleY, 0, 0, 1024, 1024);
      ctx.translate(512, 512); ctx.scale(scale, scale); ctx.beginPath(); ctx.arc(0, 0, 115, -Math.PI / 2 - .24, -Math.PI / 2 + .24); ctx.arc(0, 0, 81, -Math.PI / 2 + .24, -Math.PI / 2 - .24, true); ctx.closePath(); ctx.clip(); ctx.rotate(Math.PI);
      ctx.drawImage(image, PHOTO.wheelX - OUTER, PHOTO.wheelY - OUTER * PHOTO.wheelScaleY, OUTER * 2, OUTER * 2 * PHOTO.wheelScaleY, -OUTER, -OUTER, OUTER * 2, OUTER * 2);
      const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; textures.push(texture); floorMaterial.color.set("#f2dfad"); floorMaterial.map = texture; floorMaterial.needsUpdate = true;
    },
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); },
  };
}
