export const TOWER_FLOOR_HEIGHT = 1.8;
export const TOWER_BREAK_SECONDS = .78;
export function towerCollapseTiming(step: number) {
  const height = .9 + Math.max(0, step) * TOWER_FLOOR_HEIGHT;
  // Bound the cinematic duration for historical, extremely tall towers.
  const gravity = Math.max(24, 2 * (height + 2) / 2.25 ** 2);
  const flight = (2 + Math.sqrt(4 + 2 * gravity * (height + 2.5))) / gravity;
  const impact = TOWER_BREAK_SECONDS + Math.sqrt(2 * height / gravity);
  return { height, gravity, flight, impact, duration: TOWER_BREAK_SECONDS + flight + .9 };
}
