import * as THREE from "three";
import { betKey, type PlacedBet } from "../roulette/wheelData";
import { coveredNumbers, spotCenter, TABLE_REGIONS, type Spot } from "./layout";
import { PHOTO_TRACK, PHOTO_ZERO, photoBoardPoint, photoPolygon, photoTrackPoint } from "./photographicTable";

type Point = [number, number];
type Cell = {
  number: number; fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  selected: boolean; preview: boolean; winner: boolean; pulseAt: number;
};
type Chip = {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  shadow: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  amount: number; point: Point; placedAt: number; removedAt: number | null;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const gold = "#ffdf87";
const material = (options: THREE.MeshBasicMaterialParameters) => new THREE.MeshBasicMaterial({
  side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false, ...options,
});

function chipTexture(amount: number) {
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#826627"; ctx.beginPath(); ctx.ellipse(64, 78, 50, 33, 0, 0, Math.PI * 2); ctx.fill();
  const gradient = ctx.createLinearGradient(28, 35, 90, 95);
  gradient.addColorStop(0, "#fff5c8"); gradient.addColorStop(.35, "#d7b45d"); gradient.addColorStop(1, "#a68034");
  ctx.fillStyle = gradient; ctx.beginPath(); ctx.ellipse(64, 68, 50, 33, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#fff9df"; ctx.lineWidth = 7; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = "#fff2c299"; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(64, 68, 36, 23, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#3d280b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = "bold 25px Arial"; ctx.fillText(amount >= 1000 ? `${amount / 1000}k` : String(amount), 64, 68);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

/** Persistent table marks keep hover fades and chip landings intact across renders. */
export function createTableSelections() {
  const group = new THREE.Group(); group.position.z = 35;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const cells: Cell[] = [], chips = new Map<string, Chip>();
  const plane = new THREE.PlaneGeometry(45, 45), shadowGeometry = new THREE.CircleGeometry(19, 32), ringGeometry = new THREE.RingGeometry(22, 23.5, 48);
  const uv = plane.getAttribute("uv"); for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  const edgeGeometry = (points: Point[], inset: number) => {
    const center = points.reduce((p, v) => [p[0] + v[0] / points.length, p[1] + v[1] / points.length] as Point, [0, 0] as Point);
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    shape.holes.push(new THREE.Path([...points].reverse().map(([x, y]) => new THREE.Vector2(center[0] + (x - center[0]) * inset, center[1] + (y - center[1]) * inset))));
    return new THREE.ShapeGeometry(shape);
  };
  const addCell = (number: number, points: Point[], track: boolean) => {
    const fill = new THREE.Mesh(photoPolygon(points), material({ color: gold, opacity: 0 }));
    const edge = new THREE.Mesh(edgeGeometry(points, track ? .88 : .956), material({ color: "#fff0b2", opacity: 0 }));
    edge.position.z = .6; group.add(fill, edge);
    cells.push({ number, fill, edge, selected: false, preview: false, winner: false, pulseAt: -Infinity });
  };
  for (const region of TABLE_REGIONS.filter(r => r.spot.type === "straight")) {
    const number = region.spot.numbers![0];
    const points = number === 0 ? PHOTO_ZERO : [[region.x + 2, region.y + 2], [region.x + region.w - 2, region.y + 2], [region.x + region.w - 2, region.y + region.h - 2], [region.x + 2, region.y + region.h - 2]].map(([x, y]) => photoBoardPoint(x, y));
    addCell(number, points, false);
  }
  for (const cell of PHOTO_TRACK) addCell(cell.n, [[cell.x - 21, cell.y - 17], [cell.x + 21, cell.y - 17], [cell.x + 21, cell.y + 17], [cell.x - 21, cell.y + 17]].map(([x, y]) => photoTrackPoint(x, y)), true);

  const edgeHint = new THREE.Mesh(new THREE.CircleGeometry(15, 32), material({ color: gold, opacity: 0 }));
  edgeHint.scale.y = .6; group.add(edgeHint);
  let edgeHintTarget = 0, lastFrame = performance.now(), initialized = false, currentRound: string | null = null;
  let previous = new Map<string, number>();
  const disposeChip = (chip: Chip) => {
    group.remove(chip.mesh, chip.shadow, chip.ring);
    chip.mesh.material.map?.dispose(); chip.mesh.material.dispose(); chip.shadow.material.dispose(); chip.ring.material.dispose();
  };
  function sync(bets: PlacedBet[], previewSpots: Spot[], result: number | null, roundId: string | null, disabled: boolean) {
    const now = performance.now(), selected = new Set(coveredNumbers(bets)), preview = new Set(coveredNumbers(previewSpots));
    const roundChanged = currentRound !== roundId; currentRound = roundId;
    if (roundChanged) {
      chips.forEach(disposeChip); chips.clear(); previous.clear();
      for (const cell of cells) { cell.pulseAt = -Infinity; cell.fill.material.opacity = cell.edge.material.opacity = 0; }
    }
    const increased = initialized && !roundChanged && !disabled ? bets.filter(bet => bet.amount > (previous.get(betKey(bet)) ?? 0)) : [];
    const changedNumbers = coveredNumbers(increased);
    const delay = (i: number, count: number) => count > 1 ? i * Math.min(38, 170 / (count - 1)) : 0;
    for (const cell of cells) {
      cell.selected = selected.has(cell.number); cell.preview = preview.has(cell.number); cell.winner = result === cell.number;
      const index = changedNumbers.indexOf(cell.number);
      if (index >= 0 && !preference.matches) cell.pulseAt = now + delay(index, changedNumbers.length);
      if (!cell.selected) cell.pulseAt = -Infinity;
    }
    const hint = previewSpots.length === 1 && previewSpots[0].type !== "straight" ? previewSpots[0] : null;
    edgeHintTarget = hint ? .3 : 0;
    if (hint) { const [x, y] = photoBoardPoint(...spotCenter(hint)); edgeHint.position.set(x, y, .8); }
    const present = new Set(bets.map(betKey));
    for (const [key, chip] of chips) if (!present.has(key) && chip.removedAt === null) chip.removedAt = now;
    for (const bet of bets) {
      const key = betKey(bet), index = increased.indexOf(bet);
      let chip = chips.get(key);
      if (!chip) {
        chip = {
          mesh: new THREE.Mesh(plane, material({ map: chipTexture(bet.amount) })),
          shadow: new THREE.Mesh(shadowGeometry, material({ color: "#160e04", opacity: .25 })),
          ring: new THREE.Mesh(ringGeometry, material({ color: gold, opacity: 0 })),
          point: photoBoardPoint(...spotCenter(bet)), amount: bet.amount, placedAt: -Infinity, removedAt: null,
        };
        chips.set(key, chip); group.add(chip.shadow, chip.ring, chip.mesh);
      } else if (chip.amount !== bet.amount) {
        chip.mesh.material.map?.dispose(); chip.mesh.material.map = chipTexture(bet.amount); chip.amount = bet.amount;
      }
      chip.removedAt = null;
      if (index >= 0 && !preference.matches) chip.placedAt = now + delay(index, increased.length);
    }
    previous = new Map(bets.map(bet => [betKey(bet), bet.amount])); initialized = true;
  }
  function update(now: number) {
    const reduced = preference.matches, dt = Math.min(64, Math.max(0, now - lastFrame)); lastFrame = now;
    const fade = reduced ? 1 : 1 - Math.exp(-dt / 65);
    let active = 0;
    for (const cell of cells) {
      const t = (now - cell.pulseAt) / 620, pulse = !reduced && t >= 0 && t < 1 ? Math.sin(Math.PI * t) ** 2 : 0;
      const fill = (cell.winner ? .38 : cell.preview ? .24 : cell.selected ? .13 : 0) + pulse * .3;
      const edge = cell.preview || cell.selected ? .78 + pulse * .22 : 0;
      cell.fill.material.opacity += (fill - cell.fill.material.opacity) * fade;
      cell.edge.material.opacity += (edge - cell.edge.material.opacity) * fade;
      cell.fill.visible = cell.fill.material.opacity > .002; cell.edge.visible = cell.edge.material.opacity > .002;
    }
    edgeHint.material.opacity += (edgeHintTarget - edgeHint.material.opacity) * fade;
    edgeHint.visible = edgeHint.material.opacity > .002;
    for (const [key, chip] of chips) {
      const elapsed = now - chip.placedAt, landing = reduced ? 1 : clamp(elapsed / 460);
      const removed = chip.removedAt === null ? 0 : reduced ? 1 : clamp((now - chip.removedAt) / 150);
      if (removed >= 1) { disposeChip(chip); chips.delete(key); continue; }
      // A short weighted fall, a single small rebound, then a grounded chip.
      const fall = clamp(landing / .6);
      const rebound = landing > .6 ? Math.sin((landing - .6) / .4 * Math.PI) * 3.5 : 0;
      const lift = 34 * (1 - fall * fall) + rebound;
      const scale = 1 + .12 * (1 - landing) - .055 * Math.sin(fall * Math.PI);
      const opacity = (reduced ? 1 : clamp(elapsed / 65)) * (1 - removed);
      const [x, y] = chip.point;
      chip.mesh.position.set(x - (1 - landing) * 8, y - 3 - lift - removed * 5, 2 + lift * .08);
      chip.mesh.scale.setScalar(scale * (1 - removed * .12)); chip.mesh.rotation.z = -.1 * (1 - landing);
      chip.mesh.material.opacity = opacity;
      chip.shadow.position.set(x + 2, y + 6, 1); chip.shadow.scale.set(1 + lift * .012, .52 + lift * .006, 1);
      chip.shadow.material.opacity = .25 / (1 + lift * .06) * opacity;
      const ripple = reduced ? 1 : clamp((elapsed - 220) / 420);
      chip.ring.position.set(x, y + 2, 1.2); chip.ring.scale.set(1 + ripple * .75, .6 * (1 + ripple * .75), 1);
      chip.ring.material.opacity = !reduced && elapsed > 220 && ripple < 1 ? .65 * Math.sin(Math.PI * ripple) * (1 - removed) : 0;
      chip.ring.visible = chip.ring.material.opacity > .002;
      if (!reduced && (elapsed < 640 || chip.removedAt !== null)) active++;
    }
    return active;
  }
  function dispose() {
    chips.forEach(disposeChip); chips.clear();
    for (const cell of cells) { cell.fill.geometry.dispose(); cell.fill.material.dispose(); cell.edge.geometry.dispose(); cell.edge.material.dispose(); }
    edgeHint.geometry.dispose(); edgeHint.material.dispose(); plane.dispose(); shadowGeometry.dispose(); ringGeometry.dispose(); group.clear();
  }
  return { group, sync, update, dispose };
}
