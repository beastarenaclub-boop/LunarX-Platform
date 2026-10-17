import { useMemo } from "react";
import * as THREE from "three";
import { rng } from "./dicePlan";

function outline(width: number, depth: number, radius: number) {
  const x = -width / 2, y = -depth / 2, r = radius;
  const path = new THREE.Shape();
  path.moveTo(x + r, y);
  path.lineTo(x + width - r, y);
  path.quadraticCurveTo(x + width, y, x + width, y + r);
  path.lineTo(x + width, y + depth - r);
  path.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  path.lineTo(x + r, y + depth);
  path.quadraticCurveTo(x, y + depth, x, y + depth - r);
  path.lineTo(x, y + r);
  path.quadraticCurveTo(x, y, x + r, y);
  return path;
}

function rim(width: number, depth: number, radius: number, thickness: number, height: number) {
  const shape = outline(width, depth, radius);
  shape.holes.push(new THREE.Path(outline(width - thickness * 2, depth - thickness * 2, Math.max(0.025, radius - thickness)).getPoints(48).reverse()));
  return new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelSegments: 3,
    steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 28,
  });
}

// Straight sides and small corner bevels give the table a rectangular tray
// silhouette. Keep the felt at the same height as the filmed hand release.
const surface = new THREE.ShapeGeometry(outline(10.04, 9.24, 0.10), 32);
const uv = surface.getAttribute("uv");
const positions = surface.getAttribute("position");
for (let i = 0; i < uv.count; i++) uv.setXY(i, positions.getX(i) / 10.04 + 0.5, positions.getY(i) / 9.24 + 0.5);
const base = new THREE.ExtrudeGeometry(outline(10.9, 10.1, 0.28), {
  depth: 0.34, steps: 1, bevelEnabled: true, bevelSegments: 2,
  bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 16,
});
const wood = rim(10.9, 10.1, 0.28, 0.24, 0.23);
const cushion = rim(10.42, 9.62, 0.12, 0.17, 0.17);
const trim = rim(10.07, 9.27, 0.07, 0.035, 0.025);
const outerTrim = rim(10.88, 10.08, 0.25, 0.023, 0.014);

function texture(canvas: HTMLCanvasElement) {
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;
  return map;
}

function textiles() {
  const random = rng(719283);
  const cloth = document.createElement("canvas");
  cloth.width = cloth.height = 1024;
  const ctx = cloth.getContext("2d")!;
  const pixels = ctx.createImageData(1024, 1024);
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const i = (y * 1024 + x) * 4;
    const fibre = (random() - 0.5) * 13 + ((x + y) % 3 === 0 ? 2 : 0);
    const pool = 1 - Math.min(1, Math.hypot((x - 512) / 780, (y - 540) / 850));
    pixels.data[i] = 10 + fibre * 0.3 + pool * 4;
    pixels.data[i + 1] = 61 + fibre + pool * 17;
    pixels.data[i + 2] = 46 + fibre * 0.7 + pool * 11;
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
  // Fine woven fibres and restrained markings, printed into the same cloth.
  ctx.strokeStyle = "rgba(200,220,193,.045)";
  ctx.lineWidth = 0.6;
  for (let y = 0; y < 1024; y += 3) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y + 0.5); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(224,195,125,.58)";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(38, 38, 948, 948, 12); ctx.stroke();
  ctx.strokeStyle = "rgba(224,195,125,.25)";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(48, 48, 928, 928, 8); ctx.stroke();
  // Fine corner brackets continue the box shape without obscuring the dice.
  ctx.strokeStyle = "rgba(224,195,125,.6)";
  ctx.lineWidth = 3;
  for (const [x, y, sx, sy] of [[66, 66, 1, 1], [958, 66, -1, 1], [66, 958, 1, -1], [958, 958, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(x, y + sy * 48); ctx.lineTo(x, y); ctx.lineTo(x + sx * 48, y); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(224,195,125,.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(512, 260); ctx.lineTo(557, 309); ctx.lineTo(512, 358); ctx.lineTo(467, 309); ctx.closePath(); ctx.stroke();
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(226,204,148,.65)";
  ctx.font = "42px Georgia";
  ctx.fillText("7", 512, 324);
  ctx.fillStyle = "rgba(226,204,148,.55)";
  ctx.font = "500 30px Georgia";
  ctx.fillText("L U C K Y  7", 512, 406);

  const grain = document.createElement("canvas");
  grain.width = grain.height = 128;
  const grainCtx = grain.getContext("2d")!;
  const image = grainCtx.createImageData(128, 128);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = 100 + Math.floor(random() * 65);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = n;
    image.data[i + 3] = 255;
  }
  grainCtx.putImageData(image, 0, 0);
  const bump = new THREE.CanvasTexture(grain);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping;
  bump.repeat.set(20, 20);
  return { cloth: texture(cloth), bump };
}

/** Rectangular felt-lined box with a solid walnut base and raised leather rail. */
export default function CasinoFelt() {
  const maps = useMemo(textiles, []);
  return (
    <group position={[0, 0, -3.15]} rotation-x={-Math.PI / 2}>
      <mesh geometry={base} position-z={-0.44} receiveShadow castShadow>
        <meshStandardMaterial color="#35251d" roughness={0.43} metalness={0.04} />
      </mesh>
      <mesh geometry={wood} position-z={-0.19} receiveShadow castShadow>
        <meshStandardMaterial color="#66412a" roughness={0.36} metalness={0.08} />
      </mesh>
      <mesh geometry={outerTrim} position-z={0.045} receiveShadow>
        <meshStandardMaterial color="#bfa367" roughness={0.34} metalness={0.7} />
      </mesh>
      <mesh geometry={cushion} position-z={-0.04} receiveShadow castShadow>
        <meshStandardMaterial color="#14251f" roughness={0.65} bumpMap={maps.bump} bumpScale={0.028} />
      </mesh>
      <mesh geometry={trim} position-z={0.008} receiveShadow>
        <meshStandardMaterial color="#c9aa65" roughness={0.3} metalness={0.7} />
      </mesh>
      <mesh geometry={surface} receiveShadow>
        <meshStandardMaterial map={maps.cloth} roughness={0.97} bumpMap={maps.bump} bumpScale={0.008} />
      </mesh>
    </group>
  );
}
