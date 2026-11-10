import type { CSSProperties } from "react";
import { ICE_FISH_LABELS, ICE_FISH_VALUES, iceFishMultiplier, type IceFishOutcome } from "@workspace/api-zod/ice-fish";
import { Fish } from "./IceWheel";
import IceAtmosphere from "./IceAtmosphere";
import IceFishCard from "./IceFishCard";
import IceFishingRig from "./IceFishingRig";
import { fishingPresentation, multiplierLabel } from "./iceFishPresentation";
import "./ice-fishing-bonus.css";

type Color = "blue" | "green" | "red";
export default function IceFishingBonus({ color, outcome, elapsed, revealMs, settled, multiplier, houseEdge, cap, win, money, reducedMotion }: {
  color: Color; outcome: IceFishOutcome; elapsed: number; revealMs: number; settled: boolean;
  reducedMotion: boolean; multiplier: number; houseEdge: number; cap: number; win: bigint; money: (n: bigint) => string;
}) {
  const { stage, progress, reel } = fishingPresentation(elapsed, revealMs, settled);
  const aboveWater = !["intro", "underwater"].includes(stage);
  const shownMultiplier = stage === "result" || stage === "catch" ? multiplier
    : Math.min(multiplier, Math.max(Math.min(1, multiplier), Math.floor(multiplier * reel * 100) / 100));
  const values = ICE_FISH_VALUES[color].map(fishValue => Math.min(cap, iceFishMultiplier({ ...outcome, fishValue }, houseEdge)));
  return <section className={`if-fishing-bonus bonus-${color} bonus-${stage}`} role="status"
    aria-label={`${ICE_FISH_LABELS[color]} fishing bonus`} data-testid="ice-fishing-bonus" data-stage={stage}
    style={{ "--bonus-progress": progress } as CSSProperties}>
    {stage === "intro" && <div className="if-bonus-intro" aria-label="Ice Fish"><div className="if-ice-sweep" /><IceAtmosphere /></div>}
    {stage === "underwater" && <div className="if-underwater" data-testid="ice-underwater">
      <div className="if-water-rays" />
      {Array.from({ length: 24 }, (_, i) => <div key={i} className={`if-school-fish ${i % 3 ? "swim-left" : "swim-right"}`} style={{
        left: `${(i * 41) % 125 - 18}%`, top: `${(i * 29) % 104 - 9}%`,
        width: `${12 + (i * 7) % 17}%`, opacity: i < 8 ? .24 : i < 16 ? .57 : .95,
        filter: i < 8 ? "blur(1.5px)" : undefined, zIndex: Math.floor(i / 8),
        "--swim-delay": `${-i * .7}s`, "--swim-time": `${9 + i % 7}s`,
        "--value-length": multiplierLabel(values[i % values.length]).length,
      } as CSSProperties}><Fish color={color} /><strong>{multiplierLabel(values[i % values.length])}</strong></div>)}
      <div className="if-bubbles">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-i * .6}s`, width: `${3 + i % 5}px` }} />)}</div>
      <div className="if-bonus-badge"><IceFishCard color={color} /></div>
    </div>}
    {aboveWater && <>
      <div className="if-fishing-landscape" />
      <div className="if-surface-haze" />
      <div className="if-snow">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${-i * .41}s`, animationDuration: `${4 + i % 5}s` }} />)}</div>
      <div className="if-fishing-world">
        <div className="if-fishing-dock" />
        <div className="if-bonus-hole"><i /><i /></div>
        <IceFishingRig elapsed={elapsed} revealMs={revealMs} settled={settled} color={color} reducedMotion={reducedMotion} />
        {(stage === "reeling" || stage === "catch") && <div className="if-water-splash">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--drop": i } as CSSProperties} />)}</div>}
      </div>
      <IceAtmosphere surface />
      <div className="if-catch-meter" data-testid="ice-catch-multiplier" style={{"--catch-length":multiplierLabel(shownMultiplier).length} as CSSProperties}><strong>{multiplierLabel(shownMultiplier)}</strong><small>{stage === "casting" ? "CASTING" : stage === "reeling" ? "REELING IN" : "YOUR CATCH"}</small></div>
    </>}
    {stage === "result" && <div className={`if-bonus-finish ${win > 0n ? "is-win" : ""}`} data-testid="ice-bonus-result">
      {win > 0n && <div className="if-coin-rain" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} className={`if-falling-coin ${i % 5 === 0 ? "is-near" : ""}`} style={{
        left: `${(i * 31 + 7) % 112 - 6}%`,
        "--coin-delay": `${-i * .237}s`, "--coin-time": `${3.1 + i % 5 * .29}s`,
        "--coin-size": `${i % 5 === 0 ? 14 : 3.8 + i % 4 * 2.2}cqw`,
        "--coin-drift": `${(i % 7 - 3) * 4}cqw`, "--coin-turn": `${i % 2 ? -210 : 250}deg`,
        "--coin-spin": `${.75 + i % 4 * .18}s`, "--coin-start": `${i * 37}deg`,
      } as CSSProperties}><span className="if-coin-sprite" /><em /></i>)}</div>}
      <div className="if-final-ice"><Fish color={color} /><div className="if-final-badge" style={{"--multiplier-length":multiplierLabel(multiplier).length} as CSSProperties}><svg viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="if-badge-fill" x2="0" y2="1"><stop stopColor="#008ee2"/><stop offset=".6" stopColor="#0058a1"/><stop offset="1" stopColor="#00365e"/></linearGradient></defs><path d="M18 3H145L157 23V67L142 87H17L3 68V23Z" fill="url(#if-badge-fill)" stroke="#c0faff" strokeWidth="4"/><path d="M21 8H141L151 25V64L139 81H20L9 66V25Z" fill="none" stroke="#5ddcff" strokeWidth="2"/></svg><b>{multiplierLabel(multiplier)}</b></div><strong className="if-final-amount">{win > 0n ? money(win) : ICE_FISH_LABELS[color]}</strong><span className="if-final-caption">{win > 0n ? "YOU WON" : settled ? "ROUND COMPLETE" : "CATCH REVEALED"}</span></div>
    </div>}
  </section>;
}
