/**
 * Aviator-style red propeller plane, drawn as inline SVG so it stays crisp at
 * any size. Silhouette follows the classic Aviator branding: single-prop
 * low-wing plane seen from the side, nose to the right, with fixed landing
 * gear and an "X" mark on the tail. The propeller is a separate group so it
 * can spin while flying.
 */
export default function AviatorPlane({
  size = 56,
  color = "#e11d48",
  spinning = false,
}: {
  size?: number;
  color?: string;
  spinning?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block", overflow: "visible" }}
    >
      <g fill={color}>
        {/* Fuselage: tapered body nose-right */}
        <path d="M8 38 C14 33 30 27.5 44 26.5 C50 26.2 54 27.5 55.5 29.5 C56.5 31 55.5 32.8 52.5 33.8 C46 36 28 39.5 16 40.5 C10.5 41 6.8 40 8 38 Z" />
        {/* Tail fin with X badge cutout */}
        <path d="M9 37.8 L4.5 24.5 L12.5 23.5 L18.5 34.5 Z" />
        {/* Horizontal stabilizer */}
        <path d="M6 39.5 L1 43.5 L11 43 L14.5 39.8 Z" />
        {/* Cockpit canopy */}
        <path d="M33 26.8 C34.5 22.5 38 20 41.5 20.5 C44.5 21 45.5 23.5 44.5 26.3 C41 26.5 36.5 26.6 33 26.8 Z" />
        {/* Low wing sweeping down-left */}
        <path d="M30 33 L14 45.5 C12.5 46.6 13.5 48 15.5 47.5 L38 41.5 C40.5 40.8 41.5 38.5 40 36.5 Z" />
        {/* Wing struts */}
        <path d="M27 35 L22 46 L24.4 46 L29.6 35.8 Z" />
        {/* Landing gear legs + wheels */}
        <path d="M24 41 L21.5 50 L24 50 L26.6 41.3 Z" />
        <path d="M36 38.5 L34.8 48 L37.2 48 L38.6 38.6 Z" />
        <circle cx="22" cy="52" r="3.4" />
        <circle cx="36.4" cy="50" r="3.4" />
        {/* Engine cowling / nose */}
        <path d="M52 28.5 C55.5 28.3 57.8 29.5 57.8 31 C57.8 32.5 55.5 33.8 52 33.8 Z" />
      </g>
      {/* Tail "X" badge in background color */}
      <g stroke="rgba(0,0,0,0.55)" strokeWidth="1.6" strokeLinecap="round">
        <path d="M7.5 27.5 L12.5 33" />
        <path d="M12.5 27.5 L7.5 33" />
      </g>
      {/* Propeller: hub + blades, spins while flying */}
      <g className={spinning ? "animate-propeller" : undefined} style={{ transformOrigin: "59px 31px" }}>
        <ellipse cx="59" cy="21.5" rx="2.6" ry="10" fill={color} opacity={spinning ? 0.7 : 1} transform="rotate(8 59 31)" />
        <ellipse cx="59" cy="40.5" rx="2.6" ry="10" fill={color} opacity={spinning ? 0.7 : 1} transform="rotate(8 59 31)" />
        {spinning && (
          <circle cx="59" cy="31" r="11" fill="none" stroke={color} strokeWidth="1.4" opacity="0.35" />
        )}
      </g>
      <circle cx="59" cy="31" r="2.6" fill={color} />
    </svg>
  );
}
