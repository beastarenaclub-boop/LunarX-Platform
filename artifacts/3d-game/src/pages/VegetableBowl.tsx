import { GameInformationDrawer } from "@/components/game/GameInformation";
import { GameInformationSection, GameInformationTarget, restoreGameInformationFocus } from "@/components/game/GameInformation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Info,
  Clock3,
  Leaf,
  Plus,
  Sprout,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  getGetWalletBalanceQueryKey,
  useGetWalletBalance,
} from "@workspace/api-client-react";
import {
  VEGETABLE_MODES,
  VEGETABLE_TICKETS,
  VEGETABLE_RTP,
  VEGETABLE_LEGACY_RTP,
  VEGETABLE_JUNK_CHANCE,
  type VegetableMode,
  type VegetableOutcome,
} from "@workspace/api-zod/vegetable-game";
import { useTableRound } from "@/components/table/useTableRound";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { AutoBetStatus, BET_SEND_BUFFER_MS, useChipDraft, useTimedBet } from "@/components/table/AutoBet";
import { TableCoinRack, useCoinPreferences } from "@/components/table/CoinSettings";
import { useAuth } from "@/lib/auth";
import { VegetableArt } from "@/components/vegetable/VegetableArt";
import HarvestScene from "@/components/vegetable/HarvestScene";
import { useHarvestWorld } from "@/components/vegetable/harvestWorld";
import { HARVEST_DURATION_MS } from "@/components/vegetable/harvestMotion";
import { Dialog, DialogTitle } from "@/components/ui/dialog";
import { formatRupees } from "@/lib/format";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { unlockAudio, sfx, playGameSound } from "@/game/audio";
import "@/components/vegetable/vegetable-bowl.css";

interface Config {
  outcomeVersion?: 1 | 2;
  enabled: boolean;
  minStakePaise: string;
  maxStakePaise: string;
}
const money = (paise: string | bigint) => `₹${formatRupees(paise)}`;
export default function VegetableBowl() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sound = useStore((s) => s.settings.sound);
  const [mode, setMode] = useState<VegetableMode>("normal");
  const [rules, setRules] = useState(false);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const refreshWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
  };
  const table = useTableRound<VegetableOutcome>("vegetable-bowl", {
    onSettled: refreshWallet,
    roundOpenVoice: false,
  });
  const config = useQuery({
    queryKey: ["vegetable-config"],
    queryFn: () => customFetch<Config>("/api/vegetable-bowl/config"),
    refetchInterval: 10000,
    retry: false,
  });
  // The shared wallet's canonical scope is lunar.
  const wallet = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        retry: false,
      },
    },
  );
  const selected = VEGETABLE_MODES.find((m) => m.id === mode)!;
  const outcomeVersion = table.config
    ? table.config.vegetableOutcomeVersion ?? 1
    : config.data?.outcomeVersion ?? 1;
  const junkChance = outcomeVersion === 2 ? VEGETABLE_JUNK_CHANCE : 0;
  const theoreticalRtp = outcomeVersion === 2 ? VEGETABLE_RTP : VEGETABLE_LEGACY_RTP;
  const balance = BigInt(wallet.data?.balance ?? "0");
  const minStake = BigInt(config.data?.minStakePaise ?? "100");
  const maxStake = BigInt(
    table.config?.maxStakePaise ?? config.data?.maxStakePaise ?? "1000000",
  );
  const coins = useCoinPreferences("vegetable-bowl", user?.id, Number(maxStake / 100n));
  const stake = BigInt(coins.chip) * 100n;
  const validStake = stake >= minStake && stake <= maxStake;
  const bettingAvailable =
    !!user &&
    table.bettingOpen &&
    !!config.data?.enabled &&
    !config.isError &&
    !wallet.isError &&
    !!wallet.data &&
    !sending;
  const canEdit = bettingAvailable && table.remainingMs > 0;
  const draft = useChipDraft<VegetableMode>(table.roundId, canEdit, balance.toString(), maxStake.toString());
  const draftTotal = draft.bets.reduce((sum, bet) => sum + BigInt(bet.amountPaise), 0n);
  useEffect(() => { if (table.phase !== "betting") draft.clear(); }, [table.phase]);
  const possibleReturn =
    (stake * BigInt(selected.returnHundredths)) / 100n;
  const duration = table.config?.revealDurationMs ?? HARVEST_DURATION_MS;
  const world = useHarvestWorld(table.roundId);
  const [collection, setCollection] = useState<{ roundId: string | null; count: number; complete: boolean }>({ roundId: null, count: 0, complete: false });
  const collected = collection.roundId === table.roundId ? collection.count : 0;
  const onCollected = useCallback((count: number, complete: boolean) => {
    setCollection(previous => previous.roundId === table.roundId && previous.count === count && previous.complete === complete
      ? previous : { roundId: table.roundId, count, complete });
  }, [table.roundId]);
  const isJunk = table.outcome?.winner === "junk";
  const resultReady = !!table.outcome && collection.roundId === table.roundId && collection.complete;
  const roundWin = useRoundWin({
    game: "vegetable-bowl",
    userId: user?.id,
    roundId: table.roundId,
    eligible: resultReady && table.phase === "settling",
    bets: table.myBets,
  });
  const winner = VEGETABLE_MODES.find((m) => m.id === table.outcome?.winner);
  const myStake = table.myBets.reduce(
    (sum, b) => sum + BigInt(b.totalStake),
    0n,
  );
  const myPayout = table.myBets.reduce(
    (sum, b) => sum + BigInt(b.payoutAmount),
    0n,
  );
  const settled =
    table.myBets.length > 0 &&
    table.myBets.every((b) => b.status !== "pending");
  const currentReceipt = table.myBets
    .map((b) => `${b.slipId}:${b.status}`)
    .join("|");
  const audioEvent = useRef("");
  useEffect(() => {
    const event = `${table.roundId}:${collected}`;
    if (audioEvent.current === event) return;
    audioEvent.current = event;
    if (sound && collected > 0) playGameSound("reveal", "vegetable-bowl");
  }, [table.roundId, collected, sound]);
  const resultAudio = useRef("");
  useEffect(() => {
    if (!resultReady || !settled || !table.roundId || resultAudio.current === table.roundId) return;
    resultAudio.current = table.roundId;
    if (sound && myStake > 0n && myPayout < myStake) sfx.tableLose("vegetable-bowl");
  }, [resultReady, settled, table.roundId, sound, myStake, myPayout]);
  useEffect(() => {
    document.title = "Vegetable Bowl • Lunar Casino";
  }, []);
  useEffect(() => {
    setMessage("");
    setFailed(false);
  }, [table.roundId]);
  useEffect(() => {
    if (settled) refreshWallet();
  }, [settled, currentReceipt]);
  // Polling keeps this game's clock and receipts usable if the socket is unavailable.
  useEffect(() => {
    const timer = window.setInterval(table.refetch, 3000);
    return () => clearInterval(timer);
  }, [table.refetch]);

  async function placeBet() {
    if (!bettingAvailable || !table.roundId || !draft.bets.length || inFlight.current ||
      table.phaseEndsAt === null || table.toLocalTime(table.phaseEndsAt) - Date.now() <= 300) return;
    const bets = draft.bets;
    draft.clear();
    inFlight.current = true;
    setSending(true);
    setFailed(false);
    setMessage("");
    try {
      await customFetch("/api/vegetable-bowl/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: table.roundId,
          bets,
        }),
      });
      setMessage(
        `${money(bets.reduce((sum, bet) => sum + BigInt(bet.amountPaise), 0n))} bet placed.`,
      );
      if (sound) {
        void unlockAudio();
        sfx.chipPlace();
      }
    } catch (error) {
      setFailed(true);
      const detail =
        error instanceof ApiError
          ? (error.data as { detail?: string })?.detail
          : null;
      setMessage(
        detail ||
          "Bet could not be confirmed. Check your round bets before trying again.",
      );
    } finally {
      table.refetch();
      refreshWallet();
      setSending(false);
      inFlight.current = false;
    }
  }
  useTimedBet({
    roundKey: table.roundId,
    deadline: table.phaseEndsAt === null ? null : table.toLocalTime(table.phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: table.phaseEndsAt === null ? null : table.toLocalTime(table.phaseEndsAt) - 300,
    armed: draft.bets.length > 0,
    enabled: bettingAvailable,
    submit: placeBet,
  });
  function selectMode(next: VegetableMode) {
    if (!canEdit || inFlight.current) return;
    setMode(next);
    const staged = validStake && draft.stage([{ type: next, amountPaise: stake.toString() }]);
    if (staged && sound) { void unlockAudio(); playGameSound("select", "vegetable-bowl"); }
    setFailed(!staged);
    setMessage(staged ? "" : `Choose a coin within your balance and ${money(minStake)}–${money(maxStake)} limit.`);
  }

  return (
    <main className="vb-page">
      <header className="vb-header">
        <div className="vb-brand-group">
          <Link href="/" className="vb-back" aria-label="Back to games">
            <ArrowLeft size={19} />
          </Link>
          <div className="vb-brand-mark">
            <Sprout size={25} />
          </div>
          <div>
            <strong>
              vegetable<span>bowl</span>
            </strong>
            <small>A LITTLE LUCK. A FRESH PICK.</small>
          </div>
        </div>
        <div className="vb-header-actions">
          <button
            className="vb-icon-btn"
            aria-label={sound ? "Mute sound" : "Enable sound"}
            onClick={() => {
              void unlockAudio();
              updateSettings({ sound: !sound });
            }}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="vb-icon-btn"
            aria-label="Game information" data-testid="btn-game-rules"
            onClick={() => setRules(true)}
          >
            <Info size={20} />
          </button>
          <Link href="/wallet" className="vb-wallet">
            <Wallet size={18} />
            <span>
              <small>YOUR BALANCE</small>
              <strong>{wallet.data ? money(wallet.data.balance) : "—"}</strong>
            </span>
            <Plus size={17} />
          </Link>
        </div>
      </header>
      <div className="vb-content">
        <div className="vb-heading">
          <div>
            <div className="vb-eyebrow">
              <span /> THE FRESH PICK
            </div>
            <h1>A bowlful of possibilities.</h1>
            <p>Pick your option. Watch the harvest. Count your luck.</p>
          </div>
          <button className="vb-rules-link" onClick={() => setRules(true)}>
            How it works <ArrowRight size={17} />
          </button>
        </div>
        <div className="vb-game-layout">
          <section
            className="vb-play-area"
            aria-label="Vegetable collection game"
          >
            <div className="vb-scene-top">
              <span className="vb-round-label">
                ROUND{" "}
                <b>
                  {table.roundId
                    ? table.roundId.slice(-8).toUpperCase()
                    : "CONNECTING"}
                </b>
              </span>
              <span
                className={`vb-status ${table.phase === "betting" ? "is-open" : ""}`}
              >
                <span />
                {!config.data?.enabled && config.data
                  ? "Game paused"
                  : table.phase === "betting"
                    ? "Bets are open"
                    : table.phase
                      ? "Bets closed"
                      : "Connecting…"}
              </span>
            </div>
            <div
              className="vb-stage"
              data-testid="vegetable-stage"
              data-phase={table.phase ?? "loading"}
              data-night={world.night}
              data-junk-round={isJunk}
              style={{ background: world.ground[1] }}
            >
              <HarvestScene
                key={table.roundId ?? "waiting"}
                roundId={table.roundId ?? "waiting"}
                world={world}
                outcome={table.outcome}
                phase={table.phase}
                duration={duration}
                endsAt={
                  table.phaseEndsAt
                    ? table.toLocalTime(table.phaseEndsAt)
                    : null
                }
                onCollected={onCollected}
              />
              <div className="vb-stage-caption">
                <span>
                  {resultReady
                    ? isJunk ? "JUNK BOWL" : "HARVEST COMPLETE"
                    : table.phase === "reveal"
                      ? isJunk ? "A SURPRISE IN THE HARVEST" : "CATCHING FRESH VEGETABLES"
                      : "READY FOR THE HARVEST?"}
                </span>
                <h2>
                  {resultReady
                    ? isJunk ? "Only junk in the bowl!" : `${collected} vegetables collected!`
                    : table.phase === "reveal"
                      ? isJunk ? "Stones, boots & empty cans!" : "Catch fresh. Dodge junk!"
                      : "Pick your lucky harvest."}
                </h2>
              </div>
              <div className="vb-collected-badge">
                <Leaf size={16} />
                <strong data-testid="vegetable-count">
                  {collected.toString().padStart(2, "0")}
                </strong>
                <span>COLLECTED</span>
              </div>
              <div
                className={`vb-round-callout ${resultReady ? `result-${table.outcome?.winner}` : ""}`}
                role="status"
              >
                {resultReady ? (
                  <>
                    <Leaf size={17} />
                    <strong>{isJunk ? "Junk Bowl · No winners" : `${winner?.label} wins`}</strong>
                    <span>{isJunk ? "All bets return ₹0" : `${winner?.multiplier.toFixed(2)}× return`}</span>
                  </>
                ) : (
                  <>
                    <Clock3 size={17} />
                    <span>
                      {table.phase === "betting"
                        ? "Harvest begins in"
                        : table.phase === "reveal"
                          ? isJunk ? "Catching junk" : "Collecting vegetables"
                          : table.phase === "settling"
                            ? "Next harvest in"
                            : "Waiting for the next harvest"}
                    </span>
                    {table.phase && (
                      <strong>{Math.ceil(table.remainingMs / 1000)}s</strong>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="vb-scene-footer">
              <span>
                <Sprout size={17} />{" "}
                <b data-testid="harvest-world-name">{world.name}</b>
              </span>
              <span className={junkChance ? "vb-junk-notice" : undefined} data-testid="vegetable-junk-notice">
                {junkChance ? `${junkChance * 100}% Junk Bowl · All bets lose` : "Vegetables count · Junk is dodged"}
              </span>
            </div>
          </section>
          <section className="vb-bet-panel" aria-labelledby="vb-bet-title">
            <div className="vb-panel-heading">
              <div>
                <span className="vb-eyebrow">YOUR NEXT PICK</span>
                <h2 id="vb-bet-title">Choose your bet</h2>
              </div>
              <span className="vb-step">01 / 02</span>
            </div>
            <div className="vb-modes" role="group" aria-label="Bet option">
              {VEGETABLE_MODES.map((option) => (
                <button
                  key={option.id}
                  data-mode={option.id}
                  className={`vb-mode ${mode === option.id ? "selected" : ""}`}
                  aria-pressed={mode === option.id}
                  disabled={!canEdit}
                  onClick={() => selectMode(option.id)}
                >
                  <span className="vb-mode-illustration">
                    <VegetableArt
                      kind={
                        option.id === "normal"
                          ? "broccoli"
                          : option.id === "hard"
                            ? "carrot"
                            : "aubergine"
                      }
                    />
                  </span>
                  <span className="vb-mode-copy">
                    <strong>
                      {option.label}
                      {option.id === "risk" && <small>RARE PICK</small>}
                    </strong>
                    <span>{draft.bets.some(bet => bet.type === option.id)
                      ? `Selected ${money(draft.bets.find(bet => bet.type === option.id)!.amountPaise)}`
                      : option.hint}</span>
                  </span>
                  <span className="vb-mode-price">
                    <strong>
                      {option.multiplier.toFixed(2)}
                      <small>×</small>
                    </strong>
                    <span>total return</span>
                  </span>
                  <span className="vb-mode-radio">
                    {mode === option.id && <Check size={11} />}
                  </span>
                </button>
              ))}
            </div>
            <div className="vb-coins">
              <div className="vb-amount-label"><span>Choose coins, then tap an option</span><span>Min. {money(minStake)}</span></div>
              <TableCoinRack preferences={coins} chip={coins.chip} onSelect={coins.selectChip}
                layout="fit" disabled={!canEdit} minValue={Number(minStake) / 100} maxValue={Number(maxStake) / 100} />
            </div>
            <div className="vb-return">
              <span>Return on a winning bet</span>
              <strong data-testid="vegetable-return">
                {money(possibleReturn)}
              </strong>
            </div>
            <div className="vb-auto-bet">
              <span className="vb-draft-total">Selected <b data-testid="vegetable-selected-total">{money(draftTotal)}</b></span>
              <AutoBetStatus selected={draft.bets.length > 0} busy={sending}
                seconds={draft.bets.length ? Math.ceil(table.remainingMs / 1000) : null}
                onCancel={draft.clear} />
            </div>
            <p
              className={`vb-feedback ${failed || !validStake || stake > balance ? "error" : ""}`}
              role="status"
            >
              {message ||
                (config.isError || wallet.isError
                  ? "Connection unavailable. Reconnecting…"
                  : config.data && !config.data.enabled
                    ? "Betting is paused by the operator."
                    : !validStake
                      ? `Enter ${money(minStake)}–${money(maxStake)}.`
                      : stake > balance && wallet.data
                        ? "Insufficient wallet balance."
                        : "Total return includes your original bet.")}
            </p>
          </section>
        </div>
        <div className="vb-bottom-grid">
          <GameInformationSection><section className="vb-history">
            <div className="vb-section-label">
              <Clock3 size={16} />
              <h3>Recent harvests</h3>
              <span>LAST {Math.min(12, table.recent.length)}</span>
            </div>
            <div className="vb-history-list">
              {table.recent.length ? (
                table.recent.slice(0, 12).map((r) => {
                  const outcome = r.outcome as VegetableOutcome;
                  return (
                    <div
                      key={r.roundId}
                      className={`vb-history-item history-${outcome.winner}`}
                      title={outcome.winner === "junk" ? "Junk Bowl — 0 vegetables, all bets lose" : `${outcome.total} vegetables — ${outcome.winner}`}
                    >
                      <span>{outcome.total}</span>
                      <small>{outcome.winner}</small>
                    </div>
                  );
                })
              ) : (
                <p>Completed harvests will appear here.</p>
              )}
            </div>
          </section></GameInformationSection>
          <section className="vb-your-round">
            <div className="vb-section-label">
              <Leaf size={16} />
              <h3>Your round</h3>
            </div>
            <div>
              <span>
                Total bet <b>{money(myStake)}</b>
              </span>
              <span>
                {settled ? "Returned" : "Status"}
                <b>
                  {settled
                    ? money(myPayout)
                    : myStake > 0n
                      ? "In play"
                      : "No bets yet"}
                </b>
              </span>
            </div>
            {table.myBets.length > 0 && (
              <small>
                {table.myBets
                  .flatMap((b) =>
                    (
                      b.bets as { type: VegetableMode; amountPaise: string }[]
                    ).map(
                      (bet) =>
                        `${VEGETABLE_MODES.find((m) => m.id === bet.type)?.label} ${money(bet.amountPaise)}`,
                    ),
                  )
                  .join(" · ")}
              </small>
            )}
          </section>
        </div>
        <GameInformationSection><footer className="vb-footer">
          <span>
            <Leaf size={14} /> A fresh take on Lucky 7
          </span>
          <button onClick={() => setRules(true)}>
            Game rules & chances <ChevronDown size={14} />
          </button>
        </footer></GameInformationSection>
      </div>
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog open={rules} onOpenChange={setRules}>
        <GameInformationDrawer onCloseAutoFocus={restoreGameInformationFocus} className="vb-rules-dialog">
          <DialogTitle>Vegetable Bowl information</DialogTitle>
          <GameInformationTarget />
          <p>
            Choose a coin, then tap Normal, Hard or Risk to add it to your selected bets.
            Each tap adds that coin amount. Selected bets submit together when the
            betting countdown ends. Cancel clears them; a new round needs a new selection.
            Vegetables fall into one bowl; its final count decides the winning
            option. This is a chance game, with no catching controls. A new
            scene appears each round. {junkChance
              ? "Sometimes the bowl catches only stones, old boots and empty cans. These are Junk Bowl rounds: zero vegetables and no winning option."
              : "The bowl automatically dodges stones, old boots and empty cans."}
            {" "}Junk never adds to the vegetable count.
          </p>
          <div className="vb-rules-table">
            {VEGETABLE_MODES.map((option) => (
              <div key={option.id}>
                <strong>{option.label}</strong>
                <span>{option.range}</span>
                <b>{option.multiplier}×</b>
                <small>
                  Win chance:{" "}
                  {((option.tickets / VEGETABLE_TICKETS) * (1 - junkChance) * 100).toFixed(2)}%
                </small>
              </div>
            ))}
          </div>
          {junkChance > 0 && <p className="vb-junk-rule">
            <strong>Junk Bowl: {junkChance * 100}% chance (1 in 20 on average).</strong>{" "}
            All Normal, Hard and Risk bets lose and return ₹0, even if you bet on
            all three. Zero vegetables does not win Normal. Each round is an
            independent random draw; this is not a scheduled loss every 20 rounds.
          </p>}
          <p>
            ₹1 on Normal or Hard returns ₹1.87 when it wins. ₹1 on Risk returns
            ₹18.96 when it wins. Returns include your stake; losing bets return ₹0.
            An exact 7 loses both Normal and Hard.
          </p>
          <p>
            {junkChance > 0 ? "After the independent Junk Bowl draw, vegetable rounds" : "Results"}
            {" "}use weighted draws: 1,000 Normal, 1,000 Hard and 99 Risk
            tickets out of 2,099. Theoretical return{junkChance > 0 ? ", including Junk Bowl rounds" : ""}:{" "}
            84.64% for Normal/Hard and 84.95% for Risk (85% target), before
            fractional-paise rounding. Vegetable types are decorative; every
            vegetable counts as one.
          </p>
          <p>
            The shared server closes betting, reveals the harvest and pays the
            winning bets. Your balance and placed bets come from your account.
          </p>
          <button className="vb-place-bet" onClick={() => setRules(false)}>
            Got it <Check size={17} />
          </button>
        </GameInformationDrawer>
      </Dialog>
    </main>
  );
}
