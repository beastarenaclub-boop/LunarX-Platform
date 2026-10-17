import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CircleHelp,
  Clock3,
  History,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  ApiError,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  CRAZY_TIME_SPOTS,
  CRAZY_TIME_RTP,
  CRAZY_TIME_ROUND_TIMING,
  type CrazyTimeSpot,
  type CrazyTimeBet,
  type CrazyTimeOutcome,
} from "@workspace/api-zod/crazy-time-game";
import { useAuth } from "@/lib/auth";
import { formatRupees, rupeesToPaise } from "@/lib/format";
import { useStore } from "@/game/store";
import { updateSettings } from "@/game/engine";
import { sfx, unlockAudio, playGameSound } from "@/game/audio";
import { useTableRound, type MyBet } from "@/components/table/useTableRound";
import {
  AutoBetStatus,
  BET_SEND_BUFFER_MS,
  useTimedBet,
  useChipDraft,
} from "@/components/table/AutoBet";
import ChipRack from "@/components/table/chips";
import {
  CoinSettingsButton,
  CoinSettingsDialog,
  useCoinPreferences,
} from "@/components/table/CoinSettings";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import LiveBetsPanel from "@/components/table/LiveBetsPanel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import CrazyWheel from "@/components/crazyTime/CrazyWheel";
import StudioScene from "@/components/crazyTime/StudioScene";
import type { StudioPlayback } from "@/components/crazyTime/studioTiming";
import BonusRound from "@/components/crazyTime/BonusRound";
import { toast } from "sonner";
import "@/components/crazyTime/crazy-time.css";
import "@/components/crazyTime/studio-scene.css";

interface Config {
  enabled: boolean;
  minStakePaise: string;
  maxStakePaise: string;
  bettingWindowMs: number;
  revealDurationMs: number;
  settleDurationMs: number;
}
interface Receipt {
  roundId: string;
  outcome: CrazyTimeOutcome;
  bets: CrazyTimeBet[];
  totalStake: string;
  payoutAmount: string;
}
const label = (id: string) =>
  CRAZY_TIME_SPOTS.find((s) => s.id === id)?.label ?? id;
const money = (n: string | bigint) => `₹${formatRupees(String(n))}`;
const describe = (raw: unknown) =>
  Array.isArray(raw)
    ? (raw as CrazyTimeBet[]).map((b) => label(b.type)).join(" · ")
    : "";
const errorMessage = (error: unknown) =>
  error instanceof ApiError
    ? ((error.data as { detail?: string })?.detail ??
      "Bet could not be placed. Please try next round.")
    : (error as Error).message;

export default function CrazyTime() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const sound = useStore((s) => s.settings.sound);
  const voiceVolume = useStore(
    (s) => s.settings.masterVolume * s.settings.sfxVolume,
  );
  const studioPlayback = useRef<StudioPlayback>({
    roundId: null,
    stage: "waiting",
    mediaTime: 0,
    ready: false,
  });
  const balance = useGetWalletBalance(undefined, {
    query: {
      queryKey: getGetWalletBalanceQueryKey(),
      enabled: !!user,
      retry: false,
    },
  });
  const config = useQuery<Config>({
    queryKey: ["crazy-time", "config"],
    queryFn: () => customFetch("/api/crazy-time/config"),
    enabled: !!user,
    retry: false,
  });
  const history = useQuery<Receipt[]>({
    queryKey: ["crazy-time", "recent"],
    queryFn: () => customFetch("/api/crazy-time/recent"),
    enabled: !!user,
    retry: false,
  });
  const refreshWallet = useCallback(() => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: getListMyBetsQueryKey() });
    void qc.invalidateQueries({
      queryKey: getListWalletTransactionsQueryKey(),
    });
    void qc.invalidateQueries({ queryKey: ["crazy-time", "recent"] });
  }, [qc]);
  const round = useTableRound<CrazyTimeOutcome>("crazy-time", {
    enabled: !!user,
    onSettled: refreshWallet,
    roundOpenVoice: false,
    roundClosedVoice: false,
  });
  const { roundId, phase, remainingMs, phaseEndsAt, outcome, toLocalTime } =
    round;
  const [acknowledged, setAcknowledged] = useState<
    (MyBet & { roundId: string }) | null
  >(null);
  const myBets = useMemo(() => {
    const bets = new Map<string, MyBet>();
    if (acknowledged?.roundId === roundId)
      bets.set(acknowledged.slipId, acknowledged);
    for (const bet of round.myBets) bets.set(bet.slipId, bet);
    return [...bets.values()];
  }, [round.myBets, acknowledged, roundId]);
  const [placing, setPlacing] = useState(false);
  const placingRef = useRef(false);
  const currentRound = useRef(roundId);
  currentRound.current = roundId;
  const betting = round.bettingOpen && config.data?.enabled === true;
  const canEdit = betting && remainingMs > 0 && !placing && myBets.length === 0;
  const draft = useChipDraft<CrazyTimeSpot>(
    roundId,
    canEdit,
    balance.data?.balance ?? "0",
    round.config?.maxStakePaise ?? config.data?.maxStakePaise ?? "0",
  );
  const coins = useCoinPreferences("crazy-time", user?.id);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modal, setModal] = useState<
    "rules" | "fairness" | "history" | "picks" | null
  >(null);
  const [cashChoice, setCashChoice] = useState(0);
  const [pointerChoice, setPointerChoice] = useState(0);
  const [lastBets, setLastBets] = useState<CrazyTimeBet[] | null>(null);
  const [landedRound, setLandedRound] = useState<string | null>(null);
  const [verification, setVerification] = useState<{
    roundId: string;
    verified: boolean;
  } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    document.title = "Crazy Time · Lunar Casino";
    const timer = window.setTimeout(() => setWaited(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (phase !== "betting") draft.clear();
  }, [phase]);
  useEffect(() => {
    if (!canEdit && modal === "picks") setModal(null);
  }, [canEdit, modal]);
  // Keep wallet receipts current even if the final WebSocket event was missed.
  const settledKey = myBets
    .filter((b) => b.status === "settled" || b.status === "refunded")
    .map((b) => `${b.slipId}:${b.status}`)
    .join("|");
  useEffect(() => {
    if (settledKey) refreshWallet();
  }, [settledKey, refreshWallet]);
  // REST fallback also covers a disabled/missing socket and the first round after startup.
  useEffect(() => {
    const timer = window.setInterval(round.refetch, 2500);
    return () => clearInterval(timer);
  }, [round.refetch]);

  const prior = round.recent.find(
    (r) => r.roundId !== roundId && r.outcome != null,
  )?.outcome as CrazyTimeOutcome | undefined;
  const revealMs =
    round.config?.revealDurationMs ?? CRAZY_TIME_ROUND_TIMING.revealDurationMs;
  const revealStartsAt =
    phase === "reveal" && phaseEndsAt != null
      ? toLocalTime(phaseEndsAt) - revealMs
      : phase === "settling" && phaseEndsAt != null
        ? toLocalTime(phaseEndsAt) -
          revealMs -
          (round.config?.settleDurationMs ??
            CRAZY_TIME_ROUND_TIMING.settleDurationMs)
        : null;
  const revealEndsAt =
    revealStartsAt == null ? null : revealStartsAt + revealMs;
  const landed = landedRound === roundId && !!outcome;
  const spinning = phase === "reveal" && !!outcome && !landed;
  const heardLanding = useRef<string | null>(null);
  const onLand = useCallback((id: string) => setLandedRound(id), []);
  useEffect(() => {
    if (!landed || !roundId || heardLanding.current === roundId) return;
    heardLanding.current = roundId;
    if (sound) playGameSound("reveal", "crazy-time");
  }, [landed, roundId, sound]);
  const seconds = Math.ceil(remainingMs / 1000);
  const countdownCue = useRef("");
  useEffect(() => {
    const key = `${roundId}:${seconds}`;
    if (
      betting &&
      seconds > 0 &&
      seconds <= 5 &&
      countdownCue.current !== key
    ) {
      countdownCue.current = key;
      if (sound) playGameSound("tick", "crazy-time", 0.7);
    }
  }, [seconds, betting, roundId, sound]);

  const submit = async () => {
    if (
      !user ||
      placingRef.current ||
      !roundId ||
      !draft.bets.length ||
      !betting ||
      myBets.length
    )
      return;
    if (phaseEndsAt == null || toLocalTime(phaseEndsAt) - Date.now() <= 300)
      return;
    const submittedRound = roundId;
    const payload: CrazyTimeBet[] = draft.bets.map((b) => ({
      ...b,
      ...(b.type === "cash-hunt"
        ? { choice: cashChoice }
        : b.type === "crazy-time"
          ? { choice: pointerChoice }
          : {}),
    }));
    const stake = payload.reduce((sum, b) => sum + BigInt(b.amountPaise), 0n);
    if (
      stake <
      BigInt(round.config?.minStakePaise ?? config.data?.minStakePaise ?? "100")
    ) {
      toast.error(
        `Minimum total bet is ${money(round.config?.minStakePaise ?? config.data?.minStakePaise ?? "100")}`,
      );
      draft.clear();
      return;
    }
    placingRef.current = true;
    setPlacing(true);
    try {
      const accepted = await customFetch<{
        slipId: string;
        roundId: string;
        totalStake: string;
        status?: string;
      }>("/api/crazy-time/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: submittedRound, bets: payload }),
      });
      setLastBets(payload);
      if (currentRound.current === accepted.roundId)
        setAcknowledged({
          ...accepted,
          bets: payload,
          status: accepted.status ?? "pending",
          payoutAmount: "0",
          auditRoundId: null,
        });
      if (sound) sfx.chipStackPush();
      toast.success("Bets locked. Good luck!");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      draft.clear();
      placingRef.current = false;
      setPlacing(false);
      refreshWallet();
      round.refetch();
    }
  };
  useTimedBet({
    roundKey: roundId,
    deadline:
      phaseEndsAt == null
        ? null
        : toLocalTime(phaseEndsAt) - BET_SEND_BUFFER_MS,
    expiresAt: phaseEndsAt == null ? null : toLocalTime(phaseEndsAt) - 300,
    armed: draft.bets.length > 0,
    enabled: betting && !placing && myBets.length === 0,
    submit,
  });
  const stage = (
    bets: { type: CrazyTimeSpot; amountPaise: string }[],
    replace = false,
  ) => {
    void unlockAudio();
    if (!canEdit) return;
    if (!draft.stage(bets, replace))
      toast.error("Check your wallet balance and table limit.");
    else if (sound) sfx.chipPlace();
  };
  const amounts = new Map<CrazyTimeSpot, bigint>();
  for (const bet of [
    ...draft.bets,
    ...myBets
      .filter((s) => s.status !== "refunded")
      .flatMap((s) => s.bets as CrazyTimeBet[]),
  ]) {
    amounts.set(
      bet.type,
      (amounts.get(bet.type) ?? 0n) + BigInt(bet.amountPaise),
    );
  }
  const selectedTotal = [...amounts.values()].reduce((sum, n) => sum + n, 0n);
  const winningBet = myBets
    .flatMap((b) => b.bets as CrazyTimeBet[])
    .find((b) => b.type === outcome?.winner);
  const bonusChoice =
    winningBet?.choice ??
    (outcome?.winner === "cash-hunt" ? cashChoice : pointerChoice);
  const roundWin = useRoundWin({
    game: "crazy-time",
    userId: user?.id,
    roundId,
    eligible: phase === "settling" && landed,
    bets: myBets,
  });
  useEffect(() => {
    if (roundWin.win) {
      setSettingsOpen(false);
      setModal(null);
    }
  }, [roundWin.win]);
  const lossCue = useRef<string | null>(null);
  useEffect(() => {
    if (
      phase !== "settling" ||
      !landed ||
      !myBets.length ||
      myBets.some((b) => b.status !== "settled") ||
      lossCue.current === roundId
    )
      return;
    lossCue.current = roundId;
    if (sound && myBets.every((b) => BigInt(b.payoutAmount) === 0n))
      sfx.tableLose("crazy-time");
  }, [phase, landed, myBets, roundId, sound]);
  const repeat = () => {
    const last = lastBets ?? history.data?.[0]?.bets;
    if (!last) return;
    setCashChoice(
      last.find((b) => b.type === "cash-hunt")?.choice ?? cashChoice,
    );
    setPointerChoice(
      last.find((b) => b.type === "crazy-time")?.choice ?? pointerChoice,
    );
    stage(last, true);
  };
  const verify = async (id: string) => {
    setVerifying(true);
    setVerification(null);
    try {
      setVerification(
        await customFetch(`/api/crazy-time/${encodeURIComponent(id)}/verify`),
      );
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setVerifying(false);
    }
  };
  const unavailable = config.isError || (waited && !roundId);
  const status = unavailable
    ? "Table unavailable"
    : config.data?.enabled === false
      ? "Table paused"
      : !phase
        ? "Connecting to table"
        : betting
          ? myBets.length
            ? "Bets locked"
            : "Place your bets"
          : spinning
            ? "No more bets · wheel spinning"
            : landed
              ? `${label(outcome!.winner)} wins${phase === "settling" ? " · Next round" : ""}`
              : "Waiting for the wheel";
  const lastOutcome = landed ? outcome : prior;
  const rulesPaytable = (
    <table className="ct-paytable">
      <thead>
        <tr>
          <th>Spot</th>
          <th>Segments</th>
          <th>Theoretical RTP</th>
        </tr>
      </thead>
      <tbody>
        {CRAZY_TIME_SPOTS.map((s) => (
          <tr key={s.id}>
            <td>{s.label}</td>
            <td>{s.count}/54</td>
            <td>{(CRAZY_TIME_RTP[s.id] * 100).toFixed(2)}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="ct-page" data-testid="crazy-time-page">
      <header className="ct-header">
        <Link href="/" className="ct-icon-btn" aria-label="Back to lobby">
          <ArrowLeft size={20} />
        </Link>
        <div className="ct-brand-mark">
          <Sparkles size={20} />
        </div>
        <div className="ct-brand">
          <h1>CRAZY TIME</h1>
          <span>LUNAR ORIGINALS</span>
        </div>
        <div className="ct-wallet">
          <Wallet size={16} />
          <div>
            <span>BALANCE</span>
            <strong data-testid="crazy-balance">
              {balance.isError
                ? "Unavailable"
                : money(balance.data?.balance ?? "0")}
            </strong>
          </div>
        </div>
        <button
          className="ct-icon-btn"
          aria-label={sound ? "Mute sound" : "Enable sound"}
          aria-pressed={sound}
          onClick={() => {
            void unlockAudio();
            updateSettings({
              sound: !sound,
              ...(!sound && voiceVolume <= 0
                ? { masterVolume: 0.7, sfxVolume: 0.8 }
                : {}),
            });
          }}
        >
          {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
        </button>
        <button
          className="ct-icon-btn"
          aria-label="Game rules"
          onClick={() => setModal("rules")}
        >
          <CircleHelp size={19} />
        </button>
      </header>
      <main className="ct-layout">
        <div className="ct-table-column" data-game-screen="crazy-time">
          <section className="ct-studio" aria-label="Crazy Time wheel studio">
            <div className="ct-studio-topline">
              <span>
                <i /> VIRTUAL STUDIO
              </span>
              <span>54 SEGMENTS · 4 BONUS GAMES</span>
            </div>
            <div className="ct-studio-viewport">
              <StudioScene
                phase={phase}
                roundId={roundId}
                revealStartsAt={revealStartsAt}
                revealMs={revealMs}
                bettingEndsAt={
                  phase === "betting" && phaseEndsAt
                    ? toLocalTime(phaseEndsAt)
                    : null
                }
                bettingMs={
                  round.config?.bettingWindowMs ??
                  CRAZY_TIME_ROUND_TIMING.bettingWindowMs
                }
                playback={studioPlayback}
                sound={sound}
                volume={voiceVolume}
              >
                <CrazyWheel
                  outcome={phase === "betting" ? null : outcome}
                  previousSegment={prior?.segment ?? 0}
                  roundId={roundId}
                  spinning={spinning}
                  playback={studioPlayback}
                  revealEndsAt={revealEndsAt}
                  sound={sound}
                  onLand={onLand}
                />
              </StudioScene>
              {landed && outcome?.bonus && roundId && (
                <BonusRound
                  outcome={outcome}
                  choice={bonusChoice}
                  roundId={roundId}
                />
              )}
            </div>
            <div className="ct-studio-toolbar">
              <div className="ct-top-slot">
                <span>TOP SLOT</span>
                <div className={spinning ? "ct-slot-running" : ""}>
                  <b>
                    {outcome && phase !== "betting"
                      ? label(outcome.topSlot.spot)
                      : "?"}
                  </b>
                  <strong>
                    {outcome && phase !== "betting"
                      ? `${outcome.topSlot.multiplier}×`
                      : "?×"}
                  </strong>
                </div>
              </div>
              <div
                className={`ct-stage-status ${betting ? "ct-status-open" : ""}`}
              >
                <span>{status}</span>
                {(betting || phase === "settling") && (
                  <strong
                    aria-label={
                      betting
                        ? "Betting seconds remaining"
                        : "Next round in seconds"
                    }
                  >
                    {String(seconds).padStart(2, "0")}
                    <small>s</small>
                  </strong>
                )}
              </div>
            </div>
          </section>
          <div className="ct-result-strip">
            <span>LAST RESULTS</span>
            <div data-testid="crazy-results">
              {round.recent.length ? (
                round.recent.slice(0, 14).map((r) => {
                  const o = r.outcome as CrazyTimeOutcome | null;
                  const spot = CRAZY_TIME_SPOTS.find((s) => s.id === o?.winner);
                  return spot ? (
                    <button
                      key={r.roundId}
                      title={`${spot.label} · verify round`}
                      style={{ "--spot": spot.color } as CSSProperties}
                      onClick={() => {
                        setModal("fairness");
                        void verify(r.roundId);
                      }}
                    >
                      {spot.short}
                    </button>
                  ) : null;
                })
              ) : (
                <small>Results appear after the first round</small>
              )}
            </div>
            <button
              className="ct-icon-btn"
              aria-label="My bet history"
              onClick={() => setModal("history")}
            >
              <History size={16} />
            </button>
          </div>
          <section
            className="ct-betting"
            data-testid="crazy-betting"
            data-state={canEdit ? "open" : "closed"}
          >
            <div className="ct-bet-heading">
              <div>
                <i className={betting ? "ct-dot-open" : ""} />
                <strong>{status}</strong>
              </div>
              <span>
                <Clock3 size={13} />
                {phase === "betting" ? `${seconds}s` : "Next round shortly"}
              </span>
            </div>
            <div className="ct-timer-track">
              <div
                style={{
                  width: `${betting ? Math.min(100, (remainingMs / (round.config?.bettingWindowMs ?? 20000)) * 100) : 0}%`,
                }}
              />
            </div>
            <div className="ct-bet-grid">
              {CRAZY_TIME_SPOTS.map((spot) => (
                <button
                  key={spot.id}
                  className={`ct-bet-spot ${spot.profit == null ? "ct-bet-bonus" : ""}`}
                  data-testid={`crazy-spot-${spot.id}`}
                  data-winner={
                    (landed && outcome?.winner === spot.id) || undefined
                  }
                  data-selected={amounts.has(spot.id) || undefined}
                  style={{ "--spot": spot.color } as CSSProperties}
                  disabled={!canEdit}
                  onClick={() =>
                    stage([
                      { type: spot.id, amountPaise: rupeesToPaise(coins.chip) },
                    ])
                  }
                  aria-label={`Bet on ${spot.label}`}
                >
                  <span className="ct-spot-symbol">
                    {spot.profit == null
                      ? (
                          {
                            "coin-flip": "◉",
                            "cash-hunt": "✦",
                            pachinko: "⠿",
                            "crazy-time": "✷",
                          } as Record<string, string>
                        )[spot.id]
                      : spot.label}
                  </span>
                  {spot.profit == null && <b>{spot.label}</b>}
                  <small>
                    {spot.profit == null ? "BONUS" : `${spot.profit}:1`}
                  </small>
                  {amounts.has(spot.id) && (
                    <em data-testid={`crazy-stake-${spot.id}`}>
                      {money(amounts.get(spot.id)!)}
                    </em>
                  )}
                </button>
              ))}
            </div>
            <div className="ct-bet-hint">
              <span>
                Choose coins, then tap a spot. Bets submit at timer end.
              </span>
              <button onClick={() => setModal("picks")} disabled={!canEdit}>
                Bonus picks <span>↗</span>
              </button>
            </div>
            <fieldset disabled={!canEdit} className="ct-chip-rack">
              <ChipRack
                chip={coins.chip}
                onSelect={coins.selectChip}
                disabled={!canEdit}
                layout="fit"
                values={coins.values}
                showCustom={coins.showCustom}
              />
            </fieldset>
            <div className="ct-bet-footer">
              <CoinSettingsButton onClick={() => setSettingsOpen(true)} />
              <div className="ct-total">
                <span>{myBets.length ? "PLACED BET" : "SELECTED BET"}</span>
                <strong data-testid="crazy-total">
                  {money(selectedTotal)}
                </strong>
              </div>
              {myBets.length ? (
                <span className="ct-locked">
                  <ShieldCheck size={14} /> Confirmed
                </span>
              ) : (
                <AutoBetStatus
                  busy={placing}
                  selected={draft.bets.length > 0}
                  seconds={draft.bets.length ? seconds : null}
                  onCancel={draft.clear}
                />
              )}
              <button
                className="ct-rebet"
                aria-label="Repeat last bet"
                disabled={!canEdit || !(lastBets ?? history.data?.[0]?.bets)}
                onClick={repeat}
              >
                <RotateCcw size={15} />
                <span>Rebet</span>
              </button>
            </div>
            {unavailable && (
              <div className="ct-unavailable" role="alert">
                Could not connect to the table.{" "}
                <button
                  onClick={() => {
                    void config.refetch();
                    round.refetch();
                    void balance.refetch();
                  }}
                >
                  Reconnect
                </button>
              </div>
            )}
          </section>
        </div>
        <aside className="ct-sidebar">
          <div className="ct-side-card ct-show-card">
            <span className="ct-eyebrow">THE WHEEL IS YOURS</span>
            <h2>
              One spin.
              <br />
              <em>Endless possibilities.</em>
            </h2>
            <p>
              Four numbers. Four bonus worlds.
              <br />
              Pick your spot and enjoy the show.
            </p>
            <div>
              <Sparkles size={16} />
              <span>
                UP TO <b>5,000:1</b>
              </span>
            </div>
          </div>
          <div className="ct-side-card ct-last-win">
            <span className="ct-eyebrow">LAST WINNING SPOT</span>
            <strong>{lastOutcome ? label(lastOutcome.winner) : "—"}</strong>
            <small>
              {lastOutcome?.topSlot.spot === lastOutcome?.winner && lastOutcome
                ? `TOP SLOT ${lastOutcome.topSlot.multiplier}× BOOST`
                : "Every round is a fresh spin"}
            </small>
          </div>
          <LiveBetsPanel
            bets={round.liveBets}
            playerCount={round.playerCount}
            totalStake={round.totalStake}
            describeBets={describe}
            className="ct-live-bets"
            maxRows={5}
          />
          <div className="ct-side-card ct-your-bets">
            <span className="ct-eyebrow">YOUR ROUND</span>
            {myBets.length ? (
              myBets.map((b) => (
                <div key={b.slipId}>
                  <span>
                    {describe(b.bets)}
                    <small>{b.status}</small>
                  </span>
                  <b>
                    {money(
                      b.status === "settled" ? b.payoutAmount : b.totalStake,
                    )}
                  </b>
                </div>
              ))
            ) : (
              <p>Your confirmed bets appear here.</p>
            )}
          </div>
          <button
            className="ct-fairness-link"
            onClick={() => setModal("fairness")}
          >
            <ShieldCheck size={15} /> Round verification <span>↗</span>
          </button>
        </aside>
      </main>
      <footer className="ct-page-footer">
        <span>CRAZY TIME · VIRTUAL WHEEL</span>
        <button onClick={() => setModal("fairness")}>
          <ShieldCheck size={12} /> Verifiable rounds
        </button>
        <span>ROUND {roundId?.slice(-7).toUpperCase() ?? "—"}</span>
      </footer>
      <CoinSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        preferences={coins}
        onSave={coins.save}
      />
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent className="ct-dialog">
          <DialogTitle>
            {modal === "rules"
              ? "How to play"
              : modal === "picks"
                ? "Your bonus picks"
                : modal === "history"
                  ? "My recent bets"
                  : "Round verification"}
          </DialogTitle>
          <DialogDescription>
            {modal === "picks"
              ? "Choose before betting closes. Your selections lock with your bet."
              : modal === "fairness"
                ? "The seed commitment is published before bets are accepted."
                : modal === "history"
                  ? "Confirmed wallet settlements for your account."
                  : "An original virtual adaptation with a 54-segment wheel."}
          </DialogDescription>
          {modal === "rules" && (
            <div className="ct-rules">
              {rulesPaytable}
              <ol>
                <li>
                  Select a coin and tap one or more spots. Your combined bet is
                  sent automatically when the countdown ends.
                </li>
                <li>
                  Numbers pay 1:1, 2:1, 5:1 or 10:1 profit. A winning bet also
                  returns its original stake.
                </li>
                <li>
                  Top Slot picks a spot and a multiplier. A match multiplies
                  that spot’s profit, capped at 5,000:1.
                </li>
                <li>
                  Coin Flip pays the winning blue or red side. Cash Hunt reveals
                  your selected box from 108 prizes. Pachinko follows the puck
                  into a prize slot, with up to two doubles. Crazy Time pays
                  your green, blue or yellow pointer, with up to two
                  double/triple respins.
                </li>
                <li>
                  Choose your Cash Hunt box and Crazy Time pointer using Bonus
                  picks during betting. The default is box 1 and green. Picks
                  cannot change after the bet is accepted.
                </li>
                <li>
                  Only bets on the winning spot receive a payout. Wallets settle
                  automatically. Rebet stages your previous slip; it never
                  places a new round without a tap.
                </li>
              </ol>
              <p>
                Studio timing:{" "}
                {Math.round(
                  (round.config?.bettingWindowMs ??
                    CRAZY_TIME_ROUND_TIMING.bettingWindowMs) / 1000,
                )}
                s betting, {Math.round(revealMs / 1000)}s reveal,{" "}
                {Math.round(
                  (round.config?.settleDurationMs ??
                    CRAZY_TIME_ROUND_TIMING.settleDurationMs) / 1000,
                )}
                s result pause. Minimum{" "}
                {money(round.config?.minStakePaise ?? "100")} total and ₹1 per
                spot.
              </p>
              <p>
                This version uses its own published prize tables and an
                AI-generated video host. It is not the Evolution live feed.
              </p>
            </div>
          )}
          {modal === "picks" && (
            <div className="ct-pick-options">
              <h3>Crazy Time pointer</h3>
              <div className="ct-colour-picks">
                {["Green", "Blue", "Yellow"].map((name, i) => (
                  <button
                    key={name}
                    className={`ct-colour-${i}`}
                    aria-pressed={pointerChoice === i}
                    disabled={!canEdit}
                    onClick={() => setPointerChoice(i)}
                  >
                    {name}
                    {pointerChoice === i ? " ✓" : ""}
                  </button>
                ))}
              </div>
              <h3>Cash Hunt · box {cashChoice + 1}</h3>
              <div className="ct-cash-picks">
                {Array.from({ length: 108 }, (_, i) => (
                  <button
                    key={i}
                    aria-label={`Cash Hunt box ${i + 1}`}
                    aria-pressed={cashChoice === i}
                    disabled={!canEdit}
                    onClick={() => setCashChoice(i)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <button className="ct-primary" onClick={() => setModal(null)}>
                Save picks
              </button>
            </div>
          )}
          {modal === "history" && (
            <div className="ct-history">
              {history.isError ? (
                <p>History could not be loaded.</p>
              ) : history.data?.length ? (
                history.data.map((r) => (
                  <button
                    key={r.roundId}
                    onClick={() => {
                      setModal("fairness");
                      void verify(r.roundId);
                    }}
                  >
                    <span>
                      <b>{label(r.outcome.winner)}</b>
                      <small>Bet {money(r.totalStake)}</small>
                    </span>
                    <strong>{money(r.payoutAmount)}</strong>
                    <ShieldCheck size={14} />
                  </button>
                ))
              ) : (
                <p>No settled bets yet.</p>
              )}
            </div>
          )}
          {modal === "fairness" && (
            <div className="ct-fairness">
              <label>SERVER SEED HASH</label>
              <code>{round.serverSeedHash ?? "Waiting for a round"}</code>
              <label>CLIENT SEED</label>
              <code>{round.clientSeed ?? "—"}</code>
              <label>REVEALED SERVER SEED</label>
              <code>{round.serverSeed ?? "Hidden until betting closes"}</code>
              <p>
                HMAC-SHA256 with rejection sampling determines the wheel, Top
                Slot and bonus prizes. Your choices are recorded with your slip.
              </p>
              <button
                className="ct-primary"
                disabled={
                  verifying || !(landed ? roundId : round.recent[0]?.roundId)
                }
                onClick={() =>
                  void verify((landed ? roundId : round.recent[0]?.roundId)!)
                }
              >
                {verifying ? "Verifying…" : "Verify latest result"}
              </button>
              {verification && (
                <p
                  role="status"
                  className={
                    verification.verified
                      ? "ct-verified"
                      : "ct-verification-failed"
                  }
                >
                  {verification.verified
                    ? "✓ Seed and outcome verified; settled payouts match."
                    : "Verification failed. Contact support with this round ID."}
                  <code>{verification.roundId}</code>
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
