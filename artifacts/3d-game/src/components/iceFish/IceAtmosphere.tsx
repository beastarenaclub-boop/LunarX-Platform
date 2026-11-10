import type { CSSProperties } from "react";
import "./ice-atmosphere.css";

/** Decorative weather only; no timers, random results or player activity. */
export default function IceAtmosphere({ surface = false }: { surface?: boolean }) {
  return <div className={`if-atmosphere ${surface ? "is-surface" : "is-wheel"}`} aria-hidden="true">
    <div className="if-cloud if-cloud-far" />
    <div className="if-cloud if-cloud-middle" />
    <div className="if-cloud if-cloud-near" />
    <div className="if-cloud if-cloud-edge" />
    <div className="if-ice-dust">{Array.from({ length: 24 }, (_, i) => <i key={i} style={{
      left: `${(i * 37 + 9) % 100}%`, top: `${(i * 23) % 95}%`,
      "--dust-delay": `${-i * .71}s`, "--dust-time": `${6 + i % 6}s`,
      "--dust-size": `${i % 5 === 0 ? 4 : 1 + i % 3}px`,
    } as CSSProperties} />)}</div>
  </div>;
}
