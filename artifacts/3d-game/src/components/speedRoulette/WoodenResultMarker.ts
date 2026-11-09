import * as THREE from "three";

/** Turned wooden winning peg, matching the reference's rounded cap and halo. */
export function createWoodenResultMarker() {
  const group = new THREE.Group(), peg = new THREE.Group(); group.visible = false; group.add(peg);
  peg.rotation.x = Math.acos(.68);
  const geometries: THREE.BufferGeometry[] = [], materials: THREE.Material[] = [], textures: THREE.Texture[] = [];
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let shownAt = 0, shownNumber: number | null = null;
  const ownMaterial = <T extends THREE.Material>(m: T) => { materials.push(m); return m; };
  const woodCanvas = document.createElement("canvas"); woodCanvas.width = 256; woodCanvas.height = 512;
  const ctx = woodCanvas.getContext("2d")!, pixels = ctx.createImageData(256, 512);
  for (let y = 0; y < 512; y++) for (let x = 0; x < 256; x++) {
    const grain = Math.sin(x * .23 + Math.sin(y * .019) * 2) * .09 + Math.sin(x * .71 + y * .024) * .025 + Math.sin(x * 13 + y * 73) * .012;
    const i = (y * 256 + x) * 4; pixels.data[i] = 145 * (1 + grain); pixels.data[i + 1] = 96 * (1 + grain); pixels.data[i + 2] = 43 * (1 + grain); pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  const woodTexture = new THREE.CanvasTexture(woodCanvas); woodTexture.colorSpace = THREE.SRGBColorSpace; textures.push(woodTexture);
  const wood = ownMaterial(new THREE.MeshStandardMaterial({ map: woodTexture, color: "#be9a64", roughness: .68, metalness: 0, envMapIntensity: .12 }));
  const brass = ownMaterial(new THREE.MeshStandardMaterial({ color: "#9c731f", metalness: 1, roughness: .45, envMapIntensity: .25 }));
  const turn = (profile: [number, number][], material: THREE.Material) => {
    const geometry = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 64); geometry.rotateX(Math.PI / 2); geometries.push(geometry);
    peg.add(new THREE.Mesh(geometry, material));
  };
  turn([[0, 0], [9, 0], [10, 2], [10, 6], [9.5, 27], [10, 32], [10, 35], [8.6, 37], [9, 39], [10, 42], [10.6, 45], [10, 49], [8.8, 52], [6, 54], [0, 55]], wood);
  turn([[9.5, 31], [10.3, 32], [10.3, 34], [9.7, 35]], brass);
  turn([[9.3, 1], [10.1, 2], [10.1, 3], [9.7, 4]], brass);
  const sprite = (size: number, paint: (context: CanvasRenderingContext2D) => void) => {
    const c = document.createElement("canvas"); c.width = c.height = 256; const context = c.getContext("2d")!; paint(context);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; textures.push(map);
    const material = ownMaterial(new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }));
    const geometry = new THREE.PlaneGeometry(size, size); geometries.push(geometry); const uv = geometry.getAttribute("uv"); for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    const mesh = new THREE.Mesh(geometry, material); group.add(mesh); return mesh;
  };
  const halo = sprite(100, c => {
    const glow = c.createRadialGradient(128, 128, 40, 128, 128, 124); glow.addColorStop(0, "#ffdf4500"); glow.addColorStop(.22, "#ffdc4530"); glow.addColorStop(.35, "#fff385f5"); glow.addColorStop(.45, "#ffdc4530"); glow.addColorStop(.72, "#fff36b80"); glow.addColorStop(.85, "#ffe25118"); glow.addColorStop(1, "#ffe25100"); c.fillStyle = glow; c.fillRect(0, 0, 256, 256);
  }); halo.scale.y = .83; halo.position.z = -14;
  const shadow = sprite(48, c => { const g = c.createRadialGradient(128, 128, 20, 128, 128, 125); g.addColorStop(0, "#100700ad"); g.addColorStop(.45, "#10070070"); g.addColorStop(1, "#10070000"); c.fillStyle = g; c.fillRect(0, 0, 256, 256); }); shadow.scale.y = .47; shadow.position.set(4, 5, -8);
  return {
    group,
    setResult(number: number | null, point?: [number, number]) {
      if (number !== shownNumber) { shownNumber = number; shownAt = performance.now(); }
      group.visible = number !== null;
      if (point) group.position.set(point[0], point[1], 80);
    },
    update(now: number) {
      if (!group.visible) return;
      const t = Math.min(1, (now - shownAt) / 280); peg.position.y = reducedMotion ? 0 : -10 * (1 - t) ** 2;
      halo.material.opacity = reducedMotion ? .9 : .88 + Math.sin((now - shownAt) / 580) * .1;
    },
    dispose() { geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose()); },
  };
}
