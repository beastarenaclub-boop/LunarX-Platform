/**
 * Closed-form throw plan for the Lucky 7 dice.
 *
 * Nothing here imports three: the page and the static (no-WebGL / reduced
 * motion) fallback share this module, while only the lazily-loaded 3D scene
 * turns the numbers into meshes.
 *
 * The throw is a *position curve*, not an accumulator — exactly like the
 * roulette wheel's landing. The pose at any instant is a pure function of the
 * elapsed fraction, so a tab that was hidden for the whole roll resumes with
 * the dice exactly where they should be instead of drifting, and a player who
 * joins mid-reveal drops straight onto the resting faces.
 */

/** Shortest roll worth animating — below this the result shows at once. */
export const MIN_THROW_MS = 1100;
/** Longest roll, so a generous reveal window doesn't drag. */
export const MAX_THROW_MS = 3800;
/** Slack left at the end of the reveal window so the dice rest in time. */
const THROW_TAIL_MS = 500;

/**
 * Throw duration for a reveal window with `remainingRevealMs` left on the
 * clock. Returns 0 when there is not enough time to animate, which means
 * "show the resting faces immediately" (joined late, or the operator set a
 * very short reveal).
 */
export function planThrowMs(remainingRevealMs: number): number {
  if (!Number.isFinite(remainingRevealMs)) return 0;
  const usable = remainingRevealMs - THROW_TAIL_MS;
  if (usable < MIN_THROW_MS) return 0;
  return Math.min(usable, MAX_THROW_MS);
}

/** One clock for the dealer's release, the dice, and their sound effects. */
export interface DiceThrowCue {
  roundId: string;
  startedAt: number;
  releaseAt: number;
  endsAt: number;
}

/** Measured point where filmed dice cross onto the rendered playing surface. */
export interface DealerRelease {
  /** Coordinates in the source video, each in 0..1. */
  x: number;
  y: number;
  videoAspect: number;
  /** CSS object-position fraction for the filmed scene's horizontal crop. */
  videoPositionX?: number;
  /** Visible felt depth varies slightly between the four filmed tables. */
  tableHeight?: number;
  /** Palm positions measured from the action clip, before release. */
  hand?: { ms: number; x: number; y: number }[];
  /** Offline hand tracking: no detection or camera access runs in the game. */
  grip?: DealerGripFrame[];
  /** The source footage itself contains the dice until this handoff. */
  filmedDice?: boolean;
  /** Width of one filmed die as a fraction of the uncropped source frame. */
  dieWidth?: number;
}

export interface DealerGripFrame {
  ms: number;
  x: number;
  y: number;
  size: number;
  angle: number;
  fingers: number[][];
}

export function gripAt(release: DealerRelease, ms: number): DealerGripFrame | undefined {
  const frames = release.grip;
  if (!frames?.length || ms < frames[0].ms) return undefined;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (frames[mid].ms <= ms + 1) lo = mid;
    else hi = mid - 1;
  }
  // Do not attach dice to a stale hand if an interval could not be tracked.
  return ms - frames[lo].ms < 130 ? frames[lo] : undefined;
}

export function palmAt(release: DealerRelease, ms: number): { x: number; y: number } {
  const grip = gripAt(release, ms);
  if (grip) return grip;
  const track = release.hand;
  if (!track?.length) return release;
  if (ms <= track[0].ms) return track[0];
  for (let i = 1; i < track.length; i++) {
    if (ms > track[i].ms) continue;
    const a = track[i - 1], b = track[i];
    const t = (ms - a.ms) / (b.ms - a.ms);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return track[track.length - 1];
}

/** Reserve time for the hand gesture without extending the server's reveal. */
export function planDealerThrow(remainingRevealMs: number, windupMs: number, clipDurationMs?: number, maxPlaybackRate = Infinity) {
  if (clipDurationMs && clipDurationMs > windupMs) {
    const total = Math.min(remainingRevealMs - THROW_TAIL_MS, clipDurationMs);
    // A short/late reveal should show the result instead of fast-forwarding
    // a real person's hand movement to catch up with the server.
    if (clipDurationMs / total > maxPlaybackRate) return { windupMs: 0, durationMs: 0 };
    const lead = total * windupMs / clipDurationMs;
    const durationMs = total - lead;
    if (!Number.isFinite(total) || durationMs < MIN_THROW_MS) return { windupMs: 0, durationMs: 0 };
    return { windupMs: lead, durationMs };
  }
  const lead = Number.isFinite(windupMs) ? Math.max(0, windupMs) : 0;
  const durationMs = planThrowMs(remainingRevealMs - lead);
  return { windupMs: durationMs > 0 ? lead : 0, durationMs };
}

/** Deterministic 32-bit hash so one round id always throws the same way. */
export function hashSeed(key: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function travel(x: number): number {
  // Constant friction: forward speed falls linearly, not almost instantly.
  return 1 - (1 - x) ** 2;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Where one die starts, where it ends, and how it gets there. */
export interface DiePlan {
  from: [number, number, number];
  to: [number, number, number];
  /** Launch height above the resting height. */
  lift: number;
  /** Normalised times of each table impact, ascending, all < 1. */
  bounces: number[];
  /** Apex height of the arc that *follows* each impact. */
  peaks: number[];
  /** World-space axis the die tumbles around (unit vector). */
  axis: [number, number, number];
  /** Total tumble, in turns, unwound to exactly zero at rest. */
  turns: number;
  /** Extra yaw baked into the resting pose so dice never rest identically. */
  yaw: number;
  /** End of edge-over-edge rolling; the remaining travel is a flat skid. */
  rollEnd: number;
  skidYaw: number;
  curve: number;
}

export interface ThrowPlan {
  durationMs: number;
  dice: [DiePlan, DiePlan];
  /** Merged impact schedule for the audio cues (normalised time + weight). */
  impacts: { t: number; strength: number }[];
}

/** Resting height of a die of unit size sitting on the felt. */
export const DIE_SIZE = 0.68;
export const DIE_REST_Y = DIE_SIZE / 2;

function buildDie(r: () => number, side: -1 | 1): DiePlan {
  // Start together at the dealer's side of the table, then spread on landing.
  const from: [number, number, number] = [
    side * 0.23 + (r() - 0.5) * 0.05,
    0.85 + r() * 0.12,
    -5.4 + r() * 0.3,
  ];
  const to: [number, number, number] = [
    side * (0.62 + r() * 1.03),
    DIE_REST_Y,
    // Leave room for the larger die's rotated corners before the front rail.
    0.08 + r() * 0.78,
  ];
  // Three decaying bounces: the first lands early, the last is a short hop.
  const b1 = 0.13 + r() * 0.025;
  const b2 = b1 + 0.105 + r() * 0.025;
  const b3 = b2 + 0.075 + r() * 0.02;
  // Roll around the axis perpendicular to the direction of travel.
  const axis0: [number, number, number] = [to[2] - from[2], 0, from[0] - to[0]];
  const len =
    Math.hypot(axis0[0], axis0[1], axis0[2]) || 1; /* never divide by zero */
  return {
    from,
    to,
    lift: from[1] - DIE_REST_Y,
    bounces: [b1, b2, b3],
    peaks: [0.22 + r() * 0.08, 0.065 + r() * 0.025, 0],
    axis: [axis0[0] / len, axis0[1] / len, axis0[2] / len],
    turns: 2.5 + r() * 1.5,
    yaw: r() * Math.PI * 2,
    rollEnd: 0.64 + r() * 0.065,
    skidYaw: (r() - 0.5) * 2.2,
    curve: side * (0.15 + r() * 0.25),
  };
}

/**
 * Build the plan for one round. Seeded by the round id so the same round
 * always throws the same way — a reload mid-roll picks the roll back up
 * instead of restarting a different one.
 */
export function buildThrowPlan(seedKey: string, durationMs: number): ThrowPlan {
  const r = rng(hashSeed(seedKey));
  const dice: [DiePlan, DiePlan] = [buildDie(r, -1), buildDie(r, 1)];
  const impacts = dice
    .flatMap((d) =>
      d.bounces.map((t, i) => ({ t, strength: [1, 0.55, 0.3][i] ?? 0.25 })),
    )
    .sort((a, b) => a.t - b.t);
  return { durationMs, dice, impacts };
}

/**
 * Height of a die above the felt at normalised time `t`.
 *
 * Segment 0 is the fall from the launch height onto the first impact; each
 * later segment is a parabolic hop between two impacts, with the last hop
 * touching down exactly at t = 1.
 */
function heightAt(plan: DiePlan, t: number): number {
  const [b1] = plan.bounces;
  if (t <= b1) {
    const u = b1 <= 0 ? 1 : t / b1;
    // Falling parabola: starts at the launch height with zero vertical speed.
    return plan.lift * (1 - u * u);
  }
  for (let i = 0; i < plan.bounces.length; i++) {
    const start = plan.bounces[i];
    const end = plan.bounces[i + 1] ?? 1;
    if (t <= end) {
      const span = end - start;
      if (span <= 0) return 0;
      const u = (t - start) / span;
      return plan.peaks[i] * 4 * u * (1 - u);
    }
  }
  return 0;
}

export interface DiePose {
  x: number;
  y: number;
  z: number;
  /** Remaining tumble in radians; 0 at rest. */
  spin: number;
  skidYaw: number;
  rock: number;
  phase: "drop" | "bounce" | "roll" | "slide" | "rest";
}

/** Use the filmed release position without a jump at the first 3D frame. */
export function anchorDie(plan: DiePlan, from: [number, number, number]): void {
  plan.from = from;
  plan.lift = from[1] - DIE_REST_Y;
  const dx = plan.to[0] - from[0];
  const dz = plan.to[2] - from[2];
  const length = Math.hypot(dx, dz) || 1;
  plan.axis = [dz / length, 0, -dx / length];
}

/** Exact pose of one die at normalised time `t` (0 = launch, 1 = at rest). */
export function diePose(plan: DiePlan, t: number): DiePose {
  const k = clamp(t, 0, 1);
  // Horizontal travel eases out — the dice shed speed as friction takes over.
  const glide = travel(k);
  const rolling = clamp(k / plan.rollEnd, 0, 1);
  const slide = clamp((k - plan.rollEnd) / (1 - plan.rollEnd), 0, 1);
  return {
    x: plan.from[0] + (plan.to[0] - plan.from[0]) * glide + plan.curve * Math.sin(Math.PI * glide),
    z: plan.from[2] + (plan.to[2] - plan.from[2]) * glide,
    y: DIE_REST_Y + heightAt(plan, k),
    // Unwinds to exactly zero with zero angular speed, so the die eases onto
    // its resting face instead of snapping to it.
    spin: plan.turns * Math.PI * 2 * (1 - travel(rolling)),
    skidYaw: plan.skidYaw * (1 - k) ** 2,
    rock: Math.sin(slide * Math.PI * 3) * 0.065 * (1 - slide) ** 2,
    phase: k >= 1 ? "rest" : k >= plan.rollEnd ? "slide"
      : k >= plan.bounces[2] ? "roll" : k >= plan.bounces[0] ? "bounce" : "drop",
  };
}

/** Tumble speed as a 0..1 fraction of the launch speed (for audio). */
export function tumbleSpeed01(t: number): number {
  return (1 - clamp(t, 0, 1)) ** 2;
}
