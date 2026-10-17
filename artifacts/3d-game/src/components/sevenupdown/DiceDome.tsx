import type { CSSProperties } from "react";

const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export function Pips({ value, className = "" }: { value: number; className?: string }) {
  return <span className={`sud-pips ${className}`} aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} className={PIPS[value]?.includes(i) ? "is-pip" : ""} />)}</span>;
}

function Die({ value, index, rolling }: { value: number; index: number; rolling: boolean }) {
  // Opposing cube faces always add to seven; the front is the recorded result.
  const top = value === 1 || value === 6 ? 3 : 1;
  const side = [2, 3, 4, 5].find(n => ![value, 7 - value, top, 7 - top].includes(n))!;
  const faces = [value, 7 - value, top, 7 - top, side, 7 - side];
  return <div className={`sud-die-position sud-die-${index}`} role="img" aria-label={rolling ? `Die ${index + 1} rolling` : `Die ${index + 1}: ${value}`}>
    <div className="sud-die-cube" style={{ "--die-turn": index ? "-25deg" : "24deg" } as CSSProperties}>
      {faces.map((face, i) => <div key={i} className={`sud-die-face sud-face-${i} ${face === 1 || face === 4 ? "sud-red-pips" : ""}`}><Pips value={face} /></div>)}
    </div>
  </div>;
}

export default function DiceDome({ dice, phase }: { dice: number[]; phase: "idle" | "rolling" | "reveal" }) {
  return <div className={`sud-dome-scene is-${phase}`} data-testid="dice-dome">
    <div className="sud-table-watermark" aria-hidden="true">7 UP <span>◆</span> 7 DOWN</div>
    <div className="sud-dome-shadow" />
    <div className="sud-dome-base"><div className="sud-dome-felt" /></div>
    <div className="sud-dice-pair"><Die value={phase === "rolling" ? 3 : dice[0]} index={0} rolling={phase === "rolling"} /><Die value={phase === "rolling" ? 4 : dice[1]} index={1} rolling={phase === "rolling"} /></div>
    <div className="sud-glass-dome" aria-hidden="true"><span className="sud-glass-shine" /><span className="sud-glass-shine-small" /><span className="sud-glass-rim" /></div>
    <div className="sud-front-rim" />
  </div>;
}
