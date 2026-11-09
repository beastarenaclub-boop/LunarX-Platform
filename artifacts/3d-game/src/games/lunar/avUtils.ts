/**
 * Shared formatting + color helpers for the Spribe-exact Aviator skin.
 * Measurements and color tiers come from UI_SPEC_AVIATOR.md (derived from 4K
 * captures of the real game). Kept as plain functions so they can be unit
 * checked without React — see scripts/check-aviator-ui.ts.
 */

// Multiplier tiers, used identically in the history strip, the X column and
// the Top leaderboard cards.
export const TIER_LOW = "#34b4ff"; // < 2×      cyan-blue
export const TIER_MID = "#913ef8"; // 2× – 10×  violet
export const TIER_HIGH = "#c017b4"; // >= 10×    magenta

export function tierColor(m: number): string {
  if (m < 2) return TIER_LOW;
  if (m < 10) return TIER_MID;
  return TIER_HIGH;
}

/** `Mahesh` → `M***h`, the reference's masked-player format. */
export function maskName(name: string): string {
  if (!name) return "***";
  if (name.length === 1) return `${name}***`;
  return `${name[0]}***${name[name.length - 1]}`;
}

export function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * How many face images live in `public/avatars`.
 *
 * They are named `avatar_001.jpg` … `avatar_300.jpg` with no gaps, and this
 * number is the modulus every assignment goes through — set it wrong and the
 * tail of the range either never appears or 404s.
 */
export const AVATAR_COUNT = 300;

/**
 * The face for a player, chosen by the SAME hash as their tint.
 *
 * Deterministic on purpose: a fake bettor's name recurs across rounds and
 * across panels — the bet list, the chat, the winners pill — and a face that
 * were picked at random per render would change while the player watched, and
 * show one person as two.
 *
 * Built off Vite's BASE_URL rather than a bare "/" because the app is served
 * under a configurable base (`BASE_PATH`), and inside a partner's iframe that
 * is not the site root. Falls back to "/" so the module still imports under
 * plain node, which has no `import.meta.env` — these helpers are deliberately
 * unit-checkable without a bundler.
 */
export function avatarUrl(name: string): string {
  const base =
    (typeof import.meta !== "undefined" && import.meta.env?.BASE_URL) || "/";
  const n = (hashString(name) % AVATAR_COUNT) + 1;
  return `${base}avatars/avatar_${String(n).padStart(3, "0")}.jpg`;
}

/**
 * Stable per-player avatar tint.
 *
 * Still used, and not dead: it is what shows THROUGH `PlayerAvatar` while the
 * face is still loading and what stays if the file ever fails, so the circle
 * is never an empty hole.
 */
export function avatarGradient(name: string): string {
  const h = hashString(name);
  const a = h % 360;
  const b = (a + 40 + (h % 80)) % 360;
  return `linear-gradient(135deg, hsl(${a} 70% 45%), hsl(${b} 70% 55%))`;
}

/** Stable per-player name color for chat, like the reference's colored handles. */
export function nameColor(name: string): string {
  return `hsl(${hashString(name) % 360} 75% 68%)`;
}

/** 437453.62 → "437,453.62" — Indian grouping, always 2dp, tabular. */
export function fmtINR(n: number): string {
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `30.07.26` — the dd.mm.yy stamp on the Top-list cards. */
export function fmtDDMMYY(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${p(d.getFullYear() % 100)}`;
}

/** `17:47:40` — chat message timestamps. */
export function fmtHMS(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export type TopWindow = "day" | "month" | "year";

/** Day/Month/Year filter for the Top tab. */
export function withinWindow(ts: number, w: TopWindow, now: number): boolean {
  const day = 86_400_000;
  const span = w === "day" ? day : w === "month" ? 30 * day : 365 * day;
  return now - ts <= span;
}
