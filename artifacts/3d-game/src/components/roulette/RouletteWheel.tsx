import {
  Component,
  lazy,
  Suspense,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  EUROPEAN_WHEEL_ORDER,
  pocketColorHex,
  rouletteWheelRotationForPocket,
  WINNING_RESULT_CLASS,
} from "./wheelData";
import {
  ANTICIPATION_BALL_DPS,
  ANTICIPATION_WHEEL_DPS,
  BALL_RATTLE_DPS,
  ballRollLevel01,
  buildRouletteLanding,
  FINAL_RUN_BALL_DPS,
  FINAL_RUN_WHEEL_DPS,
  IDLE_BALL_DPS,
  IDLE_WHEEL_DPS,
  MIN_LANDING_MS,
  planAngle,
  planPhase,
  planSpeedDps,
  type RouletteLanding,
} from "./spinPlan";
import { cn } from "@/lib/utils";
import type { RouletteWheelModelHandle } from "./RouletteWheelModel";
import RouletteStudioWheel from "./RouletteStudioWheel";
import { BALL_ENTRY_DEGREES, BALL_FLIGHT_MS, DEALER_RELEASE_MS, DealerVideoContext } from "./dealerTiming";

const RouletteWheelModel = lazy(() => import("./RouletteWheelModel"));

class WheelModelErrorBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onFailure();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const SLICE = 360 / EUROPEAN_WHEEL_ORDER.length;
const SIZE = 300;

/* ── Motion tuning ──────────────────────────────────────────────────────
   Speeds and the landing curve itself live in `spinPlan.ts`, so the whole
   sequence — idle, anticipation, the final fast run and the two-second brake
   onto the winning pocket — can be reasoned about (and tested) on its own.
   What is left here is only how the free-running spin chases those speeds. */

/** How fast the free spin winds down towards a slower target (1/s). */
const EASE_FOLLOW_PER_S = 2.6;
/** Stepping up is decisive: the presentation must never crawl into life. */
const RUN_FOLLOW_PER_S = 5.6;

/** Ball offset from the top edge: outer track vs. settled in a pocket. */
const BALL_TOP_POCKET = SIZE * 0.09;

function wrap360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function easeOutCubic(x: number): number {
  return 1 - (1 - x) ** 3;
}

type Mode =
  | { kind: "idle" }
  | { kind: "landing"; startTs: number; landing: RouletteLanding }
  | { kind: "rest" };

/**
 * Audio hooks fired from the animation loop, so the spin cues follow the
 * wheel's real motion instead of a parallel timeline. Nothing here plays
 * audio itself — the page decides what (if anything) each moment sounds like.
 */
export interface WheelAudio {
  /** The ball is visibly away: the fast finishing run has begun. */
  onLaunch?: () => void;
  /**
   * Ball speed as a 0..1 share of full tilt, every frame it is on the track —
   * through the free spin as well as the landing, so the roll swells with the
   * motion the player can actually see instead of starting at the last moment.
   */
  onRoll?: (speed01: number) => void;
  /** Ball has slowed enough to start skipping across the frets. */
  onRattle?: () => void;
  /** Ball leaves the track; `settleInMs` remain until it comes to rest. */
  onDrop?: (settleInMs: number) => void;
  /** Any point at which a running roll layer must stop. */
  onRollEnd?: () => void;
}

interface Props {
  roundId?: string | null;
  ballReleaseAt?: number | null;
  ballInPlay?: boolean;
  /** Render the authoritative rotor and ball over the studio's wheel housing. */
  presentation?: "wheel" | "studio";
  /** Winning pocket to land on; null = idle spin. */
  pocket: number | null;
  /** Result may only be shown after the physical landing has completed. */
  revealedPocket?: number | null;
  /** Increment to trigger a new spin animation for the same pocket. */
  spinId: number;
  /**
   * How long the landing may take (ms), derived from the round's reveal
   * window by `planLandingMs`. 0 (default) parks on the pocket instantly.
   */
  landingMs?: number;
  /** Fired once the wheel comes to rest on `pocket`. */
  onSettled?: () => void;
  /** Motion-driven audio hooks for the spin. */
  audio?: WheelAudio;
  /** Force the flat 2D view (also auto-enabled by prefers-reduced-motion). */
  flat?: boolean;
  /** Accelerate the idle wheel during the final pre-result presentation. */
  boosted?: boolean;
  /**
   * The round is inside its last few seconds: run flat out. The landing takes
   * over from this speed, so the spin never has to start itself from a crawl.
   */
  finalRun?: boolean;
  /**
   * Was this client at the table before the ball was sent round? The wheel
   * spins blind until the server discloses the pocket, so idling is no longer
   * proof that the spin started here — the page has to say so.
   */
  watchedStart?: boolean;
  className?: string;
}

function wheelSvg(size: number): {
  paths: ReactElement[];
  labels: ReactElement[];
} {
  const r = size / 2;
  const inner = r * 0.62;
  const paths: ReactElement[] = [];
  const labels: ReactElement[] = [];
  EUROPEAN_WHEEL_ORDER.forEach((n, i) => {
    const a0 = ((i * SLICE - 90 - SLICE / 2) * Math.PI) / 180;
    const a1 = (((i + 1) * SLICE - 90 - SLICE / 2) * Math.PI) / 180;
    const x0 = r + r * Math.cos(a0);
    const y0 = r + r * Math.sin(a0);
    const x1 = r + r * Math.cos(a1);
    const y1 = r + r * Math.sin(a1);
    const xi0 = r + inner * Math.cos(a0);
    const yi0 = r + inner * Math.sin(a0);
    const xi1 = r + inner * Math.cos(a1);
    const yi1 = r + inner * Math.sin(a1);
    paths.push(
      <path
        key={n}
        d={`M${xi0},${yi0} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} L${xi1},${yi1} A${inner},${inner} 0 0 0 ${xi0},${yi0}Z`}
        fill={pocketColorHex(n)}
        stroke="#3f3f46"
        strokeWidth={0.6}
      />,
    );
    const mid = ((i * SLICE - 90) * Math.PI) / 180;
    const lr = r * 0.86;
    labels.push(
      <text
        key={`t${n}`}
        x={r + lr * Math.cos(mid)}
        y={r + lr * Math.sin(mid)}
        fill="#fff"
        fontSize={size * 0.038}
        fontWeight={700}
        textAnchor="middle"
        dominantBaseline="central"
        transform={`rotate(${i * SLICE} ${r + lr * Math.cos(mid)} ${r + lr * Math.sin(mid)})`}
      >
        {n}
      </text>,
    );
  });
  return { paths, labels };
}

// Stable style objects: the rotor/ball transforms are written straight to the
// DOM by the animation loop, so React must never diff a `transform` of its own
// onto these nodes.
const WHEEL_STYLE = {
  borderRadius: "9999px",
  transformOrigin: "50% 50%",
  willChange: "transform",
} as const;
const TRACK_STYLE = {
  transformOrigin: "50% 50%",
  willChange: "transform",
} as const;
const BALL_STYLE = {
  background: "radial-gradient(circle at 35% 30%, #ffffff, #cbd5e1 60%, #64748b)",
  boxShadow: "0 1px 4px rgba(0,0,0,0.7)",
} as const;

export default function RouletteWheel({
  roundId,
  ballReleaseAt = null,
  ballInPlay = false,
  presentation = "wheel",
  pocket,
  revealedPocket = null,
  spinId,
  landingMs = 0,
  onSettled,
  audio,
  flat,
  boosted = false,
  finalRun = false,
  watchedStart = true,
  className,
}: Props) {
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    [],
  );
  const flatMode = flat || reduced;
  const lightweightDevice = useMemo(() => {
    if (typeof window === "undefined") return true;
    const shortEdge = Math.min(window.innerWidth, window.innerHeight);
    // Replit's preview is itself an iframe and often reports a small
    // short-edge / low-resource profile even on a desktop browser. Using
    // hardwareConcurrency or deviceMemory here made the supplied 3D wheel
    // disappear from the exact preview players use. Keep the lightweight
    // fallback for real phone-sized layouts and browsers without WebGL.
    return (
      shortEdge < 420 ||
      typeof window.WebGLRenderingContext === "undefined"
    );
  }, []);
  const [modelFailed, setModelFailed] = useState(false);
  const useModel = presentation === "wheel" && !flatMode && !lightweightDevice && !modelFailed;

  const [celebrate, setCelebrate] = useState(false);
  const [wheelState, setWheelState] = useState<"idle" | "spinning" | "resting">(
    "idle",
  );

  const hostEl = useRef<HTMLDivElement | null>(null);
  const wheelEl = useRef<SVGSVGElement | null>(null);
  const trackEl = useRef<HTMLDivElement | null>(null);
  const ballEl = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef<RouletteWheelModelHandle | null>(null);

  // Live motion state — refs, so a frame never re-renders the component.
  const angleRef = useRef(0);
  const ballAngleRef = useRef(0);
  const ballDropRef = useRef(0); // 0 = outer track, 1 = settled in the pocket
  const modeRef = useRef<Mode>({ kind: "idle" });
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const celebrateTimer = useRef<number | null>(null);
  // Deadline of the current spin. Anchored once per spinId so re-running the
  // effect (flat toggle, prop churn) resumes the same landing instead of
  // starting a fresh one that would overrun the reveal window.
  const spinRef = useRef<{ id: number; endsAt: number } | null>(null);

  // Read inside the effect without restarting an in-flight landing.
  const landingMsRef = useRef(landingMs);
  landingMsRef.current = landingMs;
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const boostedRef = useRef(boosted);
  boostedRef.current = boosted;
  const finalRunRef = useRef(finalRun);
  finalRunRef.current = finalRun;
  const idleWheelDpsRef = useRef(IDLE_WHEEL_DPS);
  const idleBallDpsRef = useRef(IDLE_BALL_DPS);
  /** True while the ball-roll layer is running, so it is only ended once. */
  const rollingRef = useRef(false);
  // Phase name published to the DOM for tests/diagnostics. Written only when it
  // changes, never per frame.
  const phaseRef = useRef<string | null>(null);
  // Spin-scoped audio cue state, so a re-run of the effect mid-landing (flat
  // toggle, prop churn) resumes the spin instead of re-firing its launch.
  const cuedSpinRef = useRef<number | null>(null);
  // The launch whoosh belongs to the round, not to the landing: it fires when
  // the fast finishing run starts, which is the moment the ball is visibly
  // away. Cleared again once the wheel drops back to its between-rounds spin.
  const runCuedRef = useRef(false);
  // True once this wheel has actually sat waiting between rounds. A client that
  // mounts straight into a live reveal never did, so the ball it can see was
  // launched before it arrived.
  const sawSpinStartRef = useRef(false);
  const watchedStartRef = useRef(watchedStart);
  watchedStartRef.current = watchedStart;
  const rattledRef = useRef(false);
  const droppedRef = useRef(false);
  const releaseRef = useRef({ ballReleaseAt, ballInPlay });
  const dealerFrame = useContext(DealerVideoContext);
  const releaseProgress = useRef({ roundId, age: -Infinity });
  releaseRef.current = { ballReleaseAt, ballInPlay };
  const studioBallPresentation = () => {
    const { ballReleaseAt: at, ballInPlay: active } = releaseRef.current;
    let age = at == null ? (active ? Infinity : -Infinity) : Date.now() - at;
    const frame = dealerFrame?.current;
    if (pocket === null && frame?.active && frame.roundId === roundId && performance.now() - frame.sampledAt < 250) {
      // Match the decoded hand, not a video decoder that may be a frame behind
      // the round clock. Failed/paused footage always falls back to the clock.
      age = frame.mediaMs - DEALER_RELEASE_MS;
    }
    if (releaseProgress.current.roundId !== roundId) releaseProgress.current = { roundId, age: -Infinity };
    age = Math.max(age, releaseProgress.current.age);
    releaseProgress.current.age = age;
    return { visible: pocket !== null || age >= 0, flight: Math.max(0, Math.min(1, age / BALL_FLIGHT_MS)) };
  };

  useLayoutEffect(() => {
    // Always republish on a re-run: the host element may have been swapped.
    phaseRef.current = null;
    const setPhase = (phase: string) => {
      if (phaseRef.current === phase) return;
      phaseRef.current = phase;
      hostEl.current?.setAttribute("data-spin-phase", phase);
    };

    const applyTransforms = () => {
      if (wheelEl.current) {
        wheelEl.current.style.transform = `rotate(${angleRef.current}deg)`;
      }
      if (trackEl.current) {
        trackEl.current.style.transform = `rotate(${ballAngleRef.current}deg)`;
      }
      if (ballEl.current) {
        const top =
          4.5 + (BALL_TOP_POCKET / SIZE * 100 - 4.5) * ballDropRef.current;
        ballEl.current.style.top = `${top}%`;
      }
      modelRef.current?.setMotion(
        angleRef.current,
        ballAngleRef.current,
        ballDropRef.current,
        presentation === "studio" ? studioBallPresentation() : undefined,
      );
    };

    const clearCelebrate = () => {
      if (celebrateTimer.current) {
        window.clearTimeout(celebrateTimer.current);
        celebrateTimer.current = null;
      }
    };

    const comeToRest = () => {
      modeRef.current = { kind: "rest" };
      setPhase("settled");
      // Belt and braces: the roll normally fades out across the drop, but the
      // ball is definitively at rest here, so nothing may still be rolling.
      rollingRef.current = false;
      audioRef.current?.onRollEnd?.();
      setWheelState("resting");
      setCelebrate(true);
      clearCelebrate();
      celebrateTimer.current = window.setTimeout(() => {
        celebrateTimer.current = null;
        setCelebrate(false);
      }, 1600);
      onSettledRef.current?.();
    };

    // The whoosh of the ball being sent round, cued once per round at the
    // moment the fast run becomes visible. Only for a spin this client watched
    // begin: someone who opens the table part-way through a reveal still hears
    // the ball already in flight — roll, rattle and drop — but not a launch
    // that happened before they arrived. Idling is not proof they were here:
    // the wheel also idles while it waits for the withheld pocket, so the page
    // tells us whether the round was still taking bets when we arrived.
    const cueLaunch = () => {
      if (runCuedRef.current) return;
      runCuedRef.current = true;
      if (sawSpinStartRef.current && watchedStartRef.current) {
        audioRef.current?.onLaunch?.();
      }
    };

    const target =
      pocket !== null ? rouletteWheelRotationForPocket(pocket) : null;

    // Anchor the landing deadline once per spin, then always animate against
    // what is left of it.
    const now = performance.now();
    if (target !== null && spinRef.current?.id !== spinId) {
      spinRef.current = { id: spinId, endsAt: now + landingMsRef.current };
    }
    const remainingMs = spinRef.current ? spinRef.current.endsAt - now : 0;

    /**
     * Speeds the wheel and ball are visibly moving at right now, so a landing
     * continues the motion on screen instead of snapping back to the idle
     * speed — and so a mid-flight re-run of this effect picks up where the
     * previous plan had got to.
     */
    const liveSpeeds = (): { wheel: number; ball: number } => {
      const mode = modeRef.current;
      if (mode.kind === "rest") return { wheel: 0, ball: 0 };
      if (mode.kind === "landing") {
        const t = now - mode.startTs;
        const wheel = planSpeedDps(mode.landing.wheel, t);
        return {
          wheel,
          ball:
            t < mode.landing.dropAtMs
              ? planSpeedDps(mode.landing.ball, t)
              : wheel,
        };
      }
      return { wheel: idleWheelDpsRef.current, ball: idleBallDpsRef.current };
    };

    // ── Flat / reduced motion: fully static, instant result, no loop ──
    if (flatMode) {
      // No motion to follow, so no spin audio at all.
      setPhase("static");
      rollingRef.current = false;
      audioRef.current?.onRollEnd?.();
      cuedSpinRef.current = spinId;
      runCuedRef.current = target !== null;
      if (target !== null) {
        // Mark this spin as spent so switching back to the animated wheel
        // shows the same resting pocket instead of replaying the landing.
        spinRef.current = { id: spinId, endsAt: now };
        angleRef.current = target;
        ballAngleRef.current = 0;
        ballDropRef.current = 1;
        applyTransforms();
        comeToRest();
      } else {
        ballDropRef.current = 0;
        sawSpinStartRef.current = true;
        setWheelState("idle");
        setCelebrate(false);
        applyTransforms();
      }
      return clearCelebrate;
    }

    if (target === null) {
      // No result pending → free spin from wherever the rotor is now. Coming
      // out of a rest it starts from a standstill and spins up, so the next
      // betting window opens with the same launch as the first one did rather
      // than inheriting the speed the last round finished at.
      if (modeRef.current.kind === "rest") {
        idleWheelDpsRef.current = 0;
        idleBallDpsRef.current = 0;
      }
      modeRef.current = { kind: "idle" };
      ballDropRef.current = 0;
      sawSpinStartRef.current = true;
      setWheelState("idle");
      setCelebrate(false);
    } else if (remainingMs < MIN_LANDING_MS) {
      // No time left in the reveal window (late join, very short reveal, or a
      // spin that already landed): park on the winning pocket right away. No
      // launch or roll — a player arriving now never sees the spin, so they
      // must not hear one either.
      cuedSpinRef.current = spinId;
      angleRef.current = target;
      ballAngleRef.current = 0;
      ballDropRef.current = 1;
      applyTransforms();
      comeToRest();
      return clearCelebrate;
    } else {
      // The running spin flows straight into the deterministic landing: it
      // continues from the speed on screen, holds that fast finishing run, and
      // only then brakes onto the pocket.
      const speeds = liveSpeeds();
      const landing = buildRouletteLanding({
        wheelFrom: angleRef.current,
        ballFrom: ballAngleRef.current,
        targetMod: target,
        durationMs: remainingMs,
        wheelV0: speeds.wheel,
        ballV0: speeds.ball,
        studio: presentation === "studio",
      });
      modeRef.current = { kind: "landing", startTs: now, landing };
      setWheelState("spinning");
      setCelebrate(false);
      // Cue the spin once per round — not again if the effect re-runs while
      // this same landing is still in flight.
      if (cuedSpinRef.current !== spinId) {
        cuedSpinRef.current = spinId;
        rattledRef.current = false;
        droppedRef.current = false;
        // Normally the fast run already cued the launch several seconds ago;
        // this only covers a reveal window too short to have one.
        cueLaunch();
      }
    }

    const step = (ts: number) => {
      rafRef.current = null;
      const mode = modeRef.current;
      if (mode.kind === "idle") {
        const dt =
          lastTsRef.current == null
            ? 1 / 60
            : Math.min(0.05, (ts - lastTsRef.current) / 1000);
        lastTsRef.current = ts;
        const studioBall = studioBallPresentation();
        const held = presentation === "studio" && (!studioBall.visible || studioBall.flight < 1);
        const running = presentation === "studio" ? !held : finalRunRef.current;
        const wheelTarget = presentation === "studio" ? (running ? 100 : 24) : running
          ? FINAL_RUN_WHEEL_DPS
          : boostedRef.current
            ? ANTICIPATION_WHEEL_DPS
            : IDLE_WHEEL_DPS;
        const ballTarget = presentation === "studio" ? (held ? 0 : 740) : running
          ? FINAL_RUN_BALL_DPS
          : boostedRef.current
            ? ANTICIPATION_BALL_DPS
            : IDLE_BALL_DPS;
        // Ease between the three speeds so the same wheel never jumps, but
        // step up hard: the presentation has to look launched, not nudged.
        const follow =
          1 -
          Math.exp(
            -dt *
              (wheelTarget > idleWheelDpsRef.current
                ? RUN_FOLLOW_PER_S
                : EASE_FOLLOW_PER_S),
          );
        idleWheelDpsRef.current +=
          (wheelTarget - idleWheelDpsRef.current) * follow;
        idleBallDpsRef.current +=
          (ballTarget - idleBallDpsRef.current) * follow;
        angleRef.current = wrap360(
          angleRef.current + idleWheelDpsRef.current * dt,
        );
        if (held) {
          ballAngleRef.current = BALL_ENTRY_DEGREES;
          idleBallDpsRef.current = 0;
        } else {
          ballAngleRef.current = wrap360(ballAngleRef.current - idleBallDpsRef.current * dt);
        }
        if (running) {
          setPhase("final-run");
          // The ball is visibly away — whoosh now, not when the server gets
          // round to disclosing the pocket.
          cueLaunch();
        } else {
          runCuedRef.current = false;
          setPhase(held ? "awaiting-release" : boostedRef.current ? "anticipation" : "idle");
        }
        // The ball is on the track whenever the wheel is turning, the idle
        // spin included, so the roll rides its real speed the whole way: a
        // quiet whir at the croupier's idle pace, swelling through the
        // anticipation spin and the final run into the landing. It stops only
        // when the ball is no longer rolling in view — at rest, on a hidden
        // tab, or when the table unmounts.
        if (held) {
          if (rollingRef.current) audioRef.current?.onRollEnd?.();
          rollingRef.current = false;
        } else {
          rollingRef.current = true;
          audioRef.current?.onRoll?.(ballRollLevel01(idleBallDpsRef.current));
        }
        applyTransforms();
        schedule();
        return;
      }
      if (mode.kind === "landing") {
        const { landing } = mode;
        const t = ts - mode.startTs;
        if (t >= landing.durationMs) {
          angleRef.current = wrap360(landing.endAngle);
          ballAngleRef.current = 0;
          ballDropRef.current = 1;
          applyTransforms();
          comeToRest();
          return;
        }
        setPhase(planPhase(landing.wheel, t));
        const wheelAngle = planAngle(landing.wheel, t);
        angleRef.current = wrap360(wheelAngle);
        if (t < landing.dropAtMs) {
          ballAngleRef.current = wrap360(planAngle(landing.ball, t));
          ballDropRef.current = 0;
          // Feed the roll layer the ball's true speed, and rattle the frets
          // once it has slowed enough to start catching them.
          const ballDps = planSpeedDps(landing.ball, t);
          rollingRef.current = true;
          audioRef.current?.onRoll?.(ballRollLevel01(ballDps));
          // Only once the ball is past its peak and slowing: during the launch
          // ramp it is below this speed too, but climbing, not catching frets.
          if (
            !rattledRef.current &&
            t > landing.ball.rampMs &&
            ballDps <= BALL_RATTLE_DPS
          ) {
            rattledRef.current = true;
            audioRef.current?.onRattle?.();
          }
        } else {
          // Dropped in: the ball now sits in the winning pocket and is carried
          // round by the rotor until it stops under the pointer.
          if (!droppedRef.current) {
            droppedRef.current = true;
            audioRef.current?.onDrop?.(landing.durationMs - landing.dropAtMs);
          }
          ballAngleRef.current = wrap360(wheelAngle - landing.endAngle);
          ballDropRef.current = easeOutCubic(
            clamp(
              (t - landing.dropAtMs) / (landing.durationMs - landing.dropAtMs),
              0,
              1,
            ),
          );
        }
        applyTransforms();
        schedule();
      }
    };

    function schedule() {
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(step);
      }
    }

    const stop = () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
    };

    // Hidden tabs get no frames at all; on return the landing re-reads its
    // clock (so a spin that expired while hidden lands instantly on the right
    // pocket) and the idle spin restarts without a jump.
    const onVisibility = () => {
      if (document.hidden) {
        stop();
        // The frames are what drive the roll, so end it here rather than rely
        // on the audio layer noticing the tab itself: nothing would be
        // updating its level, and a hidden tab must never leave a loop alive.
        // The first visible frame starts it again if the ball is still going.
        rollingRef.current = false;
        audioRef.current?.onRollEnd?.();
      } else if (modeRef.current.kind !== "rest") {
        lastTsRef.current = null;
        schedule();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    applyTransforms();
    if (!document.hidden) schedule();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      clearCelebrate();
      // Nothing drives the roll once the frames stop, so it must not outlive
      // this effect — covers unmount (leaving the table) as well as a re-run.
      audioRef.current?.onRollEnd?.();
    };
    // `landingMs` is intentionally read from a ref: changing it mid-spin must
    // not restart the landing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinId, pocket, flatMode, roundId]);

  const { paths, labels } = useMemo(() => wheelSvg(SIZE), []);
  const failModel = () => setModelFailed(true);
  const syncModel = () => {
    modelRef.current?.setMotion(
      angleRef.current,
      ballAngleRef.current,
      ballDropRef.current,
      presentation === "studio" ? studioBallPresentation() : undefined,
    );
  };

  if (presentation === "studio") {
    return (
      <div ref={hostEl} className="roulette-studio-wheel-layer" data-testid="roulette-wheel"
        data-wheel-renderer="studio-controlled" data-wheel-state={flatMode ? "flat" : wheelState}>
        <RouletteStudioWheel ref={modelRef} onReady={syncModel} />
      </div>
    );
  }

  return (
    <div
      ref={hostEl}
      className={cn(
        "relative mx-auto flex aspect-square w-full max-w-[300px] items-center justify-center select-none",
        className,
      )}
      data-wheel-renderer={
        flatMode ? "static" : useModel ? "model-3d" : "lightweight-2d"
      }
    >
      <div
        className="absolute inset-0"
        style={flatMode || useModel ? undefined : { perspective: "900px" }}
      >
        <div
          className="absolute inset-0"
          style={
            flatMode || useModel
              ? undefined
              : { transform: "rotateX(38deg)", transformStyle: "preserve-3d" }
          }
        >
          <div className="relative h-full w-full">
            {/* Pointer */}
            <div
              className="absolute left-1/2 -translate-x-1/2 -top-1 z-10 w-0 h-0"
              style={{
                borderLeft: "9px solid transparent",
                borderRight: "9px solid transparent",
                borderTop: "16px solid #fbbf24",
                filter: "drop-shadow(0 0 6px rgba(251,191,36,0.8))",
              }}
              data-testid="wheel-pointer"
            />
            {useModel ? (
              <WheelModelErrorBoundary onFailure={failModel}>
                <Suspense
                  fallback={
                    <div
                      className="absolute inset-0 rounded-full bg-[radial-gradient(circle,#4b3417,#130b24_68%)]"
                      data-testid="roulette-model-loading"
                    />
                  }
                >
                  <RouletteWheelModel
                    ref={modelRef}
                    onFailure={failModel}
                    onReady={syncModel}
                  />
                </Suspense>
              </WheelModelErrorBoundary>
            ) : (
              <div
                className="absolute -inset-3 rounded-full border-[10px] border-[#4a2414]"
                style={{
                      background:
                    "radial-gradient(circle at 34% 25%, rgba(255,225,165,0.7), transparent 18%), conic-gradient(from 18deg, #5c2a16, #c37a3b 14%, #6c3219 28%, #ba6b31 43%, #4a2111 60%, #a95c2b 78%, #5c2a16)",
                  boxShadow:
                    "0 18px 48px rgba(0,0,0,0.78), inset 0 3px 8px rgba(255,238,198,0.42), inset 0 -13px 20px rgba(0,0,0,0.62)",
                }}
              >
                <div
                  className="absolute inset-[7%] rounded-full border-[7px] border-[#171717]"
                  style={{
                    background:
                      "radial-gradient(circle at 36% 30%, #343434, #111 62%, #050505 100%)",
                    boxShadow:
                      "0 3px 8px rgba(0,0,0,0.65), inset 0 2px 7px rgba(255,255,255,0.16), inset 0 -10px 16px rgba(0,0,0,0.72)",
                  }}
                />
                <div
                  className="absolute inset-[13%] rounded-full border border-[#d58a47]/70"
                  style={{
                    boxShadow:
                      "inset 0 0 0 4px rgba(7,7,7,0.9), inset 0 0 13px rgba(0,0,0,0.8)",
                  }}
                />
              </div>
            )}
            <svg
              ref={wheelEl}
              width="100%"
              height="100%"
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className={cn(
                "absolute inset-0",
                useModel && "pointer-events-none opacity-0",
              )}
              style={WHEEL_STYLE}
              data-testid="roulette-wheel"
              data-wheel-state={flatMode ? "flat" : wheelState}
            >
              {paths}
              {labels}
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={SIZE * 0.3}
                fill="#1c1917"
                stroke="#78716c"
                strokeWidth={2}
              />
              <circle cx={SIZE / 2} cy={SIZE / 2} r={SIZE * 0.05} fill="#a8a29e" />
            </svg>
            {/* Jewel cap for browsers using the lightweight wheel. The real
                GLB renderer adds the same faceted stone to the turret. */}
            <div
              className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[5px] border-2 border-white/80"
              style={{
                background:
                  "linear-gradient(135deg, #ffffff 0%, #b9efff 28%, #3b82f6 52%, #dffbff 72%, #60a5fa 100%)",
                boxShadow:
                  "0 0 8px rgba(147, 231, 255, 0.95), inset 2px 2px 3px rgba(255,255,255,0.85), inset -2px -2px 3px rgba(30,64,175,0.65)",
              }}
              aria-hidden="true"
              data-testid="roulette-center-diamond"
            />
            {/* Ball track — orbits opposite to the rotor, then drops into the
                winning pocket and rides it under the pointer. */}
            {!flatMode && (
              <div
                ref={trackEl}
                className={cn(
                  "absolute inset-0 pointer-events-none",
                  useModel && "opacity-0",
                )}
                style={TRACK_STYLE}
                data-testid="wheel-ball-track"
              >
                <div
                  ref={ballEl}
                  className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full"
                  style={BALL_STYLE}
                />
              </div>
            )}
            {/* Result readout in the hub */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
              {revealedPocket !== null && (
                <div
                  className={cn(
                    "w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl sm:text-3xl font-black text-white border-[3px] border-white/40",
                    WINNING_RESULT_CLASS,
                  )}
                  style={{
                    background: pocketColorHex(revealedPocket),
                    boxShadow: celebrate
                      ? `0 0 40px 10px ${pocketColorHex(revealedPocket)}`
                      : "0 4px 12px rgba(0,0,0,0.5)",
                    transition: "box-shadow 0.3s",
                  }}
                  data-testid="wheel-result"
                >
                  {revealedPocket}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
