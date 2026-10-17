import { BET_SEND_BUFFER_MS } from "../table/AutoBet";
import { useEffect, useRef } from "react";
import { useStore } from "@/game/store";
import { Rocket, Send, Bot, Satellite, type LucideIcon } from "lucide-react";
import { getCrashTheme } from "@/game/crashThemes";
import AviatorPlane from "./AviatorPlane";
import FlightEnvironment from "../instant/FlightEnvironment";
import FlightCraft from "../instant/FlightCraft";

// `aviator: true` renders the custom Aviator SVG plane instead of a Lucide
// icon. The classic (default) skin is the Aviator red propeller plane.
const PLANE_SKINS: Record<
  string,
  { Icon?: LucideIcon; aviator?: boolean; color: string; size: number }
> = {
  classic: { aviator: true, color: "#e11d48", size: 64 },
  jet: { Icon: Send, color: "#3b82f6", size: 52 },
  rocket: { Icon: Rocket, color: "#f59e0b", size: 56 },
  ufo: { Icon: Bot, color: "#a855f7", size: 56 },
  paper: { Icon: Satellite, color: "#e5e5e5", size: 50 },
};

export default function GameCanvas() {
  const phase = useStore((s) => s.phase);
  const multiplier = useStore((s) => s.multiplier);
  const flyMs = useStore((s) => s.flyMs);
  const countdownMs = useStore((s) => s.countdownMs);
  const countdownTotalMs = useStore((s) => s.countdownTotalMs);
  const settings = useStore((s) => s.settings);
  const activeGameCode = useStore((s) => s.activeGameCode);
  const theme = getCrashTheme(activeGameCode);
  const lang = settings.language;
  // On Lunar the player's chosen plane skin applies; every themed variant
  // uses its own branded vehicle + color instead.
  const skin =
    theme.code === "lunar"
      ? (PLANE_SKINS[settings.planeSkin] ?? PLANE_SKINS.classic)
      : theme.code === "aviator"
        ? { aviator: true as const, color: theme.vehicleColor, size: 64 }
        : { Icon: theme.Icon, color: theme.vehicleColor, size: 56 };
  const PlaneIcon = skin.Icon;

  const containerRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const sizeRef = useRef({ w: 800, h: 480 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      sizeRef.current = { w: r.width, h: r.height };
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Compute plane position from flyMs. Tight padding so the flight path uses
  // the whole canvas: takeoff hugs the bottom-left corner and the arc ends at
  // the far top-right corner (real-Aviator full-screen sweep).
  const { w, h } = sizeRef.current;

  // Curve params: arc that asymptotes top-right. The plane's progress is tied
  // to the MULTIPLIER (log scale), not wall-clock time: it only settles into
  // the far corner once the round reaches 10×. Below that it keeps visibly
  // climbing, so short rounds crash mid-canvas instead of at the corner.
  const t =
    phase === "flying" || phase === "crashed"
      ? Math.min(Math.log(Math.max(1, multiplier)) / Math.log(10), 1)
      : 0;
  // Climb curve: starts moving IMMEDIATELY (small linear component) but much
  // more gently than the old ease-out, then smoothly accelerates mid-flight
  // and settles into the top-right corner (smoothstep component).
  const et = 0.25 * t + 0.75 * (t * t * (3 - 2 * t));
  // Takeoff glued to the very bottom-left corner; landing point just inside
  // the top-right corner so the plane sprite stays visible.
  const px = 14 + (w - 14 - 54) * et;
  const py = (h - 16) - ((h - 16) - 44) * et;

  // Gentle sine-wave "bobbing" while flying (presentation only).
  const bob = phase === "flying" ? Math.sin(flyMs / 260) * 6 : 0;
  const planeY = py + bob;

  // Build trail SVG path with quadratic curve. The control point tracks the
  // plane so the bow stays proportional to the current arc instead of
  // sagging along the bottom and leaving a big empty gap above the curve.
  const startX = 2;
  const startY = h - 2;
  const ctrlX = startX + (px - startX) * 0.62;
  const ctrlY = startY - (startY - planeY) * 0.12;
  const trailD = `M ${startX} ${startY} Q ${ctrlX} ${ctrlY} ${px} ${planeY}`;

  const trailColor =
    theme.code === "lunar" ? settings.trailColor || "#ef4444" : theme.trailColor;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full overflow-hidden rounded-2xl border border-card-border ${theme.canvasBg}`}
    >
      {!theme.sunburst && <FlightEnvironment code={theme.code} accent={theme.accent} />}
      {/* Aviator-style sunburst: dark charcoal rays sweeping slowly around
          the flight origin (bottom-left) over a near-black canvas, exactly
          like the Spribe reference — subtle gray wedges, no color. */}
      {theme.sunburst && (
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
          {/* Vignette so edges fall back to black and text pops */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(120% 120% at 8% 92%, rgba(0,0,0,0) 25%, rgba(0,0,0,0.65) 100%)",
            }}
          />
        </div>
      )}

      {/* Grid — only for non-sunburst (non-Aviator-look) themes */}
      {!theme.sunburst && <div className="absolute inset-0 bg-grid opacity-30" />}

      {/* Trail SVG */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <defs>
          <linearGradient id="trail-fill" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={trailColor} stopOpacity="0.35" />
            <stop offset="60%" stopColor={trailColor} stopOpacity="0.5" />
            <stop offset="100%" stopColor={trailColor} stopOpacity="0.65" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {(phase === "flying" || phase === "crashed") && (
          <>
            {/* Filled area under the curve */}
            <path
              d={`${trailD} L ${px} ${h} L ${startX} ${h} Z`}
              fill="url(#trail-fill)"
            />
            <path
              ref={trailRef}
              d={trailD}
              stroke={trailColor}
              strokeWidth={4}
              fill="none"
              filter={settings.quality === "high" ? "url(#glow)" : undefined}
              strokeLinecap="round"
            />
          </>
        )}
      </svg>

      {/* Plane. During the betting phase the plane sits at the runway origin
          with its propeller spinning (real-Aviator style) instead of hiding
          behind a full-screen countdown. */}
      <div
        ref={planeRef}
        className={`absolute transition-transform duration-100 ${phase === "crashed" ? "animate-fly-away" : ""}`}
        style={{
          left: px - skin.size / 2,
          top: planeY - skin.size / 2,
          transform:
            phase === "betting"
              ? "rotate(0deg)"
              : `rotate(${-25 + Math.min(20, flyMs / 200)}deg)`,
          color: skin.color,
          filter: settings.quality === "high" ? `drop-shadow(0 0 12px ${skin.color})` : undefined,
        }}
      >
          <div className="relative">
            {skin.aviator ? (
              <AviatorPlane
                size={skin.size}
                color={skin.color}
                spinning={phase === "flying" || phase === "betting"}
              />
            ) : theme.code !== "lunar" ? (
              <FlightCraft color={skin.color} size={skin.size} />
            ) : (
              PlaneIcon && <PlaneIcon size={skin.size} strokeWidth={1.5} />
            )}
            {/* Spinning propeller at the nose (icon skins only; the Aviator
                plane has its own built-in propeller) */}
            {(phase === "flying" || phase === "betting") && !skin.aviator && theme.code === "lunar" && (
              <div
                className="animate-propeller absolute"
                style={{
                  left: skin.size - 6,
                  top: skin.size / 2 - skin.size * 0.18,
                  width: skin.size * 0.36,
                  height: skin.size * 0.36,
                }}
              >
                <div
                  className="absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: 2,
                    height: skin.size * 0.34,
                    background: skin.color,
                    opacity: 0.55,
                    transform: "translate(-50%, -50%)",
                  }}
                />
                <div
                  className="absolute left-1/2 top-1/2 rounded-full"
                  style={{
                    width: skin.size * 0.34,
                    height: 2,
                    background: skin.color,
                    opacity: 0.55,
                    transform: "translate(-50%, -50%)",
                  }}
                />
              </div>
            )}
          </div>
        </div>

      {/* Multiplier overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none">
        {phase === "betting" ? (
          <div className="text-center -translate-y-8">
            <div className="text-xs text-muted-foreground mb-1 tracking-widest uppercase">
              {lang === "hi" ? "तैयार हो जाओ" : "Get ready"}
            </div>
            <div className="text-3xl font-bold font-mono text-glow text-primary">
              {(Math.max(0, countdownMs - BET_SEND_BUFFER_MS) / 1000).toFixed(1)}s
            </div>
            <div className="mt-2 w-40 h-1 bg-secondary rounded-full overflow-hidden mx-auto">
              <div
                className="h-full bg-primary transition-all duration-100"
                style={{
                  width: `${100 - (countdownMs / Math.max(1, countdownTotalMs)) * 100}%`,
                }}
              />
            </div>
          </div>
        ) : phase === "flying" ? (
          <div
            className="text-center"
            style={{
              transform: `scale(${1 + Math.min(0.3, multiplier / 50)})`,
              transition: "transform 0.2s",
            }}
          >
            {/* Aviator look: huge, extra-bold, pure white readout like "1.07x" */}
            <div
              className="font-extrabold text-white tracking-tight"
              style={{
                fontSize: "clamp(56px, 12vw, 144px)",
                lineHeight: 1,
                textShadow: "0 4px 24px rgba(0,0,0,0.6)",
              }}
            >
              {multiplier.toFixed(2)}x
            </div>
          </div>
        ) : (
          <div className="text-center">
            <div
              className="animate-flew-away font-bold text-destructive uppercase tracking-wider drop-shadow-[0_0_20px_rgba(239,68,68,0.6)]"
              style={{ fontSize: "clamp(28px, 6vw, 72px)", lineHeight: 1 }}
            >
              {lang === "hi" ? "उड़ गया!" : "FLEW AWAY!"}
            </div>
            <div
              className="mt-2 text-xs uppercase tracking-widest text-destructive/80 font-semibold"
            >
              {lang === "hi" ? theme.crashTextHi : theme.crashText}
            </div>
            <div
              className="animate-count-up font-extrabold text-destructive tracking-tight mt-1"
              style={{ fontSize: "clamp(56px, 12vw, 144px)", lineHeight: 1 }}
            >
              {multiplier.toFixed(2)}x
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
