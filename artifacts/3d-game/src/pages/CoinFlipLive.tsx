import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CircleHelp,
  History,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Volume2,
  VolumeX,
  Wallet,
} from "lucide-react";
import {
  customFetch,
  getGetWalletBalanceQueryKey,
  useGetWalletBalance,
} from "@workspace/api-client-react";
import {
  collectionPayout,
  coinLiveMultiplier,
  type CoinSide,
  type CoinLiveInput,
  type CoinLiveOutcome,
  type CoinLiveReceipt,
  type CollectionConfig,
} from "@workspace/api-zod/instant-collection";
import { useAuth } from "@/lib/auth";
import { formatRupees } from "@/lib/format";
import { store, useStore } from "@/game/store";
import { unlockAudio, playGameSound } from "@/game/audio";
import { updateSettings } from "@/game/engine";
import { B2C_BRAND, B2C_STANDALONE } from "@/components/b2c/config";
import ChipRack from "@/components/table/chips";
import type { TableRoundSnapshot } from "@/components/table/useTableRound";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { errorMessage } from "@/components/instant/InstantGame";
import StadiumRoundVideo from "@/components/instant/StadiumRoundVideo";
import {
  useCoinAutoBet,
  type CoinAutoPlan,
} from "@/components/instant/useCoinAutoBet";
import "@/components/instant/coin-flip.css";
import "@/components/instant/coin-stadium.css";
import "@/components/instant/coin-live.css";

const endpoint = "/api/instant/coin-flip";
const money = (p: string | bigint) => `₹${formatRupees(String(p))}`;
const face = (side: CoinSide) =>
  `${import.meta.env.BASE_URL}media/instant/coin-${side}.svg`;
const paiseOf = (s: string) =>
  /^\d+(\.\d{1,2})?$/.test(s) &&
  Number.isSafeInteger(Math.round(Number(s) * 100))
    ? BigInt(Math.round(Number(s) * 100))
    : null;

export default function CoinFlipLive() {
  const { user } = useAuth(),
    qc = useQueryClient();
  const pendingKey = `coin-live:pending:${user?.id}`;
  const config = useQuery({
    queryKey: ["coin-live-config"],
    queryFn: () => customFetch<CollectionConfig>(`${endpoint}/config`),
    retry: false,
    refetchInterval: 30000,
  });
  const table = useQuery({
    queryKey: ["coin-live-round", user?.id],
    queryFn: () =>
      customFetch<TableRoundSnapshot | null>(`${endpoint}/live/round`),
    retry: false,
    refetchInterval: 700,
    refetchIntervalInBackground: false,
  });
  const history = useQuery({
    queryKey: ["coin-live-history", user?.id],
    queryFn: () =>
      customFetch<{ history: CoinLiveReceipt[] }>(`${endpoint}/live/state`),
    retry: false,
    refetchInterval: 1500,
    refetchIntervalInBackground: false,
  });
  const wallet = useGetWalletBalance(
    { game: "lunar" },
    {
      query: {
        queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }),
        enabled: !!user,
        retry: false,
      },
    },
  );
  const [pending, setPending] = useState<CoinLiveInput | null>(() => {
    try {
      const p = JSON.parse(localStorage.getItem(pendingKey) ?? "null");
      return p?.roundId &&
        ["heads", "tails"].includes(p.side) &&
        /^[1-9]\d{0,14}$/.test(p.stakeAmount)
        ? p
        : null;
    } catch {
      return null;
    }
  });
  const [stake, setStake] = useState(() =>
    pending ? (Number(pending.stakeAmount) / 100).toFixed(2) : "100",
  );
  const [side, setSide] = useState<CoinSide>(pending?.side ?? "heads");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [confirmedId, setConfirmedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [panel, setPanel] = useState<"rules" | "history" | "fairness" | null>(
    null,
  );
  const [motion, setMotion] = useState(
      !matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [animation, setAnimation] = useState(true);
  const [autoRounds, setAutoRounds] = useState("10"),
    [lossLimit, setLossLimit] = useState(""),
    [profitTarget, setProfitTarget] = useState("");
  const sound = useStore((s) => s.settings.sound);
  const lock = useRef(false),
    mounted = useRef(true),
    heard = useRef(new Set<string>());
  const snapshot = table.data,
    myBet = snapshot?.myBets[0];
  const serverNow = now + (snapshot ? snapshot.now - table.dataUpdatedAt : 0);
  const fresh =
    !!snapshot && !table.isError && now - table.dataUpdatedAt < 4000;
  const open =
    fresh &&
    snapshot.phase === "betting" &&
    snapshot.bettingEndsAt - serverNow > 1200;
  const confirmed = !!myBet || confirmedId === snapshot?.roundId;
  const outcome = fresh ? (snapshot?.outcome as CoinLiveOutcome | null) : null;
  const phase = !fresh
    ? "offline"
    : outcome
      ? "result"
      : snapshot.phase === "betting"
        ? "betting"
        : "toss";
  const countdown = snapshot
    ? Math.max(
        0,
        Math.ceil(
          ((phase === "betting"
            ? snapshot.bettingEndsAt
            : phase === "toss"
              ? snapshot.revealEndsAt
              : snapshot.settleEndsAt) -
            serverNow) /
            1000,
        ),
      )
    : 0;
  const configNow = snapshot
    ? {
        enabled: config.data?.enabled ?? false,
        minStakePaise: snapshot.config.minStakePaise,
        maxStakePaise: snapshot.config.maxStakePaise,
        rtp: 1 - snapshot.config.houseEdge,
        maxMultiplier: snapshot.config.maxMultiplier,
      }
    : config.data;
  const stakePaise = paiseOf(stake);
  const valid =
    stakePaise !== null &&
    stakePaise > 0n &&
    !!configNow &&
    stakePaise >= BigInt(configNow.minStakePaise) &&
    stakePaise <= BigInt(configNow.maxStakePaise);
  const enough =
    stakePaise !== null &&
    wallet.data !== undefined &&
    stakePaise <= BigInt(wallet.data.balance);
  const ready =
    fresh && !!configNow?.enabled && !!wallet.data && !wallet.isError;
  const canBet =
    ready && open && !confirmed && !busy && !pending && valid && enough;
  const ownHistory = history.data?.history ?? [];
  const latestReceipt = ownHistory[0];
  const receipt = ownHistory.find((r) => r.tableRoundId === snapshot?.roundId);
  const multiplier = configNow
    ? coinLiveMultiplier(configNow.rtp, configNow.maxMultiplier)
    : null;
  const potential =
    stakePaise !== null && multiplier !== null
      ? collectionPayout(stakePaise, multiplier)
      : null;
  const remember = (value: CoinLiveInput | null) => {
    setPending(value);
    try {
      value
        ? localStorage.setItem(pendingKey, JSON.stringify(value))
        : localStorage.removeItem(pendingKey);
    } catch {
      /* Retry still has the in-memory round identity. */
    }
  };
  const refreshWallet = () => {
    void qc.invalidateQueries({ queryKey: getGetWalletBalanceQueryKey() });
    void qc.invalidateQueries({ queryKey: ["/api/wallet/balances"] });
  };
  const refresh = () => {
    setError("");
    void table.refetch();
    void history.refetch();
    void config.refetch();
    refreshWallet();
  };
  async function submit(plan?: CoinAutoPlan): Promise<boolean> {
    if (lock.current || !mounted.current) return false;
    const input =
      pending ??
      (snapshot && {
        roundId: snapshot.roundId,
        side: plan?.side ?? side,
        stakeAmount: plan?.stakeAmount ?? String(stakePaise),
      });
    if (
      !input ||
      (!pending && (!ready || !open || confirmed || !valid || !enough))
    )
      return false;
    lock.current = true;
    setBusy(true);
    setError("");
    remember(input);
    try {
      const accepted = await customFetch<{ roundId: string; status: string }>(
        `${endpoint}/live/bet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!mounted.current) return true;
      remember(null);
      setConfirmedId(accepted.roundId);
      void table.refetch();
      void history.refetch();
      refreshWallet();
      if (store.getState().settings.sound) {
        void unlockAudio();
        playGameSound("bet", "coin-flip");
      }
      return true;
    } catch (e) {
      if (!mounted.current) return false;
      const status = (e as { status?: number }).status;
      if (
        status &&
        status >= 400 &&
        status < 500 &&
        ![408, 429].includes(status)
      )
        remember(null);
      setError(errorMessage(e));
      void table.refetch();
      void history.refetch();
      refreshWallet();
      return false;
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const auto = useCoinAutoBet({
    roundId: snapshot?.roundId,
    open,
    fresh,
    confirmed,
    pending: !!pending,
    busy,
    balance: wallet.data?.balance,
    enabled: !!configNow?.enabled,
    valid,
    error: !!error || wallet.isError || history.isError,
    submit: (plan) => submit(plan),
    receipt: latestReceipt
      ? {
          id: latestReceipt.tableRoundId,
          stakeAmount: latestReceipt.stakeAmount,
          payoutAmount: latestReceipt.payoutAmount,
        }
      : undefined,
  });
  const locked = busy || !!pending || confirmed || !open || !!auto.plan;
  const roundsValid =
    /^[1-9]\d{0,3}$/.test(autoRounds) && Number(autoRounds) <= 1000;
  const loss = lossLimit === "" ? null : paiseOf(lossLimit),
    target = profitTarget === "" ? null : paiseOf(profitTarget);
  const limitsValid =
    (lossLimit === "" || (loss !== null && loss > 0n)) &&
    (profitTarget === "" || (target !== null && target > 0n));
  const startAuto = () => {
    if (
      !ready ||
      !valid ||
      !enough ||
      !roundsValid ||
      !limitsValid ||
      !stakePaise
    )
      return;
    void unlockAudio();
    auto.start({
      side,
      stakeAmount: String(stakePaise),
      remaining: Number(autoRounds),
      stopLoss: loss,
      profitTarget: target,
      profit: 0n,
    });
  };
  const clampStake = (v: number) =>
    setStake(
      Math.max(
        0,
        Math.min(
          Number(wallet.data?.balance ?? 0) / 100,
          Number(configNow?.maxStakePaise ?? 0) / 100,
          Math.max(Number(configNow?.minStakePaise ?? 100) / 100, v),
        ),
      ).toFixed(2),
    );
  useEffect(() => {
    mounted.current = true;
    document.title = "Coin Flip · 30 Second Stadium";
    const timer = setInterval(() => setNow(Date.now()), 150);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    const m = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setMotion(!m.matches);
    m.addEventListener("change", change);
    return () => m.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!pending) return;
    const recovered =
      (pending.roundId === snapshot?.roundId && !!myBet) ||
      ownHistory.some((r) => r.tableRoundId === pending.roundId);
    if (recovered) {
      remember(null);
      setError("");
      refreshWallet();
    }
  }, [
    pending?.roundId,
    snapshot?.roundId,
    myBet?.slipId,
    history.dataUpdatedAt,
  ]);
  useEffect(() => {
    if (myBet) {
      refreshWallet();
      const entry = (myBet.bets as { side: CoinSide }[])[0];
      if (entry) {
        setSide(entry.side);
        setStake((Number(myBet.totalStake) / 100).toFixed(2));
      }
    }
  }, [myBet?.slipId, myBet?.status]);
  useEffect(() => {
    if (!receipt || !outcome || heard.current.has(receipt.requestId)) return;
    heard.current.add(receipt.requestId);
    refreshWallet();
    // Joining a result does not replay a win sound; only a bet seen during this visit does.
    if (confirmedId === receipt.tableRoundId && store.getState().settings.sound)
      playGameSound(receipt.status === "won" ? "win" : "crash", "coin-flip");
  }, [receipt?.requestId, outcome?.side]);
  const toggleSound = () => {
    void unlockAudio();
    updateSettings({ sound: !sound });
  };
  const publicResults = snapshot?.recent ?? [];
  const betSide = (myBet?.bets as { side: CoinSide }[] | undefined)?.[0]?.side;
  const errorText =
    error ||
    (table.isError || config.isError || wallet.isError
      ? "Connection interrupted. Betting is paused."
      : "");
  return (
    <div className="cf-page cfl-page" data-testid="collection-page">
      <header className="cf-header">
        <div className="cf-brand">
          <Link href="/" className="cf-icon" aria-label="Back to lobby">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <span>{B2C_STANDALONE ? B2C_BRAND : "LUNAR"} ORIGINALS</span>
            <h1>
              Coin Flip <span className="cf-edition">30 SEC</span>
            </h1>
          </div>
        </div>
        <div className="cf-header-tools">
          <div className="cf-wallet">
            <Wallet size={18} />
            <div>
              <small>YOUR BALANCE</small>
              <strong data-testid="collection-balance">
                {wallet.data ? money(wallet.data.balance) : "Connecting…"}
              </strong>
            </div>
          </div>
          <button
            className="cf-icon"
            aria-label="Game rules"
            onClick={() => setPanel("rules")}
          >
            <CircleHelp size={20} />
          </button>
          <button
            className="cf-icon"
            aria-label={sound ? "Mute sound" : "Enable sound"}
            onClick={toggleSound}
          >
            {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
        </div>
      </header>
      <main className="cf-layout">
        <section
          className="cf-experience"
          aria-label="Cricket stadium coin toss"
        >
          <div
            className={`cf-stadium cfl-stadium ${phase === "toss" ? "is-tossing" : ""} ${outcome ? "has-result" : ""}`}
            data-testid="coin-stadium"
          >
            <StadiumRoundVideo
              roundId={snapshot?.roundId}
              phase={phase}
              elapsed={snapshot ? serverNow - snapshot.bettingEndsAt : 0}
              side={outcome?.side ?? null}
              motion={motion && animation}
            />
            <div className="cf-stadium-heading">
              <span className="cf-eyebrow">THE MATCH-DAY TOSS</span>
              <h2>
                Make
                <br />
                <em>the call.</em>
              </h2>
              <p>A new result every 30 seconds.</p>
            </div>
            <div className="cf-stadium-caption">
              <span>AI HOST</span>
              <small>Shared stadium rounds</small>
            </div>
            <button
              className="cf-stadium-toggle"
              aria-label={
                animation ? "Disable toss animation" : "Enable toss animation"
              }
              onClick={() => setAnimation((v) => !v)}
            >
              {animation ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <div
              className={`cfl-clock is-${phase}`}
              data-testid="coin-round-clock"
            >
              <span>
                {phase === "offline"
                  ? "CONNECTING"
                  : phase === "betting"
                    ? "BETS CLOSE IN"
                    : phase === "toss"
                      ? "RESULT IN"
                      : "NEXT ROUND IN"}
              </span>
              <strong>{fresh ? `${countdown}s` : "—"}</strong>
              <small>30-second rounds</small>
            </div>
            <div
              className="cf-result cfl-result"
              role="status"
              aria-live="polite"
              data-testid="collection-result"
            >
              <span className="cf-eyebrow">
                {outcome
                  ? `${outcome.side.toUpperCase()} LANDED${betSide ? ` · YOU PICKED ${betSide.toUpperCase()}` : ""}`
                  : phase === "toss"
                    ? "WATCH THE TOSS"
                    : confirmed
                      ? "YOUR BET IS IN"
                      : phase === "betting"
                        ? "BETTING OPEN"
                        : "CONNECTING TO THE TABLE"}
              </span>
              <strong>
                {outcome
                  ? myBet?.status === "settled"
                    ? BigInt(myBet.payoutAmount) > 0n
                      ? `${money(myBet.payoutAmount)} returned`
                      : "Round over · no win"
                    : outcome.side.toUpperCase()
                  : phase === "toss"
                    ? "Up, catch… reveal."
                    : confirmed
                      ? "Ready for the toss"
                      : "Heads or tails?"}
              </strong>
              <small>
                {outcome
                  ? myBet?.status === "pending"
                    ? "Settling your bet…"
                    : "The result is on her palm"
                  : confirmed
                    ? `${(betSide ?? side).toUpperCase()} · ${money(myBet?.totalStake ?? stakePaise ?? 0n)} confirmed`
                    : "Choose a side. Join this round."}
              </small>
            </div>
          </div>
          <div className="cf-recent">
            <div>
              <History size={15} />
              <span>Recent results</span>
            </div>
            <div className="cf-recent-coins">
              {publicResults.length ? (
                publicResults.slice(0, 10).map((r) => (
                  <span
                    key={r.roundId}
                    title={(r.outcome as CoinLiveOutcome).side.toUpperCase()}
                  >
                    <img
                      src={face((r.outcome as CoinLiveOutcome).side)}
                      alt={(r.outcome as CoinLiveOutcome).side}
                    />
                  </span>
                ))
              ) : (
                <small>First result coming soon</small>
              )}
            </div>
            <button
              className="cf-icon"
              aria-label="Recent rounds"
              onClick={() => setPanel("history")}
            >
              <ArrowUpRight size={18} />
            </button>
          </div>
        </section>
        <section className="cf-bet-panel" aria-label="Place a Coin Flip bet">
          <div className="cf-panel-title">
            <span>MAKE YOUR CALL</span>
            <ShieldCheck size={17} />
          </div>
          <div className="cf-step">
            <span>01</span>
            <h3>Choose your side</h3>
            <small>50 / 50 chance</small>
          </div>
          <div className="cf-choices">
            {(["heads", "tails"] as CoinSide[]).map((s) => (
              <button
                key={s}
                className={`cf-choice ${side === s ? "is-selected" : ""}`}
                aria-label={`Bet on ${s === "heads" ? "Heads" : "Tails"}`}
                aria-pressed={side === s}
                disabled={locked}
                onClick={() => setSide(s)}
              >
                <span className="cf-choice-check">
                  {side === s && <Check size={12} />}
                </span>
                <img src={face(s)} alt="" />
                <strong>{s.toUpperCase()}</strong>
                <small>{multiplier?.toFixed(2) ?? "—"}× return</small>
              </button>
            ))}
          </div>
          <div className="cf-step cf-stake-step">
            <span>02</span>
            <h3>Set your stake</h3>
          </div>
          <label className="cf-amount-label" htmlFor="coin-stake">
            Bet amount <small>INR</small>
          </label>
          <div className="cf-amount">
            <span>₹</span>
            <input
              id="coin-stake"
              aria-label="Bet amount"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              inputMode="decimal"
              disabled={locked}
            />
            <button
              aria-label="Halve bet"
              disabled={locked || !valid}
              onClick={() => clampStake(Number(stake) / 2)}
            >
              ½
            </button>
            <button
              aria-label="Double bet"
              disabled={locked || !valid}
              onClick={() => clampStake(Number(stake) * 2)}
            >
              2×
            </button>
          </div>
          <div className="cf-limits">
            <span>
              {configNow
                ? `Min ${money(configNow.minStakePaise)} · Max ${money(configNow.maxStakePaise)}`
                : "Loading limits…"}
            </span>
            <button
              disabled={locked}
              onClick={() => clampStake(Infinity)}
              aria-label="Maximum bet"
            >
              MAX
            </button>
          </div>
          <ChipRack
            chip={Number(stake) || 0}
            onSelect={(v) => setStake(String(v))}
            disabled={locked || !ready}
            layout="fit"
            minValue={Number(configNow?.minStakePaise ?? 100) / 100}
            maxValue={
              Math.min(
                Number(wallet.data?.balance ?? 0),
                Number(configNow?.maxStakePaise ?? 0),
              ) / 100
            }
            idSuffix="-coin-flip"
          />
          <div className="cf-return">
            <div>
              <span>Total return on a win</span>
              <small>Includes your stake</small>
            </div>
            <strong data-testid="coin-potential-return">
              {potential === null ? "—" : money(potential)}
            </strong>
          </div>
          {errorText && (
            <div className="cf-error" role="alert">
              <span>{errorText}</span>
              <button onClick={refresh} disabled={busy}>
                <RefreshCw size={14} /> Reconnect
              </button>
            </div>
          )}
          <button
            className="cf-play"
            data-testid="collection-play"
            disabled={busy || (!pending && (!canBet || !!auto.plan))}
            onClick={() => void submit()}
          >
            {busy
              ? "Confirming…"
              : pending
                ? "Recover pending bet"
                : confirmed
                  ? "Bet confirmed"
                  : !open
                    ? "Betting closed"
                    : "Place bet"}
            <ArrowUpRight size={19} />
          </button>
          <p className="cf-play-hint">
            {pending
              ? "Recover the original round; no new bet is placed."
              : confirmed
                ? "Your bet is locked for this round."
                : !enough && valid
                  ? "Insufficient wallet balance"
                  : !valid && ready
                    ? "Enter an amount within the displayed limits."
                    : "One bet per round. Results every 30 seconds."}
          </p>
          <div className="cfl-auto" data-testid="coin-auto-controls">
            <div className="cfl-auto-title">
              <span>Auto-bet</span>
              <small>{auto.plan ? "RUNNING" : "OFF"}</small>
            </div>
            <div className="cfl-auto-fields">
              <label>
                Rounds
                <input
                  aria-label="Auto-bet rounds"
                  inputMode="numeric"
                  value={autoRounds}
                  onChange={(e) => setAutoRounds(e.target.value)}
                  disabled={!!auto.plan}
                />
              </label>
              <label>
                Stop loss ₹
                <input
                  aria-label="Auto-bet loss limit"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={lossLimit}
                  onChange={(e) => setLossLimit(e.target.value)}
                  disabled={!!auto.plan}
                />
              </label>
              <label>
                Profit target ₹
                <input
                  aria-label="Auto-bet profit target"
                  inputMode="decimal"
                  placeholder="Optional"
                  value={profitTarget}
                  onChange={(e) => setProfitTarget(e.target.value)}
                  disabled={!!auto.plan}
                />
              </label>
            </div>
            {auto.plan ? (
              <>
                <p>
                  {auto.plan.side.toUpperCase()} ·{" "}
                  {money(auto.plan.stakeAmount)} each · {auto.plan.remaining}{" "}
                  bets left
                  <br />
                  Net: {money(auto.plan.profit)}
                </p>
                <button className="cfl-stop-auto" onClick={() => auto.stop()}>
                  Stop auto-bet
                </button>
              </>
            ) : (
              <button
                className="cfl-start-auto"
                disabled={
                  !ready ||
                  !valid ||
                  !enough ||
                  busy ||
                  !!pending ||
                  !roundsValid ||
                  !limitsValid
                }
                onClick={startAuto}
              >
                Start auto-bet · {side.toUpperCase()}
              </button>
            )}
            <small role="status">
              {auto.message ||
                "Repeats this amount and side. Stops on reload, tab exit or connection loss."}
            </small>
          </div>
          <p className="cf-host-note">
            AI stadium presentation. The coin on her palm shows the shared round
            result.
          </p>
        </section>
      </main>
      <footer className="cf-footer">
        <span>
          COIN FLIP <i /> 30 SEC <i />{" "}
          {((configNow?.rtp ?? 0.97) * 100).toFixed(0)}% target RTP
        </span>
        <div>
          <button
            onClick={() => setPanel("rules")}
            aria-label="Read game rules"
          >
            <CircleHelp size={14} /> How to play
          </button>
          <button onClick={() => setPanel("fairness")}>
            <ShieldCheck size={14} /> Round details
          </button>
        </div>
      </footer>
      <Dialog open={panel !== null} onOpenChange={(v) => !v && setPanel(null)}>
        <DialogContent className="ic-dialog cfl-dialog">
          <DialogHeader>
            <DialogTitle>
              {panel === "rules"
                ? "How to play Coin Flip"
                : panel === "history"
                  ? "Your round history"
                  : "Round details"}
            </DialogTitle>
            <DialogDescription>
              Shared 30-second stadium rounds.
            </DialogDescription>
          </DialogHeader>
          {panel === "rules" ? (
            <div>
              <p>
                Each round has 15 seconds for betting, 10 seconds for the toss
                and 5 seconds to show the result. All players see the same
                result, even without a bet.
              </p>
              <p>
                Choose Heads or Tails and place one bet before betting closes.
                The winning return includes your stake and rounds down to paise.
              </p>
              <p>
                Start auto-bet repeats your selected side and amount for the
                number of rounds you choose. Optional loss and profit limits use
                net results from that run. Stop ends future bets; an already
                accepted bet still settles. Auto-bet does not resume after a
                reload, hidden tab, connection loss or error.
              </p>
              <p>
                Interrupted rounds without a revealed outcome are refunded.
                Recover pending bet checks the original round without submitting
                a new wager.
              </p>
            </div>
          ) : panel === "history" ? (
            <div className="ic-history">
              {ownHistory.length ? (
                ownHistory.map((r) => (
                  <div key={r.requestId}>
                    <span>
                      {r.options.choice.toUpperCase()} ·{" "}
                      {r.slipStatus === "refunded"
                        ? "Refunded"
                        : r.outcome[0] === 0
                          ? "Heads landed"
                          : "Tails landed"}
                      <small>{new Date(r.createdAt).toLocaleString()}</small>
                    </span>
                    <strong>
                      {money(r.stakeAmount)} → {money(r.payoutAmount)}
                    </strong>
                  </div>
                ))
              ) : (
                <p>No bets yet. You can watch every round without betting.</p>
              )}
            </div>
          ) : (
            <div className="ic-fairness">
              <p>
                The server commits a seed before betting opens. The seed and
                result are revealed together after the toss.
              </p>
              {[
                ["Round", snapshot?.roundId],
                ["Server seed SHA-256", snapshot?.serverSeedHash],
                ["Client seed", snapshot?.clientSeed],
                [
                  "Server seed",
                  snapshot?.serverSeed ?? "Revealed after the toss",
                ],
              ].map(([label, value]) => (
                <div key={label}>
                  <small>{label}</small>
                  <code>{value ?? "Connecting…"}</code>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
