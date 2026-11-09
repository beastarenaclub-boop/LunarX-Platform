import * as THREE from "three";
import { boardSpot, neighbourBets, sectorBets, type Sector, type BetPreview } from "./layout";

export const PHOTO = { width: 1741, height: 903, wheelX: 296, wheelY: 228, wheelScaleY: .82 };
type Point = readonly [number, number];
export const PHOTO_ZERO: [number, number][] = [[690, 201], [733, 221], [593, 407], [551, 377], [589, 271]];
function insideZero(x: number, y: number) {
  let inside = false;
  for (let i = 0, j = PHOTO_ZERO.length - 1; i < PHOTO_ZERO.length; j = i++) {
    const a = PHOTO_ZERO[i], b = PHOTO_ZERO[j];
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/** Project the unit square onto the four printed corners in the fixed camera. */
function homography([a, b, c, d]: readonly Point[]) {
  const dx1 = b[0] - c[0], dx2 = d[0] - c[0], dx3 = a[0] - b[0] + c[0] - d[0];
  const dy1 = b[1] - c[1], dy2 = d[1] - c[1], dy3 = a[1] - b[1] + c[1] - d[1];
  const det = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / det, h = (dx1 * dy3 - dx3 * dy1) / det;
  return new THREE.Matrix3().set(b[0] - a[0] + g * b[0], d[0] - a[0] + h * d[0], a[0], b[1] - a[1] + g * b[1], d[1] - a[1] + h * d[1], a[1], g, h, 1);
}
function project(matrix: THREE.Matrix3, x: number, y: number): [number, number] {
  const p = new THREE.Vector3(x, y, 1).applyMatrix3(matrix); return [p.x / p.z, p.y / p.z];
}
const grid = homography([[733, 221], [1403, 546], [1282, 763], [593, 407]]);
const inverseGrid = grid.clone().invert();
export function photoBoardPoint(x: number, y: number): [number, number] {
  return project(grid, (x - 100) / 1200, (y <= 300 ? y : 300 + (y - 300) * 2 / 3) / 300);
}
export function photoBoardSpot(x: number, y: number) {
  const [u, v] = project(inverseGrid, x, y), gy = v * 300;
  const spot = boardSpot(100 + u * 1200, gy <= 300 ? gy : 300 + (gy - 300) * 1.5);
  if (spot?.type === "straight" && spot.numbers?.[0] === 0) return insideZero(x, y) ? spot : null;
  return spot ?? (insideZero(x, y) ? { type: "straight" as const, numbers: [0] } : null);
}

// The racetrack follows the reference's horizontal French layout, not a circle.
export const PHOTO_TRACK = [
  ...[5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35].map((n, i) => ({ n, x: 175 + i * 47, y: 35 })),
  { n: 3, x: 918, y: 60 }, { n: 26, x: 936, y: 113 }, { n: 0, x: 896, y: 174 },
  ...[32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30].map((n, i) => ({ n, x: 838 - i * 47.286, y: 202 - i * 1.429 })),
  { n: 8, x: 132, y: 161 }, { n: 23, x: 136, y: 114 }, { n: 10, x: 144, y: 72 },
];
const track = homography([[686, 43], [1274, 300], [1232, 409], [644, 152]]), inverseTrack = track.clone().invert();
export function photoTrackPoint(x: number, y: number) { return project(track, x / 1100, y / 230); }
export function photoTrackSelection(x: number, y: number, neighbours: number): BetPreview | null {
  const [u, v] = project(inverseTrack, x, y), tx = u * 1100, ty = v * 230;
  const hit = PHOTO_TRACK.find(p => Math.abs(p.x - tx) < 26 && Math.abs(p.y - ty) < 25);
  if (hit) return { label: neighbours ? `${hit.n} + ${neighbours} neighbours each side` : `Number ${hit.n}`, spots: neighbourBets(hit.n, neighbours) };
  if (tx >= 165 && tx < 950 && ty > 67 && ty < 165) { const sector = (["TIER", "ORPHELINS", "VOISINS", "ZERO"] as Sector[])[Math.min(3, Math.floor((tx - 165) / 196.25))]; return { label: sector, spots: sectorBets(sector) }; }
  return null;
}
export function photoTrackBet(x: number, y: number, neighbours: number) { return photoTrackSelection(x, y, neighbours)?.spots ?? []; }

export function photoPolygon(points: readonly Point[]) {
  const shape = new THREE.Shape(); shape.moveTo(points[0][0], points[0][1]); points.slice(1).forEach(p => shape.lineTo(p[0], p[1])); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape), position = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) uv.setXY(i, position.getX(i) / PHOTO.width, 1 - position.getY(i) / PHOTO.height);
  return geometry;
}
export const SPINDLE_OUTLINE: Point[] = [[297, 140], [307, 145], [310, 153], [307, 162], [315, 168], [315, 180], [311, 190], [307, 197], [311, 205], [314, 216], [309, 226], [301, 234], [288, 234], [279, 226], [275, 216], [278, 205], [282, 197], [277, 190], [274, 180], [275, 168], [283, 162], [282, 152], [285, 144]];
