import { useEffect, useState } from "react";
import "./flight-environment.css";
export default function FlightEnvironment({ code, accent }: { code: string; accent: string }) {
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); const change = () => setMotion(!media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  return <div className={`flight-environment flight-env-${code}`} aria-hidden="true">
    {motion ? <video autoPlay loop muted playsInline preload="metadata" poster={`${import.meta.env.BASE_URL}media/instant/sky-poster.jpg`} src={`${import.meta.env.BASE_URL}media/instant/sky.mp4`} /> : <img alt="" src={`${import.meta.env.BASE_URL}media/instant/sky-poster.jpg`} />}
    <div className="flight-env-tint" style={{ background: `radial-gradient(ellipse at 75% 35%, ${accent}25, transparent 65%)` }} />
    <div className="flight-runway"><i /><i /><i /><i /></div>
  </div>;
}
