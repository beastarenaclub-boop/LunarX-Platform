import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Coins, History, RefreshCw, ShieldCheck, Sparkles, Volume2, VolumeX, Wallet, X } from "lucide-react";
import { customFetch, getGetWalletBalanceQueryKey, useGetWalletBalance } from "@workspace/api-client-react";
import { collectionGame, collectionMultiplier, collectionSteps, progressive, type CollectionCode, type CollectionConfig, type CollectionOptions, type CollectionRound, type CollectionState } from "@workspace/api-zod/instant-collection";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { store, useStore } from "@/game/store";
import { playGameSound, unlockAudio } from "@/game/audio";
import { notifyPlayStarted, updateSettings } from "@/game/engine";
import { hasPublicDemoSound } from "@/game/publicDemoSounds";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, request } from "@/components/instant/InstantGame";
import { Bird, Fish, Treasure } from "@/components/instant/CollectionArt";
import "@/components/instant/collection.css";
import PirateRoad from "@/components/instant/PirateRoad";
import CoinFlip from "@/components/instant/CoinFlip";

type PendingBet = { requestId: string; stakeAmount: string; clientSeed: string; options: CollectionOptions };
const amount = (paise: string) => `₹${formatRupees(paise)}`;
export default function InstantCollection({ gameCode }: { gameCode: CollectionCode }) {
  const game = collectionGame(gameCode)!, { user } = useAuth(), qc = useQueryClient();
  const endpoint = `/api/instant/${gameCode}`, key = ["instant-collection", gameCode, user?.id];
  const pendingKey = `instant:pending:${user?.id}:${gameCode}`;
  const config = useQuery({ queryKey: ["instant-config", gameCode], queryFn: () => customFetch<CollectionConfig>(`${endpoint}/config`), retry: false, refetchInterval: 30000 });
  const state = useQuery({ queryKey: key, queryFn: () => customFetch<CollectionState>(`${endpoint}/state`), retry: false, refetchOnWindowFocus: true });
  const balance = useGetWalletBalance({ game: "lunar" }, { query: { queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }), enabled: !!user, retry: false } });
  const [round, setRound] = useState<CollectionRound | null>(null), [stake, setStake] = useState("100");
  const [options, setOptions] = useState<CollectionOptions>({ difficulty: "easy", mines: 3, choice: game.kind === "dice" ? "up" : game.kind === "fishing" ? "cast" : "heads" });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [panel, setPanel] = useState<"rules" | "history" | "fairness" | null>(null);
  const sound = useStore(s => s.settings.sound);
  const music = useStore(s => s.settings.music);
  const pirateAudio = gameCode === "chicken-road-pirate";
  // Pirate Edition has an idle soundtrack; arm it on entry, before any bet.
  // The shared bus still respects saved mute/music settings and browser unlock.
  useEffect(() => { if (pirateAudio) notifyPlayStarted(); }, [pirateAudio]);
  const [pending, setPending] = useState<PendingBet | null>(() => { try { const p = JSON.parse(localStorage.getItem(pendingKey) ?? "null"); return p?.requestId && p?.options ? p : null; } catch { return null; } });
  // A recovered coin bet must show the original side and amount, including after reload.
  useEffect(() => { if (gameCode === "coin-flip" && pending) { setStake((Number(pending.stakeAmount) / 100).toFixed(2)); setOptions(pending.options); } }, [gameCode, pending]);
  const lock = useRef(false), mounted = useRef(true);
  const [motion, setMotion] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { mounted.current = true; document.title = `${game.name} · Instant Games`; return () => { mounted.current = false; }; }, [game.name]);
  useEffect(() => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"); const change = () => setMotion(!media.matches); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  useEffect(() => { if (state.data && !lock.current) setRound(state.data.round ?? state.data.history[0] ?? null); }, [state.data]);
  const active = round?.status === "active", step = round?.step ?? 0;
  const opts = active ? round.options : options;
  const isProgressive = progressive(game.kind), locked = busy || !!active || !!pending;
  const rtp = active ? round.rtp : config.data?.rtp ?? .97, cap = active ? round.maxMultiplier : config.data?.maxMultiplier ?? 1000;
  const total = collectionSteps(game.kind, opts);
  const next = collectionMultiplier(game.kind, step + 1, opts, rtp, cap);
  const validStake = /^\d+(\.\d{1,2})?$/.test(stake) && Number.isSafeInteger(Math.round(Number(stake) * 100)) && Number(stake) > 0;
  const paise = Math.round(Number(stake) * 100);
  const enough = balance.data !== undefined && paise <= Number(balance.data.balance);
  const within = config.data && paise >= Number(config.data.minStakePaise) && paise <= Number(config.data.maxStakePaise);
  const ready = !!config.data?.enabled && !!state.data && !state.isError && !!balance.data;
  const refresh = async () => { await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() }), qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] }), qc.invalidateQueries({ queryKey: ["/api/bets"] })]); };
  const remember = (p: PendingBet | null) => { setPending(p); try { p ? localStorage.setItem(pendingKey, JSON.stringify(p)) : localStorage.removeItem(pendingKey); } catch { /* optional recovery storage */ } };
  const cue = (kind: "select" | "bet" | "win" | "crash" | "reveal" | "clear") => {
    if (!pirateAudio && (kind === "select" || kind === "clear") && !hasPublicDemoSound(gameCode, kind)) return;
    if (store.getState().settings.sound) { void unlockAudio(); playGameSound(kind, gameCode); }
  };
  const toggleSound = () => {
    const enabled = !store.getState().settings.sound;
    const unlocked = unlockAudio();
    updateSettings({ sound: enabled });
    if (enabled) void unlocked.then(() => { if (mounted.current) cue("select"); });
  };
  async function act(action: "place" | "reveal" | "cashout", cell = 0) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    cue(pirateAudio || hasPublicDemoSound(gameCode) ? "select" : action === "place" ? "bet" : "reveal");
    try {
      let result: CollectionRound;
      if (action === "place") {
        if (!pending && (!ready || !validStake || !enough || !within)) throw new Error("Enter a bet within your balance and game limits.");
        const input = pending ?? { requestId: crypto.randomUUID(), stakeAmount: String(paise), clientSeed: crypto.randomUUID().replaceAll("-", ""), options };
        remember(input);
        result = gameCode === "coin-flip"
          ? await customFetch<CollectionRound>(`${endpoint}/place`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000) })
          : await request<CollectionRound>(`${endpoint}/place`, input);
        remember(null);
      } else {
        if (!round || !active) return;
        result = await request<CollectionRound>(`${endpoint}/${round.id}/move`, { action, cell, expectedStep: step, actionId: crypto.randomUUID() });
      }
      if (!isProgressive && motion) await new Promise(resolve => setTimeout(resolve, 850));
      if (pending?.requestId === result.requestId) remember(null);
      if (mounted.current) {
        setRound(result);
        if (pirateAudio) notifyPlayStarted();
        if (gameCode !== "coin-flip") cue(result.status === "lost" ? "crash" : result.status === "active" ? action === "place" ? "bet" : "reveal" : BigInt(result.payoutAmount) > BigInt(result.stakeAmount) ? "win" : "clear");
      }
      // A confirmed coin receipt can land even if a background wallet/history refresh is slow.
      if (gameCode === "coin-flip") void refresh(); else await refresh();
    } catch (e) {
      // Only definitive 4xx rejections allow a new request ID. A lost response must retry the original ID.
      const status = (e as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 408 && status !== 429) remember(null);
      if (mounted.current) setError(gameCode === "coin-flip" && (e as Error).name === "TimeoutError" ? "Confirmation timed out. Retry your pending bet to recover the result." : errorMessage(e));
      if (gameCode === "coin-flip") { void state.refetch(); void balance.refetch(); }
      else {
        const recovered = await state.refetch();
        if (mounted.current && recovered.data) setRound(recovered.data.round ?? recovered.data.history[0] ?? null);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  const selection = (value: string) => { cue("select"); setOptions(o => ({ ...o, choice: value })); };
  const result = !active ? round : null;
  const media = game.theme === "pirate" || game.theme === "ocean";
  const win = result && result.status !== "lost";
  const choices = game.kind === "dice" ? [["down", "7 DOWN"], ["seven", "EXACT 7"], ["up", "7 UP"]] : game.kind === "duel" ? [["heads", "GOLD DUCK"], ["tails", "BLUE DUCK"]] : [["heads", "HEADS"], ["tails", "TAILS"]];
  const choicePayout = (value: string) => Math.floor((rtp * (game.kind === "dice" ? value === "seven" ? 6 : 36 / 15 : 2) + 1e-10) * 100) / 100;
  const dialog = <Dialog open={panel !== null} onOpenChange={open => !open && setPanel(null)}><DialogContent className={`ic-dialog ${gameCode === "chicken-road-pirate" ? "pr-dialog" : ""}`}><DialogHeader><DialogTitle>{panel === "rules" ? `How to play ${game.name}` : panel === "history" ? "Your round history" : "Round details"}</DialogTitle><DialogDescription>{panel === "rules" ? "Understand the choices and total returns before you play." : "Your server-recorded rounds and results."}</DialogDescription></DialogHeader>{panel === "rules" ? <div className="ic-rules"><p>Set a bet amount within the displayed limits. {isProgressive ? "Start a round, make your choices, then cash out. A failed move loses the stake. Completing the final step automatically pays your return. Returning before your first move refunds your stake." : "Pick an outcome and press play. The result settles automatically into your shared wallet."}</p><p>All multipliers are total returns including your stake. Returns round down to the nearest paise. Target RTP: {((config.data?.rtp ?? .97) * 100).toFixed(0)}% before rounding and caps; each round is independent.</p>{game.kind === "dice" && <p>Each die has six equally likely faces. Below/above 7 each has 15 of 36 outcomes; exactly 7 has 6 of 36.</p>}{game.kind === "fishing" && <p>Empty hook: 50%. Reef fish: 30%. Blue marlin: 15%. Royal catch: 4%. Golden jackpot: 1%. The jackpot is a fixed return, not a shared prize pool.</p>}{game.kind === "mines" && <p>Cannons are fixed when the round starts. Tiles are never moved after your selection. The final safe tile automatically pays. Maximum return is {cap}×.</p>}{game.kind === "tower" && <p>Each floor has one hidden losing door and two safe doors. Complete all 10 floors to collect automatically.</p>}<p>A page refresh restores your active round. A network interruption never starts another bet automatically.</p></div> : panel === "history" ? <div className="ic-history">{state.data?.history.length ? state.data.history.map(r => <div key={r.id}><span>{new Date(r.createdAt).toLocaleString()}<small>{r.status.replace("_", " ")} · {r.id}</small></span><strong>{amount(r.stakeAmount)} → {amount(r.payoutAmount)}</strong></div>) : <p>No rounds yet.</p>}</div> : <div className="ic-fairness">{round ? <><p>Outcomes use a server seed and your client seed with HMAC-SHA256. Progressive rounds commit the seed before your first move; single-play games reveal their audit data with the result.</p>{[["Round", round.id], ["Server seed SHA-256", round.serverSeedHash], ["Client seed", round.clientSeed], ["Server seed", round.serverSeed ?? "Revealed after the round ends"]].map(([label, value]) => <div key={label}><small>{label}</small><code>{value}</code></div>)}</> : <p>Play a round to view its seed and result details.</p>}</div>}</DialogContent></Dialog>;
  if (gameCode === "chicken-road-pirate") return <PirateRoad
    round={round} stake={stake} setStake={setStake} options={opts}
    setDifficulty={difficulty => { cue("select"); setOptions(o => ({ ...o, difficulty })); }}
    config={config.data} balance={balance.data?.balance} busy={busy} locked={locked}
    pending={!!pending} canPlay={!busy && (!!pending || !!(ready && validStake && enough && within))}
    playHint={pending ? "Your original bet will be recovered" : !config.data?.enabled && config.data ? "Game temporarily unavailable" : !ready ? "Connecting to your game…" : !validStake || !within ? `Limits ${amount(config.data!.minStakePaise)} – ${amount(config.data!.maxStakePaise)}` : !enough ? "Insufficient wallet balance" : ""}
    error={error || (config.isError || state.isError || balance.isError ? "Could not connect to the game. Please retry." : "")}
    refresh={() => { cue("select"); void config.refetch(); void balance.refetch(); void state.refetch(); setError(""); }}
    act={(action, cell) => void act(action, cell)} sound={sound} motion={motion}
    toggleSound={toggleSound}
    music={music} toggleMusic={() => { cue("select"); updateSettings({ music: !store.getState().settings.music }); }}
    selectSound={() => cue("select")}
    openPanel={panel => { cue("select"); setPanel(panel); }}
  >{dialog}</PirateRoad>;
  if (gameCode === "coin-flip") return <CoinFlip
    round={round} history={state.data?.history ?? []} stake={stake} setStake={setStake}
    choice={pending?.options.choice ?? opts.choice} select={selection}
    config={config.data} balance={balance.data?.balance} busy={busy} locked={locked}
    pending={!!pending} canPlay={!busy && (!!pending || !!(ready && validStake && enough && within))}
    playHint={pending ? "Your original bet will be recovered" : !config.data?.enabled && config.data ? "Game temporarily unavailable" : !ready ? "Connecting to your game…" : !validStake || !within ? `Limits ${amount(config.data!.minStakePaise)} – ${amount(config.data!.maxStakePaise)}` : !enough ? "Insufficient wallet balance" : ""}
    error={error || (config.isError || state.isError || balance.isError ? "Could not connect to the game. Please retry." : "")}
    refresh={() => { void config.refetch(); void balance.refetch(); void state.refetch(); setError(""); }}
    play={() => void act("place")} sound={sound} motion={motion} toggleSound={toggleSound}
    openPanel={setPanel}
    onResult={settled => cue(settled.status === "lost" ? "crash" : BigInt(settled.payoutAmount) > BigInt(settled.stakeAmount) ? "win" : "clear")}
  >{dialog}</CoinFlip>;
  return <div className={`ic-page ic-theme-${game.theme}`} style={{ "--ic-accent": game.accent } as CSSProperties} data-testid="collection-page">
    <header className="ic-header"><div className="ic-brand"><Link href="/" aria-label="Back to lobby" className="ic-icon"><ArrowLeft size={19} /></Link><span className="ic-logomark"><Sparkles size={22} /></span><div><small>LUNAR ORIGINALS <span>INSTANT</span></small><h1>{game.name}</h1></div></div><div className="ic-header-right"><div className="ic-wallet"><Wallet size={18} /><div><small>WALLET BALANCE</small><strong data-testid="collection-balance">{balance.data ? amount(balance.data.balance) : "Loading…"}</strong></div></div><button className="ic-icon" onClick={() => setPanel("rules")} aria-label="Game rules"><CircleHelp size={20} /></button><button className="ic-icon" aria-label={sound ? "Mute sound" : "Enable sound"} onClick={toggleSound}>{sound ? <Volume2 size={19} /> : <VolumeX size={19} />}</button></div></header>
    <main className="ic-layout"><section className="ic-arena">
      <div className="ic-arena-heading"><span><i /> {active ? "ROUND IN PLAY" : "READY WHEN YOU ARE"}</span><button onClick={() => setPanel("history")}><History size={14} /> Recent rounds</button></div>
      <div className={`ic-stage ic-stage-${game.kind} ${busy ? "ic-is-busy" : ""}`}>
        {media && motion && <video className="ic-video" autoPlay muted loop playsInline preload="metadata" poster={`${import.meta.env.BASE_URL}media/instant/pirate-poster.jpg`} src={`${import.meta.env.BASE_URL}media/instant/pirate-bay.mp4`} aria-hidden="true" />}
        <div className="ic-atmosphere" /><div className="ic-stage-title"><span>{game.kind === "mines" ? "THE TREASURE HUNT" : game.kind === "tower" ? "REACH NEW HEIGHTS" : game.kind === "road" ? "THE NEXT STEP IS YOURS" : "MAKE YOUR MOMENT"}</span><h2>{game.tagline}</h2></div>
        {game.kind === "road" && <><div className="ic-road-scenery"><span /><span /><span /></div><div className="ic-road-scroll"><div className="ic-road-track"><div className="ic-road-start"><Bird pirate={game.theme === "pirate"} /><small>START</small></div>{Array.from({ length: 12 }, (_, i) => <button key={i} className={`ic-lane ${i < step ? "is-safe" : ""} ${active && i === step ? "is-next" : ""}`} disabled={!active || busy || i !== step} onClick={() => void act("reveal", i)} aria-label={`Cross lane ${i + 1}`}><span>{String(i + 1).padStart(2, "0")}</span><strong>{collectionMultiplier("road", i + 1, opts, rtp, cap).toFixed(2)}×</strong>{i === step - 1 ? <Bird pirate={game.theme === "pirate"} /> : i < step ? <Check /> : <span className="ic-lane-marker" />}<small>{i < step ? "CROSSED" : "LANE"}</small></button>)}</div></div></>}
        {game.kind === "mines" && <div className="ic-treasure-grid">{Array.from({ length: 25 }, (_, i) => { const revealed = round?.revealed.includes(i), hazard = round?.hazards?.includes(i); return <button key={i} className={`ic-tile ${revealed && !hazard ? "is-safe" : ""} ${hazard ? "is-mine" : ""}`} disabled={!active || busy || !!revealed} onClick={() => void act("reveal", i)} aria-label={`Tile ${i + 1}${revealed ? hazard ? ", cannon" : ", treasure" : ""}`}>{hazard || revealed ? <Treasure mine={!!hazard} /> : <span>✦</span>}</button>; })}</div>}
        {game.kind === "tower" && <div className="ic-tower">{Array.from({ length: 10 }, (_, j) => { const i = 9 - j; return <div className={`ic-floor ${i < step ? "is-complete" : ""} ${active && i === step ? "is-current" : ""}`} key={i}><small>{String(i + 1).padStart(2, "0")}</small>{[0, 1, 2].map(cell => <button key={cell} disabled={!active || busy || i !== step} onClick={() => void act("reveal", cell)} aria-label={`Floor ${i + 1} door ${cell + 1}`}>{i < step && round?.revealed[i] === cell ? <Check size={17} /> : result?.status === "lost" && i === step && result.revealed[i] === cell ? <X size={17} /> : <span />}</button>)}<strong>{collectionMultiplier("tower", i + 1, opts, rtp, cap).toFixed(2)}×</strong></div>; })}</div>}
        {game.kind === "coin" && <div className={`ic-coin-scene ${busy ? "is-spinning" : ""}`}><div className="ic-coin"><div className="ic-coin-ring"><span>★</span><strong>{result ? result.outcome[0] === 0 ? "H" : "T" : options.choice === "heads" ? "H" : "T"}</strong><small>LUNAR • ORIGINALS</small></div></div><div className="ic-coin-shadow" /></div>}
        {game.kind === "dice" && <div className="ic-dice-scene">{[0, 1].map(i => <div key={i} className="ic-die" aria-label={`Die ${i + 1}: ${result?.outcome[i] ?? "ready"}`}>{Array.from({ length: 9 }, (_, j) => { const n = result?.outcome[i] ?? i + 3; const dots: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }; return <i key={j} className={dots[n]?.includes(j) ? "show" : ""} />; })}</div>)}<span className="ic-dice-total">{result ? `TOTAL ${result.outcome[0] + result.outcome[1]}` : "ROLL YOUR LUCK"}</span></div>}
        {game.kind === "duel" && <div className="ic-duel-scene"><div className={`${result && result.outcome[0] === 0 ? "is-winner" : ""}`}><Bird duck /><strong>GOLD</strong></div><span>VS</span><div className={`ic-blue-duck ${result && result.outcome[0] === 1 ? "is-winner" : ""}`}><Bird duck /><strong>BLUE</strong></div></div>}
        {game.kind === "fishing" && <div className="ic-fishing-scene"><div className="ic-fishing-line" /><div className="ic-fish"><Fish index={result?.outcome[0] ?? 4} /></div><span>{result ? ["EMPTY HOOK", "REEF FISH", "BLUE MARLIN", "ROYAL CATCH", "GOLDEN JACKPOT"][result.outcome[0]] : "THE GOLDEN CATCH AWAITS"}</span></div>}
        <div className={`ic-stage-status ${win ? "is-win" : result ? "is-loss" : ""}`} role="status" aria-live="polite" data-testid="collection-result">{busy ? <><RefreshCw size={16} className="ic-spin" /> {isProgressive ? "Making your move…" : "Revealing your result…"}</> : result ? <><strong>{win ? `${result.multiplier.toFixed(2)}× · ${amount(result.payoutAmount)}` : "Round over"}</strong><span>{win ? "Returned to your wallet" : "No return this round. Play again when you’re ready."}</span></> : active ? <><strong>{round.multiplier.toFixed(2)}×</strong><span>{game.kind === "tower" ? "Choose a door or collect your return" : game.kind === "mines" ? "Open a tile or collect your treasure" : "Cross the next lane or cash out"}</span></> : <><strong>{isProgressive ? "Your adventure starts here" : "Choose your bet below"}</strong><span>{isProgressive ? "Set your bet, then take your first step" : "Every round is a fresh start"}</span></>}</div>
      </div>
      <div className="ic-control-bar"><div className="ic-stake"><label htmlFor="ic-stake">BET AMOUNT <span>INR</span></label><div><span>₹</span><input id="ic-stake" aria-label="Bet amount" value={stake} inputMode="decimal" onChange={e => setStake(e.target.value)} disabled={locked} /><button disabled={locked} onClick={() => setStake(String(Math.max(Number(config.data?.minStakePaise ?? 100) / 100, Number(stake) / 2)))} aria-label="Halve bet">½</button><button disabled={locked} onClick={() => setStake(String(Math.min(Number(config.data?.maxStakePaise ?? 1000000) / 100, Number(stake) * 2)))} aria-label="Double bet">2×</button></div><div className="ic-quick-stakes">{[50, 100, 500, 1000].map(n => <button key={n} disabled={locked} onClick={() => setStake(String(n))}>₹{n}</button>)}</div></div>
        <div className="ic-options">{game.kind === "road" ? <><label htmlFor="ic-difficulty">DIFFICULTY</label><select id="ic-difficulty" disabled={locked} value={opts.difficulty} onChange={e => setOptions(o => ({ ...o, difficulty: e.target.value as CollectionOptions["difficulty"] }))}><option value="easy">Easy · 85% per lane</option><option value="medium">Medium · 70% per lane</option><option value="hard">Hard · 55% per lane</option></select><small>12 lanes · cash out at any step</small></> : game.kind === "mines" ? <><label htmlFor="ic-mines">HIDDEN CANNONS</label><select id="ic-mines" value={opts.mines} disabled={locked} onChange={e => setOptions(o => ({ ...o, mines: Number(e.target.value) }))}>{[1, 3, 5, 7, 10].map(n => <option key={n} value={n}>{n} cannons · {25 - n} treasures</option>)}</select><small>More cannons, higher returns</small></> : game.kind === "tower" ? <><label>NEXT FLOOR</label><strong className="ic-next-price">{next.toFixed(2)}×</strong><small>2 safe doors out of 3 on every floor</small></> : game.kind === "fishing" ? <><label>CATCH PAYTABLE</label><div className="ic-fish-prizes">{[1.5, 2, 4, 6].map(n => <span key={n}>{(Math.floor((n * rtp / .97 + 1e-10) * 100) / 100).toFixed(2)}×</span>)}</div><small>Golden jackpot: 1 in 100 casts</small></> : <><label>YOUR PICK</label><div className="ic-choice-group">{choices.map(([value, label]) => <button key={value} className={options.choice === value ? "is-selected" : ""} disabled={locked} onClick={() => selection(value)} aria-pressed={options.choice === value}>{label}<small>{choicePayout(value).toFixed(2)}×</small></button>)}</div></>}</div>
        <div className="ic-actions">{active ? <>{game.kind === "road" && <button className="ic-play" disabled={busy} onClick={() => void act("reveal", step)}>Cross lane {step + 1}<ArrowRight size={19} /></button>}<button className={game.kind === "road" ? "ic-cashout" : "ic-play"} disabled={busy} onClick={() => void act("cashout")} data-testid="collection-cashout"><Coins size={18} /> {step ? "Cash out" : "Return stake"} <strong>{amount(round.cashoutAmount)}</strong></button></> : <><button className="ic-play" data-testid="collection-play" disabled={busy || (!pending && (!ready || !validStake || !enough || !within))} onClick={() => void act("place")}>{pending ? "Retry pending bet" : game.kind === "fishing" ? "Cast your line" : game.kind === "dice" ? "Roll the dice" : game.kind === "coin" ? "Flip the coin" : "Let’s play"}<ArrowRight size={20} /></button><small>{pending ? "Your original bet will be recovered" : !config.data?.enabled && config.data ? "Game temporarily unavailable" : !ready ? "Connecting to your game…" : !validStake || !within ? `Limits ${amount(config.data!.minStakePaise)} – ${amount(config.data!.maxStakePaise)}` : !enough ? "Insufficient wallet balance" : "One click. A new adventure."}</small></>}</div></div>
      {(error || config.isError || state.isError || balance.isError) && <div className="ic-error" role="alert">{error || "Could not connect to the game. Please retry."}<button disabled={busy} onClick={() => { void config.refetch(); void balance.refetch(); void state.refetch(); setError(""); }}>Refresh</button></div>}
      <footer className="ic-footer"><span><ShieldCheck size={14} /> {active ? "Round saved · resume any time" : "Secure wallet settlement"}</span><div className="ic-footer-tools"><button onClick={() => setPanel("rules")} aria-label="Read game rules"><CircleHelp size={14} /> Rules</button><button onClick={() => setPanel("fairness")}>Round details <ChevronRight size={14} /></button><button aria-label={sound ? "Turn sound off" : "Turn sound on"} onClick={toggleSound}>{sound ? <Volume2 size={14} /> : <VolumeX size={14} />}</button></div></footer>
    </section><aside className="ic-sidebar"><div className="ic-side-heading"><History size={17} /><h3>Your recent rounds</h3><span>{state.data?.history.length ?? 0}</span></div><div className="ic-recent-list">{state.data?.history.length ? state.data.history.slice(0, 8).map(r => <button key={r.id} onClick={() => setPanel("history")}><span className={`ic-receipt-icon ${r.status === "lost" ? "is-loss" : ""}`}>{r.status === "lost" ? <X size={15} /> : <Check size={15} />}</span><div><strong>{r.status === "active" ? "In progress" : `${r.multiplier.toFixed(2)}×`}</strong><small>{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></div><b>{r.status === "active" ? "Playing" : amount(r.payoutAmount)}</b></button>) : <div className="ic-empty"><History size={30} /><strong>A fresh start</strong><p>Your rounds will appear here as you play.</p></div>}</div><div className="ic-howto"><span>THE QUICK GUIDE</span><h3>{isProgressive ? "A little further?" : "Trust your pick."}</h3><p>{game.kind === "road" ? "Guide your chicken across each lane. Every safe crossing grows your return. Cash out before a failed crossing." : game.kind === "mines" ? "Choose covered tiles to uncover gems. Avoid the hidden cannons and collect your treasure at any time." : game.kind === "tower" ? "Choose one of three doors on each floor. Two are safe. Climb higher for a bigger return, or cash out." : game.kind === "dice" ? "Predict whether two dice total below 7, exactly 7, or above 7. Then roll to reveal your result." : game.kind === "duel" ? "Choose Gold or Blue. Each duck has an equal chance of winning the duel." : game.kind === "fishing" ? "Cast your line for a random catch. Reef fish, marlin, royal catches and the golden jackpot each return a different prize." : "Choose heads or tails and flip. Match the result to collect the displayed return."}</p><button onClick={() => setPanel("rules")}>How to play <ArrowRight size={14} /></button></div><Link href="/" className="ic-more-games">Explore Instant Games <ArrowRight size={16} /></Link></aside></main>
    {dialog}
  </div>;
}
