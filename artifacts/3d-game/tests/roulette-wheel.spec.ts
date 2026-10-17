import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import {
  ROULETTE_MODEL_ZERO_OFFSET_DEG,
  rouletteModelRotorDegrees,
} from "../src/components/roulette/wheelData";
import {
  ANTICIPATION_WHEEL_DPS,
  BALL_RATTLE_DPS,
  ballRollLevel01,
  buildRouletteLanding,
  FINAL_RUN_BALL_DPS,
  FINAL_RUN_WHEEL_DPS,
  LANDING_BRAKE_MS,
  MIN_LANDING_MS,
  planAngle,
  planLandingMs,
  planPhase,
  planSpeedDps,
} from "../src/components/roulette/spinPlan";

// Same bootstrap as the other player-app suites: every test starts from a
// fresh authenticated session (POST /api/auth/signup, x-test-bypass for the
// auth rate limiter).
const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const unique = `${testInfo.testId}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    const headers: Record<string, string> = {};
    if (process.env.TEST_RATE_LIMIT_BYPASS) {
      headers["x-test-bypass"] = process.env.TEST_RATE_LIMIT_BYPASS;
    }
    const res = await page.request.post("/api/auth/signup", {
      headers,
      data: {
        email: `playwright-${unique}@example.com`,
        password: "playwright-test-pw",
        displayName: "Playwright",
      },
    });
    if (!res.ok()) {
      throw new Error(
        `Failed to bootstrap auth: ${res.status()} ${await res.text()}`,
      );
    }
    await use(page);
  },
});

// European single-zero pocket order, clockwise — duplicated on purpose so the
// test asserts against the real wheel layout rather than the component's own
// helper.
const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24,
  16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
const SLICE = 360 / WHEEL_ORDER.length;
const STORAGE_KEY = "aviator:v1";

/** Pocket index 0 sits under the pointer at rotation 0; +rotation is clockwise. */
function pocketUnderPointer(rotationDeg: number): number {
  const mod = ((-rotationDeg % 360) + 360) % 360;
  return WHEEL_ORDER[Math.round(mod / SLICE) % WHEEL_ORDER.length];
}

/** Rotation angle actually rendered on an element (from its computed matrix). */
async function renderedAngle(page: Page, testId: string): Promise<number> {
  const transform = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    return el ? window.getComputedStyle(el).transform : null;
  }, testId);
  if (!transform || transform === "none") return 0;
  const parts = transform.match(/matrix\(([^)]+)\)/);
  if (!parts) return 0;
  const [a, b] = parts[1].split(",").map(Number);
  return ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
}

async function seedOnboarded(page: Page, sound = false) {
  await page.addInitScript(
    ({ key, sound }) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : {};
        const settings = { ...(parsed.settings ?? {}), onboarded: true, sound };
        localStorage.setItem(key, JSON.stringify({ ...parsed, settings }));
      } catch {
        localStorage.setItem(
          key,
          JSON.stringify({ settings: { onboarded: true, sound } }),
        );
      }
    },
    { key: STORAGE_KEY, sound },
  );
}

type ClipEvent = { dur: number; loop: boolean; stopped: boolean };

/**
 * Record every buffer the page plays. Clips are identified by their decoded
 * duration, which `clipDurations` resolves by decoding the files up front — no
 * audio device involved, so this runs the same way headless and on CI.
 */
async function recordClips(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __clips: ClipEvent[] };
    w.__clips = [];
    const proto = (window.BaseAudioContext ?? window.AudioContext).prototype;
    const create = proto.createBufferSource;
    proto.createBufferSource = function () {
      const src = create.call(this);
      let entry: ClipEvent | null = null;
      const start = src.start.bind(src);
      src.start = function (...args: Parameters<typeof start>) {
        entry = {
          dur: src.buffer ? Math.round(src.buffer.duration * 1000) : -1,
          loop: !!src.loop,
          stopped: false,
        };
        w.__clips.push(entry);
        return start(...args);
      };
      const stop = src.stop.bind(src);
      src.stop = function (...args: Parameters<typeof stop>) {
        if (entry) entry.stopped = true;
        return stop(...args);
      };
      return src;
    };
  });
}

async function clipDurations(page: Page, names: string[]) {
  return page.evaluate(async (list: string[]) => {
    const ctx = new AudioContext();
    const out: Record<string, number> = {};
    for (const n of list) {
      const buf = await ctx.decodeAudioData(
        await (await fetch(`/src/assets/audio/table/${n}.mp3`)).arrayBuffer(),
      );
      out[n] = Math.round(buf.duration * 1000);
    }
    await ctx.close();
    return out;
  }, names);
}

async function playedClips(page: Page): Promise<ClipEvent[]> {
  return page.evaluate(
    () => (window as unknown as { __clips: ClipEvent[] }).__clips,
  );
}

/** Background (or restore) the tab from inside the page, as a real switch would. */
function setTabHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

type Sample = { t: number; phase: string; wheel: number; ball: number };

/**
 * Record the rotor and ball angles every animation frame until the wheel
 * settles (or `maxMs` runs out). Reads the inline transforms the animation
 * loop writes, so it measures the motion a player actually sees rather than
 * the plan the component intended.
 */
async function sampleSpin(page: Page, maxMs: number): Promise<Sample[]> {
  return page.evaluate(async (limit: number) => {
    const host = document.querySelector("[data-spin-phase]");
    const rotor = document.querySelector<HTMLElement>(
      '[data-testid="roulette-wheel"]',
    );
    const track = document.querySelector<HTMLElement>(
      '[data-testid="wheel-ball-track"]',
    );
    if (!host || !rotor || !track) throw new Error("wheel is not mounted");
    const read = (el: HTMLElement) => {
      const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform);
      return m ? Number(m[1]) : 0;
    };
    const out: Sample[] = [];
    await new Promise<void>((resolve) => {
      const start = performance.now();
      const tick = (ts: number) => {
        const phase = host.getAttribute("data-spin-phase") ?? "";
        out.push({ t: ts - start, phase, wheel: read(rotor), ball: read(track) });
        if (phase === "settled" || ts - start >= limit) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return out;
  }, maxMs);
}

type SpeedSample = { t: number; phase: string; dps: number };

/**
 * Frame-to-frame angular speed (deg/s). The rotor only ever turns one way and
 * the ball the other, so unwrap in that direction: that stays accurate on a
 * slow frame instead of aliasing into apparent backwards motion.
 */
function speedsOf(
  samples: Sample[],
  key: "wheel" | "ball",
  dir: 1 | -1,
): SpeedSample[] {
  const out: SpeedSample[] = [];
  for (let i = 1; i < samples.length; i++) {
    const dt = samples[i].t - samples[i - 1].t;
    // Too short to measure; too long to trust (a gap over a third of a second
    // could hide a whole extra turn at ball speed).
    if (dt < 4 || dt > 300) continue;
    const travelled = ((samples[i][key] - samples[i - 1][key]) * dir + 360) % 360;
    out.push({ t: samples[i].t, phase: samples[i].phase, dps: (travelled / dt) * 1000 });
  }
  return out;
}

/** Deduplicated phase order seen across a recording. */
function phaseOrder(samples: Sample[]): string[] {
  const out: string[] = [];
  for (const s of samples) if (out[out.length - 1] !== s.phase) out.push(s.phase);
  return out;
}

function median(values: number[]): number {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function inPhase(speeds: SpeedSample[], phase: string): SpeedSample[] {
  return speeds.filter((s) => s.phase === phase);
}

/* ── Supplied 3D model contract ─────────────────────────────────────────
   The renderer picks the rotor out of the GLB by material name and spins it
   around the model origin, so a re-export that renames that material or moves
   the wheel off-axis would silently stop the pockets from turning. Read the
   shipped asset straight off disk (no WebGL needed) to catch that here rather
   than on a player's screen.

   Note: the rotor's UVs are atlased per pocket, not a single polar projection,
   so pocket-to-pointer alignment cannot be fitted from the UVs — that
   calibration lives in the constant asserted by the test below it. */

const MODEL_RELATIVE_PATH = "src/assets/roulette-model/roulette-wheel-v2.glb";

interface RotorAsset {
  materialNames: string[];
  vertexCount: number;
  /** Axis-aligned bounds of the rotor mesh: [min, max] per axis. */
  bounds: { x: [number, number]; y: [number, number]; z: [number, number] };
}

function readRotorAsset(): RotorAsset {
  const candidates = [
    path.resolve(process.cwd(), MODEL_RELATIVE_PATH),
    path.resolve(process.cwd(), "artifacts/3d-game", MODEL_RELATIVE_PATH),
  ];
  const file = candidates.find((candidate) => fs.existsSync(candidate));
  if (!file) throw new Error(`Roulette model not found: ${candidates.join(", ")}`);

  const glb = fs.readFileSync(file);
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  let binHeader = 20 + jsonLength;
  while (binHeader % 4) binHeader++;
  const bin = glb.subarray(binHeader + 8, binHeader + 8 + glb.readUInt32LE(binHeader));

  const materialNames: string[] = gltf.materials.map(
    (material: { name: string }) => material.name,
  );
  const primitive = gltf.meshes
    .flatMap((mesh: { primitives: unknown[] }) => mesh.primitives)
    .find(
      (candidate: { material: number }) =>
        materialNames[candidate.material] === "inside",
    );
  if (!primitive) throw new Error('The model no longer has an "inside" rotor mesh');

  const accessor = gltf.accessors[primitive.attributes.POSITION];
  expect(accessor.componentType, "rotor positions must stay float32").toBe(5126);
  const view = gltf.bufferViews[accessor.bufferView];
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);

  const bounds = {
    x: [Infinity, -Infinity] as [number, number],
    y: [Infinity, -Infinity] as [number, number],
    z: [Infinity, -Infinity] as [number, number],
  };
  for (let i = 0; i < accessor.count; i++) {
    const axes = ["x", "y", "z"] as const;
    for (let c = 0; c < 3; c++) {
      const value = bin.readFloatLE(start + (i * 3 + c) * 4);
      const axis = bounds[axes[c]];
      if (value < axis[0]) axis[0] = value;
      if (value > axis[1]) axis[1] = value;
    }
  }

  return { materialNames, vertexCount: accessor.count, bounds };
}

test.describe("Roulette wheel motion", () => {
  // Rounds run on a 50s betting / 5s reveal / 5s settle cycle, so a full
  // idle → result observation can take a minute.
  test.setTimeout(200_000);

  test("ships a wheel model the renderer can still drive", () => {
    const asset = readRotorAsset();

    // The renderer swaps textures and picks the rotor by these names.
    for (const name of ["inside", "outside", "turret"]) {
      expect(asset.materialNames, `model must keep its "${name}" material`).toContain(
        name,
      );
    }
    expect(asset.vertexCount).toBeGreaterThan(500);

    // The rotor spins around the model origin, so it has to stay centred on
    // the Y axis or the pockets would wobble instead of turning in place.
    const radius = Math.max(...[asset.bounds.x, asset.bounds.z].flat().map(Math.abs));
    expect(radius, "rotor radius").toBeGreaterThan(0.15);
    for (const axis of ["x", "z"] as const) {
      const [min, max] = asset.bounds[axis];
      expect(
        Math.abs((min + max) / 2) / radius,
        `rotor is off-centre on ${axis}, so it would wobble when spun`,
      ).toBeLessThan(0.01);
    }
    // Flat pocket ring: the rotor lies in the wheel plane, not on its side.
    const height = asset.bounds.y[1] - asset.bounds.y[0];
    expect(height, "rotor should be a flat ring").toBeLessThan(radius);
  });

  test("calibrates every supplied-model pocket to the top pointer", () => {
    // Asset inspection establishes: zero is local -X, clockwise pockets advance
    // in +Y rotation, and the camera's top pointer is local -Z (-90°).
    expect(ROULETTE_MODEL_ZERO_OFFSET_DEG).toBe(-90);
    for (let index = 0; index < WHEEL_ORDER.length; index++) {
      const wheelDegrees = -index * SLICE;
      const assetPocketDegrees = index * SLICE;
      const landedBearing =
        ((assetPocketDegrees + rouletteModelRotorDegrees(wheelDegrees)) % 360 +
          360) %
        360;
      expect(
        landedBearing,
        `model pocket ${WHEEL_ORDER[index]} missed the pointer`,
      ).toBeCloseTo(270, 8);
    }
  });

  /* ── Spin plan ────────────────────────────────────────────────────────
     The landing curve is pure maths, so assert its shape directly instead of
     inferring it from a browser: it must continue from the speed already on
     screen, hold the fast finishing run, brake for the last two seconds and
     still finish exactly on the server's pocket. */
  test.describe("spin plan", () => {
    const wrap = (deg: number) => ((deg % 360) + 360) % 360;
    // A full-length landing: what is left of the reveal window once the
    // server discloses the pocket.
    const landing = () =>
      buildRouletteLanding({
        wheelFrom: 137,
        ballFrom: 212,
        targetMod: 300,
        durationMs: planLandingMs(3_600),
        wheelV0: FINAL_RUN_WHEEL_DPS,
        ballV0: FINAL_RUN_BALL_DPS,
      });

    test("only animates when there is time to land", () => {
      expect(planLandingMs(800), "joined too late to animate").toBe(0);
      expect(planLandingMs(Number.NaN)).toBe(0);
      expect(planLandingMs(3_600)).toBeGreaterThanOrEqual(MIN_LANDING_MS);
      expect(planLandingMs(3_600)).toBeLessThanOrEqual(3_600);
    });

    test("takes over at the speed already on screen, without a dip", () => {
      const plan = landing().wheel;
      expect(plan.v0).toBe(FINAL_RUN_WHEEL_DPS);
      expect(planSpeedDps(plan, 0)).toBeCloseTo(FINAL_RUN_WHEEL_DPS, 6);
      // The opening is an acceleration: nowhere in the ramp or the run may the
      // wheel be slower than the free spin that handed it over.
      for (let t = 0; t <= plan.rampMs + plan.cruiseMs; t += 10) {
        expect(
          planSpeedDps(plan, t),
          `wheel sagged to ${planSpeedDps(plan, t).toFixed(0)}dps at ${t}ms`,
        ).toBeGreaterThanOrEqual(FINAL_RUN_WHEEL_DPS - 0.001);
      }
      expect(plan.vPeak).toBeGreaterThan(FINAL_RUN_WHEEL_DPS);
    });

    test("runs flat out, then brakes for the final two seconds", () => {
      const plan = landing().wheel;
      expect(plan.brakeMs).toBe(LANDING_BRAKE_MS);
      expect(plan.rampMs + plan.cruiseMs + plan.brakeMs).toBeCloseTo(
        plan.durationMs,
        6,
      );
      expect(planPhase(plan, 0)).toBe("launch");
      expect(planPhase(plan, plan.rampMs + 1)).toBe("run");
      expect(planPhase(plan, plan.durationMs - LANDING_BRAKE_MS + 1)).toBe(
        "brake",
      );

      // Speed rises to the peak, holds, then falls away to a standstill —
      // one hump, no wobble either side of it.
      let peakAt = 0;
      let previous = -Infinity;
      for (let t = 0; t <= plan.rampMs; t += 10) {
        const v = planSpeedDps(plan, t);
        expect(v).toBeGreaterThanOrEqual(previous - 1e-6);
        previous = v;
        peakAt = t;
      }
      expect(peakAt).toBeGreaterThan(0);
      previous = Infinity;
      for (let t = plan.durationMs - LANDING_BRAKE_MS; t <= plan.durationMs; t += 10) {
        const v = planSpeedDps(plan, t);
        expect(v, `brake sped up again at ${t}ms`).toBeLessThanOrEqual(
          previous + 1e-6,
        );
        previous = v;
      }
      expect(planSpeedDps(plan, plan.durationMs)).toBe(0);
      // Halfway through the brake the slow-down must already be obvious.
      expect(
        planSpeedDps(plan, plan.durationMs - LANDING_BRAKE_MS / 2) / plan.vPeak,
      ).toBeLessThan(0.4);
    });

    test("finishes exactly on the server's pocket", () => {
      const plan = landing().wheel;
      expect(wrap(plan.start + plan.delta)).toBeCloseTo(300, 9);
      // Evaluated at (or long past) its deadline — a tab hidden for the whole
      // spin resumes on the pocket rather than drifting off it.
      expect(wrap(planAngle(plan, plan.durationMs))).toBeCloseTo(300, 9);
      expect(wrap(planAngle(plan, plan.durationMs * 10))).toBeCloseTo(300, 9);
      // And the position curve really is the integral of the speed curve.
      let integrated = plan.start;
      const dt = 0.5;
      for (let t = 0; t < plan.durationMs; t += dt) {
        integrated += (planSpeedDps(plan, t + dt / 2) * dt) / 1000;
      }
      expect(wrap(integrated)).toBeCloseTo(300, 2);
      expect(Math.abs(plan.delta) / 360).toBeGreaterThan(1);
    });

    test("drops the ball inside the slow-down, onto the winning pocket", () => {
      const plan = landing();
      expect(plan.brakeAtMs).toBeCloseTo(plan.durationMs - LANDING_BRAKE_MS, 6);
      expect(plan.dropAtMs).toBeGreaterThan(plan.brakeAtMs);
      expect(plan.dropAtMs).toBeLessThan(plan.durationMs);
      // Ball and rotor start braking together.
      expect(plan.ball.durationMs - plan.ball.brakeMs).toBeCloseTo(
        plan.brakeAtMs,
        6,
      );
      // Opposite directions, ball the quicker of the two.
      expect(Math.sign(plan.ball.delta)).toBe(-Math.sign(plan.wheel.delta));
      expect(plan.ball.vPeak).toBeGreaterThan(plan.wheel.vPeak);
      expect(plan.ball.v0).toBe(FINAL_RUN_BALL_DPS);
      // It lands on the pocket that is under it at drop time, then rides home.
      expect(wrap(planAngle(plan.ball, plan.dropAtMs))).toBeCloseTo(
        wrap(planAngle(plan.wheel, plan.dropAtMs) - plan.endAngle),
        9,
      );
      // The frets rattle while the ball is slowing, before it drops.
      let rattleAt: number | null = null;
      for (let t = plan.ball.rampMs; t < plan.dropAtMs && rattleAt == null; t += 10) {
        if (planSpeedDps(plan.ball, t) <= BALL_RATTLE_DPS) rattleAt = t;
      }
      expect(rattleAt, "ball never slowed enough to rattle").not.toBeNull();
      expect(rattleAt!).toBeGreaterThan(plan.brakeAtMs);
      expect(rattleAt!).toBeLessThan(plan.dropAtMs);
    });

    test("keeps a clipped reveal window landing exactly, just faster", () => {
      const short = buildRouletteLanding({
        wheelFrom: 0,
        ballFrom: 0,
        targetMod: 123,
        durationMs: MIN_LANDING_MS,
        wheelV0: FINAL_RUN_WHEEL_DPS,
        ballV0: FINAL_RUN_BALL_DPS,
      });
      expect(short.wheel.brakeMs).toBeGreaterThan(300);
      expect(short.wheel.brakeMs).toBeLessThan(LANDING_BRAKE_MS);
      expect(short.wheel.cruiseMs).toBeGreaterThan(0);
      expect(short.dropAtMs).toBeLessThan(short.durationMs);
      expect(wrap(short.endAngle)).toBeCloseTo(123, 9);
      expect(planSpeedDps(short.wheel, 0)).toBeCloseTo(FINAL_RUN_WHEEL_DPS, 6);

      // A wheel that was standing still (reduced-motion switched off, say)
      // still accelerates rather than crawling to the pocket.
      const cold = buildRouletteLanding({
        wheelFrom: 40,
        ballFrom: 0,
        targetMod: 200,
        durationMs: 3_150,
        wheelV0: 0,
        ballV0: 0,
      });
      expect(cold.wheel.vPeak).toBeGreaterThan(ANTICIPATION_WHEEL_DPS);
      expect(wrap(cold.endAngle)).toBeCloseTo(200, 9);
    });

    test("scales the roll audio with the ball's real speed", () => {
      expect(ballRollLevel01(0)).toBe(0);
      // Quiet-but-present while the wheel is only idling, loudest at full pelt.
      expect(ballRollLevel01(FINAL_RUN_BALL_DPS)).toBeGreaterThan(
        ballRollLevel01(ANTICIPATION_WHEEL_DPS),
      );
      expect(ballRollLevel01(FINAL_RUN_BALL_DPS)).toBeLessThanOrEqual(1);
      expect(ballRollLevel01(99_999)).toBe(1);
      const plan = landing();
      expect(ballRollLevel01(planSpeedDps(plan.ball, 0))).toBeGreaterThan(0.6);
      expect(ballRollLevel01(planSpeedDps(plan.ball, plan.dropAtMs))).toBe(0);
    });
  });

  test("idles between rounds and rests on the server's winning pocket", async ({
    page,
  }) => {
    await seedOnboarded(page);
    await page.goto("/roulette", { waitUntil: "domcontentloaded" });

    const wheel = page.locator('[data-testid="roulette-wheel"]');
    await expect(wheel).toBeVisible({ timeout: 20_000 });

    // ── Idle: the wheel keeps turning while waiting/betting ──────────────
    await page
      .locator('[data-testid="roulette-wheel"][data-wheel-state="idle"]')
      .waitFor({ timeout: 60_000 });

    // The same wheel moves into the polished top presentation for the final
    // 20 seconds; it is not replaced by a second wheel. Anchor on the boosted
    // status rather than "popup is open": the popup also stays open through the
    // result, so a late join would otherwise assert against the wrong window.
    await expect(page.locator('[data-testid="wheel-popup-status"]')).toHaveText(
      "Final spin sequence",
      { timeout: 75_000 },
    );
    await expect(
      page.locator('[data-testid="roulette-wheel-popup"][data-open="true"]'),
    ).toBeVisible();
    await expect(page.locator('[data-testid="roulette-wheel"]')).toHaveCount(1);

    // Desktop-capable browsers load the supplied optimized model. The motion
    // proxy remains the authoritative test surface for exact pocket geometry.
    const renderer = await page
      .locator("[data-wheel-renderer]")
      .getAttribute("data-wheel-renderer");
    expect(["model-3d", "lightweight-2d"]).toContain(renderer);
    if (renderer === "model-3d") {
      await expect(
        page.locator('[data-testid="roulette-model-canvas"]'),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      // Headless Chromium may not expose a WebGL context. In that case the
      // tested contract is reliable automatic fallback, not a broken canvas.
      await expect(
        page.locator('[data-testid="roulette-model-canvas"]'),
      ).toHaveCount(0);
    }

    const wheelA = await renderedAngle(page, "roulette-wheel");
    const ballA = await renderedAngle(page, "wheel-ball-track");
    // Stay below a half-orbit at boosted speed so direction cannot alias after
    // wrapping through 360°.
    await page.waitForTimeout(250);
    const wheelB = await renderedAngle(page, "roulette-wheel");
    const ballB = await renderedAngle(page, "wheel-ball-track");
    const moved = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180);
    expect(
      moved(wheelA, wheelB),
      `wheel did not idle-spin (${wheelA} → ${wheelB})`,
    ).toBeGreaterThan(2);
    expect(
      moved(ballA, ballB),
      `ball did not orbit while idle (${ballA} → ${ballB})`,
    ).toBeGreaterThan(2);
    // Ball runs the opposite way to the rotor.
    const signed = (a: number, b: number) => ((b - a + 540) % 360) - 180;
    expect(
      Math.sign(signed(wheelA, wheelB)) * Math.sign(signed(ballA, ballB)),
      "ball should orbit opposite to the wheel",
    ).toBeLessThan(0);

    // ── Landing: the wheel comes to rest on the announced pocket ─────────
    await page
      .locator('[data-testid="roulette-wheel"][data-wheel-state="resting"]')
      .waitFor({ timeout: 90_000 });

    // The server target stays private while the physical wheel is moving.
    // These result surfaces only mount from the wheel's onSettled callback.
    await expect(page.locator('[data-testid="wheel-result"]')).toBeVisible();
    await expect(page.locator('[data-testid="text-result-pocket"]')).toBeVisible();
    await expect(page.locator('[data-testid="current-result-banner"]')).toBeVisible();

    const restAngle = await renderedAngle(page, "roulette-wheel");
    const landed = pocketUnderPointer(restAngle);
    const resultText = await page
      .locator('[data-testid="wheel-result"]')
      .innerText();
    const announced = Number(resultText.trim());

    expect(Number.isFinite(announced), `bad result readout "${resultText}"`).toBe(
      true,
    );
    expect(
      landed,
      `wheel rested at ${restAngle.toFixed(2)}° → pocket ${landed}, but the round result is ${announced}`,
    ).toBe(announced);
    const model = page.locator('[data-testid="roulette-model"]');
    if (await model.count()) {
      await expect(model).toHaveAttribute(
        "data-model-pocket-under-pointer",
        String(announced),
      );
      const modelWheelDegrees = Number(
        await model.getAttribute("data-model-wheel-degrees"),
      );
      const modelRotorDegrees = Number(
        await model.getAttribute("data-model-rotor-degrees"),
      );
      expect(modelWheelDegrees).toBeCloseTo(restAngle, 3);
      expect(modelRotorDegrees - modelWheelDegrees).toBeCloseTo(
        ROULETTE_MODEL_ZERO_OFFSET_DEG,
        8,
      );
    }

    // The page's own result line and the live strip must agree with it.
    await expect(page.locator('[data-testid="text-result-pocket"]')).toHaveText(
      String(announced),
    );
    await expect(page.locator(`[data-testid="cell-${announced}"]`)).toHaveAttribute(
      "data-winning",
      "true",
    );
    await expect(
      page.locator('[data-testid="live-pockets-strip"] [data-winning="true"]'),
    ).toHaveText(String(announced));

    // The ball is parked under the pointer, in the winning pocket.
    const ballRest = await renderedAngle(page, "wheel-ball-track");
    expect(
      Math.min(ballRest, 360 - ballRest),
      `ball should rest under the pointer, got ${ballRest}°`,
    ).toBeLessThan(1);

    // Winning emphasis persists for the whole result window and clears on the
    // exact betting-open transition.
    await expect(page.locator('[data-testid="wheel-result"]')).toHaveClass(
      /roulette-winning-result/,
    );
    await page
      .locator('[data-testid="round-phase-banner"][data-phase="betting"]')
      .waitFor({ timeout: 30_000 });
    await expect(page.locator('[data-testid="wheel-result"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="text-result-pocket"]')).toHaveCount(0);
    await expect(page.locator('[data-winning="true"]')).toHaveCount(0);
  });

  test("keeps every result surface hidden until the wheel stops", async ({
    page,
  }) => {
    await seedOnboarded(page);
    await page.goto("/roulette", { waitUntil: "domcontentloaded" });

    await page
      .locator('[data-testid="roulette-wheel"][data-wheel-state="idle"]')
      .waitFor({ timeout: 60_000 });
    await page
      .locator('[data-testid="roulette-wheel"][data-wheel-state="spinning"]')
      .waitFor({ timeout: 90_000 });

    await expect(page.locator('[data-testid="result-hidden-status"]')).toBeVisible();
    await expect(page.locator('[data-testid="wheel-result"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="text-result-pocket"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="current-result-banner"]')).toHaveCount(0);
    await expect(page.locator('[data-winning="true"]')).toHaveCount(0);
    await page.locator('[data-testid="btn-fairness"]').click();
    await expect(page.locator('[data-testid="current-server-seed"]')).toHaveText(
      "(hidden until the wheel lands)",
    );
    await page.keyboard.press("Escape");

    await page
      .locator('[data-testid="roulette-wheel"][data-wheel-state="resting"]')
      .waitFor({ timeout: 30_000 });
    await expect(page.locator('[data-testid="wheel-result"]')).toBeVisible();
  });

  test("withholds the pocket from API and socket traffic until the landing", async ({
    page,
  }) => {
    test.setTimeout(200_000);
    // The server hands the pocket over only for the final landing. Anything
    // earlier would let a player read the result off the network while the
    // wheel is still spinning, so this is the hard boundary: at more than the
    // landing budget before the reveal ends, no payload may carry it.
    const LANDING_BUDGET_MS = 4_000;

    type ResultFrame = { roundId: string; at: number; checked: boolean };
    const frames: ResultFrame[] = [];
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const raw = typeof frame.payload === "string" ? frame.payload : "";
        if (!raw.includes('"result"')) return;
        let msg: {
          op?: string;
          payload?: { type?: string; roundId?: string; outcome?: unknown };
        };
        try {
          msg = JSON.parse(raw);
        } catch {
          return;
        }
        const ev = msg.payload;
        if (msg.op !== "event" || ev?.type !== "result") return;
        if (ev.outcome == null || typeof ev.roundId !== "string") return;
        frames.push({ roundId: ev.roundId, at: Date.now(), checked: false });
      });
    });

    await seedOnboarded(page);
    await page.goto("/roulette", { waitUntil: "domcontentloaded" });

    let sawBlindReveal = false;
    let sawDisclosedResult = false;
    let sawSocketResult = false;
    const deadline = Date.now() + 170_000;
    while (Date.now() < deadline && !(sawBlindReveal && sawDisclosedResult)) {
      const res = await page.request.get("/api/roulette/round");
      const snap = res.ok()
        ? ((await res.json()) as {
            roundId: string;
            phase: string;
            now: number;
            revealEndsAt: number;
            outcome: { pocket: number } | null;
            serverSeed: string | null;
          } | null)
        : null;
      if (snap) {
        const offset = snap.now - Date.now();
        if (snap.phase === "reveal") {
          const msLeft = snap.revealEndsAt - snap.now;
          if (msLeft > LANDING_BUDGET_MS) {
            expect(
              snap.outcome,
              `pocket disclosed ${msLeft}ms before the wheel lands`,
            ).toBeNull();
            expect(snap.serverSeed).toBeNull();
            sawBlindReveal = true;
          } else if (snap.outcome != null) {
            sawDisclosedResult = true;
          }
        }
        // Socket frames ride the same gate — check each against the round it
        // belongs to, so a frame is never measured against the next round.
        for (const f of frames) {
          if (f.checked || f.roundId !== snap.roundId) continue;
          f.checked = true;
          sawSocketResult = true;
          expect(
            snap.revealEndsAt - (f.at + offset),
            "socket result frame arrived before the landing window",
          ).toBeLessThanOrEqual(LANDING_BUDGET_MS);
        }
      }
      await page.waitForTimeout(250);
    }

    expect(
      sawBlindReveal,
      "never saw a reveal phase with the pocket withheld",
    ).toBe(true);
    expect(
      sawDisclosedResult,
      "the pocket was never disclosed for the landing",
    ).toBe(true);
    expect(sawSocketResult, "no result frame arrived over the socket").toBe(
      true,
    );
  });

  test.describe("spin presentation", () => {
    /* The wheel is turning long before the server hands over the pocket, so
       the whole sequence — anticipation, the fast finishing run, the landing
       and its two-second brake — has to read as one continuous spin. Sampling
       the transforms frame by frame is the only way to prove the player never
       sees it sag or jump. */
    test("rolls with the ball through the ordinary idle spin", async ({
      page,
    }) => {
      await recordClips(page);
      await seedOnboarded(page, true);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible({
        timeout: 20_000,
      });
      const dur = await clipDurations(page, ["ball-roll-loop"]);
      const rolls = async () =>
        (await playedClips(page)).filter(
          (c) => c.dur === dur["ball-roll-loop"] && c.loop,
        );

      // The wheel idles through the first half of the betting window: slow,
      // but the ball is visibly on the track, so it has to be audible too.
      await page.locator('[data-spin-phase="idle"]').waitFor({ timeout: 90_000 });
      await expect
        .poll(async () => (await rolls()).some((c) => !c.stopped), {
          timeout: 10_000,
          intervals: [100],
        })
        .toBe(true);
      await expect(page.locator('[data-spin-phase="idle"]')).toHaveCount(1);

      // Take the motion out of view and the roll has to go with it: nothing is
      // driving its speed once the frames stop.
      await page.evaluate(setTabHidden, true);
      await expect
        .poll(async () => (await rolls()).every((c) => c.stopped), {
          timeout: 5_000,
          intervals: [100],
        })
        .toBe(true);

      // Back in view, the idle spin picks the roll up again from its own speed.
      const beforeReturn = (await rolls()).length;
      await page.evaluate(setTabHidden, false);
      await expect
        .poll(async () => (await rolls()).length, {
          timeout: 10_000,
          intervals: [100],
        })
        .toBeGreaterThan(beforeReturn);
    });


    test("opens fast, runs flat out, then brakes onto the pocket", async ({
      page,
    }) => {
      await recordClips(page);
      await seedOnboarded(page, true);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible({
        timeout: 20_000,
      });
      const dur = await clipDurations(page, ["ball-roll-loop"]);

      // The presentation opens 20s before betting closes — and the ball is
      // already audible, well before any landing is planned.
      await page
        .locator('[data-spin-phase="anticipation"]')
        .waitFor({ timeout: 90_000 });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toHaveAttribute(
        "data-wheel-state",
        "idle",
      );
      await expect
        .poll(
          async () =>
            (await playedClips(page)).some(
              (c) => c.dur === dur["ball-roll-loop"] && c.loop,
            ),
          { timeout: 10_000, intervals: [100] },
        )
        .toBe(true);

      const samples = await sampleSpin(page, 40_000);
      const wheel = speedsOf(samples, "wheel", 1);
      const ball = speedsOf(samples, "ball", -1);
      const order = phaseOrder(samples);
      const expected = [
        "anticipation",
        "final-run",
        "launch",
        "run",
        "brake",
        "settled",
      ];
      let cursor = -1;
      for (const phase of expected) {
        const at = order.indexOf(phase, cursor + 1);
        expect(at, `phase "${phase}" missing from ${order.join(" → ")}`).toBeGreaterThan(
          cursor,
        );
        cursor = at;
      }

      const speed = (list: SpeedSample[], phase: string) =>
        median(inPhase(list, phase).map((s) => s.dps));
      const anticipation = speed(wheel, "anticipation");
      const finalRun = speed(wheel, "final-run");
      const cruise = speed(wheel, "run");

      // Thresholds sit well under the configured speeds: this asserts the
      // shape of the sequence, not a frame budget on a busy CI box.
      expect(anticipation, "wheel should already be turning").toBeGreaterThan(60);
      expect(
        finalRun,
        `final run (${finalRun.toFixed(0)}dps) should clearly outrun the anticipation spin (${anticipation.toFixed(0)}dps)`,
      ).toBeGreaterThan(Math.max(150, anticipation * 1.4));
      expect(cruise, "the landing's run is the fastest the wheel gets").toBeGreaterThan(
        finalRun,
      );

      // No sag where the free spin hands over to the planned landing. Measured
      // over a quarter-second either side, ignoring frames where the renderer
      // did not advance the transform at all: React swapping the wheel into
      // its landing can cost a frame or two, and a repeated angle reads as a
      // standstill without the wheel ever having slowed.
      const around = (phase: string, side: "first" | "last") => {
        const list = inPhase(wheel, phase).filter((s) => s.dps > 1);
        if (list.length === 0) return [];
        const edge =
          side === "first" ? list[0].t + 250 : list[list.length - 1].t - 250;
        return list.filter((s) => (side === "first" ? s.t <= edge : s.t >= edge));
      };
      const handIn = median(around("final-run", "last").map((s) => s.dps));
      const handOut = median(around("launch", "first").map((s) => s.dps));
      expect(
        handOut,
        `wheel dropped from ${handIn.toFixed(0)}dps to ${handOut.toFixed(0)}dps at the landing handover`,
      ).toBeGreaterThan(handIn * 0.8);

      // Ball outruns the rotor it is orbiting.
      expect(speed(ball, "run")).toBeGreaterThan(cruise);

      // Two seconds of visible braking, ending at a standstill.
      const brake = inPhase(wheel, "brake");
      expect(brake.length).toBeGreaterThan(10);
      const brakeSpan = brake[brake.length - 1].t - brake[0].t;
      expect(brakeSpan, "brake should run for the final two seconds").toBeGreaterThan(
        LANDING_BRAKE_MS * 0.7,
      );
      expect(brakeSpan).toBeLessThan(LANDING_BRAKE_MS * 1.35);
      const third = Math.max(1, Math.floor(brake.length / 3));
      const braking = median(brake.slice(0, third).map((s) => s.dps));
      const stopping = median(brake.slice(-third).map((s) => s.dps));
      expect(
        stopping * 2,
        `brake barely slowed: ${braking.toFixed(0)}dps → ${stopping.toFixed(0)}dps`,
      ).toBeLessThan(braking);
      expect(brake[brake.length - 1].dps, "wheel should be all but stopped").toBeLessThan(
        80,
      );

      // Settled means settled: the result is out and the roll is silent.
      await expect(page.locator('[data-testid="wheel-result"]')).toBeVisible();
      const rolls = (await playedClips(page)).filter(
        (c) => c.dur === dur["ball-roll-loop"] && c.loop,
      );
      expect(rolls.length).toBeGreaterThan(0);
      expect(
        rolls.every((c) => c.stopped),
        "the rolling ball must not outlive the spin",
      ).toBe(true);
    });

    test("recovers a backgrounded spin onto the announced pocket", async ({
      page,
    }) => {
      await recordClips(page);
      await seedOnboarded(page, true);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible({
        timeout: 20_000,
      });
      const dur = await clipDurations(page, ["ball-roll-loop"]);

      await page
        .locator('[data-spin-phase="anticipation"]')
        .waitFor({ timeout: 90_000 });
      await page
        .locator('[data-spin-phase="final-run"]')
        .waitFor({ timeout: 40_000 });

      // Background the tab across the landing: no animation frames, no audio.
      await page.evaluate(setTabHidden, true);
      await page.waitForTimeout(1_500);
      const hiddenRolls = (await playedClips(page)).filter(
        (c) => c.dur === dur["ball-roll-loop"] && c.loop,
      );
      expect(
        hiddenRolls.every((c) => c.stopped),
        "hiding the tab must silence the rolling ball",
      ).toBe(true);
      await page.evaluate(setTabHidden, false);

      await page
        .locator('[data-testid="roulette-wheel"][data-wheel-state="resting"]')
        .waitFor({ timeout: 30_000 });
      const announced = Number(
        (await page.locator('[data-testid="wheel-result"]').innerText()).trim(),
      );
      const restAngle = await renderedAngle(page, "roulette-wheel");
      expect(
        pocketUnderPointer(restAngle),
        `a spin that ran while hidden rested at ${restAngle.toFixed(2)}°, but the result is ${announced}`,
      ).toBe(announced);

      const rolls = (await playedClips(page)).filter(
        (c) => c.dur === dur["ball-roll-loop"] && c.loop,
      );
      expect(rolls.length).toBeGreaterThan(0);
      expect(
        rolls.length,
        "the ball must be heard rolling again once the tab is back and the frames resume",
      ).toBeGreaterThan(hiddenRolls.length);
      expect(
        rolls.every((c) => c.stopped),
        "coming back to the tab must not leave a roll running",
      ).toBe(true);
    });
  });

  test.describe("launch cue", () => {
    // The launch whoosh belongs to the moment the croupier sends the ball
    // round. A player who opens the table part-way through a reveal must still
    // hear the ball that is already in flight, but never hear it launch again.
    test("sounds for a spin the player watched start", async ({ page }) => {
      await recordClips(page);
      await seedOnboarded(page, true);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible({
        timeout: 20_000,
      });
      const dur = await clipDurations(page, ["wheel-launch", "ball-roll-loop"]);

      // Arrive during betting, then sit through a whole reveal.
      await page
        .locator('[data-testid="roulette-wheel"][data-wheel-state="idle"]')
        .waitFor({ timeout: 60_000 });
      await page
        .locator('[data-testid="roulette-wheel"][data-wheel-state="spinning"]')
        .waitFor({ timeout: 90_000 });
      await page.waitForTimeout(1000);

      const played = await playedClips(page);
      expect(
        played.some((c) => c.dur === dur["wheel-launch"]),
        "watched spin should launch audibly",
      ).toBe(true);
      expect(
        played.some((c) => c.dur === dur["ball-roll-loop"] && c.loop),
        "the ball should be rolling",
      ).toBe(true);
    });

    test("stays silent when joining a spin already in flight", async ({
      page,
    }) => {
      await recordClips(page);
      await seedOnboarded(page, true);

      // Warm the decode cache on a page that never opens the table, so the
      // join below is not just quiet because the clip had not loaded yet.
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const dur = await clipDurations(page, ["wheel-launch", "ball-roll-loop"]);

      // Wait for the server round to actually be revealing, with enough of the
      // window left that the wheel animates a landing rather than parking.
      await expect
        .poll(
          async () => {
            const res = await page.request.get("/api/roulette/round");
            if (!res.ok()) return null;
            const body = (await res.json()) as {
              phase?: string;
              now?: number;
              revealEndsAt?: number;
            };
            if (body.phase !== "reveal") return null;
            const left = (body.revealEndsAt ?? 0) - (body.now ?? 0);
            return left > 2500 ? "joinable" : null;
          },
          { timeout: 120_000, intervals: [250] },
        )
        .toBe("joinable");

      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible({
        timeout: 20_000,
      });
      await page
        .locator('[data-testid="roulette-wheel"][data-wheel-state="resting"]')
        .waitFor({ timeout: 30_000 });

      const played = await playedClips(page);
      expect(
        played.filter((c) => c.dur === dur["wheel-launch"]).length,
        "a mid-flight join must not replay the launch",
      ).toBe(0);
      expect(
        played.some((c) => c.dur === dur["ball-roll-loop"] && c.loop),
        "but the ball already in flight should still be heard rolling",
      ).toBe(true);
    });

    test("stops the rolling ball when the player leaves the table", async ({
      page,
    }) => {
      await recordClips(page);
      await seedOnboarded(page, true);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });
      await page
        .locator('[data-testid="roulette-wheel"][data-wheel-state="spinning"]')
        .waitFor({ timeout: 120_000 });
      const dur = await clipDurations(page, ["ball-roll-loop"]);
      await expect
        .poll(
          async () =>
            (await playedClips(page)).some(
              (c) => c.dur === dur["ball-roll-loop"] && c.loop,
            ),
          { timeout: 10_000, intervals: [100] },
        )
        .toBe(true);

      // Client-side navigation, so the recorded clip log survives the exit.
      await page.locator('[data-testid="btn-back"]').click();
      await expect(page.locator('[data-testid="roulette-wheel"]')).toHaveCount(0);

      const rolls = (await playedClips(page)).filter(
        (c) => c.dur === dur["ball-roll-loop"] && c.loop,
      );
      expect(rolls.length).toBeGreaterThan(0);
      expect(
        rolls.every((c) => c.stopped),
        "leaving the table must not leave the ball rolling",
      ).toBe(true);
    });
  });

  test.describe("reduced motion", () => {
    test("keeps the wheel static", async ({ page }) => {
      // Emulated on the page (not via test.use) so it applies with the shared
      // auth-bootstrap fixture too.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await seedOnboarded(page);
      await page.goto("/roulette", { waitUntil: "domcontentloaded" });

      const wheel = page.locator('[data-testid="roulette-wheel"]');
      await expect(wheel).toBeVisible({ timeout: 20_000 });
      await expect(wheel).toHaveAttribute("data-wheel-state", "flat");
      // No ball track is rendered in the static view.
      await expect(page.locator('[data-testid="wheel-ball-track"]')).toHaveCount(
        0,
      );

      const first = await renderedAngle(page, "roulette-wheel");
      await page.waitForTimeout(1_200);
      const second = await renderedAngle(page, "roulette-wheel");
      expect(second, "reduced-motion wheel must not spin").toBeCloseTo(first, 3);

      await expect(page.locator('[data-testid="wheel-result"]')).toBeVisible({
        timeout: 90_000,
      });
      const animationName = await page
        .locator('[data-testid="wheel-result"]')
        .evaluate((element) => getComputedStyle(element).animationName);
      expect(animationName, "reduced-motion result must not blink").toBe("none");
    });
  });

  test("uses the lightweight wheel on phone-sized screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedOnboarded(page);
    await page.goto("/roulette", { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-wheel-renderer="lightweight-2d"]')).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="roulette-model-canvas"]')).toHaveCount(
      0,
    );
    await expect(page.locator('[data-testid="roulette-wheel"]')).toBeVisible();
  });
});
