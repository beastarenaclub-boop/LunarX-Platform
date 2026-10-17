import { Treasure } from "@/components/instant/CollectionArt";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bomb, Gem, Shuffle, ArrowRight, RotateCcw, Wallet, ShieldCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { sfx, unlockAudio, voiceRoundLoss, voiceRoundWin } from "@/game/audio";
import { notifyPlayStarted } from "@/game/engine";
import { formatRupees, rupeesToPaise } from "@/lib/format";
import { AutoBetStatus, useSelectionBet } from "@/components/table/AutoBet";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { InstantShell, StakeControl, Notice, FairnessDialog, SeedField, useInstantGame, request, errorMessage, stakeError, money } from "@/components/instant/InstantGame";

interface MinesState {
  id: string; betId: string; stakeAmount: string; status: "active" | "cashed_out" | "busted";
  gridSize: number; mineCount: number; revealedIndexes: number[]; mineIndexes: number[] | null;
  serverSeed: string | null; serverSeedHash: string; clientSeed: string; nonce: number;
  multiplier: number; nextMultiplier: number; maxMultiplier: number; payoutAmount: string | null;
  createdAt: string; settledAt: string | null;
}
interface MinesConfig { enabled: boolean; houseEdge: number; maxStakePaise: string; maxMultiplier: number; multipliers: Record<string, number[]> }

export default function Mines() {
  const { user, sound, balance, refresh } = useInstantGame("mines");
  const [stake, setStake] = useState(100);
  const [mineCount, setMineCount] = useState(3);
  const [bonus, setBonus] = useState(false);
  const [round, setRound] = useState<MinesState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const lock = useRef(false);
  const [fairness, setFairness] = useState(false);
  const [detail, setDetail] = useState<MinesState | null>(null);
  const [verification, setVerification] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const config = useQuery({ queryKey: ["mines.config"], queryFn: () => request<MinesConfig>("/api/mines/config"), staleTime: 60_000, retry: false });
  const active = useQuery({ queryKey: ["mines.active", user?.id], queryFn: () => request<MinesState | null>("/api/mines/active"), enabled: !!user, staleTime: Infinity, refetchOnWindowFocus: false, retry: false });
  const recent = useQuery({ queryKey: ["mines.recent", user?.id], queryFn: () => request<MinesState[]>("/api/mines/recent?limit=8"), enabled: !!user, retry: false });
  useEffect(() => { if (active.data !== undefined) { setRound(active.data); if (active.data) setMineCount(active.data.mineCount); setRecoveryError(false); } }, [active.data, active.dataUpdatedAt]);
  const isActive = round?.status === "active";
  const settled = !!round && !isActive;
  const picked = round?.revealedIndexes.filter(i => !round.mineIndexes?.includes(i)).length ?? 0;
  const mines = round?.mineCount ?? mineCount;
  const safeTotal = 25 - mines;
  const actualStake = round ? Number(round.stakeAmount) / 100 : stake;
  const payout = round ? round.status === "busted" ? 0 : settled ? Number(round.payoutAmount ?? 0) / 100 : picked ? Math.floor(Number(round.stakeAmount) * round.multiplier) / 100 : actualStake : 0;
  const profit = round ? payout - actualStake : 0;
  const available = bonus ? undefined : balance.data?.balance;
  const validation = stakeError(stake, available, config.data?.maxStakePaise);
  const ready = !!user && active.isSuccess && !recoveryError && config.data?.enabled === true && balance.isSuccess;
  const win = useRoundWin({ game: "mines", userId: user?.id, roundId: round?.id ?? null, eligible: round?.status === "cashed_out",
    bets: round ? [{ status: "settled", totalStake: round.stakeAmount, payoutAmount: round.payoutAmount ?? "0" }] : [] });
  const auto = useSelectionBet({ enabled: ready && !round && !busy && !validation, scope: `${mineCount}:${bonus}`, submit: () => play() });
  const selectStake = (amount: number) => { setStake(amount); unlockAudio(); if (amount > 0) auto.select(); else auto.cancel(); };

  const recover = async (id?: string) => {
    try {
      const state = await request<MinesState | null>(id ? `/api/mines/${id}` : "/api/mines/active");
      setRound(state); setRecoveryError(false); refresh();
    } catch { setRecoveryError(true); }
  };
  const accept = (state: MinesState) => {
    setRound(state);
    if (state.status === "busted") { if (sound) { sfx.mineHit(); voiceRoundLoss("mines", state.id); } }
    else if (state.status === "cashed_out") { if (sound) { sfx.minesCashout(); voiceRoundWin("mines", state.id); } }
    else if (state.revealedIndexes.length && sound) sfx.mineReveal();
    refresh();
  };
  const play = async () => {
    if (lock.current || !ready || isActive) return;
    auto.cancel();
    if (validation) { toast.error(validation); return; }
    lock.current = true; setBusy("placing"); unlockAudio();
    try {
      const state = await request<MinesState>("/api/mines/place", { stakeAmount: rupeesToPaise(stake), mineCount, useBonus: bonus });
      accept(state); notifyPlayStarted(); if (sound) sfx.bet();
    } catch (error) { toast.error(errorMessage(error)); await recover(); }
    finally { lock.current = false; setBusy(null); }
  };
  const reveal = async (cellIndex: number) => {
    if (!round || !isActive || lock.current || recoveryError || round.revealedIndexes.includes(cellIndex)) return;
    lock.current = true; setBusy(`cell-${cellIndex}`); unlockAudio();
    try { accept(await request<MinesState>(`/api/mines/${round.id}/reveal`, { cellIndex })); }
    catch (error) { toast.error(errorMessage(error)); await recover(round.id); }
    finally { lock.current = false; setBusy(null); }
  };
  const cashout = async () => {
    if (!round || !isActive || !picked || lock.current || recoveryError) return;
    lock.current = true; setBusy("cashing");
    try { accept(await request<MinesState>(`/api/mines/${round.id}/cashout`, {})); }
    catch (error) { toast.error(errorMessage(error)); await recover(round.id); }
    finally { lock.current = false; setBusy(null); }
  };
  const randomPick = () => {
    const cells = Array.from({ length: 25 }, (_, i) => i).filter(i => !round?.revealedIndexes.includes(i));
    if (cells.length) void reveal(cells[Math.floor(Math.random() * cells.length)]);
  };
  const inspect = detail ?? round;
  const verifyHash = async () => {
    if (!inspect?.serverSeed) return;
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(inspect.serverSeed));
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
      setVerification(hash === inspect.serverSeedHash ? "Verified: the revealed seed matches the committed hash." : "Mismatch: the seed does not match the commitment.");
    } catch { setVerification("Hash verification needs a secure browser connection (HTTPS or localhost)."); }
  };
  const ladder = config.data?.multipliers?.[String(mines)] ?? [];
  const nextSteps = Array.from({ length: Math.min(5, safeTotal - picked) }, (_, i) => picked + i + 1);
  if (!user) return null;
  return <InstantShell game="mines" balance={balance.data?.balance} onFairness={() => { setDetail(null); setVerification(""); setFairness(true); }}>
    <RoundWinDialog win={win.win} onClose={win.dismiss} />
    <section className="instant-heading"><div><h2>A little risk. A hidden gem.</h2><p>Find the diamonds. Dodge the mines. Cash out on your terms.</p></div><span className="instant-tag"><i /> 5 × 5 GRID</span></section>
    {(active.isError || recoveryError) && <Notice onRetry={() => recoveryError ? void recover(round?.id) : void active.refetch()}>We couldn't restore your round. Reconnect before playing.</Notice>}
    {config.isError && <Notice onRetry={() => void config.refetch()}>Game settings couldn't load.</Notice>}
    {config.data?.enabled === false && <Notice>Mines is temporarily unavailable.</Notice>}
    {balance.isError && <Notice onRetry={() => void balance.refetch()}>Your wallet couldn't load.</Notice>}
    <main className="instant-layout" data-game-screen="mines">
      <aside className="instant-controls">
        <div className="instant-control-title">{isActive ? "Your expedition" : "Make your move"}<span>{isActive ? "IN PLAY" : "MANUAL"}</span></div>
        <StakeControl game="mines" userId={user.id} value={round ? actualStake : stake} onChange={selectStake} disabled={!!round || !!busy || !ready} max={config.data?.maxStakePaise} />
        <div><label htmlFor="mine-count">Mines <span>{safeTotal} GEMS</span></label><select id="mine-count" data-testid="select-mines-count" value={mines} disabled={!!round || !!busy} onChange={e => setMineCount(Number(e.target.value))}>{Array.from({ length: 24 }, (_, i) => <option key={i} value={i + 1}>{i + 1} {i === 0 ? "mine" : "mines"}</option>)}</select>
          <div className="instant-segment instant-mine-presets">{[1, 3, 5, 10, 24].map(n => <button key={n} aria-pressed={mines === n} disabled={!!round || !!busy} onClick={() => setMineCount(n)}>{n}</button>)}</div></div>
        {!round && <label className="instant-bonus"><input type="checkbox" checked={bonus} disabled={!!busy} onChange={e => setBonus(e.target.checked)} data-testid="toggle-mines-bonus" /> Use bonus wallet</label>}
        {round && <div className="instant-round-summary"><div><small>Gems found</small><strong>{picked} <span className="instant-small">/ {safeTotal}</span></strong></div><div><small>Mines hidden</small><strong>{mines}</strong></div></div>}
        {settled && <div className={`instant-result ${round.status === "busted" ? "is-loss" : ""}`} role="status"><small>{round.status === "busted" ? "MINE HIT · ROUND OVER" : picked === safeTotal ? "ALL GEMS FOUND" : "CASHED OUT"}</small><strong>{round.status === "busted" ? `−₹${money(actualStake)}` : `₹${money(payout)}`}</strong><span className="instant-small">{round.status === "busted" ? "A fresh board is one click away." : `${round.multiplier.toFixed(2)}× total return`}</span></div>}
        <div className="instant-control-bottom">
          {!round && <><button className="instant-primary" disabled={!ready || !!busy || !!validation} onClick={() => void play()} data-game-bet data-testid="btn-mines-place">{busy ? <LoaderCircle size={18} /> : <Gem size={18} />}{busy ? "Starting…" : active.isPending ? "Restoring round…" : "Start game"}<ArrowRight size={16} /></button><AutoBetStatus seconds={auto.seconds} busy={!!busy} onCancel={auto.cancel} />{validation && <p className="instant-small" role="status">{validation}</p>}</>}
          {isActive && <><button className="instant-secondary" disabled={!!busy || recoveryError} onClick={randomPick} data-testid="btn-mines-random"><Shuffle size={15} /> Pick a random tile</button><button style={{ marginTop: 10 }} className="instant-primary is-cashout" disabled={!picked || !!busy || recoveryError} onClick={() => void cashout()} data-game-bet data-testid="btn-mines-cashout"><Wallet size={17} />{busy === "cashing" ? "Cashing out…" : picked ? `Cash out ₹${money(payout)}` : "Reveal a gem first"}</button></>}
          {settled && <button className="instant-primary" onClick={() => { setRound(null); win.dismiss(); }} data-game-bet data-testid="btn-mines-new-round"><RotateCcw size={17} /> New round</button>}
          <p className="instant-small">{isActive ? "Every safe pick increases your multiplier." : "Pick your amount and mine count to begin."}</p>
        </div>
      </aside>
      <section className="instant-stage" aria-label="Mines game board">
        <div className="instant-stage-top"><h3>THE GEM VAULT</h3><span><Gem size={13} /> {safeTotal - picked} gems remaining</span></div>
        <div className="instant-stage-body"><div className="vault-board" data-testid="mines-board-frame">{Array.from({ length: 25 }, (_, idx) => {
          const revealed = round?.revealedIndexes.includes(idx);
          const mine = settled && round.mineIndexes?.includes(idx);
          const gem = !mine && (revealed || settled);
          const hit = mine && revealed;
          return <button key={idx} type="button" data-testid={`mines-cell-${idx}`} aria-label={`Tile ${idx + 1}${mine ? ": mine" : gem ? ": gem" : ": hidden"}`} disabled={!isActive || revealed || !!busy || recoveryError} onClick={() => void reveal(idx)} className={`vault-cell${gem ? " is-gem" : ""}${mine ? " is-mine" : ""}${hit ? " is-hit" : ""}${settled && !revealed ? " is-unpicked" : ""}${busy === `cell-${idx}` ? " is-loading" : ""}`}>{mine ? <Treasure mine /> : busy === `cell-${idx}` ? <LoaderCircle /> : gem ? <Treasure /> : <Gem />}</button>;
        })}</div></div>
        <p className="instant-status" aria-live="polite">{busy?.startsWith("cell") ? "Uncovering your tile…" : settled ? round.status === "busted" ? "Mine found. Your next adventure awaits." : "Gems secured. Your return is in your wallet." : isActive ? "Choose any covered tile to reveal what's underneath." : "25 tiles. One fresh adventure."}</p>
        {isActive && <p className="instant-status" data-testid="mines-next-chance">Next pick: {((safeTotal - picked) / (25 - picked) * 100).toFixed(1)}% gem chance ? {mines} mines among {25 - picked} covered tiles</p>}
        <div className="vault-stepper" aria-label="Upcoming multipliers">{nextSteps.map((step, i) => <div className={`vault-step${i === 0 ? " is-next" : ""}`} key={step}><small>{i === 0 ? "NEXT GEM" : `${step} GEMS`}</small><strong>{(i === 0 && isActive ? round.nextMultiplier : ladder[step - 1])?.toFixed(2) ?? "—"}×</strong></div>)}</div>
        <div className="instant-stats"><div><small>Multiplier</small><strong className="accent" data-testid="mines-multiplier">{(round?.multiplier ?? 1).toFixed(2)}×</strong></div><div><small>{settled ? "Final return" : "Cashout value"}</small><strong data-testid="mines-payout">₹{money(payout)}</strong></div><div><small>Net profit</small><strong className={profit < 0 ? "negative" : "accent"} data-testid="mines-profit">{profit < 0 ? "−" : ""}₹{money(Math.abs(profit))}</strong></div></div>
      </section>
    </main>
    <section className="instant-history"><div className="instant-history-head"><h3>Your recent rounds</h3><span>Round details & seed commitment</span></div><div className="instant-history-list"><div className="instant-history-row is-head"><span>Round</span><span>Bet</span><span>Multiplier</span><span>Return</span></div>
      {recent.isError ? <Notice onRetry={() => void recent.refetch()}>History couldn't load.</Notice> : !recent.data?.length ? <p className="instant-empty">{recent.isPending ? "Loading rounds…" : "Your journey starts with the first gem. No rounds yet."}</p> : recent.data.map(r => <button className="instant-history-row" key={r.id} onClick={() => { setDetail(r); setVerification(""); setFairness(true); }} data-testid={`mines-recent-${r.id}`}><span>{r.mineCount} mines <small>{new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span><span>₹{formatRupees(r.stakeAmount)}</span><span>{r.multiplier.toFixed(2)}×</span><span className={r.status === "busted" ? "negative" : "positive"}>{r.status === "active" ? "In play" : `₹${formatRupees(r.payoutAmount)}`}</span></button>)}</div></section>
    <FairnessDialog open={fairness} onOpenChange={setFairness}>
      <p>A secret seed determines the mine positions. Its hash is shown when the round starts; the seed and complete board are revealed when the round ends.</p>
      {inspect ? <><SeedField label="Round" value={inspect.id} /><SeedField label="Server seed hash" value={inspect.serverSeedHash} /><SeedField label="Server seed" value={inspect.serverSeed} /><SeedField label="Client seed" value={inspect.clientSeed} /><SeedField label="Nonce" value={inspect.nonce} /><SeedField label="Mine positions (numbered 1–25)" value={inspect.mineIndexes?.map(i => i + 1).join(", ") ?? null} />{inspect.serverSeed && <button onClick={() => void verifyHash()}>Verify seed hash</button>}{verification && <p role="status" className="instant-verification">{verification}</p>}</> : <p>Start a round to see its seed commitment.</p>}
      {config.data && <p>House edge: {(config.data.houseEdge * 100).toFixed(2)}%. Payouts include your stake; a return below 1× is a net loss. A mine loses the round's stake.</p>}
    </FairnessDialog>
  </InstantShell>;
}
