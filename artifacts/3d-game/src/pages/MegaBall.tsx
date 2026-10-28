import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import {
  CircleHelp,
  History,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Volume2,
  VolumeX,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  customFetch,
  useGetWalletBalance,
  getGetWalletBalanceQueryKey,
  getListMyBetsQueryKey,
  getListWalletTransactionsQueryKey,
} from "@workspace/api-client-react";
import {
  MEGA_BALL_PAYTABLE,
  MEGA_BALL_TIMING,
  megaBallCardResult,
  megaBallLines,
  type MegaBallCard,
  type MegaBallOutcome,
} from "@workspace/api-zod/mega-ball";
import { useAuth } from "@/lib/auth";
import { useTableRound, type MyBet } from "@/components/table/useTableRound";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatRupees } from "@/lib/format";
import { sfx, unlockAudio } from "@/game/audio";
import BallMachineScene from "@/components/megaBall/BallMachineScene";
import {
  advanceMachineClock,
  machineFrame,
} from "@/components/megaBall/machineTimeline";
import { useBallCall, useShowCalls } from "@/components/megaBall/useBallCall";
import "@/components/megaBall/mega-ball.css";

interface Config {
  enabled: boolean;
  minStakePaise: string;
  maxStakePaise: string;
}
interface Receipt {
  roundId: string;
  cards: MegaBallCard[];
  totalStake: string;
  payoutAmount: string;
  outcome: MegaBallOutcome;
  createdAt: string;
}
const prices = [1, 5, 10, 25, 50, 100, 500, 1000, 10000];
const money = (value: string | number) => `₹${formatRupees(String(value))}`;

function BingoCard({
  card,
  drawn,
  outcome,
  finished,
}: {
  card: MegaBallCard;
  drawn: number[];
  outcome: MegaBallOutcome | null;
  finished: boolean;
}) {
  const lines = megaBallLines(card.numbers, drawn);
  const winning = new Set(lines.flat());
  const result =
    finished && outcome ? megaBallCardResult(card.numbers, outcome) : null;
  return (
    <article
      className={`mb-card${result?.multiplier ? " is-winner" : ""}`}
      aria-label={`Bingo ${card.type}`}
    >
      <header>
        <span>{money(card.amountPaise)}</span>
        <span>{card.type.replace("card-", "#")}</span>
      </header>
      <div className="mb-card-grid">
        {card.numbers.map((n, index) => (
          <span
            key={index}
            className={`${drawn.includes(n) ? "is-marked" : ""} ${winning.has(index) ? "is-line" : ""} ${finished && n === outcome?.megaBall ? "is-mega-number" : ""}`}
          >
            {n}
          </span>
        ))}
      </div>
      <footer>
        {result?.multiplier
          ? `WIN ${money(Number(card.amountPaise) * result.multiplier)}`
          : lines.length
            ? `${lines.length} ${lines.length === 1 ? "LINE" : "LINES"}`
            : "MEGA BALL"}
      </footer>
    </article>
  );
}

export default function MegaBall() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const [sound, setSound] = useState(false);
  const [studioMotion, setStudioMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [modal, setModal] = useState<
    "rules" | "history" | "settings" | "fairness" | null
  >(null);
  const [count, setCount] = useState(0);
  const [priceIndex, setPriceIndex] = useState(0);
  const [page, setPage] = useState(0);
  const [compactCards, setCompactCards] = useState(
    () => window.matchMedia("(max-width: 480px)").matches,
  );
  const cardsPerPage = compactCards ? 2 : 4;
  useEffect(() => {
    const query = window.matchMedia("(max-width: 480px)");
    const changed = () => {
      setCompactCards(query.matches);
      setPage(0);
    };
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState("");
  const [last, setLast] = useState({ count: 1, priceIndex: 0 });
  const [accepted, setAccepted] = useState<
    (MyBet & { roundId: string }) | null
  >(null);
  const [verification, setVerification] = useState("");
  const busy = useRef(false);
  const balance = useGetWalletBalance(undefined, {
    query: {
      queryKey: getGetWalletBalanceQueryKey(),
      enabled: !!user,
      retry: false,
    },
  });
  const config = useQuery<Config>({
    queryKey: ["mega-ball", "config"],
    queryFn: () => customFetch("/api/mega-ball/config"),
    enabled: !!user,
    retry: false,
  });
  const history = useQuery<Receipt[]>({
    queryKey: ["mega-ball", "recent"],
    queryFn: () => customFetch("/api/mega-ball/recent"),
    enabled: !!user,
    retry: false,
  });
  const refresh = useCallback(() => {
    for (const key of [
      getGetWalletBalanceQueryKey(),
      getListMyBetsQueryKey(),
      getListWalletTransactionsQueryKey(),
      ["mega-ball", "recent"],
    ])
      void qc.invalidateQueries({ queryKey: key });
  }, [qc]);
  const round = useTableRound<MegaBallOutcome>("mega-ball", {
    enabled: !!user,
    onSettled: refresh,
    roundOpenVoice: false,
    roundClosedVoice: false,
  });
  const { roundId, phase, remainingMs, outcome } = round;
  const liveSlip =
    round.myBets[0] ?? (accepted?.roundId === roundId ? accepted : null);
  const cards = (liveSlip?.bets ?? []) as MegaBallCard[];
  const betting = round.bettingOpen && config.data?.enabled === true;
  const canEdit = betting && remainingMs > 1000 && !liveSlip && !placing;
  const unit = prices[priceIndex] * 100;
  const paytableUnit = cards[0] ? Number(cards[0].amountPaise) : unit;
  const total = count * unit;
  const revealDuration =
    round.config?.revealDurationMs ?? MEGA_BALL_TIMING.revealDurationMs;
  const [animationNow, setAnimationNow] = useState(Date.now);
  useEffect(() => {
    if (phase !== "reveal") return;
    let request = 0,
      previous = 0;
    const tick = (now: number) => {
      if (!document.hidden && now - previous >= 32) {
        previous = now;
        setAnimationNow(Date.now());
      }
      request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [phase, roundId]);
  const drawRemaining =
    round.phaseEndsAt == null
      ? remainingMs
      : round.toLocalTime(round.phaseEndsAt) - animationNow;
  const rawProgress =
    phase === "reveal"
      ? Math.max(0, Math.min(1, 1 - drawRemaining / revealDuration))
      : phase === "settling"
        ? 1
        : 0;
  const presentationClock = useRef({ roundId, progress: 0 });
  presentationClock.current = advanceMachineClock(
    presentationClock.current,
    roundId,
    rawProgress,
  );
  const progress = presentationClock.current.progress;
  const machine = machineFrame(phase === "betting" ? null : outcome, progress);
  const {
    normalCount: ballCount,
    multiplierVisible,
    megaVisible,
    drawn,
    current,
    resultVisible,
  } = machine;
  useBallCall(roundId, current, megaVisible, sound);
  useShowCalls(roundId, machine.stage, outcome?.multiplier ?? null, sound);
  const payout =
    liveSlip?.status === "settled" ? Number(liveSlip.payoutAmount) : 0;
  const settledKey = round.myBets
    .filter((b) => b.status === "settled" || b.status === "refunded")
    .map((b) => `${b.slipId}:${b.status}`)
    .join();
  useEffect(() => {
    document.title = "Mega Ball · Lunar Casino";
  }, []);
  useEffect(() => {
    const id = window.setInterval(round.refetch, 2000);
    return () => clearInterval(id);
  }, [round.refetch]);
  useEffect(() => {
    setCount(0);
    setPage(0);
    setError("");
    setVerification("");
  }, [roundId]);
  useEffect(() => {
    if (settledKey) refresh();
  }, [settledKey, refresh]);
  const draftStack = useRef<number[]>([]);
  useEffect(() => {
    draftStack.current = [];
  }, [roundId]);

  function addCards(amount: number) {
    if (!canEdit) return;
    if (count + amount > 100) {
      setError("You can buy up to 100 cards per round.");
      return;
    }
    draftStack.current.push(count);
    setCount(count + amount);
    setError("");
    if (sound) sfx.click();
  }
  async function buy() {
    if (!canEdit || busy.current || !roundId || count < 1) return;
    if (total > Number(balance.data?.balance ?? 0)) {
      setError(
        "Insufficient wallet balance. Choose fewer cards or a lower price.",
      );
      return;
    }
    if (
      total > Number(config.data?.maxStakePaise ?? 0) ||
      total < Number(config.data?.minStakePaise ?? 100)
    ) {
      setError("Your selected cards are outside the table limits.");
      return;
    }
    busy.current = true;
    setPlacing(true);
    setError("");
    const buyingRound = roundId;
    try {
      const receipt = await customFetch<{
        slipId: string;
        totalStake: string;
        cards: MegaBallCard[];
        status: string;
      }>("/api/mega-ball/bet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: buyingRound,
          count,
          amountPaise: String(unit),
        }),
      });
      setAccepted({
        roundId: buyingRound,
        slipId: receipt.slipId,
        totalStake: receipt.totalStake,
        bets: receipt.cards,
        status: receipt.status ?? "pending",
        payoutAmount: "0",
        auditRoundId: null,
      });
      setLast({ count, priceIndex });
      refresh();
      round.refetch();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? ((e.data as { detail?: string; error?: { message?: string } })
              ?.detail ??
              (e.data as { error?: { message?: string } })?.error?.message ??
              "Cards could not be confirmed. Please retry.")
          : "Connection interrupted. Retry to check your card purchase.",
      );
      round.refetch();
    } finally {
      busy.current = false;
      setPlacing(false);
    }
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setError("Full screen is unavailable in this browser.");
    }
  }
  async function verify() {
    const id = phase === "betting" ? round.recent[0]?.roundId : roundId;
    if (!id) {
      setVerification("A completed round is needed for verification.");
      return;
    }
    setVerification("Verifying…");
    try {
      const result = await customFetch<{ verified: boolean }>(
        `/api/mega-ball/${encodeURIComponent(id)}/verify`,
      );
      setVerification(
        result.verified
          ? "Verified: the committed draw and your settled payouts match."
          : "Verification failed. Please contact support with this round ID.",
      );
    } catch {
      setVerification("Verification is unavailable. Try again after the draw.");
    }
  }
  const status = !roundId
    ? "CONNECTING TO MEGA BALL"
    : liveSlip?.status === "refunded"
      ? "CARDS REFUNDED"
      : !config.data?.enabled
        ? "TABLE PAUSED"
        : phase === "betting"
          ? liveSlip
            ? "YOUR CARDS ARE CONFIRMED"
            : "BUY CARDS TO BET"
          : resultVisible
            ? liveSlip && liveSlip.status !== "settled"
              ? "CHECKING YOUR CARDS"
              : payout > 0
                ? `YOU WIN ${money(payout)}`
                : cards.length
                  ? "NO WINNING LINES"
                  : "ROUND COMPLETE"
            : machine.stage === "mixing"
              ? "NO MORE BETS"
              : machine.stage === "multiplier-opening"
                ? "MEGA MULTIPLIER"
                : machine.stage === "multiplier-spinning"
                  ? "SELECTING THE MULTIPLIER"
                  : machine.stage === "multiplier-selected"
                    ? `${outcome!.multiplier}x MULTIPLIER SELECTED`
                    : machine.stage === "mega-draw"
                      ? "MEGA BALL"
                      : machine.stage === "draw-complete"
                        ? "20 BALLS DRAWN"
                        : "DRAW IN PROGRESS";
  const historyMultipliers = round.recent
    .slice(0, 12)
    .map((r) => (r.outcome as MegaBallOutcome).multiplier);

  return (
    <div
      ref={root}
      className={`mega-game${multiplierVisible ? " is-bonus" : ""}`}
      data-testid="mega-ball-game"
      data-show-stage={machine.stage}
    >
      <div className="mb-stage">
        <div className="mb-studio-frame">
          <BallMachineScene
            roundId={roundId}
            frame={machine}
            motion={studioMotion}
            running={phase === "reveal"}
            multiplier={outcome?.multiplier ?? null}
          />
          {phase === "betting" && (
            <div
              className="mb-countdown"
              aria-label={`${Math.ceil(remainingMs / 1000)} seconds left to buy cards`}
            >
              <svg viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="44" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  style={{
                    strokeDashoffset:
                      277 *
                      (1 -
                        Math.min(
                          1,
                          remainingMs /
                            (round.config?.bettingWindowMs ?? 20000),
                        )),
                  }}
                />
              </svg>
              <strong>{Math.ceil(remainingMs / 1000)}</strong>
            </div>
          )}
          {multiplierVisible &&
            machine.camera !== "multiplier" &&
            machine.camera !== "wide" && (
              <div className="mb-multiplier" key={roundId}>
                <small>MEGA MULTIPLIER</small>
                <strong>
                  {outcome!.multiplier}
                  <em>x</em>
                </strong>
              </div>
            )}
          {current != null && (
            <div
              className={`mb-current-ball${megaVisible ? " is-mega" : ""}`}
              key={`${roundId}-${current}`}
            >
              <small>
                {megaVisible ? `${outcome!.multiplier}x` : `BALL ${ballCount}`}
              </small>
              <strong>{current}</strong>
            </div>
          )}
          {resultVisible && outcome && (
            <div
              className="mb-result-panel"
              role="status"
              data-testid="mega-ball-result"
            >
              <small>DRAW COMPLETE</small>
              <strong>
                MEGA BALL {outcome.megaBall} <span>{outcome.multiplier}x</span>
              </strong>
              {cards.length > 0 && liveSlip?.status === "settled" && (
                <b>
                  {payout > 0
                    ? `YOU WIN ${money(payout)}`
                    : "NO WINNING LINES THIS ROUND"}
                </b>
              )}
            </div>
          )}
        </div>
      </div>
      <header className="mb-topbar">
        <Link href="/" aria-label="Back to lobby" className="mb-icon">
          <X size={20} />
        </Link>
        <h1>
          Mega Ball{" "}
          <span>
            {money(config.data?.minStakePaise ?? "100")}–
            {money(config.data?.maxStakePaise ?? "1000000")}
          </span>
        </h1>
        <span className="mb-new">NEW</span>
        <div className="mb-tools">
          <button
            className="mb-icon"
            onClick={() => {
              unlockAudio();
              setSound((v) => !v);
            }}
            aria-label={sound ? "Mute sound" : "Enable sound"}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button
            className="mb-icon"
            onClick={() => setModal("settings")}
            aria-label="Game settings"
          >
            <Settings2 size={18} />
          </button>
          <button
            className="mb-icon"
            onClick={() => setModal("history")}
            aria-label="Round history"
          >
            <History size={18} />
          </button>
          <button
            className="mb-icon"
            onClick={() => setModal("rules")}
            aria-label="How to play"
          >
            <CircleHelp size={19} />
          </button>
          <button
            className="mb-icon mb-fullscreen"
            onClick={fullscreen}
            aria-label="Full screen"
          >
            <Maximize size={18} />
          </button>
        </div>
      </header>
      <div className="mb-round-id">
        {roundId
          ? `ROUND ${roundId.slice(-9).toUpperCase()}`
          : "ESTABLISHING CONNECTION"}
      </div>
      <main className="mb-dock">
        <section className="mb-paytable" aria-label="Pay table">
          <h2>
            {multiplierVisible ? "Mega Pay table" : "Pay table"}
            <button
              aria-label="Pay table rules"
              onClick={() => setModal("rules")}
            >
              <CircleHelp size={14} />
            </button>
          </h2>
          <div>
            {[6, 5, 4, 3, 2, 1].map((lines) => (
              <p key={lines}>
                <span>
                  {lines === 6 ? "6+" : lines} {lines === 1 ? "line" : "lines"}
                </span>
                <strong>
                  {money(
                    MEGA_BALL_PAYTABLE[lines] *
                      paytableUnit *
                      (multiplierVisible ? outcome!.multiplier : 1),
                  )}
                </strong>
              </p>
            ))}
          </div>
          <button className="mb-fair-link" onClick={() => setModal("fairness")}>
            <ShieldCheck size={13} /> Verifiable draw
          </button>
        </section>
        <section className="mb-play-area">
          <div
            className={`mb-status${payout > 0 ? " is-win" : ""}`}
            role="status"
          >
            {status}
          </div>
          {cards.length > 0 ? (
            <>
              <div className={`mb-cards${compactCards ? " is-compact" : ""}`}>
                {cards
                  .slice(page * cardsPerPage, (page + 1) * cardsPerPage)
                  .map((card) => (
                    <BingoCard
                      key={card.type}
                      card={card}
                      drawn={drawn}
                      outcome={outcome}
                      finished={resultVisible}
                    />
                  ))}
              </div>
              <div className="mb-card-navigation">
                <button
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  aria-label="Previous cards"
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {cards.length} {cards.length === 1 ? "card" : "cards"} ·{" "}
                  {page + 1}/{Math.ceil(cards.length / cardsPerPage)}
                </span>
                <button
                  disabled={(page + 1) * cardsPerPage >= cards.length}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next cards"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mb-pack-options">
                {[1, 10, 25, 100].map((amount) => (
                  <button
                    key={amount}
                    disabled={!canEdit || count + amount > 100}
                    onClick={() => addCards(amount)}
                    aria-label={`Add ${amount} ${amount === 1 ? "card" : "cards"}`}
                  >
                    <div className="mb-pack-art">
                      <i />
                      <i />
                      <i />
                      <span>✦</span>
                    </div>
                    <div>
                      <strong>{amount}</strong>
                      <span>{amount === 1 ? "Card" : "Cards"}</span>
                      <b>ADD</b>
                    </div>
                    <small>Total {money(amount * unit)}</small>
                  </button>
                ))}
              </div>
              <div className="mb-purchase-line">
                <span>
                  {count
                    ? `${count} cards selected · ${money(total)}`
                    : "Select your cards for the next draw"}
                </span>
                <button
                  onClick={buy}
                  disabled={
                    !canEdit ||
                    count === 0 ||
                    total > Number(balance.data?.balance ?? 0) ||
                    total > Number(config.data?.maxStakePaise ?? 0)
                  }
                >
                  {placing
                    ? "CONFIRMING…"
                    : count
                      ? `BUY ${count} ${count === 1 ? "CARD" : "CARDS"}`
                      : "SELECT CARDS"}
                </button>
              </div>
              <div className="mb-controls">
                <button
                  disabled={!canEdit || !count}
                  onClick={() => setCount(draftStack.current.pop() ?? 0)}
                >
                  <RotateCcw size={16} /> UNDO
                </button>
                <div className="mb-stake">
                  <button
                    disabled={!canEdit || priceIndex === 0}
                    onClick={() => setPriceIndex((p) => p - 1)}
                    aria-label="Decrease card price"
                  >
                    <Minus size={16} />
                  </button>
                  <span>
                    PER CARD<strong>{money(unit)}</strong>
                  </span>
                  <button
                    disabled={!canEdit || priceIndex === prices.length - 1}
                    onClick={() => setPriceIndex((p) => p + 1)}
                    aria-label="Increase card price"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <button
                  disabled={!canEdit}
                  onClick={() => {
                    draftStack.current.push(count);
                    setCount(last.count);
                    setPriceIndex(last.priceIndex);
                  }}
                >
                  <History size={16} /> REPEAT
                </button>
              </div>
            </>
          )}
          {error && (
            <p className="mb-error" role="alert">
              {error}
            </p>
          )}
          {!roundId && (
            <button
              className="mb-reconnect"
              onClick={() => {
                round.refetch();
                void config.refetch();
              }}
            >
              Reconnect to table
            </button>
          )}
        </section>
        <section className="mb-draw-panel" aria-label="Drawn balls">
          {phase === "betting" || !outcome ? (
            <>
              <h2>Recent multipliers</h2>
              <div className="mb-recent">
                {historyMultipliers.length ? (
                  historyMultipliers.map((m, i) => (
                    <span key={i} className={m >= 20 ? "is-high" : ""}>
                      {m}x
                    </span>
                  ))
                ) : (
                  <p>The first completed draw will appear here.</p>
                )}
              </div>
              <p className="mb-round-note">
                20 balls. One Mega Ball.
                <br />
                Complete a line to win.
              </p>
            </>
          ) : (
            <>
              <h2>
                {megaVisible
                  ? "Mega Ball"
                  : multiplierVisible
                    ? "Multiplier selected"
                    : `Balls left: ${20 - ballCount}`}
              </h2>
              <div className="mb-drawn-balls">
                {outcome.balls.slice(0, ballCount).map((n, i) => (
                  <span
                    key={n}
                    className={`mb-small-ball color-${n % 3}`}
                    style={{
                      animationDelay: `${i === ballCount - 1 ? 0 : -1}s`,
                    }}
                  >
                    {n}
                  </span>
                ))}
                {megaVisible && (
                  <span className="mb-small-ball mb-mega-small">
                    {outcome.megaBall}
                    <b>{outcome.multiplier}x</b>
                  </span>
                )}
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="mb-bottom">
        <div>
          <span>
            BALANCE
            <strong>
              {user?.isDemo
                ? "∞ Demo coins"
                : balance.data
                  ? money(balance.data.balance)
                  : "—"}
            </strong>
          </span>
          <span>
            TOTAL BET<strong>{money(liveSlip?.totalStake ?? 0)}</strong>
          </span>
        </div>
        <small>51 balls · 5 × 5 cards</small>
        <Link href="/" className="mb-lobby">
          ‹ LOBBY
        </Link>
      </footer>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent className="mb-dialog">
          <DialogTitle>
            {modal === "rules"
              ? "How to play Mega Ball"
              : modal === "history"
                ? "Your round history"
                : modal === "fairness"
                  ? "Verifiable draw"
                  : "Game settings"}
          </DialogTitle>
          <DialogDescription>
            {modal === "rules"
              ? "Choose your cards. Follow the draw. Watch for the Mega Ball."
              : modal === "history"
                ? "Your latest 20 settled rounds and wallet returns."
                : modal === "fairness"
                  ? "Every draw is committed before card purchases close."
                  : "Make the studio comfortable for you."}
          </DialogDescription>
          {modal === "rules" && (
            <div className="mb-rules">
              <ol>
                <li>
                  Choose a price per card and add 1, 10, 25 or 100 cards. You
                  can buy up to 100 cards in a round.
                </li>
                <li>
                  Press Buy Cards before the countdown ends. Confirmed cards are
                  charged to your wallet and cannot be changed.
                </li>
                <li>
                  Each card contains 25 numbers from 1–51. Twenty unique balls
                  are drawn. Matches are marked automatically.
                </li>
                <li>
                  Complete horizontal, vertical or diagonal lines. The highest
                  line-count award per card pays 1×, 5×, 50×, 250×, 1,000× or
                  10,000× for 1–6+ lines.
                </li>
                <li>
                  A multiplier from 5× to 100× is selected, followed by a new
                  Mega Ball. If it completes an additional line, the card's
                  award receives that multiplier.
                </li>
                <li>
                  Returns include the card stake. Each winning card pays
                  separately. Winnings are credited automatically after the
                  draw; reconnecting restores confirmed cards.
                </li>
              </ol>
              <p>
                The glass machine and all 51 numbered balls are generated in
                real time. One ball leaves at a time. The machine, spoken
                number, drawn-ball list and card marks follow the same server
                draw.
              </p>
            </div>
          )}
          {modal === "settings" && (
            <div className="mb-settings">
              <label>
                Draw sound and number calls
                <button
                  onClick={() => {
                    unlockAudio();
                    setSound((v) => !v);
                  }}
                  aria-label="Draw sound effects"
                  aria-pressed={sound}
                >
                  {sound ? "ON" : "OFF"}
                </button>
              </label>
              <label>
                Machine motion
                <button
                  onClick={() => setStudioMotion((v) => !v)}
                  aria-label="Machine motion"
                  aria-pressed={studioMotion}
                >
                  {studioMotion ? "ON" : "OFF"}
                </button>
              </label>
              <p>
                Machine motion starts paused when your device requests reduced
                motion. Number calls use your device's English voice when sound
                is on.
              </p>
              <button onClick={fullscreen}>Toggle full screen</button>
            </div>
          )}
          {modal === "history" && (
            <div className="mb-history">
              {history.isLoading ? (
                <p>Loading rounds…</p>
              ) : history.isError ? (
                <button onClick={() => void history.refetch()}>
                  Retry history
                </button>
              ) : !history.data?.length ? (
                <p>
                  No completed rounds yet. Your confirmed cards will appear here
                  after settlement.
                </p>
              ) : (
                history.data.map((receipt) => (
                  <article key={receipt.roundId}>
                    <div>
                      <b>
                        {receipt.cards.length} cards ·{" "}
                        {receipt.outcome.multiplier}x
                      </b>
                      <small>
                        {new Date(receipt.createdAt).toLocaleString()}
                      </small>
                    </div>
                    <span>
                      Bet {money(receipt.totalStake)}
                      <strong
                        className={Number(receipt.payoutAmount) ? "win" : ""}
                      >
                        Return {money(receipt.payoutAmount)}
                      </strong>
                    </span>
                  </article>
                ))
              )}
            </div>
          )}
          {modal === "fairness" && (
            <div className="mb-fairness">
              <p>
                The draw uses a committed server seed. Cards use a separate
                deterministic seed. Neither card quantities nor stakes change
                the draw.
              </p>
              <label>
                Current commitment
                <code>{round.serverSeedHash ?? "Connecting…"}</code>
              </label>
              <button onClick={verify}>
                Verify {phase === "betting" ? "previous" : "current"} round
              </button>
              <p role="status">{verification}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
