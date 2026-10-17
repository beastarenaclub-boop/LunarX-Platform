import type { CSSProperties } from "react";
import { useStore } from "@/game/store";
import airport from "@/assets/jetx/airport-runway-v3.webp";
import clouds from "@/assets/jetx/clouds-runway-v3.webp";
import night from "@/assets/jetx/night-runway-v3.webp";
import "./jetx-background.css";

export default function JetXBackdrop() {
  const phase = useStore(s => s.phase);
  const multiplier = useStore(s => s.multiplier);
  const airborne = phase !== "betting";
  const altitude = airborne ? Math.min(1, Math.max(0, (multiplier - 2.4) / 2.6)) : 0;
  return <div className="jetx-backdrop" aria-hidden="true" style={{ "--jetx-altitude": altitude } as CSSProperties}>
    <img className="jetx-background jetx-airport-background" src={airport} alt="" draggable={false} decoding="async" fetchPriority="high" style={{ opacity: airborne ? 0 : 1 }} />
    <img className="jetx-background jetx-cloud-background" src={clouds} alt="" draggable={false} decoding="async" style={{ opacity: airborne ? 1 : 0 }} />
    <img className="jetx-background jetx-night-background" src={night} alt="" draggable={false} decoding="async" style={{ opacity: altitude }} />
    <div className="jetx-background-shade" />
  </div>;
}
