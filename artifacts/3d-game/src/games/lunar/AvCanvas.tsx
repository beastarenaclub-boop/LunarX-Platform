import { useEffect, useRef } from "react";
import aviatorLogo from "@/assets/aviator-logo.svg";
import idleArt from "@/assets/loading_image_middle.png";
import { useStore } from "@/game/store";

/**
 * Artwork shown in the middle of the canvas between rounds.
 *
 * To use your own image:
 *   1. drop the file in `src/assets/` (png, jpg, svg or webp all work)
 *   2. uncomment the import below and point it at your file
 *   3. set IDLE_ART to that import
 *
 * Leave it null and the built-in lockup (wordmark + provably-fair badge) is
 * used instead. The countdown bar renders underneath either way.
 *
 * Whatever you use here is shown to every player, so it needs to be artwork
 * you hold the rights to — third-party logos and "official/certified" badges
 * included.
 */
const IDLE_ART: string | null = idleArt;

/**
 * Where the countdown sits ON TOP of IDLE_ART, as a percentage down the image.
 * 50% is dead centre; raise it to push the bar toward the bottom of the art if
 * it collides with something in the middle of your image. Ignored when
 * IDLE_ART is null — the fallback lockup stacks the countdown underneath.
 */
const IDLE_ART_COUNTDOWN_Y = "55%";

/**
 * Idle-art sizing. The art is drawn at an EXACT width and height derived from
 * these, rather than a width plus a maxHeight cap — with a cap, whichever
 * constraint binds decides the size and `object-contain` letterboxes the rest,
 * so the element's box stopped matching the visible artwork and nothing could
 * be aligned to it.
 *
 * IDLE_ART_RATIO must match the source file (loading_image_middle.png is
 * 576x433). Update it if you swap the artwork, or the art will letterbox again.
 */
const IDLE_ART_RATIO = 576 / 433;
/**
 * Idle art sizing, measured from the reference at three canvas widths (1:1
 * captures, no downscaling):
 *
 *   stage 382 -> art ~152    stage 818 -> art ~300    stage 1498 -> art ~304
 *
 * So the art is NOT a fraction of the canvas: it grows to a ~300px ceiling and
 * only shrinks below that on narrow canvases, where it settles at ~40% of the
 * width. Treating it as a pure fraction made it balloon on desktop and vanish
 * on mobile — both of which we hit on the way here.
 */
const IDLE_ART_MAX_W = 300;
const IDLE_ART_W = 0.4;
/**
 * Never taller than this fraction of canvas height. The reference peaks at
 * ~53% (300-wide art on an 423-tall stage); ours needs more headroom because
 * our bet panels are taller, so the same canvas width leaves us ~346px of
 * height instead of 423. 0.65 lets the 300px ceiling be reached at every size
 * we support without the art overrunning a short canvas.
 */
const IDLE_ART_MAX_H = 0.65;
/**
 * The countdown bar is a FIXED width in the reference — ~200px at every canvas
 * size measured (382/818/1498 all gave 198-201). It does not track the art.
 */
const IDLE_BAR_PX = 200;
import { ShieldCheck } from "lucide-react";
import AviatorPlane, { PLANE_ASPECT, PLANE_FRACTION, PLANE_PARK, PLANE_TAIL, PLANE_TILT_DEG } from "@/games/lunar/AviatorPlane";
import { tierColor } from "./avUtils";
import { PlayerAvatar } from "./PlayerAvatar";

const CURVE = "#e50539";

/**
 * Spribe-exact Aviator canvas.
 *
 * Differences from the shared Lunar canvas, all taken from the 4K reference
 * (UI_SPEC_AVIATOR.md §4): the crash headline is WHITE with only the number in
 * red, a tier-colored radial glow sits behind the flying readout, the live
 * players pill sits bottom-right inside the canvas, and the betting phase shows
 * the brand lockup + "waiting for next round" bar instead of a countdown ring.
 */
export default function AvCanvas() {
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);
  const flyMs = useStore((s) => s.flyMs);
  const countdownMs = useStore((s) => s.countdownMs);
  const countdownTotalMs = useStore((s) => s.countdownTotalMs);
  const quality = useStore((s) => s.settings.quality);
  const onlinePlayers = useStore((s) => s.onlinePlayers);
  const liveBets = useStore((s) => s.liveBets);

  const containerRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 1420, h: 710 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      // clientWidth/Height, not getBoundingClientRect — the page applies CSS
      // `zoom` above us, which scales the rect but not the local coordinate
      // space the plane is positioned in.
      sizeRef.current = { w: el.clientWidth, h: el.clientHeight };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w, h } = sizeRef.current;

  // Position tracks FLIGHT TIME, not the multiplier. In the reference the plane
  // sweeps out to the top-right over the first few seconds and then hovers
  // there while the multiplier keeps climbing — which is why its 1.34× frame
  // sits at 66% across but its 2.33× and 20.01× frames are both out at 83-96%.
  // A multiplier-driven curve cannot produce that ordering.
  //
  // SWEEP_MS and HOVER_* are calibrated against those three reference frames;
  // they are the knobs to retune if the flight feels off.
  const SWEEP_MS = 4000;
  const HOVER_X = 0.07; // fraction of canvas width the hover drifts back
  const HOVER_Y = 0.09;
  const travel = phase === "betting" ? 0 : Math.min(1, flyMs / SWEEP_MS);
  const et = travel * travel * (3 - 2 * travel);
  // Sized off the canvas, like the type, at the reference's own share of it
  // (PLANE_FRACTION). Clamped so a phone still shows a plane and a
  // widescreen does not show a billboard.
  const planeW = Math.max(76, Math.min(136, w * PLANE_FRACTION));
  const planeH = planeW * PLANE_ASPECT;
  // The far corner is where the TAIL WHEEL ends up, and the plane reaches
  // forward and up from it — so the corner pulls in by that reach, or the
  // nose runs off the canvas and is clipped. It used to be 54/44 px, which
  // was the old 64 px sprite's half-size.
  const endX = w - 12 - planeW * (1 - PLANE_TAIL.x);
  const endY = 12 + planeH * PLANE_TAIL.y;
  const parkX = PLANE_PARK.left + planeW * PLANE_TAIL.x;
  const baseX = parkX + (endX - parkX) * et;
  const baseY = h - PLANE_PARK.bottom - (h - PLANE_PARK.bottom - endY) * et;
  // Hover only builds in once the plane is actually out at the corner.
  const px = baseX - et * w * HOVER_X * (0.5 + 0.5 * Math.sin(flyMs / 1100));
  const py = baseY + et * h * HOVER_Y * (0.5 + 0.5 * Math.cos(flyMs / 900));
  const planeY = py;

  const startX = 2;
  const startY = h - 2;
  const ctrlX = startX + (px - startX) * 0.62;
  const ctrlY = startY - (startY - planeY) * 0.12;
  const trailD = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${px} ${planeY}`;

  // Type scales off the measured canvas width rather than `vw`: viewport units
  // resolve ambiguously inside the page's zoomed subtree. Ratios are taken from
  // the reference at its 1920 design width. Final calibration is a direct
  // like-for-like: our `1.58x` frame against the reference's `1.70x` frame at
  // the same 3840px image scale — identical string shape, so no glyph-width
  // modelling. Bump every ratio here together if the readout still reads large.
  // Derived originally by normalising each run against the bet button, which
  // puts the flying readout at ~71px on a 1420px-wide canvas. Cross-checked on
  // two frames with different glyph counts (55.08x and 273.36x) — both give 71.
  const fs = (ratio: number, min: number) => Math.max(min, Math.round(w * ratio));

  // The readout grows far more slowly than the canvas. Measured off the live
  // reference at three canvas widths — 382px→66, 1498px→98, 2642px→117 (the
  // last from a 4K Parimatch capture at 125% OS scaling, so 3072 CSS px) — a
  // least-squares line through them is 60 + 0.0225w. A plain width ratio
  // doubles it on a 4K stage.
  // ponytail: linear fit over three samples; re-measure if Spribe re-skins.
  const readoutFs = Math.round(60 + 0.0225 * w);

  const glow = tierColor(multiplier);
  // Cashed-out players this round, for the bottom-right pill avatars.
  // The pill's three faces come from liveBets, which the engine clears between
  // rounds — so during betting/waiting the pill had a count but no avatars,
  // then popped them in at takeoff. Hold the last non-empty trio so the pill
  // looks the same in every phase, like the reference.
  const lastFaces = useRef<typeof liveBets>([]);
  if (liveBets.length) lastFaces.current = liveBets.slice(0, 3);
  const pillFaces = liveBets.length ? liveBets.slice(0, 3) : lastFaces.current;

  // One definition, rendered either over IDLE_ART or under the fallback lockup.
  // Exact art size: start from the width, fall back to the height cap if it
  // would overflow a short canvas. Both dimensions are set explicitly, so the
  // element's box IS the artwork and the bar below can size against it.
  // Width first (with its floor), then clamp to the height cap — so the art
  // grows with the canvas but never gets stamp-sized on a phone or tall enough
  // to crowd the bet panels on a short one.
  const artH = Math.min(
    Math.min(w * IDLE_ART_W, IDLE_ART_MAX_W) / IDLE_ART_RATIO,
    h * IDLE_ART_MAX_H,
  );
  const artW = artH * IDLE_ART_RATIO;

  // The seconds number that used to sit above the bar is gone (operator
  // request, 2026-10-10): the draining bar alone says how long is left, and a
  // large counter over the idle art read as a second, busier clock.

  const countdown = (
    <div className="flex flex-col items-center">
      <div
        className="h-[3px] overflow-hidden rounded-full bg-white/10"
        style={{ width: IDLE_BAR_PX }}
      >
        {/* Drains rather than fills: starts full at the top of the window and
            empties to 0 as the countdown runs out. Put the `100 - ` back in
            front to flip it the other way. */}
        <div
          className="h-full bg-[#e50539] transition-[width] duration-100"
          style={{
            width: `${(countdownMs / Math.max(1, countdownTotalMs)) * 100}%`,
          }}
        />
      </div>
    </div>
  );

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden rounded-[20px] border border-[#2a2b2e] bg-[#0d0d0d]"
      data-testid="aviator-canvas"
    >
      {/* Sunburst: ~20 charcoal wedges radiating from the bottom-left origin,
          rotating slowly. Present in every phase, exactly like the reference. */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute animate-sunburst"
          style={{
            left: startX,
            top: startY,
            width: "300vmax",
            height: "300vmax",
            marginLeft: "-150vmax",
            marginTop: "-150vmax",
            borderRadius: "50%",
            background:
              "repeating-conic-gradient(from 0deg, rgba(255,255,255,0.055) 0deg 7deg, rgba(255,255,255,0) 7deg 16deg)",
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 120% at 8% 92%, rgba(0,0,0,0) 25%, rgba(0,0,0,0.65) 100%)",
          }}
        />
      </div>

      {/* Tier-colored glow behind the readout — blue low, violet mid, magenta
          high. Only while flying; it vanishes the instant the plane leaves. */}
      {phase === "flying" && (
        <div
          className="absolute inset-0 pointer-events-none transition-opacity duration-500"
          style={{
            background: `radial-gradient(40% 48% at 50% 50%, ${glow}59 0%, ${glow}24 40%, transparent 74%)`,
          }}
        />
      )}

      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="av-trail-fill" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={CURVE} stopOpacity="0.55" />
            <stop offset="55%" stopColor={CURVE} stopOpacity="0.4" />
            <stop offset="100%" stopColor={CURVE} stopOpacity="0.22" />
          </linearGradient>
          <filter id="av-glow">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Flying only: in the reference the trail vanishes with the plane the
            instant it flies away, leaving a bare sunburst behind the result. */}
        {phase === "flying" && (
          <>
            {/* Fill closes with a vertical drop under the plane, not a diagonal. */}
            <path d={`${trailD} L ${px} ${h} L ${startX} ${h} Z`} fill="url(#av-trail-fill)" />
            <path
              d={trailD}
              stroke={CURVE}
              strokeWidth={5}
              fill="none"
              strokeLinecap="round"
              filter={quality === "high" ? "url(#av-glow)" : undefined}
            />
          </>
        )}
      </svg>

      {/*
        Plane. The trail ATTACHES AT THE TAIL WHEEL — the curve's tip is the
        point under the plane's rear, and the plane extends forward from it —
        so the sprite is hung from that point, not centred on it, and it turns
        about it too, or a tilt would lift the wheel off the trail.

        During the countdown it sits parked at the bottom-left origin, level
        and STILL: no bob, no tilt. It only ever moves on the flight point.
        The prop turns in every phase (the component owns that).
      */}
      <div
        className={`absolute transition-transform duration-100 ${
          phase === "crashed" ? "animate-fly-away" : ""
        }`}
        style={{
          left: px - planeW * PLANE_TAIL.x,
          top: planeY - planeH * PLANE_TAIL.y,
          transformOrigin: `${PLANE_TAIL.x * 100}% ${PLANE_TAIL.y * 100}%`,
          // The same stance parked and flying — see PLANE_TILT_DEG.
          transform: `rotate(${PLANE_TILT_DEG}deg)`,
          // No glow. The plane is drawn exactly as its art is (product
          // decision, 2026-09-04); a drop-shadow read as a halo around it.
        }}
      >
        <AviatorPlane size={planeW} color={CURVE} />
      </div>

      {/* Center readout */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        {phase === "betting" ? (
          <div className="flex flex-col items-center gap-4">
            {/* Slot for your own idle artwork — see IDLE_ART at the top of the
                file. Scales to 42% of the canvas width and is capped at 45% of
                its height. With art set the countdown is overlaid on it at
                IDLE_ART_COUNTDOWN_Y; without it, the fallback lockup stacks the
                countdown underneath instead. */}
            {IDLE_ART ? (
              <div className="flex flex-col items-center gap-2">
                <div className="relative">
                  <img
                    src={IDLE_ART}
                    alt=""
                    // Exact size from the IDLE_ART_* constants at the top of the
                    // file — no letterboxing, so this box IS the artwork and the
                    // countdown bar can size itself against it.
                    style={{ width: Math.round(artW), height: Math.round(artH) }}
                    data-testid="idle-branding"
                  />
                  <div
                    className="absolute left-1/2 w-full -translate-x-1/2 -translate-y-1/2"
                    style={{ top: IDLE_ART_COUNTDOWN_Y }}
                  >
                    {countdown}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <img
                  src={aviatorLogo}
                  alt="Aviator"
                  className="w-auto"
                  style={{ height: Math.max(34, Math.round(w * 0.055)) }}
                />
                <div className="flex flex-col items-center gap-1 rounded-lg border border-white/15 bg-black/50 px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <ShieldCheck
                      className="text-[#4caf50]"
                      style={{ height: fs(0.017, 13), width: fs(0.017, 13) }}
                    />
                    <span
                      className="font-semibold uppercase tracking-[0.18em] text-white/80"
                      style={{ fontSize: fs(0.013, 10) }}
                    >
                      Provably Fair
                    </span>
                  </div>
                  <span
                    className="uppercase tracking-[0.2em] text-white/35"
                    style={{ fontSize: fs(0.009, 8) }}
                  >
                    Powered by Lunar
                  </span>
                </div>
                {/* Fallback lockup keeps the countdown bar stacked beneath it. */}
                <div className="mt-3 flex flex-col items-center gap-1.5">
                  {countdown}
                </div>
              </>
            )}
          </div>
        ) : phase === "flying" ? (
          <div
            className="font-extrabold tracking-tight text-white tabular-nums"
            style={{
              fontSize: readoutFs,
              lineHeight: 1,
              textShadow: "0 4px 28px rgba(0,0,0,0.55)",
            }}
            data-testid="text-multiplier"
          >
            {multiplier.toFixed(2)}x
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {/* Headline is WHITE in the reference — only the number is red. */}
            <div
              className="animate-flew-away font-bold uppercase text-white"
              style={{ fontSize: Math.round(readoutFs * 0.4), lineHeight: 1.1 }}
            >
              Flew Away!
            </div>
            <div
              className="animate-count-up mt-1 font-extrabold tracking-tight tabular-nums"
              style={{
                fontSize: readoutFs,
                lineHeight: 1,
                color: CURVE,
              }}
              data-testid="text-crash-multiplier"
            >
              {multiplier.toFixed(2)}x
            </div>
          </div>
        )}
      </div>

      {/* Live players pill — reference .wrapper: 32px tall, radius 16, 24px
          avatars ringed in #28a90a, count 12px/500. */}
      <div className="absolute bottom-4 right-4 flex h-[32px] items-center gap-1 rounded-[16px] bg-black/55 px-2 backdrop-blur-sm">
        <div className="flex">
          {pillFaces.map((b, i) => (
            <PlayerAvatar
              key={b.id}
              name={b.name}
              className="h-[24px] w-[24px] rounded-full border border-[#28a90a] text-center text-[10px] font-bold leading-[22px] text-white"
              style={{ marginLeft: i ? -8 : 0 }}
            />
          ))}
        </div>
        <span className="text-[12px] font-medium text-white tabular-nums">
          {onlinePlayers.toLocaleString("en-IN")}
        </span>
      </div>
    </div>
  );
}
