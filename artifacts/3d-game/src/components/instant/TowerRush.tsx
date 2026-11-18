import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { ArrowLeft, ChevronRight, CircleHelp, History, Layers3, ShieldCheck, Volume2, VolumeX, Wallet, Play, Pause } from "lucide-react";
import { collectionMultiplier, towerSurvival, type CollectionConfig, type CollectionRound } from "@workspace/api-zod/instant-collection";
import { formatRupees } from "@/lib/format";
import TowerScene, { type TowerDrop } from "./TowerScene";
import "./tower-rush.css";
import { towerCollapseTiming } from "./towerMotion";

type Props = {
  round: CollectionRound | null; history: CollectionRound[];
  stake: string; setStake: (value: string) => void;
  config?: CollectionConfig; balance?: string;
  busy: boolean; locked: boolean; pending: boolean; canPlay: boolean;
  error: string; playHint: string; refresh: () => void;
  act: (action: "place" | "reveal" | "cashout", cell?: number) => Promise<CollectionRound | undefined>;
  sound: boolean; motion: boolean; toggleSound: () => void; toggleMotion: () => void;
  onLanding: (lost: boolean) => void;
  openPanel: (panel: "rules" | "history" | "fairness") => void;
  children: ReactNode;
};
const money = (paise: string) => `₹${formatRupees(paise)}`;

export default function TowerRush(p: Props) {
  const { round, busy, motion } = p;
  const active = round?.status === "active";
  const [visualStep, setVisualStep] = useState(round?.step ?? 0);
  const [drop, setDrop] = useState<TowerDrop>(null);
  const [working, setWorking] = useState(false);
  const [auto, setAuto] = useState(false);
  const intent = useRef(false), actionLock = useRef(false), alive = useRef(true);
  const seen = useRef(""), animationId = useRef(0);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const impactTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const landSound = useRef(p.onLanding); landSound.current = p.onLanding;
  const disabled = busy || working || !!drop;
  const step = round?.step ?? 0;
  const rtp = active ? round.rtp : p.config?.rtp ?? .97;
  const cap = active ? round.maxMultiplier : p.config?.maxMultiplier ?? 1000;
  const version = active ? round.towerPayoutVersion ?? 1 : p.config?.towerPayoutVersion ?? 1;
  const formatMultiplier = (value: number, v = version) => value.toFixed(v === 2 ? 3 : 2);
  const options = round?.options ?? { difficulty: "easy" as const, mines: 3, choice: "heads" };
  const next = collectionMultiplier("tower", active ? step + 1 : 1, options, rtp, cap, version);
  const atCap = !!active && round.multiplier >= cap;
  const lastSafe = version === 2 && !!active && step >= 34;
  const nextChance = version === 2 ? 100 * towerSurvival(active ? step + 1 : 1, rtp) / towerSurvival(active ? step : 0, rtp) : 200 / 3;
  const settled = round && !active && !disabled;
  const lost = settled && round.status === "lost";
  const returned = settled && !lost;

  useEffect(() => {
    alive.current = true;
    const pause = () => setAuto(false);
    const visibility = () => { if (document.hidden) pause(); };
    window.addEventListener("blur", pause);
    document.addEventListener("visibilitychange", visibility);
    return () => { alive.current = false; clearTimeout(animationTimer.current); clearTimeout(impactTimer.current); window.removeEventListener("blur", pause); document.removeEventListener("visibilitychange", visibility); };
  }, []);

  useEffect(() => {
    const revision = round ? `${round.id}:${round.step}:${round.status}` : "";
    if (seen.current === revision) return;
    seen.current = revision;
    if (!round) { setVisualStep(0); return; }
    if (round.status !== "active") setAuto(false);
    const failed = round.status === "lost";
    if (intent.current && (round.step > 0 || failed)) {
      intent.current = false;
      if (motion) {
        setVisualStep(failed ? round.step : round.step - 1);
        setDrop({ key: ++animationId.current, failed });
        clearTimeout(animationTimer.current);
        clearTimeout(impactTimer.current);
        const collapse = towerCollapseTiming(round.step);
        if (failed) impactTimer.current = setTimeout(() => { if (alive.current) landSound.current(true); }, collapse.impact * 1000);
        animationTimer.current = setTimeout(() => {
          if (!alive.current) return;
          setVisualStep(round.step); setDrop(null); if (!failed) landSound.current(false);
        }, failed ? Math.ceil(collapse.duration * 1000) : 820);
        return;
      }
      landSound.current(failed);
    }
    intent.current = false;
    setVisualStep(round.step);
  }, [round, motion]);

  async function build() {
    if (actionLock.current || disabled || (!active && !p.canPlay)) return;
    actionLock.current = true; setWorking(true); intent.current = !p.pending;
    if (!active && !p.pending) setVisualStep(0);
    const receipt = await p.act(p.pending ? "place" : active ? "reveal" : "place", 0);
    if (alive.current) {
      if (!receipt || p.pending) { intent.current = false; setAuto(false); }
      setWorking(false);
    }
    actionLock.current = false;
  }

  const latestBuild = useRef(build); latestBuild.current = build;
  useEffect(() => {
    // Continue only this explicitly started round. Never place the next bet.
    if (atCap || lastSafe) { setAuto(false); return; }
    if (!auto || !active || step === 0 || disabled || p.pending || p.error || document.hidden) return;
    const timer = setTimeout(() => void latestBuild.current(), 1500);
    return () => clearTimeout(timer);
  }, [auto, active, step, disabled, p.pending, p.error, round?.id, atCap, lastSafe]);

  const cashout = async () => {
    if (actionLock.current || disabled) return;
    setAuto(false); actionLock.current = true; setWorking(true);
    await p.act("cashout");
    actionLock.current = false; if (alive.current) setWorking(false);
  };
  const adjust = (factor: number) => {
    const min = Number(p.config?.minStakePaise ?? 100), max = Math.min(Number(p.config?.maxStakePaise ?? 1000000), Number(p.balance ?? 0));
    p.setStake((Math.max(min, Math.min(max, Math.round(Number(p.stake || 0) * 100 * factor))) / 100).toFixed(2));
  };

  return <div className={`tr-page ${motion ? "tr-motion-enabled" : ""}`} data-testid="collection-page">
    <header className="tr-header">
      <Link href="/" className="tr-icon" aria-label="Back to lobby"><ArrowLeft size={20} /></Link>
      <div className="tr-wordmark"><span>TOWER</span><b>RUSH</b></div><span className="tr-original">BUILD YOUR WAY UP</span>
      <div className="tr-wallet"><Wallet size={16} /><span><small>WALLET</small><strong data-testid="collection-balance">{p.balance === undefined ? "Connecting…" : money(p.balance)}</strong></span></div>
      <button className="tr-icon" onClick={p.toggleSound} aria-label={p.sound ? "Mute sound" : "Enable sound"}>{p.sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
      <button className="tr-icon" onClick={p.toggleMotion} aria-label={motion ? "Pause animations" : "Enable animations"} title={motion ? "Animations on" : "Animations off"}>{motion ? <Pause size={16} /> : <Play size={16} />}</button>
      <button className="tr-icon" onClick={() => p.openPanel("rules")} aria-label="Game rules"><CircleHelp size={19} /></button>
    </header>
    <div className="tr-layout"><main className="tr-main">
      <section className="tr-stage" aria-label="Tower construction site">
        <TowerScene step={visualStep} drop={drop} motion={motion} lost={!!lost} />
        <div className="tr-scene-brand"><strong>TOWER<br /><span>RUSH</span></strong><small>ONE MORE FLOOR?</small></div>
        <div className="tr-height"><Layers3 size={16} /><strong>{visualStep}</strong><span>FLOORS</span></div>
        <div className="tr-floor-track" aria-label={`${visualStep} floors built; ${version === 2 ? "crash between floors 20 and 35" : "no final floor"}`}>{Array.from({ length: 8 }, (_, i) => <i key={i} className={i < Math.min(visualStep, 8) ? "tr-done" : ""} />)}<b>{version === 2 ? "35" : "∞"}</b></div>
        <div className="tr-score"><small>{drop?.failed ? "BLOCK FALLING" : lost ? "ROUND OVER" : returned ? "COLLECTED" : active ? "CURRENT RETURN" : "FIRST FLOOR"}</small><strong>{lost || drop?.failed ? "0.00" : returned ? formatMultiplier(round.multiplier, round.towerPayoutVersion ?? 1) : active ? formatMultiplier(drop ? collectionMultiplier("tower", visualStep, options, rtp, cap, version) : round.multiplier) : formatMultiplier(next)}<em>×</em></strong>{active && <span>Next {formatMultiplier(next)}×</span>}</div>
        {settled && <div className={`tr-result-card ${lost ? "tr-result-loss" : ""}`}><span>{lost ? "TOWER FELL" : "SUCCESSFULLY COLLECTED"}</span><strong>{lost ? "Round over" : money(round.payoutAmount)}</strong><small>{lost ? "The block missed. No return this round." : "Returned to your wallet"}</small></div>}
        <div className="tr-site-caption"><span /><span>{drop ? drop.failed ? "Block slipping…" : "Placing your block…" : busy || working ? "Confirming your move…" : active ? "Build higher or collect your return" : settled ? "Your next tower starts with one block" : "A little ambition. A little luck."}</span></div>
      </section>
      <section className="tr-console" aria-label="Game controls">
        <div className="tr-stake"><label htmlFor="tr-stake">BET AMOUNT <span>INR</span></label><div><button aria-label="Halve bet" disabled={p.locked || disabled} onClick={() => adjust(.5)}>−</button><input id="tr-stake" aria-label="Bet amount" value={p.stake} onChange={e => p.setStake(e.target.value)} disabled={p.locked || disabled} inputMode="decimal" /><button aria-label="Double bet" disabled={p.locked || disabled} onClick={() => adjust(2)}>+</button></div><div className="tr-stake-presets">{[50, 100, 500].map(n => <button key={n} disabled={p.locked || disabled} onClick={() => p.setStake(String(n))}>₹{n}</button>)}</div></div>
        <button className="tr-cashout" data-testid="collection-cashout" disabled={!active || disabled} onClick={() => void cashout()}><span>{active && step === 0 ? "Return stake" : "Cash out"}</span><strong>{active ? money(round.cashoutAmount) : "—"}</strong></button>
        <button className="tr-build" data-testid="collection-play" disabled={disabled || (!active && !p.canPlay)} onClick={() => void build()}><span>{disabled ? "BUILDING…" : p.pending ? "RECOVER BET" : "BUILD"}</span><small>{disabled ? "Please wait" : active ? `Floor ${step + 1} · ${formatMultiplier(next)}×` : p.pending ? "No duplicate stake" : "Drop your first block"}</small></button>
        <div className="tr-auto"><label><input type="checkbox" disabled={atCap || lastSafe} checked={auto} onChange={e => setAuto(e.target.checked)} /><span className="tr-switch" /><span>Auto build <small>This round only</small></span></label><span className="tr-next">Next floor <b>{formatMultiplier(next)}×</b></span></div>
      </section>
      <div className="tr-status" role="status" aria-live="polite" data-testid="collection-result">{disabled ? "Confirming and placing your block…" : lost ? "Round over · No return this round" : returned ? `${money(round.payoutAmount)} · Returned to your wallet` : active ? `${step} floors built · Cash out or build the next floor` : p.playHint || "Press BUILD to start. Cash out after any successful floor."}</div>
      {atCap && <div className="tr-cap-note" role="status">Maximum return {cap}&times; reached. Auto build paused. More floors risk your return without increasing it; you can cash out or continue manually.</div>}
      {lastSafe && <div className="tr-cap-note" role="status">Auto build paused. Floor 35 always falls: cash out now to collect your return. Building again loses this round.</div>}
      {version === 2 && <div className="tr-cap-note">Next floor survival: {nextChance.toFixed(2)}%. Returns below 1× are less than your stake; 1× returns your stake with no profit. Amounts round down to the nearest paise.</div>}
      {p.error && <div className="tr-error" role="alert">{p.error}<button disabled={disabled} onClick={p.refresh}>Refresh</button></div>}
      <footer className="tr-footer"><span><ShieldCheck size={13} /> {active ? "Round saved" : "Server-verified results"}</span><button onClick={() => p.openPanel("fairness")}>Round details <ChevronRight size={13} /></button><button onClick={() => p.openPanel("rules")}>Rules</button></footer>
    </main><aside className="tr-sidebar">
      <div className="tr-history-title"><History size={17} /><h2>Your rounds</h2><button onClick={() => p.openPanel("history")}>View all</button></div>
      <div className="tr-table-head"><span>BET / TIME</span><span>RETURN</span></div>
      <div className="tr-history">{p.history.length ? p.history.slice(0, 10).map(r => <button key={r.id} onClick={() => p.openPanel("history")}><span><b>{money(r.stakeAmount)}</b><small>{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {r.step} floors</small></span><span className={r.status === "lost" ? "tr-history-loss" : "tr-history-win"}><b>{r.status === "active" ? "In play" : money(r.payoutAmount)}</b><small>{r.status === "active" ? `${formatMultiplier(r.multiplier, r.towerPayoutVersion ?? 1)}×` : r.status === "lost" ? "No return" : `${formatMultiplier(r.multiplier, r.towerPayoutVersion ?? 1)}× collected`}</small></span></button>) : <div className="tr-empty"><Layers3 size={28} /><strong>Your skyline starts here</strong><p>Completed rounds and returns will appear here.</p></div>}</div>
      <div className="tr-guide"><span>THE HIGHER THE TOWER</span><h3>The bigger the moment.</h3>{version === 2 ? <><p>Floors 1–19 are safe. One crash floor from 20–35 is fixed when the round starts. Cash out before it.</p><div><b>0.001×</b><span>first floor total return</span></div><div><b>1.000×</b><span>floor 30 total return, before caps</span></div><div><b>20–35</b><span>random crash floor</span></div><small>Crash-floor chances are weighted by the round's RTP. Maximum theoretical stopping return: {(rtp * 100).toFixed(2)}% before paise rounding and caps; earlier cash-outs can return less. Auto build pauses at floor 34. Timing your click does not change the result.</small></> : <><p>Build one floor at a time. There is no final floor. Cash out whenever you choose, before a block falls.</p><div><b>66.67%</b><span>chance per floor</span></div><div><b>&infin;</b><span>no floor limit</span></div><div><b>{cap}&times;</b><span>maximum payout multiplier</span></div><small>Target RTP {(rtp * 100).toFixed(2)}% before rounding and payout cap. Timing your click does not change the outcome.</small></>}</div>
    </aside></div>{p.children}
  </div>;
}
