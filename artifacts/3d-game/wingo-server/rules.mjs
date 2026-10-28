import { createHash } from "node:crypto";

export const DURATIONS = [30];
export const PAYOUT_VERSION = 3;
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export function colorsFor(number) {
  return [number % 2 ? "green" : "red", ...([0, 5].includes(number) ? ["violet"] : [])];
}
export function multiplierFor(pick, number, version = 1) {
  if (version === 3) {
    if (/^[0-9]$/.test(pick)) return Number(pick) === number ? 1.98 : 0;
    return multiplierFor(pick, number, 2);
  }
  if (version === 2) {
    if (/^[0-9]$/.test(pick)) return Number(pick) === number ? 8.5 : 0;
    if (pick === "big") return number >= 5 ? 1.7 : 0;
    if (pick === "small") return number < 5 ? 1.7 : 0;
    return colorsFor(number).includes(pick) ? pick === "violet" ? 4.25 : 1.7 : 0;
  }
  if (/^[0-9]$/.test(pick)) return Number(pick) === number ? 9 : 0;
  if (pick === "big") return number >= 5 ? 2 : 0;
  if (pick === "small") return number < 5 ? 2 : 0;
  if (!colorsFor(number).includes(pick)) return 0;
  return pick === "violet" ? 4.5 : [0, 5].includes(number) ? 1.5 : 2;
}
export const commitmentFor = (period, number, secret) => hash(`${period}:${number}:${secret}`);
