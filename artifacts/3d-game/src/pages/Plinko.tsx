import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, CircleDot, LoaderCircle, Pause, Play } from "lucide-react";
import { toast } from "sonner";
import { sfx, unlockAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { formatRupees, rupeesToPaise } from "@/lib/format";
import { AutoBetStatus, useSelectionBet } from "@/components/table/AutoBet";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { InstantShell, StakeControl, Notice, FairnessDialog, SeedField, useInstantGame, request, errorMessage, stakeError, money } from "@/components/instant/InstantGame";

type Risk = "low" | "medium" | "high";
interface PlinkoState {
  id: string; betId: string; stakeAmount: string; rows: number; risk: Risk; path: ("L" | "R")[];
  bucket: number; multiplier: number; payoutAmount: string; serverSeed: string | null; serverSeedHash: string;
  clientSeed: string; nonce: number; houseEdge: number; maxMultiplier: number; createdAt: string;
}
interface PlinkoConfig { enabled: boolean; houseEdge: number; maxMultiplier: number; maxStakePaise: string; multipliers: Record<Risk, Record<string, number[]>> }
interface Seed { serverSeedHash: string; clientSeed: string; nextNonce: number }
interface Ball { round: PlinkoState; startedAt: number; stepMs: number }

export default function Plinko() {
  const { user, sound, balance, refresh, qc } = useInstantGame("plinko");
  const [stake, setStake] = useState(100);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<Risk>("medium");
  const [bonus, setBonus] = useState(false);
  const [mode, setMode] = useState<"manual" | "auto">("manual");
  const [autoCount, setAutoCount] = useState(10);
  const [remaining, setRemaining] = useState(0);
  const [autoRunning, setAutoRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ball, setBall] = useState<Ball | null>(null);
  const [completed, setCompleted] = useState<PlinkoState | null>(null);
  const [results, setResults] = useState<PlinkoState[]>([]);
  const [fairness, setFairness] = useState(false);
  const [detail, setDetail] = useState<PlinkoState | null>(null);
  const [verification, setVerification] = useState("");
  const [rotating, setRotating] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [clientSeed, setClientSeed] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const stopRef = useRef(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  const landResolve = useRef<((ok: boolean) => void) | null>(null);
  const config = useQuery({ queryKey: ["plinko.config"], queryFn: () => request<PlinkoConfig>("/api/plinko/config"), staleTime: 60_000, retry: false });
  const seed = useQuery({ queryKey: ["plinko.seed", user?.id], queryFn: () => request<Seed>("/api/plinko/seed"), enabled: !!user, retry: false });
  const recent = useQuery({ queryKey: ["plinko.recent", user?.id], queryFn: () => request<PlinkoState[]>("/api/plinko/recent?limit=8"), enabled: !!user, retry: false });
  const available = bonus ? undefined : balance.data?.balance;
  const latestBalance = useRef(available); latestBalance.current = available;
  const validation = stakeError(stake, available, config.data?.maxStakePaise);
  const table = config.data?.multipliers?.[risk]?.[String(rows)] ?? [];
  const ready = !!user && config.data?.enabled === true && table.length === rows + 1 && balance.isSuccess && seed.isSuccess && !rotating && !uncertain;
  const locked = busy || autoRunning || rotating;
  const win = useRoundWin({ game: "plinko", userId: user?.id, roundId: completed?.id ?? null, eligible: !!completed && !autoRunning,
    bets: completed ? [{ status: "settled", totalStake: completed.stakeAmount, payoutAmount: completed.payoutAmount }] : [] });
  const autoSelect = useSelectionBet({ enabled: ready && mode === "manual" && !locked && !validation, scope: `${rows}:${risk}:${bonus}:${mode}`, submit: () => singleDrop() });
  const selectStake = (n: number) => { setStake(n); unlockAudio(); if (n > 0) autoSelect.select(); else autoSelect.cancel(); };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stopRef.current = true; landResolve.current?.(false); landResolve.current = null; }; }, []);
  // Losing focus stops future auto bets; the already submitted ball still settles.
  useEffect(() => {
    const stop = () => { if (document.hidden) { stopRef.current = true; setStopping(true); } };
    document.addEventListener("visibilitychange", stop);
    return () => document.removeEventListener("visibilitychange", stop);
  }, []);

  const landed = (result: PlinkoState) => {
    if (!mounted.current) return;
    setCompleted(result); setResults(prev => [result, ...prev].slice(0, 6)); setBall(null);
    if (sound) {
      if (Number(result.payoutAmount) > Number(result.stakeAmount)) { sfx.plinkoWin(); voiceRoundWin("plinko", result.id); }
      else { sfx.plinkoLose(); if (Number(result.payoutAmount) < Number(result.stakeAmount)) voiceRoundLoss("plinko", result.id); }
    }
    refresh(); void seed.refetch();
    landResolve.current?.(true); landResolve.current = null;
  };
  const drop = async (): Promise<boolean> => {
    if (!mounted.current || lock.current || !ready) return false;
    const error = stakeError(stake, latestBalance.current, config.data?.maxStakePaise);
    if (error) { toast.error(error); return false; }
    lock.current = true; setBusy(true); unlockAudio();
    try {
      const result = await request<PlinkoState>("/api/plinko/drop", { stakeAmount: rupeesToPaise(stake), rows, risk, useBonus: bonus });
      if (!mounted.current) return false;
      notifyPlayStarted(); if (sound) sfx.plinkoDrop();
      // Keep the result out of the UI until this exact server path lands.
      return await new Promise<boolean>(resolve => {
        landResolve.current = resolve;
        setBall({ round: result, startedAt: performance.now(), stepMs: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 65 : 145 });
      });
    } catch (error) {
      if (mounted.current) {
        toast.error(errorMessage(error));
        // Never retry a wager automatically after an uncertain response.
        setUncertain(true); refresh();
      }
      return false;
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const singleDrop = async () => { if (autoRunning || lock.current) return; autoSelect.cancel(); await drop(); };
  const startAuto = async () => {
    if (locked || !ready || validation || !Number.isInteger(autoCount) || autoCount < 1 || autoCount > 100) return;
    autoSelect.cancel(); stopRef.current = false; setStopping(false); setAutoRunning(true); win.dismiss();
    for (let left = autoCount; left > 0 && !stopRef.current && mounted.current; left--) {
      setRemaining(left);
      if (!await drop()) break;
      if (mounted.current) setRemaining(left - 1);
      // Fetch the settled balance before authorizing the next drop.
      try {
        const out = await balance.refetch();
        if (out.error) break;
        latestBalance.current = bonus ? undefined : out.data?.balance;
      } catch { break; }
    }
    if (mounted.current) { setAutoRunning(false); setStopping(false); setRemaining(0); }
  };
  const stopAuto = () => { stopRef.current = true; setStopping(true); };
  const rotate = async () => {
    if (locked) return;
    setRotating(true);
    try {
      const result = await request<{ revealedServerSeed: string; newSeed: Seed }>("/api/plinko/seed/rotate", clientSeed.trim() ? { clientSeed: clientSeed.trim() } : {});
      setRevealed(result.revealedServerSeed); qc.setQueryData(["plinko.seed", user?.id], result.newSeed); setVerification("");
    } catch (error) { toast.error(errorMessage(error)); }
    finally { setRotating(false); }
  };
  const verify = async () => {
    if (!detail) return;
    setVerification("Checking…");
    try {
      const out = await request<PlinkoState & { verified: boolean }>(`/api/plinko/${detail.id}/verify`);
      setDetail(out); setVerification(out.verified ? "Server verification passed: hash, path, bucket and multiplier match." : "Verification mismatch. Please contact support with this round ID.");
    } catch (error) { setVerification(errorMessage(error)); }
  };
  const reconcile = async () => {
    const [history, wallet] = await Promise.all([recent.refetch(), balance.refetch()]);
    if (history.isSuccess && wallet.isSuccess) { setUncertain(false); toast.info("Wallet and recent rounds refreshed. Check the latest round before dropping again."); }
  };
  const changeRows = (n: number) => { setRows(n); setCompleted(null); };
  const changeRisk = (r: Risk) => { setRisk(r); setCompleted(null); };
  const net = completed ? (Number(completed.payoutAmount) - Number(completed.stakeAmount)) / 100 : 0;
  if (!user) return null;
  return <InstantShell game="plinko" balance={balance.data?.balance} onFairness={() => { setDetail(null); setVerification(""); setFairness(true); }}>
    <RoundWinDialog win={win.win} onClose={win.dismiss} />
    <section className="instant-heading"><div><h2>Let the good times drop.</h2><p>Pick your risk. Drop a ball. Follow every bounce.</p></div><span className="instant-tag"><i /> {rows} ROWS</span></section>
    {config.isError && <Notice onRetry={() => void config.refetch()}>Payout settings couldn't load.</Notice>}
    {config.data?.enabled === false && <Notice>Plinko is temporarily unavailable.</Notice>}
    {seed.isError && <Notice onRetry={() => void seed.refetch()}>Your seed commitment couldn't load.</Notice>}
    {balance.isError && <Notice onRetry={() => void balance.refetch()}>Your wallet couldn't load.</Notice>}
    {uncertain && <Notice onRetry={() => void reconcile()}>The drop couldn't be confirmed. Refresh your wallet and history before trying again.</Notice>}
    <main className="instant-layout" data-game-screen="plinko">
      <aside className="instant-controls"><div className="instant-control-title">Set your drop<span>YOUR GAME</span></div>
        <div className="instant-segment" aria-label="Play mode">{(["manual", "auto"] as const).map(m => <button key={m} aria-pressed={mode === m} disabled={locked} onClick={() => setMode(m)}>{m === "manual" ? "Manual" : "Auto drops"}</button>)}</div>
        <StakeControl game="plinko" userId={user.id} value={stake} onChange={selectStake} disabled={locked || !ready} max={config.data?.maxStakePaise} />
        <div><label>Risk level<span>{risk === "high" ? "WIDER SWINGS" : risk === "low" ? "SMALLER SWINGS" : "BALANCED"}</span></label><div className="instant-segment" aria-label="Risk level">{(["low", "medium", "high"] as const).map(r => <button key={r} aria-pressed={risk === r} disabled={locked} onClick={() => changeRisk(r)} data-testid={`risk-${r}`}>{r[0].toUpperCase() + r.slice(1)}</button>)}</div></div>
        <div><label>Rows<span>BOARD SIZE</span></label><div className="instant-segment" aria-label="Rows">{[8, 12, 16].map(n => <button key={n} aria-pressed={rows === n} disabled={locked} onClick={() => changeRows(n)} data-testid={`rows-${n}`}>{n}</button>)}</div></div>
        <label className="instant-bonus"><input type="checkbox" checked={bonus} disabled={locked} onChange={e => setBonus(e.target.checked)} data-testid="toggle-plinko-bonus" /> Use bonus wallet</label>
        {mode === "auto" && <div><label htmlFor="auto-drops">Number of drops<span>1–100</span></label><input className="instant-auto-count" id="auto-drops" type="number" min="1" max="100" step="1" value={autoCount || ""} onChange={e => setAutoCount(Number(e.target.value))} disabled={locked} data-testid="input-auto-count" /><p className="instant-small" style={{ marginTop: 7 }}>Planned stake: ₹{money(stake * (Number.isFinite(autoCount) ? autoCount : 0))}</p></div>}
        <div className="instant-control-bottom">{autoRunning ? <button className="instant-primary" onClick={stopAuto} disabled={stopping} data-game-bet data-testid="btn-auto-stop"><Pause size={17} />{stopping ? "Stopping after this ball…" : `Stop auto · ${remaining} left`}</button> : <button className="instant-primary" onClick={() => mode === "auto" ? void startAuto() : void singleDrop()} disabled={!ready || !!validation || busy || (mode === "auto" && (!Number.isInteger(autoCount) || autoCount < 1 || autoCount > 100))} data-game-bet data-testid={mode === "auto" ? "btn-auto-start" : "btn-plinko-drop"}>{busy ? <LoaderCircle size={18} /> : mode === "auto" ? <Play size={17} /> : <ArrowDown size={18} />}{busy ? "Ball in play…" : mode === "auto" ? "Start auto drops" : "Drop ball"}</button>}
          <AutoBetStatus seconds={autoSelect.seconds} busy={busy} onCancel={autoSelect.cancel} />
          <p className="instant-small">{validation ?? (autoRunning ? "Stop cancels future drops. The current ball will finish." : "Each drop is a separate bet.")}</p></div>
        <div className="instant-odds"><span>Highest pocket</span><strong>{table.length ? `${Math.max(...table)}×` : "—"}</strong></div>
      </aside>
      <section className="instant-stage" aria-label="Plinko game board"><div className="instant-stage-top"><h3>THE DROP ZONE</h3><div className="drop-result-chips" aria-label="Recent results">{results.length ? results.slice(0, 4).reverse().map(r => <span key={r.id}>{r.multiplier.toFixed(2)}×</span>) : <span>READY TO DROP</span>}</div></div>
        <div className="instant-stage-body"><PlinkoBoard rows={rows} multipliers={table} ball={ball} onLand={landed} sound={sound} lastBucket={completed?.rows === rows && completed.risk === risk ? completed.bucket : null} /></div>
        <p className="instant-status" aria-live="polite">{ball ? "Follow the bounce…" : busy ? "Preparing your drop…" : completed ? `Landed at ${completed.multiplier.toFixed(2)}× · ₹${formatRupees(completed.payoutAmount)} returned` : "The outer pockets hold the bigger multipliers."}</p>
        <div className="instant-stats"><div><small>Last multiplier</small><strong className="accent" data-testid="plinko-last-multiplier">{completed ? `${completed.multiplier.toFixed(2)}×` : "—"}</strong></div><div><small>Last return</small><strong data-testid="plinko-last-payout">₹{formatRupees(completed?.payoutAmount ?? "0")}</strong></div><div><small>Net profit</small><strong className={net < 0 ? "negative" : "accent"}>{net < 0 ? "−" : ""}₹{money(Math.abs(net))}</strong></div></div>
      </section>
    </main>
    <section className="instant-history"><div className="instant-history-head"><h3>Your recent drops</h3><span>Every bounce has a story</span></div><div className="instant-history-list"><div className="instant-history-row is-head"><span>Drop</span><span>Bet</span><span>Multiplier</span><span>Return</span></div>
      {recent.isError ? <Notice onRetry={() => void recent.refetch()}>History couldn't load.</Notice> : !recent.data?.length ? <p className="instant-empty">{recent.isPending ? "Loading drops…" : "Make your first drop. Your results will appear here."}</p> : recent.data.filter(r => r.id !== ball?.round.id).map(r => <button key={r.id} className="instant-history-row" onClick={() => { setDetail(r); setVerification(""); setFairness(true); }} data-testid={`recent-${r.id}`}><span>{r.rows} rows <small>{r.risk.toUpperCase()}</small></span><span>₹{formatRupees(r.stakeAmount)}</span><span>{r.multiplier.toFixed(2)}×</span><span className={Number(r.payoutAmount) >= Number(r.stakeAmount) ? "positive" : "negative"}>₹{formatRupees(r.payoutAmount)}</span></button>)}</div></section>
    <FairnessDialog open={fairness} onOpenChange={setFairness} title={detail ? "Verify drop" : "Your seed commitment"}>
      <p>The active server seed hash is committed before your drop. Rotate the seed to reveal it and verify past results. Rotation uses a new seed for future drops.</p>
      {detail ? <><SeedField label="Round" value={detail.id} /><SeedField label="Path (L = left, R = right)" value={detail.path.join(" ")} /><SeedField label="Bucket (from left, numbered from 1)" value={detail.bucket + 1} /><SeedField label="Server seed hash" value={detail.serverSeedHash} /><SeedField label="Server seed" value={detail.serverSeed} /><SeedField label="Client seed" value={detail.clientSeed} /><SeedField label="Nonce" value={detail.nonce} /><button onClick={() => void verify()}>Verify this drop</button>{verification && <p className="instant-verification" role="status">{verification}</p>}</> : <><SeedField label="Active server seed hash" value={seed.data?.serverSeedHash ?? null} /><SeedField label="Client seed" value={seed.data?.clientSeed ?? null} /><SeedField label="Next nonce" value={seed.data?.nextNonce ?? null} />{revealed && <SeedField label="Previous server seed (revealed)" value={revealed} />}<label htmlFor="plinko-client-seed">New client seed (optional)</label><input id="plinko-client-seed" className="instant-auto-count" placeholder="Generate automatically" maxLength={64} value={clientSeed} onChange={e => setClientSeed(e.target.value)} disabled={locked} /><button onClick={() => void rotate()} disabled={locked || !seed.data} data-testid="btn-rotate-seed">{rotating ? "Rotating…" : "Rotate seed & reveal previous"}</button></>}
      {config.data && <p>House edge: {(config.data.houseEdge * 100).toFixed(2)}%. Pockets show total returns including your stake. Returns below 1× are net losses.</p>}
    </FairnessDialog>
  </InstantShell>;
}

function PlinkoBoard({ rows, multipliers, ball, onLand, sound, lastBucket }: { rows: number; multipliers: number[]; ball: Ball | null; onLand: (r: PlinkoState) => void; sound: boolean; lastBucket: number | null }) {
  const [progress, setProgress] = useState(0);
  const callback = useRef(onLand); callback.current = onLand;
  const soundRef = useRef(sound); soundRef.current = sound;
  useEffect(() => {
    setProgress(0);
    if (!ball) return;
    let frame = 0, previousStep = -1;
    const tick = (now: number) => {
      const p = Math.min(rows + 1, (now - ball.startedAt) / ball.stepMs);
      setProgress(p);
      const step = Math.floor(p);
      if (step !== previousStep && step >= 1 && step <= rows && soundRef.current) sfx.plinkoPeg();
      previousStep = step;
      if (p >= rows + 1) callback.current(ball.round);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ball, rows]);
  const gap = 712 / (rows + 2), rowGap = 435 / rows, firstY = 60, bucketY = 512;
  const pegs = Array.from({ length: rows }, (_, row) => Array.from({ length: row + 3 }, (_, col) => ({ x: 400 + (col - (row + 2) / 2) * gap, y: firstY + row * rowGap }))).flat();
  const points = [{ x: 400, y: 15 }, { x: 400, y: firstY - 9 }];
  if (ball) {
    let rights = 0;
    ball.round.path.forEach((dir, i) => {
      if (dir === "R") rights++;
      points.push({ x: 400 + (rights - (i + 1) / 2) * gap, y: i === rows - 1 ? bucketY + 16 : firstY + (i + 1) * rowGap - 9 });
    });
  }
  const segment = Math.min(Math.floor(progress), points.length - 2), t = progress - segment;
  const from = points[segment] ?? points[0], to = points[segment + 1] ?? from;
  const position = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * (segment ? 9 : 0) };
  return <svg className="drop-board" viewBox="0 0 800 580" role="img" aria-label={`${rows}-row Plinko board`} data-testid="plinko-board-frame">
    <defs><radialGradient id="drop-ball-fill"><stop offset="0" stopColor="#fff3dc" /><stop offset=".5" stopColor="#ffcb91" /><stop offset="1" stopColor="#ff795b" /></radialGradient></defs>
    <path d="M384 9 L400 25 L416 9" fill="none" stroke="#ff9c7760" strokeWidth="3" strokeLinecap="round" />
    {pegs.map((p, i) => { const near = ball && Math.hypot(p.x - position.x, p.y - position.y) < 24; return <g key={i}><circle cx={p.x} cy={p.y + 2} r={rows === 16 ? 3.5 : 4.5} fill="#0006" /><circle cx={p.x} cy={p.y} r={near ? 5.5 : rows === 16 ? 3.5 : 4.5} fill={near ? "#ffb68e" : "#c9bbbd"} opacity={near ? 1 : .8} /></g>; })}
    {Array.from({ length: rows + 1 }, (_, i) => {
      const m = multipliers[i], edge = Math.abs(i - rows / 2) / (rows / 2);
      const fill = edge > .8 ? "#ef657a" : edge > .55 ? "#f48969" : edge > .3 ? "#f9af72" : "#e2c48d";
      const x = 400 + (i - rows / 2) * gap, landed = i === lastBucket && !ball;
      return <g key={i} data-testid={`plinko-bucket-${i}`} data-landed={landed ? "true" : "false"}><title>{m === undefined ? "Loading payout" : `${m}× total return`}</title><rect className={`drop-bucket${landed ? " is-landed" : ""}`} x={x - gap / 2 + 2} y={bucketY + (landed ? 3 : 0)} width={gap - 4} height="34" rx="5" fill={fill} stroke={landed ? "#fff6e7" : "none"} strokeWidth="2" /><rect x={x - gap / 2 + 2} y={bucketY + 34} width={gap - 4} height="5" rx="2" fill={fill} opacity=".4" /><text x={x} y={bucketY + 21 + (landed ? 3 : 0)} textAnchor="middle" fill="#3c2224" fontSize={rows === 16 ? 11 : 13}>{m === undefined ? "·" : `${Number(m.toFixed(2))}×`}</text></g>;
    })}
    {ball && <g className="drop-ball" data-testid="plinko-ball"><circle cx={position.x} cy={position.y - 7} r="9" fill="#ffa87a" opacity=".15" /><circle cx={position.x} cy={position.y} r="8" fill="url(#drop-ball-fill)" /><circle cx={position.x - 2} cy={position.y - 3} r="2" fill="#fff9ee" /></g>}
    <text x="400" y="575" textAnchor="middle" fontSize="9" letterSpacing="3" fill="#9c8589">LUNAR ORIGINALS</text>
  </svg>;
}
