import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CircleHelp, History, ShieldCheck, Volume2, VolumeX, Wallet, Plus, RefreshCw, Timer } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, customFetch, useGetWalletBalance, getGetWalletBalanceQueryKey, getGetWalletBalancesQueryKey, getListWalletTransactionsQueryKey, getListMyBetsQueryKey } from "@workspace/api-client-react";
import { CHICKEN_DIFFICULTIES, CHICKEN_MODES, CHICKEN_CLASSIC_RTP, CHICKEN_RTP, CHICKEN_VERSION, CHICKEN_ROUND_DURATION_MS, chickenReturn, type ChickenConfig, type ChickenDifficulty, type ChickenRound, type ChickenState } from "@workspace/api-zod/chicken-road-game";
import { CoinFace } from "@/components/table/chips";
import { CoinSettingsButton, CoinSettingsDialog, useCoinPreferences } from "@/components/table/CoinSettings";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import ChickenScene from "@/components/chicken-road/ChickenScene";
import { formatProfitFactor } from "@/components/chicken-road/format";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { playGameSound, unlockAudio } from "@/game/audio";
import "@/components/chicken-road/chicken-road.css";

const endpoint = "/api/chicken-road";
const money = (value: string | bigint) => `₹${formatRupees(value)}`;
type PendingBet = { requestId: string; difficulty: ChickenDifficulty; stakeAmount: string; clientSeed: string };
function parseStake(value: string): bigint {
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(value)) return 0n;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
function restorePending(key: string): PendingBet | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null");
    return value && typeof value.requestId === "string" && CHICKEN_DIFFICULTIES.includes(value.difficulty) && /^\d+$/.test(value.stakeAmount) && typeof value.clientSeed === "string" ? value : null;
  } catch { return null; }
}
const friendlyError = (error: unknown) => error instanceof ApiError ? (error.data as { detail?: string })?.detail ?? error.message : "Connection interrupted. Refresh to recover your round.";

export default function ChickenRoad() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sound = useStore(s => s.settings.sound);
  const [difficulty, setDifficulty] = useState<ChickenDifficulty>("easy");
  const [stakeInput, setStakeInput] = useState("100");
  const [busy, setBusy] = useState(false);
  const [hopping, setHopping] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [error, setError] = useState("");
  const [panel, setPanel] = useState<"rules" | "history" | "fairness" | null>(null);
  const [coinSettings, setCoinSettings] = useState(false);
  const [inspected, setInspected] = useState<ChickenRound | null>(null);
  const inFlight = useRef(false);
  const hopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observedRound = useRef<ChickenRound | null>(null);
  const expiryRefresh = useRef(0);
  const pendingKey = `chicken-road:pending:${user?.id}`;
  const [pending, setPending] = useState<PendingBet | null>(() => restorePending(pendingKey));
  const stateKey = ["chicken-road-state", user?.id];
  const config = useQuery({ queryKey: ["chicken-road-config"], queryFn: () => customFetch<ChickenConfig>(`${endpoint}/config`), refetchInterval: 15000, retry: false });
  const state = useQuery({ queryKey: stateKey, queryFn: ({ signal }) => customFetch<ChickenState>(`${endpoint}/state`, { signal }), enabled: !busy, refetchInterval: busy ? false : 4000, retry: false });
  const wallet = useGetWalletBalance({ game: "lunar" }, { query: { queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }), retry: false } });
  const round = state.data?.round ?? state.data?.history[0] ?? null;
  const active = round?.status === "active";
  const durationSeconds = Math.ceil((config.data?.roundDurationMs ?? CHICKEN_ROUND_DURATION_MS) / 1000);
  // Anchor the countdown to receipt time even if the device clock differs.
  const serverNow = (round?.serverTime ?? state.dataUpdatedAt) + Math.max(0, now - state.dataUpdatedAt);
  const remainingMs = active && round.expiresAt ? Math.max(0, Date.parse(round.expiresAt) - serverNow) : null;
  const secondsLeft = remainingMs === null ? null : Math.ceil(remainingMs / 1000);
  const expired = remainingMs === 0;
  const rulesVersion = active ? round.version : config.data?.version ?? CHICKEN_VERSION;
  const guaranteed = rulesVersion === 2;
  const selectedMode = active ? round.difficulty : pending?.difficulty ?? difficulty;
  const min = BigInt(config.data?.minStakePaise ?? "100");
  const max = BigInt(config.data?.maxStakePaise ?? "1000000");
  const balance = BigInt(wallet.data?.balance ?? "0");
  const stake = parseStake(stakeInput);
  const coins = useCoinPreferences("chicken-road", user?.id, Number(max / 100n));
  const ready = !!state.data && !!wallet.data && !!config.data && !state.isError && !wallet.isError && !config.isError;
  const valid = stake >= min && stake <= max && stake <= balance;
  const locked = busy || active || !!pending;
  const nextMultiplier = active ? round.nextMultiplier : chickenReturn(selectedMode, 1) / 100;
  const canStep = ready && active && !busy && !hopping && !expired;
  const refreshWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getGetWalletBalancesQueryKey() });
    void qc.invalidateQueries({ queryKey: getListWalletTransactionsQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
  };
  function remember(value: PendingBet | null) {
    setPending(value);
    try { if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value)); else sessionStorage.removeItem(pendingKey); } catch { /* Current tab retains the request. */ }
  }
  useEffect(() => {
    document.title = "Chicken Road · Lunar Casino";
    return () => { if (hopTimer.current) clearTimeout(hopTimer.current); };
  }, []);
  useEffect(() => {
    if (!pending || !state.data) return;
    const recovered = [state.data.round, ...state.data.history].find(r => r?.requestId === pending.requestId);
    if (recovered) { remember(null); refreshWallet(); }
  }, [state.data, pending]);
  useEffect(() => { if (active) setDifficulty(round.difficulty); }, [active, round?.difficulty]);
  useEffect(() => {
    if (!active || !round.expiresAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 200);
    const onVisible = () => { if (!document.hidden) { setNow(Date.now()); void state.refetch(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [active, round?.id, round?.expiresAt]);
  useEffect(() => {
    if (expired && !busy && !state.isFetching && now - expiryRefresh.current >= 1000) {
      expiryRefresh.current = now;
      void state.refetch();
    }
  }, [expired, busy, now, state.isFetching]);
  useEffect(() => {
    const previous = observedRound.current;
    if (previous?.status === "active" && (!active || previous.id !== round?.id)) refreshWallet();
    observedRound.current = round;
  }, [round?.id, round?.status, active]);

  const playSound = (cue: "select" | "bet" | "reveal" | "win" | "crash") => { if (sound) { void unlockAudio(); playGameSound(cue, "chicken-road"); } };
  function accept(result: ChickenRound) {
    qc.setQueryData<ChickenState>(stateKey, previous => ({ round: result.status === "active" ? result : null, history: [result, ...(previous?.history ?? []).filter(r => r.id !== result.id)].slice(0, 12) }));
    refreshWallet();
  }
  async function act(action: "place" | "step" | "cashout") {
    if (inFlight.current || hopping || !ready || (action !== "place" && (!active || expired))) return;
    if (action === "place" && (active || (!pending && (!valid || !config.data?.enabled)))) return;
    inFlight.current = true; setBusy(true); setError("");
    await qc.cancelQueries({ queryKey: stateKey });
    let submitted = pending;
    try {
      if (action === "place") {
        submitted ??= { requestId: crypto.randomUUID(), clientSeed: crypto.randomUUID().replaceAll("-", ""), difficulty, stakeAmount: stake.toString() };
        remember(submitted);
      }
      const result = await customFetch<ChickenRound>(action === "place" ? `${endpoint}/place` : `${endpoint}/${round!.id}/${action}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "place" ? submitted : { expectedStep: round!.step }),
      });
      accept(result);
      if (action === "place") { remember(null); playSound("bet"); }
      else {
        if (action === "step" && result.attemptedStep > round!.attemptedStep) {
          setHopping(true);
          hopTimer.current = setTimeout(() => setHopping(false), 480);
        }
        playSound(result.status === "busted" ? "crash" : result.status === "cashed_out" ? "win" : "reveal");
      }
    } catch (e) {
      setError(friendlyError(e));
      // Keep the same key after ambiguous failures. Definitive validation failures
      // may be corrected; a 5xx/network failure must never create a second stake.
      if (action === "place" && e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) remember(null);
      void qc.invalidateQueries({ queryKey: stateKey });
      refreshWallet();
    } finally { inFlight.current = false; setBusy(false); }
  }
  function chooseCoin(value: number) { if (locked) return; coins.selectChip(value); setStakeInput(String(value)); playSound("select"); }
  const displayRound = active ? round : round && round.difficulty === selectedMode ? round : null;
  const history = state.data?.history.filter(r => r.status !== "active") ?? [];
  const fairness = inspected ?? round;
  const fairnessGuaranteed = (fairness?.version ?? rulesVersion) === 2;

  return <div className="cr-page" data-testid="chicken-road-page">
    <header className="cr-header">
      <Link href="/" className="cr-icon-button" aria-label="Back to lobby"><ArrowLeft size={19} /></Link>
      <Link href="/chicken-road" className="cr-brand" aria-label="Chicken Road"><span>CHICKEN</span><strong>ROAD<span>↗</span></strong></Link>
      <span className="cr-original">LUNAR ORIGINALS</span>
      <Link href="/wallet" className="cr-wallet" aria-label="Open shared wallet"><Wallet size={17} /><span><small>WALLET</small><strong data-testid="chicken-wallet">{wallet.data ? money(balance) : "—"}</strong></span><Plus size={15} /></Link>
      <button className="cr-icon-button" aria-label={sound ? "Mute sound" : "Enable sound"} aria-pressed={sound} onClick={() => { updateSettings({ sound: !sound }); if (!sound) { void unlockAudio(); playGameSound("bet", "chicken-road", .75); } }}>{sound ? <Volume2 size={18} /> : <VolumeX size={18} />}</button>
      <button className="cr-icon-button" aria-label="Game rules" onClick={() => setPanel("rules")}><CircleHelp size={18} /></button>
    </header>
    <main className="cr-main">
      <section className="cr-road-panel">
        <div className="cr-round-strip"><span><History size={13} /> MY RUNS</span><div>{history.length ? history.slice(0, 7).map(r => <button key={r.id} className={r.status === "busted" ? "is-loss" : "is-win"} onClick={() => { setInspected(r); setPanel("fairness"); }} aria-label={`Round ${r.status === "busted" ? "lost" : `${formatProfitFactor(r.multiplier)}x profit cashed out`}`}>{r.status === "busted" ? "Lost" : `${formatProfitFactor(r.multiplier)}x profit`}</button>) : <small>Your completed runs will appear here</small>}</div><button aria-label="Round history" onClick={() => setPanel("history")}><History size={16} /></button></div>
        <ChickenScene round={displayRound} difficulty={selectedMode} hopping={hopping} onStep={() => void act("step")} canStep={!!canStep}
          idle={ready && !busy && !hopping && !expired && !pending && !panel && !coinSettings && (!displayRound || !!active)} sound={sound} />
      </section>
      <section className="cr-controls" aria-label="Bet controls">
        <div className="cr-control-heading"><span>MAKE YOUR MOVE</span><div className={`cr-timer${active && secondsLeft !== null && secondsLeft <= 10 ? " is-urgent" : ""}`} data-testid="chicken-timer" role="timer" aria-label={active ? "Round time remaining" : "Round time limit"}><Timer size={14} /><strong>{active ? secondsLeft === null ? "Syncing…" : `${String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:${String(secondsLeft % 60).padStart(2, "0")}` : `${durationSeconds}s`}</strong><small>{active ? expired ? "SETTLING" : "LEFT" : "ROUND"}</small></div><button onClick={() => { setInspected(null); setPanel("fairness"); }}><ShieldCheck size={14} /> Fairness</button></div>
        <div className="cr-stake-section"><label htmlFor="chicken-stake">Bet amount <span>INR</span></label>
          <div className="cr-stake-input"><button disabled={locked} onClick={() => { setStakeInput((Number(min) / 100).toFixed(2)); playSound("select"); }}>MIN</button><span>₹</span><input id="chicken-stake" aria-label="Bet amount" inputMode="decimal" autoComplete="off" value={active ? (Number(round.stakeAmount) / 100).toFixed(2) : pending ? (Number(pending.stakeAmount) / 100).toFixed(2) : stakeInput} disabled={locked} onChange={e => setStakeInput(e.target.value)} /><button disabled={locked || balance < min} onClick={() => { setStakeInput((Number(balance < max ? balance : max) / 100).toFixed(2)); playSound("select"); }}>MAX</button></div>
          <div className="cr-coins"><div role="group" aria-label="Choose stake coin">{coins.values.filter(v => BigInt(v) * 100n >= min).map(value => <button key={value} disabled={locked} aria-label={`₹${value} coin`} aria-pressed={stake === BigInt(value) * 100n} onClick={() => chooseCoin(value)}><CoinFace value={value} sizeClass="w-10 h-10" /></button>)}</div><CoinSettingsButton onClick={() => setCoinSettings(true)} /></div>
        </div>
        <div className="cr-mode-section"><label htmlFor="chicken-difficulty">Difficulty <span>{CHICKEN_MODES[selectedMode].returns.length} lanes</span></label><select id="chicken-difficulty" aria-label="Difficulty" value={selectedMode} disabled={locked} onChange={e => { setDifficulty(e.target.value as ChickenDifficulty); playSound("select"); }}>{CHICKEN_DIFFICULTIES.map(mode => <option key={mode} value={mode}>{CHICKEN_MODES[mode].label}</option>)}</select><div className={`cr-risk cr-risk-${guaranteed ? "safe" : selectedMode}`}><i /><i /><i /><i /><span>{guaranteed ? "Every lane is safe" : selectedMode === "easy" ? "Gentle steps" : selectedMode === "medium" ? "Bigger leaps" : selectedMode === "hard" ? "High risk" : "Maximum risk"}</span></div></div>
        <div className="cr-actions">{active ? <><button className="cr-cashout" data-testid="chicken-cashout" disabled={!canStep || round.step < 1} onClick={() => void act("cashout")}><span>CASH OUT</span><strong>{money(round.cashoutAmount)}</strong><small>Stake + profit</small></button><button className="cr-play" data-testid="chicken-step" disabled={!canStep} onClick={() => void act("step")}><span>{expired ? "Time up" : busy ? "Crossing…" : "Go"} <ArrowRight size={22} /></span><small>Profit {formatProfitFactor(nextMultiplier!)}x</small></button></> : <button className="cr-play cr-play-start" data-testid="chicken-play" disabled={busy || hopping || !ready || (!pending && (!config.data?.enabled || !valid))} onClick={() => void act("place")}><span>{busy ? "Starting…" : pending ? "Recover bet" : "Play"}<ArrowRight size={24} /></span><small>{pending ? "Retry the same bet" : "Take the first step"}</small></button>}</div>
        <div className="cr-feedback" role="status">{error ? <span className="cr-error">{error}</span> : !ready ? <span>{state.isError || wallet.isError || config.isError ? "Could not connect. Refresh to resume." : "Connecting to your wallet…"}</span> : expired ? <span>Time up. Settling your round…</span> : active ? <span>{round.step === 0 ? "Cross a lane, or receive your stake back when time runs out." : `Next lane: ${(round.nextSurvival! * 100).toFixed(1)}% safe. Auto cashout when time runs out.`}</span> : !config.data?.enabled ? <span>Game temporarily unavailable.</span> : stake > balance ? <span>Insufficient balance. <Link href="/wallet">Open wallet</Link></span> : !valid ? <span>Choose a stake from {money(min)} to {money(max)}.</span> : <span>{durationSeconds}s per round. Time up: auto cashout, or stake returned if no lane crossed.</span>}{(error || state.isError || wallet.isError || config.isError) && <button disabled={busy} aria-label="Refresh game" onClick={() => { setError(""); void state.refetch(); void config.refetch(); void wallet.refetch(); }}><RefreshCw size={15} /></button>}</div>
      </section>
      <footer className="cr-footer"><span><ShieldCheck size={13} /> {wallet.data && !wallet.isError ? "Shared wallet connected" : "Connecting to wallet"}</span><span>{guaranteed ? "100% win chance" : `${(rulesVersion === 3 ? CHICKEN_RTP : CHICKEN_CLASSIC_RTP) * 100}% theoretical RTP`} <i /> v{rulesVersion}</span></footer>
    </main>
    <CoinSettingsDialog open={coinSettings} onOpenChange={setCoinSettings} preferences={coins} onSave={coins.save} maxValue={Number(max / 100n)} />
    <Dialog open={panel !== null} onOpenChange={open => { if (!open) setPanel(null); }}><DialogContent className="cr-dialog">
      <DialogTitle>{panel === "rules" ? "How to play Chicken Road" : panel === "history" ? "Your recent runs" : "Round fairness"}</DialogTitle>
      <DialogDescription>{panel === "rules" ? "One chicken. One shared wallet. Your next move." : panel === "history" ? "Amounts below include the original stake." : "The round seed stays hidden until your run is over."}</DialogDescription>
      {panel === "rules" && <div className="cr-rules">
        <ol><li>Choose a coin or enter your bet, then select a difficulty.</li><li>Press Play to reserve your stake from the lobby wallet and start the {durationSeconds}-second round timer.</li><li>Press Go to cross one lane. Each safe step raises the profit shown on the road.</li><li>{guaranteed ? "Every lane is safe. Cash Out after any step to collect your stake plus profit." : "Cash Out after a safe step to collect. A collision loses the entire stake."}</li><li>Reaching the final lane collects automatically. When time runs out, an active round cashes out at its current lane. If no lane was crossed, your original stake is returned.</li><li>The timer keeps running when you refresh, leave the game or close the tab. Moves do not reset it. A new bet starts only when you press Play.</li></ol>
        <p>{guaranteed ? "Guaranteed-win mode: 100% crossing chance on every lane, in every difficulty. Traffic is decorative and cannot hit the chicken. Modes change the number of lanes and profit multipliers." : "Classic mode: traffic is visual. Tap timing does not change the server's random result. Higher difficulty has larger profit multipliers and greater risk."}</p>
        <p>Lane values show profit above your original stake: +0.01x means 1% profit. For example, a 100 rupee bet at +0.01x pays 101 rupees in total (100 stake + 1 profit). Cashout amounts include the stake and are rounded down to the nearest paise.</p>
        <p>{guaranteed ? "100% win chance is not 100% RTP. The total return depends on the lane where you cash out and can exceed your stake. There is no fixed RTP percentage in this mode." : "New rounds target 85% theoretical RTP before rounding, equivalent to a 15% house edge. Historical version 1 retains 98% RTP. This is an average over many rounds, not a guaranteed return in any round or session."}</p>
        <p>This is the lobby's own version with original artwork and published paytables.</p><div className="cr-paytable">{CHICKEN_DIFFICULTIES.map(d => <div key={d}><strong>{CHICKEN_MODES[d].label}</strong><span>{CHICKEN_MODES[d].returns.length} lanes</span><span>profit up to {formatProfitFactor(CHICKEN_MODES[d].returns.at(-1)! / 100)}x</span></div>)}</div>
      </div>}
      {panel === "history" && <div className="cr-history">{history.length ? history.map(r => <button key={r.id} onClick={() => { setInspected(r); setPanel("fairness"); }}><span><strong>{CHICKEN_MODES[r.difficulty].label}</strong><small>Lane {r.attemptedStep} · {money(r.stakeAmount)} bet</small></span><span className={r.status === "busted" ? "cr-error" : "cr-win-text"}>{r.status === "busted" ? "Lost" : money(r.payoutAmount)}<small>{r.status === "busted" ? "Lost" : `${formatProfitFactor(r.multiplier)}x profit`}</small></span></button>) : <p>Your completed runs will be saved here.</p>}</div>}
      {panel === "fairness" && <div className="cr-fairness">
        <p>{fairnessGuaranteed ? "Guaranteed-win rules: every valid lane is safe. Seeds are kept as round records; they do not introduce a collision chance." : "Classic round: each round commits a SHA-256 seed hash before the first move. At settlement the server seed is revealed for replay."}</p>
        {fairness ? <><label>Round ID<code>{fairness.id}</code></label><label>Seed commitment<code>{fairness.serverSeedHash}</code></label><label>Client seed<code>{fairness.clientSeed}</code></label><label>Server seed<code>{fairness.serverSeed ?? (fairnessGuaranteed ? "Hidden until cash out" : "Hidden until cash out or collision")}</code></label><p>{CHICKEN_MODES[fairness.difficulty].label} · {fairness.step} safe lanes · Version {fairness.version}</p></> : <p>Start a round to see its record.</p>}
        <details><summary>{fairnessGuaranteed ? "Guaranteed-win rule" : "Verification formula"}</summary>{fairnessGuaranteed ? <p>Version 2 uses a 100% survival probability for every lane. Payout is your stake multiplied by 1 + the displayed profit factor, rounded down to paise. The final lane pays automatically. Seeds, timing and traffic do not change the outcome.</p> : <><p>For step n, calculate HMAC-SHA256 with server seed as the key and <code>chicken-road:v{fairness?.version ?? rulesVersion}:CLIENT_SEED:DIFFICULTY:n</code> as the message. Divide the first 13 hex digits by 2^52. The step is safe if this number is below its survival probability.</p><p>For this formula, the total-return multiplier is 1 + the displayed profit factor. Step 1: 0.85 ÷ next multiplier in version 3 (0.98 in version 1). Later steps: current multiplier ÷ next multiplier. Bet timing and traffic positions are not inputs.</p></>}</details>
      </div>}
    </DialogContent></Dialog>
  </div>;
}
