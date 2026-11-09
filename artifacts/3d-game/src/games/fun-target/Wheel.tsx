import { useEffect, useRef } from "react";
import { angleAt, targetAngle } from "./wheel-plan";
import { art } from "./art";
import { playWheelSound } from "./sounds";
import type { Reveal } from "./types";

export default function Wheel({ reveal, restingPocket, onLand, sound, spinning }: { sound: boolean; spinning: boolean; reveal: Reveal | null; restingPocket: number | null; onLand: (roundId: string, pocket: number) => void }) {
  const wheel = useRef<HTMLImageElement>(null);
  const angle = useRef(0), completed = useRef<string | null>(null);
  const spinStartedAt = useRef(0);
  const landed = useRef(onLand); landed.current = onLand;
  useEffect(() => {
    if (reveal) return;
    if (restingPocket !== null) angle.current = -36 * restingPocket;
    if (wheel.current) wheel.current.style.transform = `rotate(${angle.current}deg)`;
  }, [restingPocket, reveal]);
  useEffect(() => {
    if (!reveal || completed.current === reveal.roundId) return;
    const start = performance.now(), from = angle.current;
    spinStartedAt.current = start;
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 100 : reveal.duration;
    let frame = 0;
    const tick = (time: number) => {
      const progress = Math.min(1, (time - start) / Math.max(100, duration));
      angle.current = angleAt(from, reveal.pocket, progress);
      // Only the outer wheel turns: the centre medallion stays on its resting
      // frame through the spin (operator request, 2026-10-10 — it used to
      // flick through its twenty frames while the wheel ran).
      if (wheel.current) wheel.current.style.transform = `rotate(${angle.current}deg)`;
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        angle.current = targetAngle(from, reveal.pocket);
        completed.current = reveal.roundId; landed.current(reveal.roundId, reveal.pocket);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reveal]);
  useEffect(() => {
    if (!reveal || !spinning || !sound) return;
    return playWheelSound(sound, performance.now() - spinStartedAt.current);
  }, [reveal, spinning, sound]);
  return <>
    <img ref={wheel} className="ft-wheel ft-art" src={art["wheel.webp"] ?? art["wheel.png"]} alt="" draggable={false} />
    <img className="ft-logo ft-art" src={art[restingPocket === null ? "Logo_10.png" : "Logo_15.png"]} alt="" draggable={false} />
  </>;
}
