import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from "react";
import poster from "@/assets/roulette-dealer/dealer-poster.jpg";
import { EUROPEAN_WHEEL_ORDER, pocketColor, roulettePocketAtWheelRotation } from "./wheelData";
import type { RouletteWheelModelHandle } from "./RouletteWheelModel";
import { BALL_RELEASE_POINT } from "./dealerTiming";

// Geometry is in the original 1920×1080 camera frame. The photographed housing
// is stationary; every numbered pocket and the ball are rendered by the game.
// Parking at the near rim keeps the ball clear of the central spindle.
const CX = 748, CY = 813, PERSPECTIVE = 0.42;
const SLICE = 360 / 37;
const TRACK_RADIUS = 475, POCKET_RADIUS = 320;
const point = (radius: number, degrees: number) => {
  const angle = (degrees - 90) * Math.PI / 180;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
};
function sector(index: number, outer: number, inner: number) {
  const a = index * SLICE - SLICE / 2, b = a + SLICE;
  const [ax, ay] = point(outer, a), [bx, by] = point(outer, b);
  const [ix, iy] = point(inner, b), [jx, jy] = point(inner, a);
  return `M${ax},${ay} A${outer},${outer} 0 0 1 ${bx},${by} L${ix},${iy} A${inner},${inner} 0 0 0 ${jx},${jy}Z`;
}

export default forwardRef<RouletteWheelModelHandle, { onReady?: () => void }>(
  function RouletteStudioWheel({ onReady }, ref) {
    const id = useId().replace(/:/g, "");
    const rotor = useRef<SVGGElement>(null);
    const ball = useRef<SVGCircleElement>(null);
    const ballLayer = useRef<SVGGElement>(null);
    const shadow = useRef<SVGEllipseElement>(null);
    const trail = useRef<SVGPathElement>(null);
    const root = useRef<SVGSVGElement>(null);
    const lastWinner = useRef<number | null>(null);
    useImperativeHandle(ref, () => ({
      setMotion(wheelDeg, ballDeg, drop, presentation = { visible: true, flight: 1 }) {
        // Both transforms use the same 180° camera offset. No result is ever
        // baked into footage or inferred from the number badge.
        const rotation = (wheelDeg + 180) % 360;
        rotor.current?.setAttribute("transform", `rotate(${rotation})`);
        const radius = TRACK_RADIUS + (POCKET_RADIUS - TRACK_RADIUS) * drop;
        // A few diminishing skips as the ball crosses the brass frets. The
        // displacement is exactly zero at rest, preserving every pocket match.
        const skip = Math.sin(drop * Math.PI) * Math.abs(Math.sin(drop * Math.PI * 4));
        const [x, y] = point(radius, ballDeg + 180 + skip * 1.1);
        const flight = presentation.flight;
        const floorX = CX + x, floorY = CY + y * PERSPECTIVE;
        const bx = BALL_RELEASE_POINT.x + (floorX - BALL_RELEASE_POINT.x) * flight;
        const by = BALL_RELEASE_POINT.y + (floorY - BALL_RELEASE_POINT.y) * (.5 * flight + .5 * flight * flight) - skip * 7;
        const trackSize = 8.2 * (1 + y / TRACK_RADIUS * 0.15);
        const size = 11 + (trackSize - 11) * flight;
        ballLayer.current?.setAttribute("visibility", presentation.visible ? "visible" : "hidden");
        root.current?.setAttribute("data-ball-stage", !presentation.visible ? "held" : flight < 1 ? "flight" : drop >= 1 ? "settled" : drop > 0 ? "dropping" : "orbit");
        ball.current?.setAttribute("cx", String(bx));
        ball.current?.setAttribute("cy", String(by));
        ball.current?.setAttribute("r", String(size));
        shadow.current?.setAttribute("cx", String(bx + 2));
        shadow.current?.setAttribute("cy", String(floorY + size * .65));
        shadow.current?.setAttribute("rx", String(size * (1.05 + skip * .4)));
        shadow.current?.setAttribute("ry", String(size * .36));
        shadow.current?.setAttribute("opacity", String(flight * (.55 - skip * .18)));
        const [tx, ty] = point(radius, ballDeg + 180 + 1.7);
        trail.current?.setAttribute("d", `M${CX + tx} ${CY + ty * PERSPECTIVE} L${bx} ${by}`);
        trail.current?.setAttribute("opacity", drop === 0 && flight >= 1 ? ".18" : "0");
        const winner = drop >= 1 ? roulettePocketAtWheelRotation(wheelDeg) : null;
        if (winner !== lastWinner.current) {
          root.current?.querySelector('[data-winning="true"]')?.removeAttribute("data-winning");
          if (winner !== null) root.current?.querySelector(`[data-pocket="${winner}"]`)?.setAttribute("data-winning", "true");
          lastWinner.current = winner;
        }
        root.current?.setAttribute("data-landed-pocket", winner === null ? "" : String(winner));
      },
    }), []);
    useLayoutEffect(() => { onReady?.(); }, []);

    return <svg ref={root} viewBox="0 0 1920 1080" className="roulette-studio-controlled-wheel"
      data-testid="roulette-controlled-wheel" aria-label="European roulette wheel, 37 pockets">
      <defs>
        <clipPath id={`${id}-housing`}><ellipse cx="738" cy="813" rx="650" ry="300" /></clipPath>
        <clipPath id={`${id}-cone`}><ellipse cx={CX} cy={CY} rx="245" ry="93" /></clipPath>
        <clipPath id={`${id}-spindle`}>
          <path d="M748 544 Q766 546 771 556 L777 558 L778 573 L791 579 L790 591 L795 598 L797 622 L789 635 L781 645 L767 653 L767 676 L787 711 L785 722 L801 735 L809 746 L811 768 Q751 789 688 768 L691 746 L699 734 L714 722 L711 711 L734 676 L734 653 L719 646 L710 635 L705 622 L705 599 L711 591 L711 579 L725 573 L725 560 L734 556 Q737 546 748 544Z" />
        </clipPath>
        <radialGradient id={`${id}-brass`} cx="38%" cy="30%"><stop stopColor="#fff0c5" /><stop offset=".4" stopColor="#c0a174" /><stop offset=".7" stopColor="#ece0bd" /><stop offset="1" stopColor="#7c5c32" /></radialGradient>
        <radialGradient id={`${id}-wood`} cx="47%" cy="45%"><stop stopColor="#a46736" /><stop offset=".28" stopColor="#6b3017" /><stop offset=".64" stopColor="#8c4927" /><stop offset="1" stopColor="#422016" /></radialGradient>
        <radialGradient id={`${id}-ivory`} cx="30%" cy="25%"><stop stopColor="#fffef7" /><stop offset=".5" stopColor="#f1ead9" /><stop offset="1" stopColor="#a2947a" /></radialGradient>
        <radialGradient id={`${id}-bowl`}>
          <stop offset=".82" stopColor="#27160f" /><stop offset=".86" stopColor="#8c5834" />
          <stop offset=".91" stopColor="#40261a" /><stop offset=".95" stopColor="#100d0b" />
          <stop offset=".98" stopColor="#1b1712" /><stop offset="1" stopColor="#987347" />
        </radialGradient>
        {(["red", "black", "green"] as const).map(color => <linearGradient key={color} id={`${id}-${color}`} x1="0" y1="0" x2=".3" y2="1">
          <stop stopColor={color === "red" ? "#d52e2d" : color === "green" ? "#218465" : "#343633"} />
          <stop offset=".45" stopColor={color === "red" ? "#9d1018" : color === "green" ? "#075b3e" : "#111512"} />
          <stop offset="1" stopColor={color === "red" ? "#590810" : color === "green" ? "#052d20" : "#050807"} />
        </linearGradient>)}
        <radialGradient id={`${id}-shade`}><stop offset=".55" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".32" /></radialGradient>
        <filter id={`${id}-shadow`} x="-80%" y="-80%" width="260%" height="260%"><feDropShadow dx="1" dy="4" stdDeviation="3" floodOpacity=".8" /></filter>
      </defs>
      {/* Opaque, still housing completely covers the filmed wheel and ball in
          every frame. The original numbered ring is covered by the rotor. */}
      <image href={poster} width="1920" height="1080" clipPath={`url(#${id}-housing)`} data-testid="roulette-wheel-housing" />
      <g transform={`translate(${CX} ${CY}) scale(1 ${PERSPECTIVE})`}>
        <circle r="514" fill={`url(#${id}-bowl)`} stroke="#d6b781" strokeWidth="2" />
        <circle r="480" fill="none" stroke="#d5c09b" strokeOpacity=".3" strokeWidth="2" />
        <circle r="452" fill="none" stroke="#140c08" strokeWidth="3" />
        <circle r="437" fill="#4e2b1b" />
        <circle r="432" fill={`url(#${id}-brass)`} />
        <g ref={rotor} data-testid="roulette-studio-rotor" transform="rotate(180)">
          <circle r="424" fill={`url(#${id}-wood)`} />
          {EUROPEAN_WHEEL_ORDER.map((n, i) => {
            const [x, y] = point(394, i * SLICE);
            return <g key={n} data-wheel-number={n}>
              <path d={sector(i, 422, 368)} fill={`url(#${id}-${pocketColor(n)})`} stroke="#d8c399" strokeWidth="1.3" />
              <path d={sector(i, 359, 276)} fill={`url(#${id}-${pocketColor(n)})`} stroke="#211b13" strokeWidth="3"
                className="roulette-studio-pocket" data-pocket={n} />
              <path d={sector(i, 357, 348)} fill="#060805" fillOpacity=".65" />
              <path d={sector(i, 283, 276)} fill="#ecd3a1" fillOpacity=".65" />
              <path d={`M${point(359, i * SLICE - SLICE / 2).join(" ")} L${point(278, i * SLICE - SLICE / 2).join(" ")}`}
                fill="none" stroke="#080a08" strokeWidth="8" />
              <path d={`M${point(359, i * SLICE - SLICE / 2).join(" ")} L${point(278, i * SLICE - SLICE / 2).join(" ")}`}
                fill="none" stroke={`url(#${id}-brass)`} strokeWidth="4" />
              <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#fff8e7"
                fontFamily="Georgia, serif" fontSize="33" fontWeight="700" stroke="#21160e" strokeWidth=".75" paintOrder="stroke"
                transform={`rotate(${i * SLICE + 180} ${x} ${y})`}>{n}</text>
            </g>;
          })}
          <circle r="364" fill="none" stroke={`url(#${id}-brass)`} strokeWidth="8" />
          <circle r="274" fill={`url(#${id}-wood)`} stroke={`url(#${id}-brass)`} strokeWidth="8" />
          {Array.from({ length: 28 }, (_, i) => {
            const [x, y] = point(267, i * 360 / 28), [ix, iy] = point(69, i * 360 / 28 + 2);
            return <path key={i} d={`M${ix} ${iy} Q${x * .62} ${y * .64} ${x} ${y}`} fill="none" stroke={i % 3 ? "#d6a575" : "#36170d"} strokeOpacity=".14" strokeWidth={i % 3 ? 2 : 4} />;
          })}
          <circle r="270" fill={`url(#${id}-shade)`} />
        </g>
      </g>
      {/* Preserve the photographed polished cone and its reflections. Only the
          indexed pocket rotor moves; this cap never exposes filmed numbers. */}
      <image href={poster} width="1920" height="1080" clipPath={`url(#${id}-cone)`} />
      <g ref={ballLayer} visibility="hidden">
        <ellipse ref={shadow} fill="#080906" />
        <path ref={trail} fill="none" stroke="#f2e6c9" strokeWidth="6" strokeLinecap="round" />
        <circle ref={ball} cx={CX} cy={CY + TRACK_RADIUS * PERSPECTIVE} r="8.2" fill={`url(#${id}-ivory)`}
          data-testid="roulette-studio-ball" />
      </g>
      <image href={poster} width="1920" height="1080" clipPath={`url(#${id}-spindle)`} />
    </svg>;
  },
);
