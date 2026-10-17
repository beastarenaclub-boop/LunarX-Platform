/** The presentation uses the server's reveal window, including when joining late. */
import { roundHash } from "./harvestWorld";
import type { JunkKind } from "./JunkArt";
export const HARVEST_DURATION_MS = 18_000;
export const FALL_DURATION_MS = 1_450;
export const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);
export function catchTime(index: number, total: number, duration: number) {
  return total === 1
    ? duration * 0.7
    : 2300 + (index * Math.max(0, duration - 3900)) / (total - 1);
}
export function catchX(index: number) {
  return [260, 475, 325, 510, 230, 425, 285, 490, 350, 215, 455, 310][
    index % 12
  ];
}
export function harvestFrame(elapsed: number, total: number, duration: number) {
  let collected = 0;
  for (let i = 0; i < total; i++)
    if (elapsed >= catchTime(i, total, duration)) collected++;
  const previousTime = collected
    ? catchTime(collected - 1, total, duration)
    : 0;
  const previousX = collected ? catchX(collected - 1) : 360;
  const targetX = collected < total ? catchX(collected) : 360;
  const nextTime =
    collected < total ? catchTime(collected, total, duration) - 250 : duration;
  const travel = smooth(
    clamp01(
      (elapsed - previousTime - 180) /
        Math.max(1, nextTime - previousTime - 180),
    ),
  );
  const sinceCatch = elapsed - previousTime;
  const bounce =
    collected && sinceCatch < 420
      ? Math.sin((sinceCatch / 420) * Math.PI) * 9
      : 0;
  return {
    collected,
    bowlX: previousX + (targetX - previousX) * travel,
    bounce,
  };
}

export interface JunkDrop {
  kind: JunkKind;
  crossesAt: number;
  x: number;
  side: 1 | -1;
}
export const JUNK_FALL_MS = 1300;
/** Decorative hazards occupy gaps between catches, never the wallet outcome. */
export function junkDrops(
  total: number,
  duration: number,
  roundId: string,
): JunkDrop[] {
  if (!total) return [];
  const catches = Array.from({ length: total }, (_, i) =>
    catchTime(i, total, duration),
  );
  const candidates: number[] = [];
  for (let time = 1100; time < duration - 700; time += 60) {
    if (catches.every((catchAt) => Math.abs(catchAt - time) >= 560))
      candidates.push(time);
  }
  const hash = roundHash(roundId);
  const drops: JunkDrop[] = [];
  for (let index = 0; index < 6; index++) {
    const target =
      (duration * (index + 0.65)) / 6 + (((hash >>> (index * 3)) % 7) - 3) * 65;
    const available = candidates.filter((time) =>
      drops.every((drop) => Math.abs(drop.crossesAt - time) > 1400),
    );
    const time = available.sort(
      (a, b) => Math.abs(a - target) - Math.abs(b - target),
    )[0];
    if (time === undefined) continue;
    const positions = Array.from(
      { length: 13 },
      (_, i) => harvestFrame(time - 200 + i * 40, total, duration).bowlX,
    );
    const left = Math.min(...positions) - 124,
      right = Math.max(...positions) + 124;
    const side: 1 | -1 =
      left < 45 ? 1 : right > 675 ? -1 : (hash >>> index) & 1 ? 1 : -1;
    drops.push({
      kind: (["stone", "boot", "can"] as const)[(hash + index) % 3],
      crossesAt: time,
      x: side === 1 ? right : left,
      side,
    });
  }
  return drops.sort((a, b) => a.crossesAt - b.crossesAt);
}
export function dodgeWeight(elapsed: number, crossesAt: number) {
  const delta = elapsed - crossesAt;
  if (delta < -480 || delta > 500) return 0;
  return delta < -180
    ? smooth(clamp01((delta + 480) / 300))
    : delta <= 280
      ? 1
      : 1 - smooth(clamp01((delta - 280) / 220));
}
export function dodgeBowlX(baseX: number, elapsed: number, drops: JunkDrop[]) {
  return drops.reduce(
    (x, drop) => x - drop.side * 58 * dodgeWeight(elapsed, drop.crossesAt),
    baseX,
  );
}
