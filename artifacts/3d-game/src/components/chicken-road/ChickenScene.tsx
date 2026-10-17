import { useEffect, useRef, useState, type CSSProperties, type AnimationEvent } from "react";
import { CHICKEN_MODES, type ChickenDifficulty, type ChickenRound } from "@workspace/api-zod/chicken-road-game";
import chicken from "@/assets/chicken-road/chicken.svg";
import { formatProfitFactor } from "./format";
import { playGameSound } from "@/game/audio";

export default function ChickenScene({ round, difficulty, hopping, onStep, canStep, idle, sound }: {
  round: ChickenRound | null; difficulty: ChickenDifficulty; hopping: boolean; onStep: () => void; canStep: boolean; idle: boolean; sound: boolean;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(() => !document.hidden);
  const step = round?.status === "busted" ? round.attemptedStep : round?.step ?? 0;
  const lost = round?.status === "busted";
  const won = round?.status === "cashed_out";
  const idling = idle && visible && !hopping && !lost && !won;
  const returns = CHICKEN_MODES[difficulty].returns;
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  function idleHopSound(event: AnimationEvent<HTMLImageElement>) {
    // The animation owns the rhythm: no background timer or backlog of calls.
    if (event.animationName === "cr-idle-hop" && idling && sound && !document.hidden) {
      playGameSound("idle", "chicken-road", .6);
    }
  }
  useEffect(() => {
    const root = scene.current;
    if (!root) return;
    const update = () => {
      const lane = innerWidth <= 540 ? 138 : 170;
      const position = step === 0 ? 86 : 156 + (step - .5) * lane;
      root.style.setProperty("--lane", `${lane}px`);
      root.style.setProperty("--chicken-x", `${position}px`);
      root.style.setProperty("--camera", `${Math.max(0, position - Math.min(root.clientWidth * .32, 370))}px`);
    };
    update();
    const observer = new ResizeObserver(update); observer.observe(root);
    return () => observer.disconnect();
  }, [step]);
  return <div className={`cr-scene${lost ? " cr-scene-lost" : ""}${won ? " cr-scene-won" : ""}`} ref={scene} data-testid="chicken-scene" aria-label="Chicken Road crossing">
    <div className="cr-scene-hud"><span><i />LANE PROFIT</span><div className="cr-progress"><span>{round?.step ?? 0}<small> / {returns.length} lanes</small></span><div role="progressbar" aria-label="Lanes crossed" aria-valuemin={0} aria-valuemax={returns.length} aria-valuenow={round?.step ?? 0}><i style={{ width: `${(round?.step ?? 0) / returns.length * 100}%` }} /></div></div></div>
    <div className="cr-track">
      <div className="cr-garden"><i /><i /><i /><div className="cr-bench" /></div>
      <div className="cr-sidewalk"><div className="cr-lamp" /><span>START</span></div>
      {returns.map((value, i) => {
        const safe = i < (round?.step ?? 0);
        const current = i + 1 === step;
        const next = !lost && !won && i === (round?.step ?? 0);
        return <div key={i} className={`cr-lane${safe ? " is-safe" : ""}${current ? " is-current" : ""}${next ? " is-next" : ""}${lost && current ? " is-hit" : ""}`} style={{ left: `calc(156px + ${i} * var(--lane))`, "--delay": `${-i * 1.7}s`, "--speed": `${4 + i % 3}s` } as CSSProperties}>
          <span className="cr-lane-number">{String(i + 1).padStart(2, "0")}</span>
          {!safe && <div className={`cr-car cr-car-${i % 3}${lost && current ? " cr-collision" : ""}`}><i /><b /></div>}
          {safe && <div className="cr-barrier"><i /><i /></div>}
          <button className="cr-manhole" tabIndex={canStep && i === round?.step ? 0 : -1} aria-label={`Cross lane ${i + 1} for ${formatProfitFactor(value / 100)}x profit`}
            disabled={!canStep || i !== round?.step} onClick={onStep}><span>{formatProfitFactor(value / 100)}<small>x</small></span>{safe && <b>✓</b>}</button>
          {next && <span className="cr-next-label">{round ? "NEXT STEP" : "FIRST STEP"}</span>}
        </div>;
      })}
      <div className="cr-finish" style={{ left: `calc(156px + ${returns.length} * var(--lane))` }}><span>🥚</span><strong>FINISH</strong></div>
      <div className={`cr-chicken${idling ? " is-idle" : ""}${hopping ? " is-hopping" : ""}${lost ? " is-busted" : ""}${won ? " is-celebrating" : ""}`}><img src={chicken} alt="Chicken" draggable={false} onAnimationIteration={idleHopSound} />{lost && <span className="cr-feathers">✦ ✧ ✦</span>}</div>
    </div>
    {!round && <div className="cr-welcome"><span><i /> READY TO CROSS</span><h1>One road.<br /><em>Your next move.</em></h1><p>Set your stake. Cross a lane. Choose when to collect.</p><div className="cr-welcome-pills"><span>{CHICKEN_MODES[difficulty].label} mode</span><span>{returns.length} lanes</span></div></div>}
    {round?.status === "active" && <div className="cr-current"><small>CURRENT PROFIT</small><strong>{formatProfitFactor(round.multiplier)}<span>x</span></strong><span>{round.step ? "Cashout includes your original stake" : "Cross one lane to unlock cashout"}</span></div>}
    {lost && <div className="cr-result is-loss" role="status"><small>END OF THE ROAD</small><strong>Oh, cluck!</strong><span>Lane {round.attemptedStep} · Stake lost</span></div>}
    {won && <div className="cr-result is-win" role="status"><small>{round.endReason === "timeout" ? round.step === 0 ? "TIME UP · STAKE RETURNED" : "TIME UP · AUTO CASHOUT" : round.step === round.totalSteps ? "GOLDEN EGG · PROFIT" : "PROFIT COLLECTED"}</small><strong>{formatProfitFactor(round.multiplier)}x</strong><span>{round.endReason === "timeout" && round.step === 0 ? "Stake returned to your wallet" : "Winnings added to your wallet"}</span></div>}
    <div className="cr-scene-caption">{CHICKEN_MODES[difficulty].label.toUpperCase()} <i /> {returns.length} LANES <i /> MAX PROFIT {formatProfitFactor(returns.at(-1)! / 100)}x</div>
  </div>;
}
