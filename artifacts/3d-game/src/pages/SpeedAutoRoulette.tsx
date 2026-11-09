import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { BarChart3, CircleHelp, Expand, Grid2X2, History, RotateCcw, Trash2, Undo2, Volume2, VolumeX, X, Zap } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch, getGetWalletBalanceQueryKey, useGetWalletBalance } from "@workspace/api-client-react";
import { ROULETTE_LIMITS, SPEED_ROULETTE_CODE, rouletteMaxBetPaise, rouletteSelectionKey } from "@workspace/api-zod/roulette-game";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { sfx, stopRouletteAudio, unlockAudio } from "@/game/audio";
import { useTableRound } from "@/components/table/useTableRound";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { betLabel, pocketColor, EUROPEAN_WHEEL_ORDER, type PlacedBet } from "@/components/roulette/wheelData";
import BettingBoard from "@/components/roulette/BettingBoard";
import SpeedRouletteScene from "@/components/speedRoulette/SpeedRouletteScene";
import SelectionSummary from "@/components/speedRoulette/SelectionSummary";
import { neighbourBets, sectorBets, SECTORS, type Spot, type BetPreview } from "@/components/speedRoulette/layout";
import "@/components/speedRoulette/speed-auto-roulette.css";

const ENDPOINT = `/api/${SPEED_ROULETTE_CODE}`;
const CHIPS = [10, 50, 100, 500, 1000, 5000, 10000];
const CHIP_COLORS = ["#dfdfd4", "#cc494b", "#4480bd", "#aa78c3", "#deb75d", "#66a471", "#4e505b"];
const money = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const totalOf = (bets: Map<string, PlacedBet>) => [...bets.values()].reduce((s, b) => s + b.amount, 0);
type WireBet = Spot & { amountPaise: string };
type Config = { enabled: boolean; maxStakePaise: string; payoutBase: number };

export default function SpeedAutoRoulette() {
  const { user } = useAuth(), qc = useQueryClient();
  const sound = useStore(s => s.settings.sound);
  const root = useRef<HTMLDivElement>(null), soundRef = useRef(sound); soundRef.current = sound;
  const refreshWallet = useCallback(() => { void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }); void qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] }); }, [qc]);
  const round = useTableRound<{ pocket: number }>(SPEED_ROULETTE_CODE, { enabled: !!user, roundOpenVoice: false, roundClosedVoice: false, onSettled: refreshWallet });
  const config = useQuery({ queryKey: [SPEED_ROULETTE_CODE, "config"], queryFn: () => customFetch<Config>(`${ENDPOINT}/config`), staleTime: 10000, refetchInterval: 15000, retry: false });
  const wallet = useGetWalletBalance(undefined, { query: { queryKey: getGetWalletBalanceQueryKey(), enabled: !!user, retry: false } });
  const [chip, setChip] = useState(10), [neighbours, setNeighbours] = useState(2);
  const [bets, setBets] = useState<Map<string, PlacedBet>>(new Map()), draftRef = useRef(bets);
  const [undo, setUndo] = useState<Map<string, PlacedBet>[]>([]), lastBets = useRef<Map<string, PlacedBet>>(new Map());
  const [posting, setPosting] = useState(false), postingRef = useRef(false);
  const [automatic, setAutomatic] = useState(true), [error, setError] = useState("");
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [panel, setPanel] = useState<"rules" | "stats" | "bets" | null>(null);
  const [trackPreview, setTrackPreview] = useState<BetPreview | null>(null);
  const [landed, setLanded] = useState<{ roundId: string; pocket: number } | null>(null);
  const [localSlips, setLocalSlips] = useState<{ roundId: string; slips: Map<string, WireBet[]> }>({ roundId: "", slips: new Map() });
  const seenRound = useRef<string | null>(null), currentRound = useRef(round.roundId); currentRound.current = round.roundId;
  const save = (next: Map<string, PlacedBet>) => { draftRef.current = next; setBets(next); };
  const balance = Number(wallet.data?.balance ?? 0) / 100;
  const seconds = Math.max(0, Math.ceil(round.remainingMs / 1000));
  const result = landed?.roundId === round.roundId && round.phase !== "betting" ? landed.pocket : null;
  const isFresh = !!round.snapshot && Date.now() - round.toLocalTime(round.snapshot.now) < 8000;
  const open = !!config.data?.enabled && round.bettingOpen && round.remainingMs > 350 && isFresh && !!wallet.data && !wallet.isError;
  const disabled = !open || posting || uncertain === round.roundId;
  const total = totalOf(bets);
  const accepted = useMemo(() => {
    const slips = new Map(round.myBets.filter(b => b.status !== "refunded").map(b => [b.slipId, b.bets as WireBet[]]));
    if (localSlips.roundId === round.roundId) for (const [id, slip] of localSlips.slips) if (!slips.has(id)) slips.set(id, slip);
    const map = new Map<string, PlacedBet>();
    for (const slip of slips.values()) for (const b of Array.isArray(slip) ? slip : []) { const key = rouletteSelectionKey(b); map.set(key, { ...b, amount: (map.get(key)?.amount ?? 0) + Number(b.amountPaise) / 100 }); }
    return map;
  }, [round.myBets, round.roundId, localSlips]);
  const shownBets = useMemo(() => { const m = new Map(accepted); for (const [key, bet] of bets) m.set(key, { ...bet, amount: bet.amount + (m.get(key)?.amount ?? 0) }); return [...m.values()]; }, [bets, accepted]);
  const history = round.recent.map(r => ({ id: r.roundId, pocket: (r.outcome as { pocket?: number })?.pocket })).filter((r): r is { id: string; pocket: number } => Number.isInteger(r.pocket));
  const paid = result !== null ? round.myBets.filter(s => s.status === "settled").reduce((sum, b) => sum + Number(b.payoutAmount) / 100, 0) : 0;
  const cue = (kind: "place" | "clear") => { void unlockAudio(); if (sound) (kind === "place" ? sfx.chipPlace : sfx.chipScoop)(); };

  useEffect(() => {
    document.title = "Speed Auto Roulette · Lunar Casino";
    const timer = window.setInterval(round.refetch, 2000);
    return () => { window.clearInterval(timer); stopRouletteAudio(); };
  }, [round.refetch]);
  useEffect(() => {
    if (!round.roundId || seenRound.current === round.roundId) return;
    seenRound.current = round.roundId; save(new Map()); setUndo([]); setError(""); setUncertain(null); setLanded(null); setLocalSlips({ roundId: round.roundId, slips: new Map() }); refreshWallet();
  }, [round.roundId, refreshWallet]);
  useEffect(() => { if (round.myBets.some(b => b.status === "settled")) refreshWallet(); }, [round.myBets, refreshWallet]);
  const lastPhase = useRef<string | null>(null);
  useEffect(() => {
    if (lastPhase.current === "betting" && round.phase === "reveal" && soundRef.current) { sfx.voiceNoMoreBets(); sfx.wheelLaunch(); }
    lastPhase.current = round.phase;
    if (round.phase === "reveal" && sound) sfx.ballRoll(.6); else sfx.ballRollStop(200);
    return () => sfx.ballRollStop(120);
  }, [round.phase, sound]);

  function validate(next: Map<string, PlacedBet>) {
    if (next.size > ROULETTE_LIMITS.maxBetsPerSlip) return "Maximum 40 selections in one bet.";
    for (const [key, b] of next) {
      const maximum = Number(rouletteMaxBetPaise(b.type)) / 100;
      if (b.amount + (accepted.get(key)?.amount ?? 0) > maximum) return `${betLabel(b)}: maximum ${money(maximum)} per round.`;
    }
    const stake = totalOf(next);
    if (stake > balance) return "Insufficient balance for these bets.";
    if (stake > Number(round.config?.maxStakePaise ?? config.data?.maxStakePaise ?? 0) / 100) return "Total bet exceeds the table limit.";
    return "";
  }
  function change(next: Map<string, PlacedBet>) {
    if (disabled || postingRef.current) return;
    const problem = validate(next); if (problem) { setError(problem); return; }
    const previous = new Map(draftRef.current);
    setUndo(stack => [...stack.slice(-49), previous]); save(next); setError(""); cue("place");
  }
  function place(spots: Spot[]) {
    if (disabled || postingRef.current) return;
    const next = new Map(draftRef.current);
    for (const spot of spots) { const key = rouletteSelectionKey(spot); next.set(key, { ...spot, amount: (next.get(key)?.amount ?? 0) + chip }); }
    change(next);
  }
  function clear() { if (disabled) return; const previous = new Map(draftRef.current); setUndo(stack => [...stack.slice(-49), previous]); save(new Map()); setError(""); cue("clear"); }
  async function submit() {
    if (disabled || postingRef.current || !draftRef.current.size || !round.roundId) return;
    const problem = validate(draftRef.current); if (problem) { setError(problem); return; }
    const id = round.roundId, submitted = new Map(draftRef.current);
    const payload = [...submitted.values()].map(({ amount, ...spot }) => ({ ...spot, amountPaise: String(Math.round(amount * 100)) }));
    postingRef.current = true; setPosting(true); setError("");
    try {
      const response = await customFetch<{ slipId: string }>(`${ENDPOINT}/spin`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roundId: id, bets: payload }) });
      lastBets.current = submitted;
      if (currentRound.current === id) { setLocalSlips(prev => ({ roundId: id, slips: new Map(prev.roundId === id ? prev.slips : []).set(response.slipId, payload) })); save(new Map()); setUndo([]); }
      refreshWallet(); round.refetch();
    } catch (e) {
      if (currentRound.current !== id) return;
      const details = e instanceof ApiError ? e.data as { detail?: string; title?: string } : null;
      // A lost response may already have debited the wallet. Never retry it automatically.
      if (!(e instanceof ApiError) || e.status >= 500) {
        setUncertain(id); setError("Confirmation interrupted. Checking the server; no automatic retry this round."); save(new Map());
      } else setError(details?.detail ?? details?.title ?? "Bet was not accepted. Please check your balance and try again.");
      round.refetch(); refreshWallet();
    } finally { postingRef.current = false; setPosting(false); }
  }
  const submitRef = useRef(submit); submitRef.current = submit;
  const autoAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (!automatic || !round.roundId || !open || round.remainingMs > 1600 || round.remainingMs <= 350 || !bets.size || posting || autoAttempt.current === round.roundId) return;
    autoAttempt.current = round.roundId; void submitRef.current();
  }, [automatic, round.roundId, round.remainingMs, open, bets.size, posting]);
  const onLanded = useCallback((pocket: number, id: string) => {
    if (currentRound.current !== id) return;
    setLanded({ roundId: id, pocket }); sfx.ballRollStop(160); if (soundRef.current) { sfx.ballDrop(); sfx.voicePocket(pocket); }
  }, []);
  const status = !round.phase ? "CONNECTING TO TABLE" : !isFresh ? "RECONNECTING TO TABLE" : !config.data?.enabled ? "TABLE UNAVAILABLE" : result !== null ? `${result} ${pocketColor(result).toUpperCase()}` : round.phase === "betting" ? seconds <= 4 ? "BETS CLOSING" : "PLACE YOUR BETS" : "NO MORE BETS";
  const currentIndex = result === null ? 0 : EUROPEAN_WHEEL_ORDER.indexOf(result as typeof EUROPEAN_WHEEL_ORDER[number]);
  return <div className="sar-game" ref={root} data-testid="speed-auto-roulette" data-phase={round.phase ?? "loading"}>
    <SpeedRouletteScene roundId={round.roundId} phase={round.phase} pocket={round.outcome?.pocket ?? null} landingDeadline={round.phase === "reveal" && round.phaseEndsAt ? round.toLocalTime(round.phaseEndsAt) - 100 : 0} bets={shownBets} result={result} disabled={disabled} neighbours={neighbours} onPlace={place} onLanded={onLanded} onPreview={setTrackPreview} />
    <div className="sar-vignette" />
    <header className="sar-header">
      <Link href="/" className="sar-icon" aria-label="Back to lobby"><X size={19} /></Link>
      <div className="sar-title"><strong>Speed Auto Roulette</strong><span>₹10–500,000 <i>3D</i></span></div>
      <div className="sar-history" aria-label="Recent winning numbers">{history.slice(0, 12).map((h, i) => <span key={h.id} className={`sar-number ${pocketColor(h.pocket)} ${i === 0 ? "newest" : ""}`}>{h.pocket}</span>)}</div>
      <div className="sar-header-actions">
        <button className="sar-icon" onClick={() => setPanel("stats")} aria-label="Result history"><History size={18} /></button>
        <button className="sar-icon" onClick={() => { void unlockAudio(); updateSettings({ sound: !sound }); }} aria-label={sound ? "Mute sound" : "Enable sound"}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
        <button className="sar-icon" onClick={() => setPanel("rules")} aria-label="Game rules"><CircleHelp size={18} /></button>
        <button className="sar-icon sar-fullscreen" onClick={() => { const request = document.fullscreenElement ? document.exitFullscreen() : root.current?.requestFullscreen(); void request?.catch(() => setError("Fullscreen is unavailable in this window.")); }} aria-label="Toggle fullscreen"><Expand size={17} /></button>
      </div>
    </header>
    <div className="sar-table-label"><span className="sar-live-dot" /> AUTOMATED TABLE <span>EUROPEAN · SINGLE ZERO</span></div>
    <div className="sar-neighbours"><span>NEIGHBOURS</span><button onClick={() => setNeighbours(n => Math.max(0, n - 1))} disabled={neighbours === 0} aria-label="Fewer neighbours">−</button><b>{neighbours}</b><button onClick={() => setNeighbours(n => Math.min(9, n + 1))} disabled={neighbours === 9} aria-label="More neighbours">+</button></div>
    <SelectionSummary preview={trackPreview} bets={shownBets} chip={chip} disabled={disabled} />
    {result !== null && <div className="sar-result" data-testid="speed-result"><span>{EUROPEAN_WHEEL_ORDER[(currentIndex + 36) % 37]}</span><strong className={pocketColor(result)}>{result}</strong><span>{EUROPEAN_WHEEL_ORDER[(currentIndex + 1) % 37]}</span><small>{paid > 0 ? `YOU WIN ${money(paid)}` : "WINNING NUMBER"}</small></div>}
    <footer className="sar-footer">
      <div className={`sar-status ${round.phase === "betting" ? seconds <= 4 ? "closing" : "open" : "closed"}`} role="status"><span>{status}</span>{round.phase === "betting" && <b>{seconds}</b>}<i style={{ width: `${round.phase === "betting" ? Math.min(100, round.remainingMs / (round.config?.bettingWindowMs ?? 12000) * 100) : 0}%` }} /></div>
      {error && <div className="sar-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss message"><X size={14} /></button></div>}
      <div className="sar-dock">
        <div className="sar-wallet"><span>BALANCE<strong data-testid="speed-balance">{wallet.data ? money(balance) : "—"}</strong></span><span>TOTAL BET<strong data-testid="speed-total">{money(total + totalOf(accepted))}</strong></span>{paid > 0 && <span className="sar-win">WIN<strong>{money(paid)}</strong></span>}</div>
        <div className="sar-controls">
          <div className="sar-chip-row"><button className="sar-action" disabled={disabled || !undo.length} onClick={() => { const previous = undo[undo.length - 1]; if (previous) { save(previous); setUndo(v => v.slice(0, -1)); cue("clear"); } }} aria-label="Undo bet"><Undo2 size={19} /></button>
            {CHIPS.map((n, i) => <button key={n} className={`sar-chip ${chip === n ? "selected" : ""}`} style={{ "--chip": CHIP_COLORS[i] } as CSSProperties} onClick={() => { setChip(n); void unlockAudio(); }} aria-label={`Select ₹${n} chip`} aria-pressed={chip === n}><span>{n >= 1000 ? `${n / 1000}K` : n}</span></button>)}
            <button className="sar-action" disabled={disabled || !bets.size} onClick={() => change(new Map([...draftRef.current].map(([k, b]) => [k, { ...b, amount: b.amount * 2 }])))} aria-label="Double bets">2×</button>
          </div>
          <div className="sar-bet-actions">
            <button onClick={clear} disabled={disabled || !bets.size}><Trash2 size={13} /> Clear</button>
            <button onClick={() => change(new Map(lastBets.current))} disabled={disabled || !lastBets.current.size}><RotateCcw size={13} /> Rebet</button>
            <label><input type="checkbox" checked={automatic} onChange={e => setAutomatic(e.target.checked)} disabled={posting} /> Auto confirm</label>
            <button className="sar-confirm" disabled={disabled || !bets.size} onClick={() => void submit()} data-testid="speed-confirm">{posting ? "Confirming…" : total ? `Confirm ${money(total)}` : "Select your bets"}</button>
          </div>
        </div>
        <div className="sar-tools"><button className="sar-table-button" onClick={() => setPanel("bets")}><Grid2X2 size={16} /> Table bets</button><button className="sar-icon" onClick={() => setPanel("stats")} aria-label="Table statistics"><BarChart3 size={17} /></button><Link href="/" className="sar-lobby">LOBBY</Link></div>
      </div>
      <div className="sar-footnote"><span><Zap size={10} /> SPEED AUTO ROULETTE</span><span>{automatic && total > 0 ? "Selected bets confirm before betting closes" : totalOf(accepted) > 0 ? "BETS ACCEPTED" : "Click the table to place chips"}</span><span>ROUND {round.roundId?.slice(-8).toUpperCase() ?? "—"}</span></div>
    </footer>
    <Dialog open={!!panel} onOpenChange={v => { if (!v) setPanel(null); }}><DialogContent className={`sar-dialog ${panel === "bets" ? "sar-bets-dialog" : ""}`}><DialogHeader><DialogTitle>{panel === "rules" ? "Speed Auto Roulette · Game rules" : panel === "stats" ? "Results & statistics" : "Table bets"}</DialogTitle><DialogDescription>{panel === "bets" ? "Select a chip, then a number or a shared edge. Bets close with the countdown." : panel === "stats" ? "Recent completed rounds from this table." : "European roulette · 37 pockets · one zero"}</DialogDescription></DialogHeader>
      {panel === "rules" && <div className="sar-rules"><p>Place chips while betting is open. The automated wheel spins after bets close, and the ball determines the winning number. This table uses one fixed 3D camera.</p><table><thead><tr><th>Bet</th><th>Profit odds</th><th>Total return</th></tr></thead><tbody>{[["Single number", "35:1", "36×"], ["Split · 2 numbers", "17:1", "18×"], ["Street / trio · 3", "11:1", "12×"], ["Corner / first four · 4", "8:1", "9×"], ["Six line · 6", "5:1", "6×"], ["Dozen / column · 12", "2:1", "3×"], ["Red / black / odd / even / 1–18 / 19–36", "1:1", "2×"]].map(row => <tr key={row[0]}>{row.map(c => <td key={c}>{c}</td>)}</tr>)}</tbody></table><p>Zero is green. It loses all even-money, dozen and column bets. Winning returns include the original stake.</p><p>Racetrack numbers cover the selected number and {neighbours} neighbours on each side. Tier, Orphelins, Voisins and Zero place traditional French sector combinations. Voisins uses nine chip units, including two each on 0–2–3 and 25–26–28–29.</p><p>Minimum ₹10 per selection. Maximum ₹20,000 on a single number; ₹1,00,000 on each other selection, including earlier bets in the same round. Maximum total stake ₹5,00,000 per slip and 40 selections.</p><p>Auto confirm sends only the chips you selected for the current round. It does not repeat bets. Rebet restores the previous accepted selection; Undo and Clear change unconfirmed chips only.</p><p>Default round: 12 seconds betting, 9 seconds spin, 4 seconds result. RTP 97.2973% (36/37). Results are independent.</p></div>}
      {panel === "stats" && <div className="sar-statistics"><div className="sar-stat-counts">{["red", "black", "green"].map(color => <span key={color}>{color === "green" ? "ZERO" : color.toUpperCase()}<b>{history.filter(h => pocketColor(h.pocket) === color).length}</b></span>)}</div><div className="sar-stat-grid">{history.map(h => <span key={h.id} className={`sar-number ${pocketColor(h.pocket)}`}>{h.pocket}</span>)}</div>{!history.length && <p>No completed rounds yet.</p>}<p>Statistics describe previous results and do not predict the next spin.</p></div>}
      {panel === "bets" && <div className="sar-accessible-board"><div className="sar-modal-status">{status} · {money(chip)} chip <b>{money(total)} selected</b></div><BettingBoard bets={new Map(shownBets.map(b => [rouletteSelectionKey(b), b]))} onPlace={b => place([b])} disabled={disabled} highlight={result} payoutBase={36} /><div className="sar-sector-buttons">{SECTORS.map(s => <button key={s} disabled={disabled} onClick={() => place(sectorBets(s))}>{s}</button>)}</div><details><summary>Racetrack numbers · {neighbours} neighbours each side</summary><div className="sar-track-buttons">{EUROPEAN_WHEEL_ORDER.map(n => <button key={n} className={pocketColor(n)} disabled={disabled} onClick={() => place(neighbourBets(n, neighbours))}>{n}</button>)}</div></details><div className="sar-selected">{[...bets.values()].map(b => <span key={rouletteSelectionKey(b)}>{betLabel(b)} <b>{money(b.amount)}</b></span>)}</div>{error && <p role="alert" className="sar-modal-error">{error}</p>}<button className="sar-confirm" disabled={disabled || !bets.size} onClick={() => void submit()}>{posting ? "Confirming…" : `Confirm ${money(total)}`}</button></div>}
    </DialogContent></Dialog>
  </div>;
}
