import { useCallback, useEffect, useRef, useState } from "react";
import { Wheel3D } from "./Wheel3D";
import { BOWL, WHEEL, unstretch } from "./layout";
import { currentViewport, effectiveWindow, fitViewport } from "./viewport";
import {
  ballAt,
  canonicalRestSpin,
  easeInOut,
  easeOutCubic,
  measuredSpin,
  pocketRestAngle,
  spinTravel,
} from "./geometry";
import { rouletteSounds } from "./sounds";
import type { Wheel } from "./wheelSpec";

/**
 * The spin: wait for the clock, zoom in, turn, hold, zoom out.
 *
 * Three properties matter more than the timings and are easy to lose:
 *
 *  - THE RING NEVER STOPS ON THE WINNER. It turns exactly five whole turns and
 *    ends in its one canonical pose every time. The BALL alone marks the
 *    number. A ring that stopped on the winner would have to be re-registered
 *    against the sprite for every pocket, and would be wrong on the mini wheel
 *    whose zero offset is not a whole number of pockets.
 *  - The ring turns ANTICLOCKWISE and the ball CLOCKWISE. Same controller,
 *    opposite signs.
 *  - The spin starts as the NEXT round's betting window opens, and runs into
 *    it. That is not a bug to design around; it is why the whole canvas absorbs
 *    input for the entire sequence.
 */
export interface SpinStageProps {
  wheel: Wheel;
  /** The pocket to land on, or null while nothing is resolved. */
  pocket: number | null;
  /** Identifies the round, so each is played exactly once. */
  roundId: string | null;
  /** ms until the on-screen clock reaches zero. The spin starts then. */
  startInMs: number;
  /**
   * The round's betting window. The sequence below runs INTO the next one, so
   * on a short window it has to be compressed or it eats the whole thing.
   */
  bettingWindowMs?: number | null;
  /** Where the ball is parked between spins — the last settled pocket. */
  restingPocket: number;
  zoomEnabled: boolean;
  /** While true a resolved round is CLAIMED AND DROPPED, never queued. */
  paused: boolean;
  onSpinning: (spinning: boolean) => void;
  /** The reveal: the ball has stopped and this is the number. */
  onResultShown: (pocket: number, roundId: string) => void;
  /**
   * A round whose spin was DROPPED because a win was still on the meter.
   *
   * The screen has to hear about it: "the round whose result the player has
   * seen" is what decides which chips the chart draws, what Total Bet reads
   * and whether Prev Bet is offered, and a dropped round left that pinned to
   * the round BEFORE it — so after TAKE the table showed a stale layout, Total
   * Bet 0, and the chips the player was staging did not appear at all, for a
   * whole round. Not the same call as `onResultShown`: nothing was shown, so
   * there is no flash and no win or lose sting.
   */
  onResultSkipped: (roundId: string) => void;
  onSpinStopped: () => void;
}

type Phase = "idle" | "zoomIn" | "turning" | "hold" | "zoomOut";

export function SpinStage(props: SpinStageProps) {
  const {
    wheel,
    pocket,
    roundId,
    startInMs,
    bettingWindowMs,
    restingPocket,
    zoomEnabled,
    paused,
    onSpinning,
    onResultShown,
    onResultSkipped,
    onSpinStopped,
  } = props;

  const [zoom, setZoom] = useState(0);
  /**
   * The camera, as a live and interruptible control.
   *
   * Wheel Zoom used to be read ONCE when the sequence armed, so pressing it
   * mid-spin did nothing until the next round — and the button was under the
   * spin absorber, so it could not even be pressed. The cabinet moves the
   * camera immediately: off while the ring turns retreats over 1100 ms from
   * wherever it stands, on zooms in over 520 ms, and the ring's own 6000 ms
   * run is never cut either way.
   *
   * `zoomRef` mirrors the state because the sequence and the toggle both read
   * "where is the camera now" from inside closures a render behind.
   */
  const zoomRef = useRef(0);
  const zoomAnimRef = useRef<{ cancel: boolean } | null>(null);
  const zoomAllowedRef = useRef(true);
  const msRef = useRef(1);
  const zoomEnabledRef = useRef(zoomEnabled);
  zoomEnabledRef.current = zoomEnabled;

  const setZoomBoth = useCallback((v: number) => {
    zoomRef.current = v;
    setZoom(v);
  }, []);

  /**
   * Move the camera to `target`, cancelling whatever it was doing.
   *
   * Resolves on cancellation rather than hanging, which is what lets the
   * sequence await its own zoom leg and still play on when the player
   * interrupts it.
   */
  const zoomTo = useCallback(
    (target: 0 | 1) =>
      new Promise<void>((resolve) => {
        if (zoomAnimRef.current) zoomAnimRef.current.cancel = true;
        const token = { cancel: false };
        zoomAnimRef.current = token;
        const from = zoomRef.current;
        if (from === target) return resolve();
        const dur = Math.max(
          1,
          Math.round((target === 1 ? WHEEL.zoomInMs : WHEEL.zoomOutMs) * msRef.current),
        );
        const curve = target === 1 ? easeOutCubic : easeInOut;
        const started = performance.now();
        const step = () => {
          if (token.cancel || cancelRef.current) return resolve();
          const t = Math.min(1, (performance.now() - started) / dur);
          setZoomBoth(from + (target - from) * curve(t));
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [setZoomBoth],
  );

  // The toggle, live. Only while the wheel is actually running: the idle wheel
  // is never zoomed, so pressing it between rounds must not move the camera.
  const spinningRef = useRef(false);
  useEffect(() => {
    if (!spinningRef.current || !zoomAllowedRef.current) return;
    void zoomTo(zoomEnabled ? 1 : 0);
  }, [zoomEnabled, zoomTo]);
  const [spinU, setSpinU] = useState<number | null>(null);
  const [sparkle, setSparkle] = useState(0);
  const [restAngle, setRestAngle] = useState(() => pocketRestAngle(wheel, restingPocket));
  // The window as the CANVAS sees it — swapped when it is turned for a
  // portrait phone, so the counter-scale that keeps the wheel circular is
  // computed against the axes the canvas is actually stretched along.
  const [window, setWindow] = useState(() => effectiveWindow(currentViewport()));

  const playedRef = useRef<string | null>(null);
  // Where the ball is RIGHT NOW, for the sequence to start from. State would
  // be a render behind; the sequence reads it once, at the moment it throws.
  const restAngleRef = useRef(restAngle);
  restAngleRef.current = restAngle;
  const travelRef = useRef(0);
  const cancelRef = useRef(false);
  // The props the running sequence needs, read at the moment it needs them
  // rather than captured — the sequence outlives several renders.
  const cbRef = useRef({ onSpinning, onResultShown, onResultSkipped, onSpinStopped });
  cbRef.current = { onSpinning, onResultShown, onResultSkipped, onSpinStopped };

  useEffect(() => {
    const onResize = () =>
      setWindow(effectiveWindow(fitViewport(globalThis.innerWidth, globalThis.innerHeight)));
    // Run it ONCE on mount, not only on the next resize.
    //
    // The initial state reads the module-level viewport singleton during
    // render, and that singleton is only refreshed by an effect on the screen
    // above — and React runs child effects before parent effects, so the value
    // read here is the one left behind by the last visit. Open the wheel, go
    // back to the lobby, resize or rotate there, open the wheel again: the
    // counter-scale was computed against the old window and the wheel drew as a
    // visible ellipse until something else resized. Taps stayed correct because
    // the bet chart reads the viewport at pointer time instead.
    onResize();
    globalThis.addEventListener("resize", onResize);
    // A phone can fire orientationchange without a following resize, which is
    // the same stale value arriving by the other door. The screen above already
    // listens for both.
    globalThis.addEventListener("orientationchange", onResize);
    return () => {
      globalThis.removeEventListener("resize", onResize);
      globalThis.removeEventListener("orientationchange", onResize);
    };
  }, []);

  // The ball parks on the last settled pocket between spins. Never on 0 — a
  // returning player would read that as "the last round came up zero".
  //
  // Only until the first spin. After one, the ball is wherever the last spin
  // put it and that is the truth on screen; re-syncing from `restingPocket`
  // here made the ball jump BACK to the previous number for the half-second
  // between landing and the history refresh, and stay behind for good on any
  // round the pause dropped.
  useEffect(() => {
    if (playedRef.current === null) {
      setRestAngle(pocketRestAngle(wheel, restingPocket));
    }
  }, [wheel, restingPocket]);

  const animate = useCallback(
    (ms: number, onFrame: (t: number) => void) =>
      new Promise<void>((resolve) => {
        const started = performance.now();
        const step = () => {
          if (cancelRef.current) return resolve();
          const t = Math.min(1, (performance.now() - started) / ms);
          onFrame(t);
          if (t < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    [],
  );

  // Cancel ONLY on unmount. The sequence below is deliberately not tied to
  // the effect that starts it, because the props that start it are gone by
  // the time it runs: the spin is scheduled for the moment the on-screen clock
  // hits zero, and that is the SAME instant the next round opens — the
  // outcome goes null, the round id changes, and an effect keyed on them
  // would clean itself up and cancel the spin it had just armed. That is
  // exactly what the first version did: the wheel never turned, once.
  useEffect(
    () => () => {
      cancelRef.current = true;
      rouletteSounds.spinStop();
    },
    [],
  );

  useEffect(() => {
    if (pocket === null || roundId === null) return;
    if (playedRef.current === roundId) return;

    // A resolved round arriving while a win is uncollected is CLAIMED AND
    // DROPPED, not queued: lifting the pause must not replay a spin the player
    // has already moved past.
    if (paused) {
      playedRef.current = roundId;
      cbRef.current.onResultSkipped(roundId);
      return;
    }

    playedRef.current = roundId;
    // Captured now: the props will not be there when the sequence needs them.
    const target = pocket;
    const played = roundId;
    /**
     * How much of the sequence fits in the next betting window.
     *
     * The full sequence is ~9.2s and it plays over the START of the next
     * window behind a full-canvas absorber, so on a short window the player
     * could not place a single bet — no error, just a table that never became
     * bettable. The betting window is partner-settable down to 1s, and the
     * constraint is this animation rather than anything the server does, so it
     * belongs here and not in a config bound.
     *
     * At most 55% of the window, so there is always more time to bet than to
     * watch. 1 at the shipped 50s default, so nothing changes for anyone whose
     * table is paced normally.
     */
    const fullMs =
      WHEEL.zoomInMs + WHEEL.spinMs + WHEEL.holdMs + WHEEL.zoomOutMs;
    const budget =
      typeof bettingWindowMs === "number" && bettingWindowMs > 0
        ? bettingWindowMs * 0.55
        : fullMs;
    const scale = Math.min(1, budget / fullMs);
    msRef.current = scale;
    const ms = (base: number) => Math.max(1, Math.round(base * scale));
    // Below about a third there is no room for a zoom that has to come back
    // out again; the spin itself is what carries the result.
    zoomAllowedRef.current = scale > 0.34;
    let sparkleTimer: ReturnType<typeof setInterval> | undefined;

    const run = async () => {
      // Wait for the on-screen clock. Already past zero (a mid-tail rejoin)
      // starts at once — and still runs the FULL sequence. There is no
      // shortened spin: a hurried one reads as a different machine.
      const wait = Math.max(0, startInMs);
      if (wait > 0) {
        await new Promise<void>((r) => setTimeout(r, wait));
      }
      if (cancelRef.current) return;

      spinningRef.current = true;
      cbRef.current.onSpinning(true);

      // The camera is a LIVE control now: the toggle can move it at any point
      // of the sequence, so this leg only asks for the zoom and awaits it. A
      // toggle that interrupts resolves this await rather than leaving it
      // hanging, and the spin plays on either way.
      if (zoomAllowedRef.current && zoomEnabledRef.current) {
        await zoomTo(1);
        if (cancelRef.current) return;
      }

      const from = restAngleRef.current;
      const to = pocketRestAngle(wheel, target);
      travelRef.current = spinTravel(from, to, WHEEL.turns);
      setRestAngle(from);

      rouletteSounds.spinStart();
      sparkleTimer = setInterval(
        () => setSparkle((f) => (f + 1) % WHEEL.sparkleFrames),
        WHEEL.sparkleMs,
      );

      await animate(ms(WHEEL.spinMs), (t) => setSpinU(t));
      clearInterval(sparkleTimer);
      setSparkle(0);
      if (cancelRef.current) return;

      // Land exactly on the pocket, and drop back to the resting picture: five
      // whole turns is the identity, so this is the same frame.
      setRestAngle(to);
      setSpinU(null);
      rouletteSounds.spinStop();

      cbRef.current.onResultShown(target, played);
      cbRef.current.onSpinStopped();

      await new Promise<void>((r) => setTimeout(r, ms(WHEEL.holdMs)));
      if (cancelRef.current) return;

      // Only if the camera is still OUT. A sequence the toggle already parked
      // must not play a second retreat from zero.
      if (zoomRef.current > 0) await zoomTo(0);
      setZoom(0);
      zoomRef.current = 0;
      spinningRef.current = false;
      cbRef.current.onSpinning(false);
    };

    void run().finally(() => {
      if (sparkleTimer) clearInterval(sparkleTimer);
    });
    // No cleanup here — see the unmount effect above. `restingPocket` and
    // `zoomEnabled` are read once at arming and are deliberately not deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pocket, roundId, paused, wheel, animate]);

  // ── the drawn state ──────────────────────────────────────────────────────
  const turning = spinU !== null;
  const eased = turning ? measuredSpin(spinU!) : 0;
  const spin = canonicalRestSpin(wheel) - (turning ? WHEEL.turns * 2 * Math.PI * eased : 0);
  const ball = turning
    ? ballAt(restAngle, travelRef.current, spinU!)
    : { angle: restAngle, radius: BOWL.ballRadiusEnd };

  const scale = 1 + (WHEEL.zoomScale - 1) * zoom;
  const cx = WHEEL.idleCentre.x + (WHEEL.zoomCentre.x - WHEEL.idleCentre.x) * zoom;
  const cy = WHEEL.idleCentre.y + (WHEEL.zoomCentre.y - WHEEL.idleCentre.y) * zoom;
  const drawnW = WHEEL.idleSize.w * scale;
  const drawnH = WHEEL.idleSize.h * scale;
  const un = unstretch(window.w, window.h);

  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* The dim behind a zoomed wheel. Nothing but the wheel is meant to read. */}
      {zoom > 0 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            opacity: WHEEL.scrimAlpha * zoom,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: cx - drawnW / 2,
          top: cy - drawnH / 2,
          width: drawnW,
          height: drawnH,
          // Undo the canvas's non-uniform stretch so the wheel stays circular.
          transform: `scale(${un.x}, ${un.y})`,
          transformOrigin: "50% 50%",
          overflow: "visible",
        }}
      >
        {/*
          The whole composite is squashed from its 660x432 geometry box into
          the drawn footprint TOGETHER — bowl, ring, diamond and ball — which is
          why this is one scale on a wrapper rather than four sizes.
        */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: BOWL.w,
            height: BOWL.h,
            transform: `scale(${drawnW / BOWL.w}, ${drawnH / BOWL.h})`,
            transformOrigin: "0 0",
            overflow: "visible",
          }}
        >
          <Wheel3D
            wheel={wheel}
            spin={spin}
            ballAngle={ball.angle}
            ballRadius={ball.radius}
            sparkleFrame={sparkle}
          />
        </div>
      </div>
    </div>
  );
}
