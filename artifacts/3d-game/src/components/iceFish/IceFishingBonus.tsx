import type { CSSProperties } from "react";
import { ICE_FISH_LABELS, ICE_FISH_VALUES, iceFishMultiplier, type IceFishOutcome } from "@workspace/api-zod/ice-fish";
import { Fish } from "./IceWheel";
import IceAtmosphere from "./IceAtmosphere";
import { fishingPresentation, multiplierLabel } from "./iceFishPresentation";
import "./ice-fishing-bonus.css";

type Color = "blue" | "green" | "red";
export default function IceFishingBonus({ color, outcome, elapsed, revealMs, settled, multiplier, houseEdge, cap, win, money }: {
  color: Color; outcome: IceFishOutcome; elapsed: number; revealMs: number; settled: boolean;
  multiplier: number; houseEdge: number; cap: number; win: bigint; money: (n: bigint) => string;
}) {
  const { stage, progress, cast, reel, lift } = fishingPresentation(elapsed, revealMs, settled);
  const aboveWater = !["intro", "underwater"].includes(stage);
  const rodAngle = 26 * cast - 4 * lift;
  const radians = rodAngle * Math.PI / 180;
  const headX = 464 + 171 * Math.cos(radians) + 458 * Math.sin(radians), headY = 518 + 171 * Math.sin(radians) - 458 * Math.cos(radians);
  const fishY = 610 - 235 * lift;
  const shownMultiplier = stage === "result" || stage === "catch" ? multiplier
    : Math.min(multiplier, Math.max(Math.min(1, multiplier), Math.floor(multiplier * reel * 100) / 100));
  const values = ICE_FISH_VALUES[color].map(fishValue => Math.min(cap, iceFishMultiplier({ ...outcome, fishValue }, houseEdge)));
  return <section className={`if-fishing-bonus bonus-${color} bonus-${stage}`} role="status"
    aria-label={`${ICE_FISH_LABELS[color]} fishing bonus`} data-testid="ice-fishing-bonus" data-stage={stage}
    style={{ "--bonus-progress": progress, "--cast": cast, "--lift": lift } as CSSProperties}>
    {stage === "intro" && <div className="if-bonus-intro" aria-label="Ice Fish"><div className="if-ice-sweep" /><IceAtmosphere /></div>}
    {stage === "underwater" && <div className="if-underwater" data-testid="ice-underwater">
      <div className="if-water-rays" />
      {Array.from({ length: 24 }, (_, i) => <div key={i} className={`if-school-fish ${i % 3 ? "swim-left" : "swim-right"}`} style={{
        left: `${(i * 41) % 125 - 18}%`, top: `${(i * 29) % 104 - 9}%`,
        width: `${12 + (i * 7) % 17}%`, opacity: i < 8 ? .24 : i < 16 ? .57 : .95,
        filter: i < 8 ? "blur(1.5px)" : undefined, zIndex: Math.floor(i / 8),
        "--swim-delay": `${-i * .7}s`, "--swim-time": `${9 + i % 7}s`,
      } as CSSProperties}><Fish color={color} /><strong>{multiplierLabel(values[i % values.length])}</strong></div>)}
      <div className="if-bubbles">{Array.from({ length: 20 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${-i * .6}s`, width: `${3 + i % 5}px` }} />)}</div>
      <div className="if-bonus-badge"><Fish color={color} /><strong>{ICE_FISH_LABELS[color]}</strong></div>
    </div>}
    {aboveWater && <>
      <div className="if-fishing-landscape" />
      <div className="if-surface-haze" />
      <div className="if-snow">{Array.from({ length: 28 }, (_, i) => <i key={i} style={{ left: `${(i * 29) % 100}%`, animationDelay: `${-i * .41}s`, animationDuration: `${4 + i % 5}s` }} />)}</div>
      <div className="if-fishing-world">
        <div className="if-fishing-dock" />
        <div className="if-bonus-hole"><i /><i /></div>
        <img className="if-fisher" src="/media/ice-fish/fishing-rig-v4.webp" alt="" />
        <svg className="if-fishing-rig" viewBox="0 0 1200 720" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="if-rig-body"><stop stopColor="#172734" /><stop offset=".4" stopColor="#6f8089" /><stop offset=".7" stopColor="#3d505b" /><stop offset="1" stopColor="#142431" /></linearGradient></defs>
          <g transform={`rotate(${rodAngle} 464 518)`}>
            <path d="M464 518 L515 220 C535 50 620 20 635 60" fill="none" stroke="#526875" strokeWidth="16" />
            <path d="M464 518 L515 220 C535 50 620 20 635 60" fill="none" stroke="#b6c9d0" strokeWidth="12" />
            <path d="M461 518 L512 220 C532 50 617 20 632 60" fill="none" stroke="#effaff" strokeWidth="4" />
            <path d="M442 520L456 439L497 446L482 527Z" fill="url(#if-rig-body)" stroke="#687b86" strokeWidth="2" />
            <path d="M448 516L460 444" stroke="#c0cbd1" strokeWidth="2" />
            {[[486,452],[493,396],[500,340],[507,284],[514,228],[527,165],[550,112],[585,75],[619,54]].map(([x,y],i) => <g key={i} transform={`translate(${x} ${y}) rotate(${i < 5 ? 7 : 15 + (i-5)*20})`}><path d="M-7 0h15v6H-7z" fill="#425764" stroke="#a4bac4" strokeWidth="1" /><ellipse cx="13" cy="3" rx="3" ry="4" fill="none" stroke="#596f7b" strokeWidth="1.5" /></g>)}
          </g>
          <path d={`M410 455 L464 518 Q${530 + cast * 120} 220 ${headX} ${headY} L${headX} ${fishY - 26}`} fill="none" stroke="#314756" strokeWidth="1.3" />
          <path d={`M${headX} ${fishY - 30}v18q0 12 -10 8`} fill="none" stroke="#d6e4eb" strokeWidth="4" />
        </svg>
        {(stage === "catch" || stage === "result") && <div className="if-fish-catch-mask"><div className="if-lifted-fish" style={{ left: `${headX / 12}%`, top: `${fishY / 7.2}%`, opacity: Math.min(1, lift * 8), transform: "translate(-50%, -8%) rotate(90deg)" }}><Fish color={color} /></div></div>}
        {(stage === "reeling" || stage === "catch") && <div className="if-water-splash">{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ "--drop": i } as CSSProperties} />)}</div>}
      </div>
      <IceAtmosphere surface />
      <div className="if-catch-meter" data-testid="ice-catch-multiplier"><strong>{multiplierLabel(shownMultiplier)}</strong><small>{stage === "casting" ? "CASTING" : stage === "reeling" ? "REELING IN" : "YOUR CATCH"}</small></div>
    </>}
    {stage === "result" && <div className={`if-bonus-finish ${win > 0n ? "is-win" : ""}`} data-testid="ice-bonus-result">
      {win > 0n && <div className="if-coin-rain" aria-hidden="true">{Array.from({ length: 28 }, (_, i) => <i key={i} className={`if-falling-coin ${i % 5 === 0 ? "is-near" : ""}`} style={{
        left: `${(i * 31 + 7) % 112 - 6}%`,
        "--coin-delay": `${-i * .237}s`, "--coin-time": `${3.1 + i % 5 * .29}s`,
        "--coin-size": `${i % 5 === 0 ? 14 : 3.8 + i % 4 * 2.2}cqw`,
        "--coin-drift": `${(i % 7 - 3) * 4}cqw`, "--coin-turn": `${i % 2 ? -210 : 250}deg`,
        "--coin-spin": `${.75 + i % 4 * .18}s`, "--coin-start": `${i * 37}deg`,
      } as CSSProperties}><span className="if-coin-sprite" /><em /></i>)}</div>}
      <div className="if-final-ice"><Fish color={color} /><b>{multiplierLabel(multiplier)}</b><strong className="if-final-amount">{win > 0n ? money(win) : ICE_FISH_LABELS[color]}</strong><span className="if-final-caption">{win > 0n ? "YOU WON" : settled ? "ROUND COMPLETE" : "CATCH REVEALED"}</span></div>
    </div>}
  </section>;
}
