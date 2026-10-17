// Simple value noise implementation
function hash(x: number, y: number): number {
  const dot = x * 12.9898 + y * 78.233;
  const sin = Math.sin(dot) * 43758.5453;
  return sin - Math.floor(sin);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  
  const xf = x - xi;
  const yf = y - yi;
  
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  
  const k0 = a;
  const k1 = b - a;
  const k2 = c - a;
  const k3 = a - b - c + d;
  
  return k0 + k1 * u + k2 * v + k3 * u * v;
}

export function getElevation(x: number, z: number): number {
  // Combine multiple octaves of noise
  let e = 0;
  e += 1.00 * valueNoise(x * 0.005, z * 0.005);
  e += 0.50 * valueNoise(x * 0.01, z * 0.01);
  e += 0.25 * valueNoise(x * 0.02, z * 0.02);
  e += 0.12 * valueNoise(x * 0.04, z * 0.04);
  e += 0.06 * valueNoise(x * 0.08, z * 0.08);
  
  // Power it up to make valleys flatter and hills steeper
  e = Math.pow(e, 1.5);
  
  return e * 80 - 15; // Scale height to reasonable level
}

// Pseudo-random deterministic function for placement
export function seededRandom(x: number, z: number): number {
  return hash(x * 100, z * 100);
}
