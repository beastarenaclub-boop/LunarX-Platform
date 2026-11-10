import type { CSSProperties } from "react";
import { ICE_FISH_LABELS, ICE_FISH_VALUES, iceFishMultiplier, type IceFishOutcome } from "@workspace/api-zod/ice-fish";
import { Fish } from "./IceWheel";
import { fishingPresentation, multiplierLabel } from "./iceFishPresentation";
import "./ice-fishing-bonus.css";

type Color = "blue" | "green" | "red";
export default function IceFishingBonus({ color, outcome, elapsed, revealMs, settled, multiplier, houseEdge, cap, win, money, reducedMotion }: {
  color: Color; outcome: IceFishOutcome; elapsed: number; revealMs: number; settled: boolean;
  multiplier: number; houseEdge: number; cap: number; win: bigint; money: (n: bigint) => string; reducedMotion: boolean;
}) {
  const { stage, progress, cast, reel, lift } = fishingPresentation(elapsed, revealMs, settled);
  const aboveWater = !["intro", "underwater"].includes(stage);
  const rodAngle = 26 * cast - 4 * lift;
  const radians = rodAngle * Math.PI / 180;
  const headX = 480 + 155 * Math.cos(radians) + 505 * Math.sin(radians), headY = 565 + 155 * Math.sin(radians) - 505 * Math.cos(radians);
  const fishY = 610 - 235 * lift;
  const shownMultiplier = stage === "result" || stage === "catch" ? multiplier
    : Math.min(multiplier, Math.max(Math.min(1, multiplier), Math.floor(multiplier * reel * 100) / 100));
  const values = ICE_FISH_VALUES[color].map(fishValue => Math.min(cap, iceFishMultiplier({ ...outcome, fishValue }, houseEdge)));
  return <section className={`if-fishing-bonus bonus-${color} bonus-${stage}`} role="status"
    aria-label={`${ICE_FISH_LABELS[color]} fishing bonus`} data-testid="ice-fishing-bonus" data-stage={stage}
    style={{ "--bonus-progress": progress, "--cast": cast, "--lift": lift } as CSSProperties}>
    {stage === "intro" && <div className="if-bonus-intro"><div className="if-ice-sweep" /><Fish color={color} /><h2>{ICE_FISH_LABELS[color]}</h2><p>FISHING BONUS</p></div>}
    {stage === "underwater" && <div className="if-underwater" data-testid="ice-underwater">
      <div className="if-water-rays" />
      {Array.from({ length: 18 }, (_, i) => <div key={i} className={`if-school-fish ${i % 2 ? "swim-left" : "swim-right"}`} style={{
        left: `${(i % 3) * 36 - 10 + (Math.floor(i / 3) % 2) * 12}%`, top: `${Math.floor(i / 3) * 16 - 3}%`,
        width: `${18 + (i % 4) * 2}%`, opacity: i % 4 === 0 ? .5 : .9,
        "--swim-delay": `${-i * .7}s`, "--swim-time": `${7 + i % 4}s`,
      } as CSSProperties}><Fish color={color} /><strong>{multiplierLabel(values[Math.floor(i / 3)])}</strong></div>)}
      <div className="if-bubbles">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-i * .6}s`, width: `${3 + i % 5}px` }} />)}</div>
      <div className="if-bonus-badge"><Fish color={color} /><strong>{ICE_FISH_LABELS[color]}</strong></div>
    </div>}
    {aboveWater && <>
      <div className="if-fishing-landscape" />
      <div className="if-snow">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${-i * .41}s`, animationDuration: `${4 + i % 5}s` }} />)}</div>
      <div className="if-fishing-world">
        <div className="if-fishing-dock" />
        <div className="if-bonus-hole"><i /><i /></div>
        <img className={`if-fisher ${stage === "reeling" ? "is-reeling" : ""}`} src="/media/ice-fish/fisher-v3.webp" alt="" />
        <svg className="if-fishing-rig" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="if-rod-metal"><stop stopColor="#344b59" /><stop offset=".4" stopColor="#f5fbff" /><stop offset=".6" stopColor="#c0d2df" /><stop offset="1" stopColor="#43565f" /></linearGradient>
            <linearGradient id="if-rig-body" x2="0" y2="1"><stop stopColor="#677a87" /><stop offset="1" stopColor="#182b39" /></linearGradient></defs>
          <g transform={`rotate(${rodAngle} 480 565)`}>
            <path d="M480 565 Q495 385 500 245 Q515 85 635 60" fill="none" stroke="#283943" strokeWidth="18" />
            <path d="M480 565 Q495 385 500 245 Q515 85 635 60" fill="none" stroke="url(#if-rod-metal)" strokeWidth="12" />
            {[0,1,2,3,4,5].map(i => <path key={i} d={`M${481+i*2} ${510-i*53}l22 1`} stroke="#273c49" strokeWidth="6" />)}
          </g>
          <path d={`M480 565 Q${530 + cast * 120} 260 ${headX} ${headY} L${headX} ${fishY - 26}`} fill="none" stroke="#172d3b" strokeWidth="1.8" />
          <path d={`M${headX} ${fishY - 30}v18q0 12 -10 8`} fill="none" stroke="#d6e4eb" strokeWidth="4" />
          <path d="M452 550L490 550L500 622H440Z" fill="url(#if-rig-body)" stroke="#7d929e" strokeWidth="3" />
          <circle cx="475" cy="560" r="26" fill="#425765" stroke="#93a4ad" strokeWidth="4" />
          <path d="M400 616l12-83h15l35 83" fill="none" stroke="#384d59" strokeWidth="9" />
          <circle cx="415" cy="530" r="29" fill="#3a505c" stroke="#aebdc2" strokeWidth="3" />
          <g transform={`rotate(${reducedMotion ? 0 : reel * 2000} 415 530)`}><path d="M415 530l-20-17" stroke="#d0dadd" strokeWidth="5" /><circle cx="395" cy="513" r="7" fill="#f1c330" /></g>
          <rect x="385" y="610" width="145" height="42" rx="6" fill="url(#if-rig-body)" stroke="#879ba5" strokeWidth="3" />
          <rect x="400" y="639" width="115" height="18" rx="3" fill="#a5193a" />
          {[407,514].map(x => <g key={x}><circle cx={x} cy="658" r="26" fill="#182e3c" stroke="#657781" strokeWidth="8" strokeDasharray="7 3" /><circle cx={x} cy="658" r="17" fill="#efc42e" stroke="#98822c" strokeWidth="4" /><circle cx={x} cy="658" r="8" fill="#a99739" /></g>)}
        </svg>
        {(stage === "catch" || stage === "result") && <div className="if-fish-catch-mask"><div className="if-lifted-fish" style={{ left: `${headX / 12}%`, top: `${fishY / 7.2}%`, opacity: Math.min(1, lift * 8), transform: "translate(-50%, -8%) rotate(90deg)" }}><Fish color={color} /></div></div>}
        {(stage === "reeling" || stage === "catch") && <div className="if-water-splash">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--drop": i } as CSSProperties} />)}</div>}
      </div>
      <div className="if-catch-meter" data-testid="ice-catch-multiplier"><strong>{multiplierLabel(shownMultiplier)}</strong><small>{stage === "casting" ? "CASTING" : stage === "reeling" ? "REELING IN" : "YOUR CATCH"}</small></div>
    </>}
    {stage === "result" && <div className={`if-bonus-finish ${win > 0n ? "is-win" : ""}`} data-testid="ice-bonus-result">
      {win > 0n && <div className="if-coin-rain" aria-hidden="true">{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ left: `${(i * 31) % 100}%`, animationDelay: `${-i * .17}s`, "--coin-size": `${25 + i % 4 * 17}px` } as CSSProperties} />)}</div>}
      <div className="if-final-ice"><Fish color={color} /><b>{multiplierLabel(multiplier)}</b><strong>{win > 0n ? money(win) : ICE_FISH_LABELS[color]}</strong><span>{win > 0n ? "YOU WON" : settled ? "ROUND COMPLETE" : "CATCH REVEALED"}</span></div>
    </div>}
  </section>;
}
