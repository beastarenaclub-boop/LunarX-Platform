export async function sha256Hex(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function sha256HexSync(seed: string): string {
  let h1 = 0xdeadbeef ^ seed.length;
  let h2 = 0x41c6ce57 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    const ch = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const out = (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  return out.padStart(16, "0");
}

/**
 * Default house edge used by the client-side fallback when the server has not
 * yet pushed live config. Kept in lockstep with the server default in
 * `lib/db/src/schema/game.ts` and `artifacts/api-server/src/services/rtp.ts`.
 * Version 3 targets 85% RTP with a 15% house edge; no extra bust bias.
 */
export const DEFAULT_HOUSE_EDGE = 0.15;
export const DEFAULT_MAX_MULTIPLIER = 1000;

let runtimeHouseEdge = DEFAULT_HOUSE_EDGE;
let runtimeMaxMultiplier = DEFAULT_MAX_MULTIPLIER;

export function setEngineConfig(cfg: { houseEdge?: number; maxMultiplier?: number }) {
  if (typeof cfg.houseEdge === "number" && cfg.houseEdge >= 0 && cfg.houseEdge <= 1) {
    runtimeHouseEdge = cfg.houseEdge;
  }
  if (typeof cfg.maxMultiplier === "number" && cfg.maxMultiplier >= 2) {
    runtimeMaxMultiplier = cfg.maxMultiplier;
  }
}

/**
 * Deterministically derive a crash multiplier from server seed + client seed + nonce.
 * Uses a "provably fair" style pattern with the configured house edge.
 * Returns a multiplier between 1.00 and the configured max with realistic distribution.
 */
export async function deriveCrash(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  config?: {houseEdge?:number;maxMultiplier?:number},
): Promise<number> {
  const hash = await sha256Hex(`${serverSeed}:${clientSeed}:${nonce}`);
  const uniform = parseInt(hash.slice(0, 13), 16) / 2 ** 52;
  return Math.max(1, Math.min(config?.maxMultiplier ?? runtimeMaxMultiplier, Math.floor(100 * (1 - (config?.houseEdge ?? runtimeHouseEdge)) / (1 - uniform)) / 100));
}

export function generateSeed(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Mulberry32 PRNG for non-fair atmosphere (other players, chat) */
export function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
