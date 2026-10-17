import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { store, useStoreShallow, type CrashPanelIndex } from "@/game/store";
import { placeBet, setAutoBet, setPanelAutoCash } from "@/game/engine";
import { unlockAudio } from "@/game/audio";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { BET_SEND_BUFFER_MS } from "../table/AutoBet";
import JetXBetPanel from "./JetXBetPanel";
import { setJetXPanelCount, useJetXPreferences } from "./jetxPreferences";

const allSlots = [0, 1, 2, 3] as const;
const money = (n: number) => `₹ ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function JetXBetDock() {
  const state = useStoreShallow(s => ({
    panels: s.panels, balance: s.balance, phase: s.phase, roundId: s.roundId,
    bettingTimeOpen: s.countdownMs > BET_SEND_BUFFER_MS,
    gameDisabled: s.gameDisabled, maxStakeRupees: s.maxStakeRupees,
    autoCashoutMin: s.autoCashoutMin, autoCashoutMax: s.autoCashoutMax,
    useFreeBetForBets: s.useFreeBetForBets, freeBetCount: s.freeBetCount,
    freeBetNextAmountPaise: s.freeBetNextAmountPaise,
  }));
  const { panelCount } = useJetXPreferences();
  // Restored active bets always keep their cashout cards visible.
  const activeCount = state.panels.reduce((count, panel, i) => panel.activeBetId || panel.pendingBet ? Math.max(count, i + 1) : count, panelCount);
  const visibleCount = activeCount > 2 ? 4 : activeCount > 1 ? 2 : 1;
  const slots = allSlots.slice(0, visibleCount);
  const compact = visibleCount === 4;
  const id = useId();
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  const [selected, setSelected] = useState<CrashPanelIndex[]>([0]);
  const [rounds, setRounds] = useState(50);
  const [limits, setLimits] = useState({ stopOnWin: 0, stopOnLoss: 0, stopOnBalanceBelow: 0, stopOnBalanceAbove: 0 });
  useEffect(() => { setSelected(previous => previous.filter(i => i < visibleCount)); }, [visibleCount]);
  const openAuto = (panel?: CrashPanelIndex) => { if (panel !== undefined) setSelected([panel]); setAutoOpen(true); };
  const free = state.useFreeBetForBets && state.freeBetCount > 0;
  const freeAmount = Number(state.freeBetNextAmountPaise || 0) / 100;
  const unlocked = slots.filter(i => !state.panels[i].pendingBet && !state.panels[i].activeBetId && !state.panels[i].autoBet.enabled);
  const eligible = free ? unlocked.slice(0, state.freeBetCount) : unlocked;
  const total = eligible.reduce((sum, i) => sum + (free ? freeAmount : state.panels[i].amount), 0);
  const amountsValid = eligible.every(i => {
    const amount = free ? freeAmount : state.panels[i].amount;
    return amount > 0 && (!state.maxStakeRupees || amount <= state.maxStakeRupees);
  });
  const canPlace = !busy && eligible.length > 0 && amountsValid && !state.gameDisabled && state.phase === "betting" && state.roundId.startsWith("crash-") && state.bettingTimeOpen && (free || total <= state.balance);
  const autoEnabled = state.panels.every(p => p.autoCashOutEnabled);
  const playing = state.panels.some(p => p.autoBet.enabled);
  const cashLocked = unlocked.length !== slots.length;
  const updateCash = (on: boolean, value = state.panels[0].autoCashOut) => {
    if (!cashLocked) slots.forEach(i => setPanelAutoCash(i, on, value));
  };
  const placeAll = async () => {
    if (!canPlace || submitting.current) return;
    submitting.current = true; setBusy(true); unlockAudio();
    const round = state.roundId;
    try {
      // Stop on a failed reservation or a round boundary; accepted cards
      // are never retried. The server remains authoritative for every debit.
      for (const i of eligible) {
        const latest = store.getState();
        if (latest.roundId !== round || latest.phase !== "betting" || latest.countdownMs <= BET_SEND_BUFFER_MS) break;
        await placeBet(i);
        if (!store.getState().panels[i].activeBetId) break;
      }
    } finally { submitting.current = false; setBusy(false); }
  };
  const stopAuto = () => slots.forEach(i => setAutoBet(i, { enabled: false }));
  const selectedTotal = selected.reduce((sum, i) => sum + state.panels[i].amount, 0);
  const autoValid = selected.length > 0 && !state.gameDisabled && selected.every(i => !state.panels[i].activeBetId && !state.panels[i].pendingBet && state.panels[i].amount > 0 && (!state.maxStakeRupees || state.panels[i].amount <= state.maxStakeRupees)) && (free ? state.freeBetCount >= selected.length : selectedTotal <= state.balance);
  return <div className="jetx-betting-dock" data-panel-count={visibleCount}>
    {!compact && <button className="jetx-panel-promo" onClick={() => setJetXPanelCount(4)}><b>New</b> Try 4 Bets Panel <span>›</span></button>}
    {compact && <div className="jetx-dock-toolbar">
      <Switch id={id} aria-label="Auto cashout for all bets" checked={autoEnabled} disabled={cashLocked} onCheckedChange={on => updateCash(on)} />
      <label htmlFor={id}>Auto cashout</label>
      {autoEnabled && <label className="jetx-cash-value"><input aria-label="Auto cashout multiplier" type="number" min={state.autoCashoutMin} max={state.autoCashoutMax} step="0.01" value={state.panels[0].autoCashOut} disabled={cashLocked} onChange={e => updateCash(true, Number(e.target.value) || state.autoCashoutMin)} /><span>x</span></label>}
      <button className="jetx-auto-play" aria-label="Auto play settings" aria-pressed={playing} onClick={() => openAuto()}>Auto play <RefreshCw size={18} /></button>
    </div>}
    <div className="jetx-dual-bets">{slots.map(i => <JetXBetPanel key={i} panelIdx={i} expanded={!compact} onAutoPlay={() => openAuto(i)} />)}</div>
    {compact && <button className="jetx-place-all" data-testid="btn-jetx-place-all" disabled={!canPlace} onClick={() => void placeAll()}>
      <strong>{busy ? "Placing bets…" : eligible.length === 0 ? "Bets accepted" : "Place all bets"}</strong><span>{money(total)}</span>
    </button>}
    {playing && <button className="jetx-stop-auto" onClick={stopAuto}>Stop auto play</button>}
    {state.freeBetCount > 0 && <label className="jetx-free-bet"><Switch checked={state.useFreeBetForBets} disabled={cashLocked} onCheckedChange={useFreeBetForBets => store.setState({ useFreeBetForBets })} />Use free bet · {money(freeAmount)} ({state.freeBetCount})</label>}
    <Dialog open={autoOpen} onOpenChange={setAutoOpen}>
      <DialogContent className="jetx-auto-dialog">
        <DialogHeader><DialogTitle>Autoplay Settings</DialogTitle><DialogDescription className="sr-only">Choose rounds and bets to repeat. Auto cashout remains enabled.</DialogDescription></DialogHeader>
        <div className="jetx-round-options"><strong>Number of rounds</strong><div>{[50, 100, 200, Number.MAX_SAFE_INTEGER].map(n => <button key={n} aria-pressed={rounds === n} onClick={() => setRounds(n)}>{n === Number.MAX_SAFE_INTEGER ? "∞" : n}</button>)}</div></div>
        <details className="jetx-auto-details"><summary>Bet selection & limits</summary>
          <div className="jetx-auto-slots">{slots.map(i => <label key={i}><input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(previous => e.target.checked ? [...previous, i] : previous.filter(n => n !== i))} />Bet {i + 1}</label>)}</div>
          {([['stopOnWin', 'Stop on profit'], ['stopOnLoss', 'Stop on loss'], ['stopOnBalanceBelow', 'Stop below balance'], ['stopOnBalanceAbove', 'Stop above balance']] as const).map(([key, label]) => <label key={key}>{label} (₹)<input type="number" min="0" value={limits[key]} onChange={e => setLimits({ ...limits, [key]: Math.max(0, Number(e.target.value) || 0) })} /></label>)}
        </details>
        <p className="jetx-auto-total">Bet {selected.map(i => i + 1).join(", ") || "—"} · {money(free ? freeAmount * selected.length : selectedTotal)} per round</p>
        <div className="jetx-auto-actions"><button className="jetx-auto-stop" onClick={() => { stopAuto(); setAutoOpen(false); }}>Stop</button><button className="jetx-auto-start" disabled={playing || !autoValid} aria-label={`Start ${rounds === Number.MAX_SAFE_INTEGER ? 'unlimited' : rounds} rounds`} onClick={() => {
            unlockAudio();
            selected.forEach(i => {
              setPanelAutoCash(i, true, state.panels[i].autoCashOut);
              setAutoBet(i, { enabled: true, rounds, ...limits });
            });
          setAutoOpen(false);
        }}>Start</button></div>
      </DialogContent>
    </Dialog>
  </div>;
}
