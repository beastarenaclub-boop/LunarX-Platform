import { EUROPEAN_WHEEL_ORDER, betKey, pocketColor, type PlacedBet } from "../roulette/wheelData";

export type Spot = Omit<PlacedBet, "amount">;
export type BetPreview = { label: string; spots: Spot[] };

/** Exact number coverage for both the preview and the placed-chip highlights. */
export function coveredNumbers(spots: readonly Spot[]): number[] {
  const covered = new Set<number>();
  for (const spot of spots) {
    if (spot.numbers) { for (const n of spot.numbers) if (Number.isInteger(n) && n >= 0 && n <= 36) covered.add(n); continue; }
    for (let n = 1; n <= 36; n++) {
      const match = spot.type === "red" ? pocketColor(n) === "red" : spot.type === "black" ? pocketColor(n) === "black" : spot.type === "even" ? n % 2 === 0 : spot.type === "odd" ? n % 2 === 1 : spot.type === "low" ? n <= 18 : spot.type === "high" ? n >= 19 : spot.type === "dozen" ? Math.floor((n - 1) / 12) + 1 === spot.selection : spot.type === "column" ? (n - 1) % 3 + 1 === spot.selection : false;
      if (match) covered.add(n);
    }
  }
  return [...covered];
}
export type Region = { x: number; y: number; w: number; h: number; label: string; spot: Spot; fill?: string };
export const BOARD_W = 1400, BOARD_H = 480;
export const TABLE_REGIONS: Region[] = [
  { x: 0, y: 0, w: 100, h: 300, label: "0", spot: { type: "straight", numbers: [0] }, fill: "#16775c" },
  ...[3, 2, 1].flatMap((start, row) => Array.from({ length: 12 }, (_, col) => {
    const n = start + col * 3;
    return { x: 100 + col * 100, y: row * 100, w: 100, h: 100, label: String(n), spot: { type: "straight" as const, numbers: [n] }, fill: pocketColor(n) === "red" ? "#ad243c" : "#111729" };
  })),
  ...[3, 2, 1].map((selection, row) => ({ x: 1300, y: row * 100, w: 100, h: 100, label: "2 TO 1", spot: { type: "column" as const, selection } })),
  ...[1, 2, 3].map((selection, col) => ({ x: 100 + col * 400, y: 300, w: 400, h: 90, label: ["1ˢᵗ 12", "2ⁿᵈ 12", "3ʳᵈ 12"][col], spot: { type: "dozen" as const, selection } })),
  ...(["low", "even", "red", "black", "odd", "high"] as const).map((type, col) => ({ x: 100 + col * 200, y: 390, w: 200, h: 90, label: ["1–18", "EVEN", "◆", "◆", "ODD", "19–36"][col], spot: { type } })),
];

/** Edge precedence follows a physical roulette layout, including zero trios. */
export function boardSpot(x: number, y: number): Spot | null {
  if (x < 0 || y < 0 || x > BOARD_W || y > BOARD_H) return null;
  const gx = (x - 100) / 100, gy = y / 100;
  const col = Math.floor(gx), row = Math.floor(gy);
  const nearX = Math.abs(gx - Math.round(gx)) < .11;
  const nearY = Math.abs(gy - Math.round(gy)) < .11;
  const cx = Math.round(gx), ry = Math.round(gy);
  if (nearX && cx === 0 && y <= 311) {
    if (nearY && ry === 1) return { type: "street", numbers: [0, 2, 3] };
    if (nearY && ry === 2) return { type: "street", numbers: [0, 1, 2] };
    if (nearY && ry === 3) return { type: "corner", numbers: [0, 1, 2, 3] };
    return { type: "split", numbers: [0, 3 - Math.min(2, row)] };
  }
  if (x >= 100 && x < 1300 && y <= 311) {
    if (nearY && ry === 3) {
      const c = Math.min(11, Math.max(0, col));
      if (nearX && cx > 0 && cx < 12) return { type: "line", numbers: Array.from({ length: 6 }, (_, i) => (cx - 1) * 3 + 1 + i) };
      return { type: "street", numbers: [c * 3 + 1, c * 3 + 2, c * 3 + 3] };
    }
    if (y < 300) {
      if (nearX && cx > 0 && cx < 12 && nearY && ry > 0 && ry < 3) {
        const a = (cx - 1) * 3 + 3 - ry;
        return { type: "corner", numbers: [a, a + 1, a + 3, a + 4] };
      }
      if (nearX && cx > 0 && cx < 12) { const a = (cx - 1) * 3 + 3 - row; return { type: "split", numbers: [a, a + 3] }; }
      if (nearY && ry > 0 && ry < 3) { const a = col * 3 + 3 - ry; return { type: "split", numbers: [a, a + 1] }; }
    }
  }
  return TABLE_REGIONS.find(r => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h)?.spot ?? null;
}

export function spotCenter(spot: Spot): [number, number] {
  const direct = TABLE_REGIONS.find(r => betKey(r.spot) === betKey(spot));
  if (direct) return [direct.x + direct.w / 2, direct.y + direct.h / 2];
  const numbers = spot.numbers ?? [];
  if (numbers.includes(0)) return [100, spot.type === "corner" ? 300 : spot.type === "street" ? (numbers.includes(1) ? 200 : 100) : (3.5 - (numbers[1] ?? 2)) * 100];
  const centers = numbers.map(n => TABLE_REGIONS.find(r => r.spot.type === "straight" && r.spot.numbers?.[0] === n)!).filter(Boolean);
  if (!centers.length) return [700, 240];
  return [centers.reduce((s, r) => s + r.x + r.w / 2, 0) / centers.length, ["street", "line"].includes(spot.type) ? 300 : centers.reduce((s, r) => s + r.y + r.h / 2, 0) / centers.length];
}

export function neighbourBets(n: number, neighbours: number): Spot[] {
  const index = EUROPEAN_WHEEL_ORDER.indexOf(n as typeof EUROPEAN_WHEEL_ORDER[number]);
  if (index < 0 || !Number.isInteger(neighbours) || neighbours < 0 || neighbours > 9) return [];
  return Array.from({ length: neighbours * 2 + 1 }, (_, i) => ({ type: "straight", numbers: [EUROPEAN_WHEEL_ORDER[(index + i - neighbours + 37) % 37]] }));
}
export type Sector = "TIER" | "ORPHELINS" | "VOISINS" | "ZERO";
export function sectorBets(sector: Sector): Spot[] {
  const split = (numbers: number[]): Spot => ({ type: "split", numbers });
  switch (sector) {
    case "TIER": return [[5, 8], [10, 11], [13, 16], [23, 24], [27, 30], [33, 36]].map(split);
    case "ORPHELINS": return [{ type: "straight", numbers: [1] }, ...[[6, 9], [14, 17], [17, 20], [31, 34]].map(split)];
    case "VOISINS": return [{ type: "street", numbers: [0, 2, 3] }, { type: "street", numbers: [0, 2, 3] }, ...[[4, 7], [12, 15], [18, 21], [19, 22], [32, 35]].map(split), { type: "corner", numbers: [25, 26, 28, 29] }, { type: "corner", numbers: [25, 26, 28, 29] }];
    case "ZERO": return [split([0, 3]), split([12, 15]), { type: "straight", numbers: [26] }, split([32, 35])];
  }
}

export function paintBoard(canvas: HTMLCanvasElement, bets: PlacedBet[], result: number | null, hover: Spot | null = null) {
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, BOARD_W, BOARD_H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const r of TABLE_REGIONS) {
    ctx.fillStyle = r.fill ?? "rgba(50,62,167,.12)"; ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#cbd7ed"; ctx.lineWidth = 2; ctx.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
    ctx.font = `${r.spot.type === "column" ? 23 : 42}px Georgia`;
    ctx.fillStyle = r.spot.type === "red" ? "#e03446" : r.spot.type === "black" ? "#0a1024" : "#ebf2ff";
    ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2);
    if (r.spot.type === "straight" && r.spot.numbers?.[0] === result) { ctx.strokeStyle = "#ffe891"; ctx.lineWidth = 8; ctx.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12); }
  }
  if (hover) { const [x, y] = spotCenter(hover); ctx.fillStyle = "#fff4b34d"; ctx.beginPath(); ctx.arc(x, y, 36, 0, Math.PI * 2); ctx.fill(); }
  for (const bet of bets) {
    const [x, y] = spotCenter(bet);
    ctx.shadowColor = "#0009"; ctx.shadowBlur = 8; ctx.shadowOffsetY = 5;
    ctx.fillStyle = "#d8ad45"; ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.strokeStyle = "#fff5c8"; ctx.lineWidth = 5; ctx.setLineDash([7, 7]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "#30200a"; ctx.font = "bold 19px Arial"; ctx.fillText(bet.amount >= 1000 ? `${bet.amount / 1000}k` : String(bet.amount), x, y);
  }
}

export const TRACK_W = 1100, TRACK_H = 230;
export const TRACK_SPOTS = EUROPEAN_WHEEL_ORDER.map((n, i) => {
  const a = (i / 37) * Math.PI * 2;
  // A stadium outline: upper/lower straights and rounded ends.
  const perimeter = 2 * 740 + Math.PI * 160, p = i / 37 * perimeter;
  let x: number, y: number;
  if (p < 740) { x = 180 + p; y = 35; }
  else if (p < 740 + Math.PI * 80) { const t = (p - 740) / 80 - Math.PI / 2; x = 920 + 80 * Math.cos(t); y = 115 + 80 * Math.sin(t); }
  else if (p < 1480 + Math.PI * 80) { x = 920 - (p - 740 - Math.PI * 80); y = 195; }
  else { const t = (p - 1480 - Math.PI * 80) / 80 + Math.PI / 2; x = 180 + 80 * Math.cos(t); y = 115 + 80 * Math.sin(t); }
  return { n, x, y, angle: a };
});
export const SECTORS: Sector[] = ["TIER", "ORPHELINS", "VOISINS", "ZERO"];
export function paintTrack(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d")!; ctx.clearRect(0, 0, TRACK_W, TRACK_H);
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const p of TRACK_SPOTS) {
    ctx.fillStyle = p.n === 0 ? "#16775c" : pocketColor(p.n) === "red" ? "#ad243c" : "#111729";
    ctx.fillRect(p.x - 24, p.y - 22, 48, 44); ctx.strokeStyle = "#cbd7ed"; ctx.strokeRect(p.x - 24, p.y - 22, 48, 44);
    ctx.font = "26px Georgia"; ctx.fillStyle = "#f1f1ff"; ctx.fillText(String(p.n), p.x, p.y);
  }
  SECTORS.forEach((s, i) => { ctx.font = "23px Georgia"; ctx.fillStyle = "#e4eaff"; ctx.fillText(s, 250 + i * 200, 115); if (i < 3) { ctx.strokeStyle = "#aebadb"; ctx.beginPath(); ctx.moveTo(350 + i * 200, 65); ctx.lineTo(350 + i * 200, 165); ctx.stroke(); } });
}

export function trackSelection(x: number, y: number, neighbours: number): Spot[] {
  const hit = TRACK_SPOTS.find(p => Math.abs(x - p.x) < 27 && Math.abs(y - p.y) < 25);
  if (hit) return neighbourBets(hit.n, neighbours);
  if (y > 65 && y < 165 && x >= 150 && x < 950) return sectorBets(SECTORS[Math.floor((x - 150) / 200)]);
  return [];
}
