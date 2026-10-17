export interface RoadEntry {
  winner: "player" | "banker" | "tie";
  playerPair: boolean;
  bankerPair: boolean;
}
export interface RoadCell extends RoadEntry {
  row: number;
  col: number;
  ties: number;
}

/** Six-row Big Road, including collisions, dragon tails and leading ties. */
export function bigRoadCells(entries: RoadEntry[]): RoadCell[] {
  const cells: RoadCell[] = [],
    occupied = new Set<string>();
  let base = -1,
    last: RoadCell | undefined,
    leading = 0,
    tail = false;
  for (const entry of entries) {
    if (entry.winner === "tie") {
      if (last) last.ties++;
      else leading++;
      continue;
    }
    let row = 0,
      col: number;
    if (!last || last.winner !== entry.winner) {
      col = ++base;
      tail = false;
      while (occupied.has(`${col}:0`)) col = ++base;
    } else {
      row = last.row;
      col = last.col;
      if (!tail && row < 5 && !occupied.has(`${col}:${row + 1}`)) row++;
      else {
        tail = true;
        col++;
        while (occupied.has(`${col}:${row}`)) col++;
      }
    }
    last = { ...entry, row, col, ties: leading };
    leading = 0;
    cells.push(last);
    occupied.add(`${col}:${row}`);
  }
  if (!cells.length && leading)
    cells.push({
      winner: "tie",
      playerPair: false,
      bankerPair: false,
      col: 0,
      row: 0,
      ties: leading,
    });
  return cells;
}
