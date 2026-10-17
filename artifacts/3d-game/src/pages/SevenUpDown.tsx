import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, CircleHelp, History, RotateCcw, Settings2, Undo2, Volume2, VolumeX, X } from "lucide-react";
import { customFetch, getGetWalletBalanceQueryKey, useGetWalletBalance } from "@workspace/api-client-react";
import { SEVEN_SPOTS, normalizeSevenBets, sevenMultiplier, sevenWins, type SevenBet, type SevenSpot, type CollectionConfig, type CollectionState } from "@workspace/api-zod/instant-collection";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { store, useStore } from "@/game/store";
import { playSevenSound, unlockAudio } from "@/game/audio";
import { updateSettings } from "@/game/engine";
import type { SevenSound } from "@/game/sevenSoundDesign";
import { useSevenRoundAudio } from "@/components/sevenupdown/useSevenRoundAudio";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, request } from "@/components/instant/InstantGame";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import DiceDome, { Pips } from "@/components/sevenupdown/DiceDome";
import "@/components/sevenupdown/seven-up-down.css";

type PendingBet = { roundId: string; bets: SevenBet[] };
type Outcome = { dice: number[]; total: number };
type Slip = Partial<Record<SevenSpot, number>>;
const endpoint = "/api/7up7down";
const money = (paise: string | number) => `₹${formatRupees(String(paise))}`;
const sumSlip = (slip: Slip) => Object.values(slip).reduce((a, b) => a + (b ?? 0), 0);
const chipLabel = (value: number) => value >= 1000 ? `${value / 1000}k` : String(value);
const fromBets = (bets: SevenBet[]) => Object.fromEntries(bets.map(b => [b.spot, Number(b.amount)])) as Slip;
const spotLabel = (spot: SevenSpot) => spot === "down" ? "7 Down" : spot === "seven" ? "Exactly 7" : spot === "up" ? "7 Up" : `Total ${spot}`;
const totalOf = (round: { outcome: number[] }) => round.outcome[0] + round.outcome[1];
const category = (total: number) => total < 7 ? "down" : total === 7 ? "seven" : "up";


function Chip({ value, color = "#169a43", small = false }: { value: number; color?: string; small?: boolean }) {
  return <span className={`sud-chip ${small ? "is-small" : ""}`} style={{ "--chip-color": color } as CSSProperties}><span>{chipLabel(value)}</span></span>;
}

export default function SevenUpDown() {
  const { user } = useAuth(), qc = useQueryClient();
  const queryKey = ["seven-live-history", user?.id];
  const pendingKey = `seven-live:pending:${user?.id}`;
  const config = useQuery({ queryKey: ["seven-live-config"], queryFn: () => customFetch<CollectionConfig>(`${endpoint}/config`), retry: false, refetchInterval: 30000 });
  const state = useQuery({ queryKey, queryFn: () => customFetch<CollectionState>(`${endpoint}/state`), retry: false });
  const table = useQuery({ queryKey: ["seven-live-round", user?.id], queryFn: () => customFetch<TableRoundSnapshot | null>(`${endpoint}/round`), retry: false, refetchInterval: 700, refetchIntervalInBackground: false });
  const balance = useGetWalletBalance({ game: "lunar" }, { query: { queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }), enabled: !!user, retry: false } });
  const [pending, setPending] = useState<PendingBet | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(pendingKey) ?? "null") as PendingBet | null;
      if (!p?.roundId || !Array.isArray(p.bets)) return null;
      normalizeSevenBets(p.bets, p.bets.reduce((n, b) => n + BigInt(b.amount), 0n));
      return p;
    } catch { return null; }
  });
  const [slip, setSlip] = useState<Slip>(() => pending ? fromBets(pending.bets) : {});
  const [undo, setUndo] = useState<Slip[]>([]), [lastSlip, setLastSlip] = useState<Slip>({});
  const [chip, setChip] = useState(10), [chipsOpen, setChipsOpen] = useState(false);
  const [multiple, setMultiple] = useState(true), [roadmap, setRoadmap] = useState(false);
  const [error, setError] = useState(""), [panel, setPanelState] = useState<"rules" | "history" | "fairness" | "settings" | null>(null);
  const [sending, setSending] = useState(false), [confirmedRound, setConfirmedRound] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const sound = useStore(s => s.settings.sound), lock = useRef(false), seenRound = useRef<string | null>(null);
  const snapshot = table.data;
  const serverNow = now + (snapshot ? snapshot.now - table.dataUpdatedAt : 0);
  const fresh = !!snapshot && !table.isError && now - table.dataUpdatedAt < 5000;
  const bettingOpen = fresh && snapshot?.phase === "betting" && snapshot.bettingEndsAt - serverNow > 300;
  const myBet = snapshot?.myBets[0];
  const confirmed = !!myBet || (!!snapshot && confirmedRound === snapshot.roundId);
  const outcome = snapshot?.outcome as Outcome | null;
  const phase = snapshot?.phase === "reveal" && !outcome ? "rolling" : outcome ? "reveal" : "idle";
  const countdown = snapshot ? Math.max(0, Math.ceil(((snapshot.phase === "betting" ? snapshot.bettingEndsAt : snapshot.phase === "reveal" ? snapshot.revealEndsAt : snapshot.settleEndsAt) - serverNow) / 1000)) : 0;
  const locked = !bettingOpen || sending || confirmed || !!pending;
  const total = sumSlip(slip), wallet = balance.data ? Number(balance.data.balance) : 0;
  const min = Number(snapshot?.config.minStakePaise ?? config.data?.minStakePaise ?? 1000), max = Number(snapshot?.config.maxStakePaise ?? config.data?.maxStakePaise ?? 1000000);
  const ready = !!config.data?.enabled && fresh && !!balance.data && !balance.isError;
  const canRoll = ready && bettingOpen && !confirmed && total >= min && total > 0 && total <= max && total <= wallet;
  const history = (snapshot?.recent ?? []).map(r => ({ id: r.roundId, outcome: (r.outcome as Outcome).dice }));
  const ownHistory = state.data?.history ?? [];
  const round = ownHistory[0] ?? null;
  const rtp = snapshot ? 1 - snapshot.config.houseEdge : config.data?.rtp ?? .97, cap = snapshot?.config.maxMultiplier ?? config.data?.maxMultiplier ?? 1000;
  const counts = history.reduce((acc, r) => { acc[category(totalOf(r))]++; return acc; }, { down: 0, seven: 0, up: 0 });
  const dice = outcome?.dice ?? history[0]?.outcome ?? [5, 4];
  const resultTotal = dice[0] + dice[1];
  const paid = myBet?.status === "settled" ? Number(myBet.payoutAmount) : 0;
  const resultVisible = !!outcome && fresh;
  const shownSlip = myBet ? fromBets(myBet.bets as SevenBet[]) : slip;
  const cue = (kind: SevenSound) => { if (sound) { void unlockAudio(); playSevenSound(kind); } };
  const setPanel = (next: typeof panel) => { if (next !== panel) cue(next ? "open" : "close"); setPanelState(next); };
  const toggleRoadmap = () => { cue(roadmap ? "close" : "open"); setRoadmap(v => !v); };
  const remember = (value: PendingBet | null) => {
    setPending(value);
    try { if (value) localStorage.setItem(pendingKey, JSON.stringify(value)); else localStorage.removeItem(pendingKey); } catch { /* In-memory retry still identifies the same round. */ }
  };
  const refreshWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] });
    void qc.invalidateQueries({ queryKey });
  };
  useEffect(() => { document.title = "7 Up 7 Down · Lunar Games"; const tick = window.setInterval(() => setNow(Date.now()), 150); return () => clearInterval(tick); }, []);
  useEffect(() => {
    if (!snapshot || snapshot.roundId === seenRound.current) return;
    if (seenRound.current || (pending && pending.roundId !== snapshot.roundId)) {
      setSlip({}); setUndo([]); remember(null); setError(""); setConfirmedRound(null); refreshWallet();
    }
    seenRound.current = snapshot.roundId;
  }, [snapshot?.roundId]);
  useEffect(() => {
    if (myBet) {
      setError("");
      setLastSlip(fromBets(myBet.bets as SevenBet[]));
      if (pending?.roundId === snapshot?.roundId) remember(null);
      refreshWallet();
    }
  }, [snapshot?.roundId, myBet?.slipId, myBet?.status]);
  useEffect(() => {
    if (round?.options.bets) setLastSlip(fromBets(round.options.bets));
  }, [round?.id]);
  // Local entertainment only: deterministic bot activity, never wallet entries or real player counts.
  const botSeed = (snapshot?.roundId ?? "").split("").reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  const elapsed = snapshot ? serverNow - snapshot.bettingEndsAt + snapshot.config.bettingWindowMs : 0;
  const bots = ["Maya", "Arjun", "Neha", "Kabir", "Riya", "Dev"].map((name, i) => ({ name, spot: SEVEN_SPOTS[(botSeed + i * 7) % SEVEN_SPOTS.length], amount: [10, 50, 100, 500][(botSeed + i) % 4], at: (i + 1) * (snapshot?.config.bettingWindowMs ?? 12000) / 8 })).filter(b => fresh && elapsed >= b.at);
  const latestBot = bots[bots.length - 1];
  useSevenRoundAudio({ id: snapshot?.roundId, phase: snapshot?.phase, countdown, total: outcome?.total, enabled: sound, fresh, rolling: phase === "rolling", slipId: myBet?.slipId, slipStatus: myBet?.status, payout: paid, bot: latestBot?.name });
  function edit(next: Slip, action: SevenSound = "chip") {
    if (locked || lock.current) return false;
    const amount = sumSlip(next);
    if (amount > wallet || amount > max) { setError(amount > wallet ? "Insufficient wallet balance for these chips." : `Maximum total bet is ${money(max)}.`); cue("error"); return false; }
    setUndo(previous => [...previous.slice(-49), slip]); setSlip(next); setError("");
    cue(action); return true;
  }
  function addChip(spot: SevenSpot) {
    if (!ready || locked) return;
    edit(multiple ? { ...slip, [spot]: (slip[spot] ?? 0) + chip * 100 } : { [spot]: (slip[spot] ?? 0) + chip * 100 });
  }
  function toggleMode() {
    if (locked) return;
    cue("select");
    setMultiple(value => !value); setUndo([]);
    if (multiple && Object.keys(slip).length > 1) setSlip({});
    setError("");
  }
  async function roll() {
    if (lock.current || !snapshot || confirmed || (!pending && !canRoll)) return;
    lock.current = true; setSending(true); setError(""); setChipsOpen(false);
    const input: PendingBet = pending ?? { roundId: snapshot.roundId, bets: SEVEN_SPOTS.filter(spot => slip[spot]).map(spot => ({ spot, amount: String(slip[spot]) })) };
    remember(input);
    try {
      await request(`${endpoint}/bet`, input);
      setConfirmedRound(input.roundId); setLastSlip(fromBets(input.bets)); remember(null); cue("confirm"); refreshWallet();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) remember(null);
      setError(errorMessage(e)); cue("error");
    } finally { await table.refetch(); lock.current = false; setSending(false); }
  }
  const toggleSound = () => {
    const next = !sound, unlocked = unlockAudio();
    updateSettings({ sound: next });
    if (next) void unlocked.then(() => { if (store.getState().settings.sound) playSevenSound("select"); });
  };
  const refresh = () => { cue("select"); setError(""); void config.refetch(); void table.refetch(); void state.refetch(); void balance.refetch(); };

  function spotButton(spot: SevenSpot, main = false) {
    const winner = resultVisible && sevenWins(spot, resultTotal);
    const shownAmount = shownSlip[spot];
    return <button key={spot} className={`sud-spot ${main ? `sud-main-spot sud-${spot}` : "sud-number-spot"} ${winner ? "is-winner" : ""} ${resultVisible && !winner ? "is-dimmed" : ""} ${shownSlip[spot] ? "has-bet" : ""}`} disabled={locked || !ready} onClick={() => addChip(spot)} aria-label={`Bet on ${spotLabel(spot)}`} data-testid={`seven-spot-${spot}`}>
      <strong>{spot === "down" ? "2–6" : spot === "up" ? "8–12" : spot === "seven" ? "7" : spot}</strong>
      <span className="sud-odds">{config.data ? `${sevenMultiplier(spot, rtp, cap).toFixed(2)}×` : "—"}</span>
      {main && <span className="sud-spot-word">{spot === "down" ? "DOWN" : spot === "up" ? "UP" : "LUCKY 7"}</span>}
      {!!shownAmount && <span className="sud-placed-chip"><Chip value={Number(shownAmount) / 100} small /></span>}
      {bots.some(b => b.spot === spot) && <span className="sud-bot-chip" aria-label="Simulated player chips" key={`${snapshot?.roundId}-${spot}`}><i />BOT</span>}
      {winner && <span className="sud-winner-spark" aria-label="Winning outcome">✦</span>}
    </button>;
  }

  return <main className="sud-page" data-testid="collection-page">
    <div className="sud-ambient" aria-hidden="true" />
    <section className="sud-cabinet" aria-label="7 Up 7 Down dice game">
      <header className="sud-header"><Link href="/" aria-label="Back to lobby" onClick={() => cue("close")}><ArrowLeft size={17} /></Link><h1>7<span>up</span>7<span>down</span></h1><button onClick={() => setPanel("rules")} aria-label="Game rules"><CircleHelp size={18} /></button></header>
      <div className="sud-history-panel">
        <div className="sud-stats">{(["down", "up", "seven"] as const).map(key => <span key={key}><b>{key === "down" ? "2–6" : key === "up" ? "8–12" : "7"}</b> {history.length ? `${Math.round(counts[key] / history.length * 100)}%` : "—"}</span>)}<small>Table · {history.length || "—"} rounds</small></div>
        <button className="sud-road-strip" onClick={toggleRoadmap} aria-label="Toggle roadmap" aria-expanded={roadmap}>
          {history.length ? history.slice(0, 14).reverse().map((r, i, list) => <span key={r.id} className={`sud-history-round ${i === list.length - 1 ? "is-latest" : ""}`}><span className="sud-history-star">{i === list.length - 1 ? "★" : "·"}</span><b className={`sud-total-${category(totalOf(r))}`}>{totalOf(r)}</b><Pips value={r.outcome[0]} /><Pips value={r.outcome[1]} /></span>) : <span className="sud-history-empty"><History size={19} /><span>The table is warming up<small>Rounds run automatically</small></span></span>}
        </button>
      </div>
      <div className="sud-table">
        <div className="sud-wood-rail" />
        <div className="sud-bot-players" aria-label="Simulated players"><small>SIMULATED</small>{bots.slice(-3).map((b, i) => <div key={b.name} className="sud-bot-player" style={{ "--bot-color": ["#d5a853", "#bc77c4", "#63b9c9"][i] } as CSSProperties}><span>{b.name[0]}</span><b>{b.name}<small>BOT</small></b></div>)}</div>
        <DiceDome dice={dice} phase={phase} />
        <button className="sud-round-info" onClick={() => setPanel("fairness")}>Round details</button>
        <div className={`sud-round-clock ${bettingOpen ? "is-ticking" : ""}`} aria-label="Round countdown"><span>{fresh ? countdown : "–"}</span><small>{!fresh ? "SYNCING" : snapshot?.phase === "betting" ? "BET NOW" : phase === "rolling" ? "ROLLING" : "NEXT"}</small></div>
        <div className={`sud-table-message ${paid ? "is-win" : ""}`} role="status" aria-live="polite" data-testid="collection-result">
          {!fresh ? <><b>Connecting to the table…</b><span>Waiting for the round clock</span></> : resultVisible ? <><b>{resultTotal} · {category(resultTotal) === "seven" ? "LUCKY 7" : `7 ${category(resultTotal).toUpperCase()}`}</b><span>{paid ? `${money(paid)} · Returned to your wallet` : myBet?.status === "pending" ? "Settling your bet…" : `Next round in ${countdown}s`}</span></> : phase === "rolling" || !bettingOpen ? <><b>No more bets · Rolling…</b><span>Good luck!</span></> : <><b>{confirmed ? "Bet confirmed · Good luck!" : "Please Bet Now"}</b><span>{confirmed ? "Your chips are locked for this round" : "Choose your chips, then confirm your bet"}</span></>}
        </div>
      </div>
      <nav className="sud-table-nav" aria-label="Table controls"><button onClick={() => setPanel("settings")} aria-label="Table settings"><Settings2 size={16} /></button><button onClick={toggleRoadmap} aria-expanded={roadmap}>Roadmap <ChevronDown size={11} /></button><button disabled={locked} onClick={toggleMode}>{multiple ? "Multiple Mode" : "Single Mode"}<ChevronDown size={11} /></button><span>Min <b>{money(min)}</b><i /> Max <b>{money(max)}</b></span></nav>
      {roadmap && <div className="sud-roadmap"><div><b>Table roadmap</b><button onClick={toggleRoadmap} aria-label="Close roadmap"><X size={16} /></button></div>{history.length ? <div className="sud-roadmap-cells">{history.slice().reverse().map(r => <span key={r.id} className={`sud-total-${category(totalOf(r))}`}>{totalOf(r)}</span>)}</div> : <p>Completed rounds will appear here automatically.</p>}<small>Past results do not predict the next roll.</small></div>}
      <div className="sud-activity"><span className="sud-live-dot" />AUTO ROUNDS <span key={`${snapshot?.roundId}-${latestBot?.name}`} className="sud-activity-bet">{latestBot ? `${latestBot.name} · BOT · ${money(latestBot.amount * 100)} on ${spotLabel(latestBot.spot)}` : "Simulated players joining…"}</span></div>
      <div className="sud-betting-board" aria-label="Betting board"><div className="sud-main-bets">{SEVEN_SPOTS.slice(0, 3).map(spot => spotButton(spot, true))}</div><div className="sud-number-bets">{SEVEN_SPOTS.slice(3).map(spot => spotButton(spot))}</div></div>
      <div className="sud-balance-bar"><span>Balance <b data-testid="collection-balance">{balance.data ? money(balance.data.balance) : "Connecting…"}</b></span><span>Your Bet <b data-testid="seven-total-bet">{money(myBet?.totalStake ?? total)}</b></span></div>
      <div className="sud-dock">
        <div className="sud-player"><span>{(user?.displayName || "P").slice(0, 1).toUpperCase()}</span><small>{user?.displayName || "Player"}</small></div>
        <button className="sud-dock-action" disabled={locked || !sumSlip(lastSlip) || !ready} onClick={() => { if (Object.keys(lastSlip).length > 1) setMultiple(true); edit({ ...lastSlip }, "stack"); }} aria-label="Repeat last bet"><RotateCcw size={21} /><small>again</small></button>
        <div className="sud-chip-selector"><button className="sud-selected-chip" disabled={locked} onClick={() => { cue(chipsOpen ? "close" : "open"); setChipsOpen(v => !v); }} aria-label="Choose chip value" aria-expanded={chipsOpen}><Chip value={chip} /><ChevronDown size={12} /></button>{chipsOpen && <div className="sud-chip-menu" role="group" aria-label="Chip values">{[10, 50, 100, 500, 1000, 5000].map((value, i) => <button key={value} onClick={() => { cue("select"); setChip(value); setChipsOpen(false); }} aria-label={`Select ₹${value} chip`} aria-pressed={chip === value}><Chip value={value} color={["#169a43", "#268dcc", "#d94242", "#9462c8", "#d58c24", "#202533"][i]} /></button>)}</div>}</div>
        <button className="sud-dock-action" disabled={locked || !total} onClick={() => edit(Object.fromEntries(Object.entries(slip).map(([spot, value]) => [spot, value! * 2])), "stack")} aria-label="Double bets"><b>×2</b><small>double</small></button>
        <button className="sud-dock-action" disabled={locked || !undo.length} onClick={() => { cue("undo"); setSlip(undo[undo.length - 1]); setUndo(a => a.slice(0, -1)); setError(""); }} aria-label="Undo last chip"><Undo2 size={23} /><small>undo</small></button>
        <button className="sud-dock-action sud-clear" disabled={locked || !total} onClick={() => edit({}, "clear")} aria-label="Clear bets"><X size={25} /><small>clear</small></button>
      </div>
      <div className="sud-roll-row"><span>{!config.data?.enabled && config.data ? "Table temporarily closed" : !fresh ? "Reconnecting…" : confirmed ? "Waiting for the dice" : !bettingOpen ? "Next round starts automatically" : total < min ? `Minimum bet ${money(min)}` : `${Object.keys(slip).length} spot(s) · ${money(total)}`}</span><button data-testid="collection-play" disabled={sending || confirmed || !fresh || (!pending && !canRoll)} onClick={() => void roll()}>{sending ? "Confirming…" : confirmed ? "Bet confirmed" : pending ? "Retry pending bet" : "Confirm bet"}<span aria-hidden="true">◆</span></button></div>
      {(error || config.isError || table.isError || balance.isError) && <div className="sud-error" role="alert"><span>{error || "Could not connect to the table. Please retry."}</span><button onClick={refresh} disabled={sending}>Refresh</button></div>}
      <footer className="sud-footer"><button onClick={() => setPanel("rules")} aria-label="Read game rules">How to play</button><span>LUNAR <i>◆</i> ORIGINALS</span><button onClick={() => setPanel("history")} aria-label="Round history"><History size={15} /></button><button onClick={toggleSound} aria-label={sound ? "Mute sound" : "Enable sound"}>{sound ? <Volume2 size={15} /> : <VolumeX size={15} />}</button></footer>
    </section>
    <Dialog open={panel !== null} onOpenChange={open => !open && setPanel(null)}><DialogContent className="sud-dialog"><DialogHeader><DialogTitle>{panel === "rules" ? "How to play 7 Up 7 Down" : panel === "settings" ? "Table settings" : panel === "history" ? "Your round history" : "Round details"}</DialogTitle><DialogDescription>{panel === "rules" ? "Two dice. Pick your numbers. Make your moment." : panel === "settings" ? "Make the table feel like yours." : "Your server-recorded bets and results."}</DialogDescription></DialogHeader>
      {panel === "rules" ? <div className="sud-rules"><p>Choose a chip and tap a spot to add it. Tap again to add more. Select <b>Confirm bet</b> to confirm your entire bet. Every round starts and settles automatically, even when you do not bet. Confirmed chips apply to this round only.</p><ul><li><b>7 Down:</b> the two dice total 2–6.</li><li><b>Lucky 7:</b> the dice total exactly 7.</li><li><b>7 Up:</b> the dice total 8–12.</li><li><b>Number bets:</b> match the exact total shown on a smaller square.</li></ul><p>In Multiple Mode, you can bet on several spots in the same roll. All winning spots pay. Again restores your last bet; ×2 doubles your chips; Undo removes your last change; Clear empties the table.</p><p>All multipliers are total returns including your stake. Each spot rounds down to the nearest paise. Odds use the table’s current RTP ({(rtp * 100).toFixed(0)}%) and maximum return. Limits apply to the total bet: {money(min)}–{money(max)}.</p><p>Dice have six equally likely faces. There are 36 combinations: 15 below seven, 6 exactly seven and 15 above. Each roll is independent. Bets only submit when you press Confirm bet; a retry recovers the same bet. Players marked BOT are simulated entertainment; their chips do not affect your wallet, dice or payouts.</p></div>
      : panel === "settings" ? <div className="sud-settings"><button onClick={toggleSound}><span>Game sound</span><b>{sound ? "On" : "Off"}</b></button><button disabled={locked} onClick={toggleMode}><span>Betting mode</span><b>{multiple ? "Multiple" : "Single"}</b></button><p>Animations follow your device’s reduced motion setting.</p></div>
      : panel === "history" ? <div className="sud-receipts">{ownHistory.length ? ownHistory.map(r => <article key={r.id}><span className={`sud-receipt-total sud-total-${category(totalOf(r))}`}>{totalOf(r)}</span><div><strong>{r.outcome.join(" + ")} · {category(totalOf(r)).toUpperCase()}</strong><small>{new Date(r.createdAt).toLocaleString()}</small><small>Bet {money(r.stakeAmount)} · {r.options.bets?.length ?? 1} spot(s)</small></div><b>{money(r.payoutAmount)}</b></article>) : <p>Your rounds will appear here after your first roll.</p>}</div>
      : <div className="sud-fairness">{snapshot ? <><p>Everyone sees the same server round. The seed hash is committed before betting; the seed and dice are disclosed at the end of the roll. HMAC-SHA256 uses the domain instant:v1:7up7down:{snapshot.nonce}, the client seed, and labels draw / dice:2.</p>{[["Round", snapshot.roundId], ["Dice", outcome?.dice.join(" + ") ?? "Awaiting roll"], ["Server seed SHA-256", snapshot.serverSeedHash], ["Client seed", snapshot.clientSeed], ["Nonce", String(snapshot.nonce)], ["Server seed", snapshot.serverSeed ?? "Hidden until reveal"]].map(([label, value]) => <div key={label}><small>{label}</small><code>{value}</code></div>)}</> : <p>Connecting to the round…</p>}</div>}
    </DialogContent></Dialog>
  </main>;
}
