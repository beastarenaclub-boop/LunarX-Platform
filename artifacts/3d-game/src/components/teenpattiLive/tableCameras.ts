import { BACK_PAPER_QUADS, FILM_WORLD } from "./dealerFilm";

/** Preparation runs inside the existing server betting window. No outcome
 * is needed or revealed while the six face-down cards leave the side shoe. */
export const SHUFFLE_MS = 5200;
export const DEAL_MS = 4200;
export const DEAL_ORDER = [0, 3, 1, 4, 2, 5];
export const BACK_PLANES = BACK_PAPER_QUADS.map(([a, b, , d]) => [
  a[0],
  a[1],
  b[0],
  b[1],
  d[0],
  d[1],
]);
const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const smooth = (n: number) => {
  const t = clamp(n);
  return t * t * (3 - 2 * t);
};

export function preparationAt(
  now: number,
  endsAt: number,
  duration: number,
  animate: boolean,
) {
  const elapsed = Math.max(0, now - (endsAt - duration));
  const dealElapsed = now - (endsAt - Math.min(DEAL_MS, duration));
  const cards = BACK_PLANES.map((target, index) => {
    const order = DEAL_ORDER.indexOf(index);
    const raw = (dealElapsed - order * 560) / 760;
    const t = animate ? smooth(raw) : raw >= 0 ? 1 : 0;
    const start = [175, 427, 199, 427, 170, 443];
    const p = target.map((value, i) => start[i] + (value - start[i]) * t);
    // A low arc keeps the card sliding along the table out of the shoe.
    const arc = Math.sin(Math.PI * t) * 8;
    return {
      visible: raw >= 0,
      landed: raw >= 1,
      raw,
      matrix: `matrix(${(p[2] - p[0]) / 66} ${(p[3] - p[1]) / 66} ${(p[4] - p[0]) / 94} ${(p[5] - p[1]) / 94} ${p[0]} ${p[1] - arc})`,
    };
  });
  return {
    elapsed,
    cards,
    phase:
      elapsed < SHUFFLE_MS
        ? "shuffle"
        : dealElapsed < 0
          ? "ready"
          : cards.every((c) => c.landed)
            ? "dealt"
            : "dealing",
  };
}

export const OVERHEAD_X = [176, 262, 348, 476, 562, 648];
export type TableCamera = "auto" | "dealer" | "cards";

/** Film and ink share one 16:9 world. Keep the dealer's whole head,
 * both hands and the table visible while the readable cards open below. */
export function filmCameraFrame(
  width: number,
  height: number,
  close: boolean,
  sideBySide = false,
  maxHeight?: number,
) {
  const filmWidth = sideBySide ? Math.floor(width / 2) : width;
  const readoutWidth = sideBySide ? width - filmWidth : width;
  const compact = readoutWidth < 640;
  const margin = compact ? 8 : 12;
  const groupGap = compact ? 12 : 24;
  const cardGap = compact ? 4 : 8;
  const customerCardWidth = Math.min(
    84,
    Math.max(1, (readoutWidth - 2 * margin - groupGap - 32 - 4 * cardGap) / 6),
  );
  const customerHeight = Math.ceil((customerCardWidth * 94) / 66 + 50);
  const top = close && !sideBySide ? 44 : 40;
  const bottom = close && !sideBySide ? customerHeight + 38 + 6 : 24;
  // Keep the entire film visible. Short betting screens also reserve room
  // for the shared coin and bet sizes below the dealer.
  const scale = Math.min(filmWidth / FILM_WORLD.width,
    maxHeight && !close ? Math.max(1, maxHeight - top - bottom - 2) / FILM_WORLD.height : Infinity);
  const minHeight = sideBySide
    ? top +
      Math.max(Math.ceil(FILM_WORLD.height * scale), customerHeight) +
      bottom +
      2
    : close
      ? Math.max(430, top + Math.ceil(FILM_WORLD.height * scale) + bottom + 8)
      : top + Math.ceil(FILM_WORLD.height * scale) + bottom + 2;
  const viewportHeight = Math.max(1, height - top - bottom);
  const x = filmWidth / 2 - (FILM_WORLD.width / 2) * scale;
  const y = (viewportHeight - FILM_WORLD.height * scale) / 2;
  return {
    scale,
    x,
    y,
    top,
    bottom,
    viewportHeight,
    customerHeight,
    customerCardWidth,
    minHeight,
    filmWidth,
  };
}
