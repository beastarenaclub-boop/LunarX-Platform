import { useId, useRef, useState } from "react";
import { Minus, Plus, RefreshCw } from "lucide-react";
import { useStore, type CrashPanelIndex } from "@/game/store";
import { placeBet, cashOut, setPanelAmount, setPanelAutoCash } from "@/game/engine";
import { Switch } from "@/components/ui/switch";
import { unlockAudio } from "@/game/audio";
import { BET_SEND_BUFFER_MS } from "../table/AutoBet";

/** Each card is a distinct server bet, including panels three and four. */
export default function JetXBetPanel({ panelIdx, expanded = false, onAutoPlay }: { panelIdx: CrashPanelIndex; expanded?: boolean; onAutoPlay?: () => void }) {
  const id = useId();
  const panel = useStore(s => s.panels[panelIdx]);
  const phase = useStore(s => s.phase);
  const roundId = useStore(s => s.roundId);
  const bettingTimeOpen = useStore(s => s.countdownMs > BET_SEND_BUFFER_MS);
  const multiplier = useStore(s => s.phase === "flying" && s.panels[panelIdx].activeBetId ? s.multiplier : 1);
  const balance = useStore(s => s.balance);
  const disabled = useStore(s => s.gameDisabled);
  const maxStake = useStore(s => s.maxStakeRupees);
  const autoMin = useStore(s => s.autoCashoutMin);
  const autoMax = useStore(s => s.autoCashoutMax);
  const activeBet = useStore(s => s.myBets.find(b => b.id === panel.activeBetId));
  const freeArmed = useStore(s => s.useFreeBetForBets && s.freeBetCount > 0);
  const freeAmount = useStore(s => Number(s.freeBetNextAmountPaise || 0) / 100);
  const busy = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const locked = panel.pendingBet || !!panel.activeBetId;
  const editLocked = locked || panel.autoBet.enabled;
  const amount = locked ? activeBet?.amount ?? panel.pendingAmount : freeArmed ? freeAmount : panel.amount;
  const limit = maxStake > 0 ? maxStake : Infinity;
  const canCash = phase === "flying" && !!panel.activeBetId;
  const canBet = phase === "betting" && roundId.startsWith("crash-") && bettingTimeOpen && !disabled && !locked && !panel.autoBet.enabled && amount > 0 && amount <= limit && (freeArmed || amount <= balance);
  const setAmount = (value: number) => {
    if (!editLocked && !freeArmed && Number.isFinite(value)) setPanelAmount(panelIdx, Math.max(1, Math.min(limit, value)));
  };
  const act = async () => {
    if (busy.current || (!canCash && !canBet)) return;
    busy.current = true; setSubmitting(true); unlockAudio();
    try { await (canCash ? cashOut(panelIdx) : placeBet(panelIdx)); }
    finally { busy.current = false; setSubmitting(false); }
  };
  const label = canCash ? "Cash out" : locked ? panel.activeBetId ? "Bet accepted" : "Placing…" : disabled ? "Paused" : panel.autoBet.enabled ? "Auto bet" : "Bet";
  return <div className="jetx-bet-panel" data-testid={`bet-panel-${panelIdx}`}>
    {expanded && <div className="jetx-bet-toolbar"><Switch id={id} aria-label={`Auto cashout bet ${panelIdx + 1}`} checked={panel.autoCashOutEnabled} disabled={editLocked} onCheckedChange={on => setPanelAutoCash(panelIdx, on, panel.autoCashOut)} /><label htmlFor={id}>Auto cashout</label><button className="jetx-repeat" aria-label={`Auto play bet ${panelIdx + 1}`} aria-pressed={panel.autoBet.enabled} onClick={onAutoPlay}><RefreshCw size={19} /></button>
      {panel.autoCashOutEnabled && <input className="jetx-auto-multiplier" aria-label={`Bet ${panelIdx + 1} auto cashout multiplier`} type="number" min={autoMin} max={autoMax} step="0.01" value={panel.autoCashOut} disabled={editLocked} onChange={e => setPanelAutoCash(panelIdx, true, Number(e.target.value) || autoMin)} />}</div>}
    <div className="jetx-stake-input">
      <button aria-label={`Decrease bet ${panelIdx + 1} amount`} data-testid={`btn-amount-minus-${panelIdx}`} disabled={editLocked || freeArmed} onClick={() => setAmount(panel.amount - 10)}><Minus size={15} /></button>
      <input type="number" min="1" max={Number.isFinite(limit) ? limit : undefined} step="0.01" aria-label={`Bet ${panelIdx + 1} amount`} data-testid={`input-amount-${panelIdx}`} value={editing ? amount : amount.toFixed(2)} disabled={editLocked || freeArmed} onFocus={() => setEditing(true)} onBlur={() => setEditing(false)} onChange={e => setAmount(Number(e.target.value))} />
      <button aria-label={`Increase bet ${panelIdx + 1} amount`} data-testid={`btn-amount-plus-${panelIdx}`} disabled={editLocked || freeArmed} onClick={() => setAmount(panel.amount + 10)}><Plus size={15} /></button>
    </div>
    {expanded && <div className="jetx-quick-stakes">{[500, 5000, 65000].map(value => <button key={value} disabled={editLocked || freeArmed} onClick={() => setAmount(value)}>{value.toLocaleString("en-IN")}</button>)}<button disabled={editLocked || freeArmed} onClick={() => setAmount(Math.min(limit, balance))}>Max</button></div>}
    <button className="jetx-bet-action" data-state={canCash ? "cashout" : locked ? "accepted" : "bet"} data-game-bet data-testid={canCash ? `btn-cashout-${panelIdx}` : `btn-bet-${panelIdx}`} onClick={() => void act()} disabled={submitting || (!canCash && !canBet)}>
      {expanded && !canCash && <strong>₹ {amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>}
      <span>{submitting ? canCash ? "Cashing out…" : "Placing…" : label}</span>
      {canCash && <strong>₹{((activeBet?.amount ?? panel.pendingAmount) * multiplier).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>}
    </button>
  </div>;
}
