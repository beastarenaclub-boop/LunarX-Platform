export function makeWheel(digits: number) {
  if (!Number.isInteger(digits) || digits < 2 || digits > 100) throw new Error("INVALID_LAYOUT");
  return { digits, pockets: Array.from({ length: digits }, (_, n) => n), sectorDegrees: 360 / digits };
}
export const WHEEL = makeWheel(10);
