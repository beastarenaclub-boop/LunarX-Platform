import { Fragment, useEffect, useRef, useState, type ReactNode, type ComponentType } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowRight,
  ArrowLeft,
  ArrowUpRight,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Coins,
  Download,
  History as HistoryIcon,
  Info,
  Layers3,
  LockKeyhole,
  Minus,
  MoonStar,
  Plus,
  Radio,
  ShieldCheck,
  Shuffle,
  Sparkles,
  Timer,
  TrendingUp,
  Volume2,
  VolumeX,
  Wallet,
  X,
} from "lucide-react";
import { useStandaloneGameAudio, type GameAudioBridge } from "../../src/game/useStandaloneGameAudio";
import type { GameState, History, Pick } from "./types";
import RoundWinPopup, { type Win } from "../../src/components/table/RoundWinPopup";

const ROUND_DURATION = 30;
const MULTIPLIERS = [1, 5, 10, 20, 50, 100];
const coins = (cents: number) =>
  (cents / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const title = (value: string) =>
  /^\d$/.test(value)
    ? `Number ${value}`
    : value.charAt(0).toUpperCase() + value.slice(1);
const color = (n: number) => (n % 2 ? "green" : "red");
const size = (n: number) => (n >= 5 ? "Big" : "Small");
function Ball({ number, small = false }: { number: number; small?: boolean }) {
  return (
    <span
      className={`ball ${color(number)} ${[0, 5].includes(number) ? "dual" : ""} ${small ? "small" : ""}`}
    >
      <span>{number}</span>
    </span>
  );
}
function Dots({ number }: { number: number }) {
  return (
    <span
      className="color-dots"
      aria-label={`${color(number)}${[0, 5].includes(number) ? " and violet" : ""}`}
    >
      <i className={color(number)} />
      {[0, 5].includes(number) && <i className="violet" />}
    </span>
  );
}
function Modal({
  title: heading,
  description,
  open,
  onClose,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(value) => !value && onClose()}>
      <Dialog.Portal>
        <div className="wingo-theme">
          <Dialog.Overlay className="modal-overlay" />
          <Dialog.Content className="modal-content">
            <Dialog.Title>{heading}</Dialog.Title>
            <Dialog.Description>{description}</Dialog.Description>
            <Dialog.Close
              className="icon-button modal-close"
              aria-label="Close dialog"
            >
              <X size={20} />
            </Dialog.Close>
            {children}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
async function api(path: string, data?: unknown): Promise<GameState> {
  const response = await fetch(`/api/wingo/${path}`, {
    method: data === undefined ? "GET" : "POST",
    headers:
      data === undefined ? undefined : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : result.error?.message || "Unable to connect. Please try again.",
    );
  return result;
}

export interface WinGoBetControlsProps {
  roundKey: string | null;
  closesAt: number | null;
  chip: number;
  enabled: boolean;
  locked: boolean;
  selected: boolean;
  busy: boolean;
  onSelect: (value: number) => void;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}
export default function App({ onBackToLobby, onOpenWallet, walletBalance, onWalletChange, BetControls, Secondary = Fragment, informationButton, audioBridge }: {
  onBackToLobby?: () => void;
  onOpenWallet?: () => void;
  walletBalance?: string;
  onWalletChange?: () => void;
  BetControls?: ComponentType<WinGoBetControlsProps>;
  Secondary?: ComponentType<{ children: ReactNode }>;
  informationButton?: ReactNode;
  audioBridge?: GameAudioBridge;
} = {}) {
  const [data, setData] = useState<GameState | null>(null);
  const payoutVersion = data?.round.payoutVersion ?? 1;
  const pricingV2 = payoutVersion >= 2;
  const payoutLabel = (pick: Pick) => pick === "violet" ? (pricingV2 ? "4.25×" : "4.5×") : /^\d$/.test(pick) ? (payoutVersion === 3 ? "1.98×" : pricingV2 ? "8.5×" : "9×") : (pricingV2 ? "1.70×" : "2×");
  const sharedWallet = !!onOpenWallet;
  const balance = walletBalance === undefined ? data?.player.balance : Number(walletBalance);
  const lastBalance = useRef<number | undefined>(undefined);
  const walletChangeRef = useRef(onWalletChange);
  walletChangeRef.current = onWalletChange;
  const openWallet = () => onOpenWallet ? onOpenWallet() : setWallet(true);
  const mode = ROUND_DURATION;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [pick, setPick] = useState<Pick | null>(null);
  const [base, setBase] = useState(BetControls ? "100" : "10");
  const [multiple, setMultiple] = useState(1);
  const [tab, setTab] = useState("Game history");
  const [page, setPage] = useState(0);
  const [rules, setRules] = useState(false);
  const [wallet, setWallet] = useState(false);
  const [proof, setProof] = useState<History | null>(null);
  const [verified, setVerified] = useState("");
  const [confirm, setConfirm] = useState<{
    period: string;
    pick: Pick;
    stake: number;
    request: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [toast, setToast] = useState<{ text: string; win?: boolean } | null>(
    null,
  );
  const gameAudio = useStandaloneGameAudio("wingo", "wingo:sound", audioBridge);
  const sound = gameAudio.enabled;
  const [time, setTime] = useState(0);
  const clock = useRef({ server: 0, received: 0 });
  const previousBets = useRef<Map<string, number | null>>(new Map());
  const [wins, setWins] = useState<Win[]>([]);
  const seenWins = useRef(new Set<string>());
  const historyRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Colour Trading";
    return () => { document.title = previousTitle; };
  }, []);
  function accept(next: GameState) {
    if (
      next.round.duration !== modeRef.current ||
      next.serverTime < clock.current.server
    )
      return;
    clock.current = { server: next.serverTime, received: performance.now() };
    setTime(next.serverTime);
    setData(next);
    if (next.player.balance !== lastBalance.current) {
      lastBalance.current = next.player.balance;
      walletChangeRef.current?.();
    }
    setConnected(true);
    setError("");
    const settledPeriods = new Set<string>();
    for (const bet of next.bets) {
      if (
        previousBets.current.has(bet.id) &&
        previousBets.current.get(bet.id) === null &&
        bet.payout !== null
      ) {
        settledPeriods.add(`${bet.duration}:${bet.period}`);
        setToast({
          text:
            bet.payout > 0
              ? `Nice pick! ${title(bet.pick)} returned ${coins(bet.payout)} coins.`
              : `Round settled · ${title(bet.pick)} did not match.`,
          win: bet.payout > 0,
        });

      }
      previousBets.current.set(bet.id, bet.payout);
    }
    for (const period of settledPeriods) {
      const bets = next.bets.filter(bet => `${bet.duration}:${bet.period}` === period);
      const id = `${next.player.id}:${period}`;
      if (!bets.some(bet => bet.payout === null)) {
        const payout = bets.reduce((sum, bet) => sum + (bet.payout ?? 0), 0);
        const total = bets.reduce((sum, bet) => sum + bet.stake, 0);
        gameAudio.play(payout > total ? "win" : payout < total ? "lose" : "settle");
      }
      if (seenWins.current.has(id) || bets.some(bet => bet.payout === null) ||
        !bets.some(bet => bet.payout! > bet.stake)) continue;
      seenWins.current.add(id);
      const payout = bets.reduce((sum, bet) => sum + BigInt(bet.payout!), 0n);
      const stake = bets.reduce((sum, bet) => sum + BigInt(bet.stake), 0n);
      setWins(previous => [...previous, {
        scope: `wingo:${next.player.id}`, game: "wingo", roundId: period,
        profit: payout - stake, payout, unit: sharedWallet ? "rupees" : "coins",
      }]);
    }
  }
  useEffect(() => {
    let active = true;
    api("session", {})
      .then((next) => {
        if (active) {
          accept(next);
          setReady(true);
        }
      })
      .catch((err) => {
        if (active) {
          setConnected(false);
          setError(err.message);
        }
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    if (!ready) return;
    let active = true,
      timeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!active) return;
      if (!busyRef.current) {
        try {
          const next = await api(`state?duration=${mode}`);
          if (active) accept(next);
        } catch (err) {
          if (active) {
            setConnected(false);
            setError((err as Error).message);
          }
        }
      }
      if (active) timeout = setTimeout(poll, 900);
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [ready, mode]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (clock.current.server)
        setTime(
          clock.current.server + performance.now() - clock.current.received,
        );
    }, 100);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    setPage(0);
  }, [tab, mode]);
  const correctMode = data?.round.duration === mode;
  useEffect(() => { if (BetControls) setPick(null); }, [mode, data?.round.period, BetControls]);
  const remaining =
    data && correctMode
      ? Math.min(mode, Math.max(0, Math.ceil((data.round.ends - time) / 1000)))
      : mode;
  const heardTick = useRef("");
  useEffect(() => {
    const event = String(mode) + ":" + data?.round.period + ":" + remaining;
    if (!correctMode || !connected || !data || remaining > 5 || remaining < 1 || heardTick.current === event) return;
    heardTick.current = event;
    gameAudio.play("tick");
  }, [remaining, correctMode, connected, data?.round.period, mode, gameAudio.play]);
  const previousPick = useRef(pick);
  useEffect(() => {
    if (pick !== previousPick.current && pick !== null) gameAudio.play("select");
    previousPick.current = pick;
  }, [pick, gameAudio.play]);
  const fresh = time - clock.current.server < 6000;
  const locked =
    !data || !correctMode || remaining <= 5 || !connected || !fresh;
  const clockReady = !!data && correctMode && connected && fresh;
  const clockText = clockReady ? `00:${String(remaining).padStart(2, "0")}` : "--:--";
  const stake = Number(base) * multiple * 100;
  const validStake =
    Number.isSafeInteger(stake) &&
    stake >= 100 &&
    stake <= 1000000 &&
    Number.isInteger(Number(base));
  const canBet =
    !!pick &&
    !locked &&
    validStake &&
    stake <= (balance ?? 0) &&
    !busy;
  const history = correctMode ? data?.history || [] : [];
  const last = history[0];
  const myBets = data?.bets.filter((bet) => bet.duration === mode) || [];
  const pendingBets = myBets.filter((bet) => bet.payout === null);
  const greenCount = history.filter((item) => item.number % 2 === 1).length;
  const redCount = history.length - greenCount;
  const violetCount = history.filter((item) =>
    [0, 5].includes(item.number),
  ).length;
  function showHistory(nextTab: string) {
    setTab(nextTab);
    historyRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const toggleSound = gameAudio.toggle;
  function randomPick() {
    const bytes = new Uint8Array(1);
    do {
      crypto.getRandomValues(bytes);
    } while (bytes[0] >= 250);
    setPick(String(bytes[0] % 10) as Pick);
  }
  async function submit(selection = confirm) {
    if (!selection || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const next = await api("bets", { ...selection, duration: mode,
        ...(payoutVersion >= 3 ? { payoutVersion } : {}),
      });
      accept(next);
      gameAudio.play("bet");
      setToast({
        text: `${title(selection.pick)} prediction placed · ${coins(selection.stake)} coins`,
      });
      setConfirm(null);
      setPick(null);
    } catch (err) {
      setToast({ text: (err as Error).message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function refill() {
    if (sharedWallet) return;
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      accept(await api("refill", { duration: mode }));
      setToast({ text: "Your practice wallet is back to 10,000 coins." });
      setWallet(false);
    } catch (err) {
      setToast({ text: (err as Error).message });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function verifyRound() {
    if (!proof) return;
    try {
      const bytes = new TextEncoder().encode(
        `${proof.period}:${proof.number}:${proof.secret}`,
      );
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const actual = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      setVerified(
        actual === proof.commitment
          ? "Verified. The revealed result matches its published commitment."
          : "Verification failed: the commitment does not match.",
      );
    } catch {
      setVerified(
        "Verification needs a secure browser context (localhost or HTTPS).",
      );
    }
  }
  function exportHistory() {
    const rows = [
      "Period,Duration,Prediction,Stake coins,Return coins,Status",
      ...myBets.map((bet) =>
        [
          bet.period,
          bet.duration,
          bet.pick,
          bet.stake / 100,
          bet.payout === null ? "" : bet.payout / 100,
          bet.payout === null ? "Pending" : bet.payout > 0 ? "Won" : "Lost",
        ].join(","),
      ),
    ];
    const url = URL.createObjectURL(
      new Blob([rows.join("\r\n")], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `colour-trading-history.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div
      className={`wingo-theme app${onBackToLobby ? " wingo-integrated" : ""}`}
    >
      <header className="topbar">
        <div className="topbar-inner">
          {onBackToLobby && (
            <button
              className="lobby-back"
              onClick={onBackToLobby}
              aria-label="Back to all games"
            >
              <ArrowLeft size={18} />
              <span>All games</span>
            </button>
          )}
          <a
            className="brand"
            href={onBackToLobby ? "/lunar-colour-trading" : "/"}
            aria-label="Colour Trading home"
          >
            <span className="brand-mark">
              <MoonStar size={27} aria-hidden="true" />
            </span>
            <span>
              Colour
              <small>TRADING</small>
            </span>
          </a>
          <Secondary><nav aria-label="Main navigation">
            <button
              className="active"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            >
              <Layers3 size={17} />
              Play
            </button>
            <button onClick={() => showHistory("My history")}>
              <HistoryIcon size={17} />
              My activity
            </button>
            <button onClick={() => setRules(true)}>
              <CircleHelp size={17} />
              How to play
            </button>
          </nav></Secondary>
          <div className="header-actions">
            {informationButton}
            <span className="practice-label">
              <span />
              {sharedWallet ? "Shared wallet" : "Practice mode"}
            </span>
            <button
              className="icon-button sound"
              onClick={toggleSound}
              aria-label={sound ? "Mute sound" : "Enable sound"}
            >
              {sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <button
              className="avatar"
              onClick={openWallet}
              aria-label={sharedWallet ? "Open shared wallet" : "Open practice wallet"}
            >
              P
            </button>
          </div>
        </div>
      </header>

      <main className="shell">
        <Secondary><div className="breadcrumb">
          {onBackToLobby ? (
            <button onClick={onBackToLobby}>All games</button>
          ) : (
            "Games"
          )}{" "}
          <ChevronRight size={13} />
          <span>Colour Trading</span>
        </div></Secondary>
        <Secondary><section className="page-heading">
          <div>
            <div className="eyebrow">
              <span /> PICK YOUR COLOUR. PLAY YOUR NUMBER.
            </div>
            <h1>
              <span>Colour Trading</span>
            </h1>
            <p>
              Pick your colour, find your number. A fresh round is always around
              the corner.
            </p>
          </div>
          <button
            className="subtle-button help-button"
            onClick={() => setRules(true)}
          >
            <CircleHelp size={17} /> Game guide <ArrowUpRight size={15} />
          </button>
        </section></Secondary>

        <section className="overview" aria-label={sharedWallet ? "Your shared account" : "Your practice account"}>
          <button className="wallet-overview" onClick={openWallet}>
            <span className="wallet-icon">
              <Wallet size={24} />
            </span>
            <span>
              <span className="stat-label">
                {sharedWallet ? "Your shared balance" : "Your practice balance"} <Info size={12} />
              </span>
              <strong data-testid="balance">
                {balance === undefined ? "—" : coins(balance)} <small>{sharedWallet ? "INR" : "coins"}</small>
              </strong>
            </span>
            <span className="wallet-arrow">
              <ArrowUpRight size={19} />
            </span>
          </button>
          <Secondary><div className="overview-stat">
            <span className="stat-symbol coral">
              <Layers3 size={20} />
            </span>
            <div>
              <span className="stat-label">Predictions played</span>
              <strong>
                {data?.summary.played ?? "—"}
                <small>settled</small>
              </strong>
            </div>
          </div></Secondary>
          <Secondary><div className="overview-stat">
            <span className="stat-symbol mint">
              <TrendingUp size={20} />
            </span>
            <div>
              <span className="stat-label">Total returns − stakes</span>
              <strong
                className={
                  (data?.summary.profit ?? 0) < 0 ? "negative" : "positive"
                }
              >
                {(data?.summary.profit ?? 0) >= 0 ? "+" : ""}
                {data ? coins(data.summary.profit) : "0"}
                <small>coins</small>
              </strong>
            </div>
          </div></Secondary>
          <Secondary><div className="overview-note">
            <ShieldCheck size={25} />
            <span>
              {sharedWallet ? "One wallet. All games." : "Just for the fun of it."}
              <small>{sharedWallet ? "Bets and winnings share your balance." : "Free coins. Real game experience."}</small>
            </span>
          </div></Secondary>
        </section>
        {error && (
          <div className="connection-error" role="alert">
            <Info size={17} />
            <span>{error}</span>
            {!ready && (
              <button onClick={() => setRetry((value) => value + 1)}>
                Retry connection
              </button>
            )}
          </div>
        )}

        <div className="game-layout">
          <div className="game-column">
            <section
              className={`round-ticket ${locked ? "closing" : ""}`}
              aria-label="Current round"
            >
              <div className="ticket-left">
                <span className="round-live">
                  <i />
                  {!connected || !fresh ? "CONNECTING" : locked ? "BETTING CLOSED" : "BETTING OPEN"}
                </span>
                <span className="round-caption">Current round</span>
                <strong className="period" data-testid="period">
                  #{correctMode ? data?.round.period : "Connecting…"}
                </strong>
                <div className="ticket-recent">
                  <span>Last results</span>
                  {history.length ? (
                    history
                      .slice(0, 5)
                      .map((item) => (
                        <Ball key={item.period} number={item.number} small />
                      ))
                  ) : (
                    <span className="first-round">
                      The first reveal is on its way
                    </span>
                  )}
                </div>
              </div>
              <div className="ticket-divider" />
              <div className="ticket-right">
                <span><Timer size={14} aria-hidden="true" />{clockReady && remaining <= 5 ? "Result in" : "Round ends in"}</span>
                <div className="countdown" data-testid="countdown" role="timer" aria-live="off"
                  aria-label={clockReady ? `${remaining} seconds remaining` : "Syncing round"}>
                  {clockText.split("").map((digit, index) => digit === ":"
                    ? <b key={index}>:</b> : <span key={index}>{digit}</span>)}
                </div>
                <small>{clockReady ? remaining <= 5 ? "Betting closed" : "30-second round" : "Connecting…"}</small>
              </div>
            </section>

            <section className="prediction-panel card">
              <div className="section-heading">
                <div>
                  <span className="step">01</span>
                  <h2>Make your prediction</h2>
                </div>
                <span className="muted-caption">One round. Your choice.</span>
              </div>
              <div className="color-options">
                {(["green", "violet", "red"] as const).map((item) => (
                  <button
                    key={item}
                    className={`color-option ${item} ${pick === item ? "chosen" : ""}`}
                    aria-pressed={pick === item}
                    disabled={locked || busy}
                    onClick={() => setPick(item)}
                  >
                    <span className="color-orb" />
                    <strong>{title(item)}</strong>
                    <small>{payoutLabel(item)}</small>
                    {pick === item && (
                      <Check className="choice-check" size={17} />
                    )}
                  </button>
                ))}
              </div>
              <div className="option-divider">
                <span>or pick your lucky number</span>
                <b>{payoutLabel("0")} return</b>
              </div>
              <div className="number-options">
                {Array.from({ length: 10 }, (_, number) => (
                  <button
                    key={number}
                    aria-label={`Pick number ${number}`}
                    aria-pressed={pick === String(number)}
                    disabled={locked || busy}
                    className={pick === String(number) ? "chosen" : ""}
                    onClick={() => setPick(String(number) as Pick)}
                  >
                    <Ball number={number} />
                    <span className="number-selection">
                      <Check size={10} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="size-options">
                <button
                  className={`big ${pick === "big" ? "chosen" : ""}`}
                  disabled={locked || busy}
                  onClick={() => setPick("big")}
                  aria-pressed={pick === "big"}
                >
                  <span>
                    <strong>Big</strong>
                    <small>5 · 6 · 7 · 8 · 9</small>
                  </span>
                  <b>{payoutLabel("big")}</b>
                  {pick === "big" && <Check size={17} />}
                </button>
                <button
                  className={`small ${pick === "small" ? "chosen" : ""}`}
                  disabled={locked || busy}
                  onClick={() => setPick("small")}
                  aria-pressed={pick === "small"}
                >
                  <span>
                    <strong>Small</strong>
                    <small>0 · 1 · 2 · 3 · 4</small>
                  </span>
                  <b>{payoutLabel("small")}</b>
                  {pick === "small" && <Check size={17} />}
                </button>
              </div>
              <div className="bet-divider" />
              <div className="section-heading stake-heading">
                <div>
                  <span className="step">02</span>
                  <h2>Set your play amount</h2>
                </div>
                <span className="coins-caption">
                  <Coins size={14} /> {sharedWallet ? "1 coin = ₹1" : "Practice coins"}
                </span>
              </div>
              {BetControls ? <BetControls
                roundKey={correctMode && data ? `${mode}:${data.round.period}` : null}
                closesAt={correctMode && data ? Date.now() + data.round.ends - 5000 - time : null}
                chip={stake / 100} enabled={canBet} locked={locked} selected={!!pick} busy={busy}
                onSelect={value => { setBase(String(value)); setMultiple(1); }}
                onCancel={() => setPick(null)}
                onSubmit={async () => {
                  if (!canBet || !data || !pick) return;
                  await submit({ period: data.round.period, pick, stake, request: crypto.randomUUID() });
                  setPick(null);
                }}
              /> : <><div className="stake-options">
                <button
                  className="random-button"
                  onClick={randomPick}
                  disabled={locked || busy}
                >
                  <Shuffle size={15} />
                  Random
                </button>
                <div className="multipliers" aria-label="Stake multiplier">
                  {MULTIPLIERS.map((value) => (
                    <button
                      key={value}
                      aria-pressed={multiple === value}
                      className={multiple === value ? "selected" : ""}
                      disabled={busy}
                      onClick={() => setMultiple(value)}
                    >
                      ×{value}
                    </button>
                  ))}
                </div>
              </div>
              <div className="place-row">
                <label className="amount-input">
                  <span>Base amount</span>
                  <div>
                    <button
                      aria-label="Decrease base amount"
                      disabled={busy}
                      onClick={() =>
                        setBase(String(Math.max(1, (Number(base) || 1) - 10)))
                      }
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      aria-label="Base coin amount"
                      type="number"
                      min="1"
                      max="10000"
                      step="1"
                      value={base}
                      disabled={busy}
                      onChange={(event) => setBase(event.target.value)}
                    />
                    <button
                      aria-label="Increase base amount"
                      disabled={busy}
                      onClick={() =>
                        setBase(
                          String(Math.min(10000, (Number(base) || 0) + 10)),
                        )
                      }
                    >
                      <Plus size={14} />
                    </button>
                  </div>
                </label>
                <button
                  className="primary-button place-button"
                  disabled={!canBet}
                  onClick={() =>
                    setConfirm({
                      period: data!.round.period,
                      pick: pick!,
                      stake,
                      request: crypto.randomUUID(),
                    })
                  }
                >
                  <span>
                    {locked
                      ? remaining <= 5 && correctMode
                        ? "Next round shortly"
                        : "Connecting to round…"
                      : pick
                        ? `Play ${title(pick)}`
                        : "Choose your prediction"}
                    <small>
                      {validStake
                        ? `${coins(stake)} coins`
                        : "Enter a valid amount"}
                      {pick && validStake
                        ? ` · ${payoutLabel(pick)} max return`
                        : ""}
                    </small>
                  </span>
                  {locked ? (
                    <LockKeyhole size={19} />
                  ) : (
                    <ArrowRight size={21} />
                  )}
                </button>
              </div>
              </>}
              <div className="stake-footnote">
                {validStake && balance !== undefined && stake > balance ? (
                  <span className="negative">
                    Not enough coins. Lower your amount or open your wallet.
                  </span>
                ) : (
                  <>
                    <ShieldCheck size={12} />
                    <span>
                      Virtual coins only. Returns include your original stake.
                    </span>
                  </>
                )}
              </div>
              {pendingBets.length > 0 && (
                <div className="pending-strip" role="status">
                  <Radio size={15} />
                  <span>
                    {pendingBets.length} active prediction
                    {pendingBets.length > 1 ? "s" : ""} this round
                  </span>
                  <b>
                    {coins(
                      pendingBets.reduce((sum, bet) => sum + bet.stake, 0),
                    )}{" "}
                    coins
                  </b>
                </div>
              )}
            </section>
          </div>

          <Secondary><aside className="sidebar">
            <section className="latest-card card">
              <div className="section-heading">
                <div>
                  <span className="icon-square">
                    <Sparkles size={17} />
                  </span>
                  <h2>The latest reveal</h2>
                </div>
                <span className="tiny-tag">LIVE</span>
              </div>
              <div className="latest-result">
                {last ? (
                  <>
                    <div className="reveal-halo">
                      <Ball key={last.period} number={last.number} />
                    </div>
                    <div>
                      <span className="result-kicker">WINNING NUMBER</span>
                      <h3>
                        {size(last.number)} <span>·</span> {color(last.number)}
                        {[0, 5].includes(last.number) ? " + violet" : ""}
                      </h3>
                      <small>Round #{last.period}</small>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="waiting-orbit">
                      <Timer size={34} />
                    </div>
                    <div>
                      <h3>Let the colours roll</h3>
                      <small>Your first result arrives after this round.</small>
                    </div>
                  </>
                )}
              </div>
              <button
                className="verify-button"
                disabled={!last}
                onClick={() => {
                  setProof(last);
                  setVerified("");
                }}
              >
                <ShieldCheck size={15} />
                {last ? "Verify this round" : "Results verified by commitment"}
                {last && <ArrowUpRight size={13} />}
              </button>
            </section>

            <section className="trends-card card">
              <div className="section-heading">
                <div>
                  <ChartNoAxesCombined size={18} />
                  <h2>Colour pulse</h2>
                </div>
                <span className="muted-caption">Last {history.length}</span>
              </div>
              <p>A little look at the recent rounds.</p>
              <div className="pulse-bar">
                <i
                  className="green"
                  style={{ flex: greenCount || (history.length ? 0.001 : 1) }}
                />
                <i
                  className="red"
                  style={{ flex: redCount || (history.length ? 0.001 : 1) }}
                />
              </div>
              <div className="pulse-stats">
                {[
                  { name: "Green", count: greenCount },
                  { name: "Violet", count: violetCount },
                  { name: "Red", count: redCount },
                ].map((item) => (
                  <div key={item.name}>
                    <span>
                      <i className={item.name.toLowerCase()} />
                      {item.name}
                    </span>
                    <strong>
                      {history.length
                        ? Math.round((item.count / history.length) * 100)
                        : "—"}
                      <small>{history.length ? "%" : ""}</small>
                    </strong>
                  </div>
                ))}
              </div>
              <div className="trend-note">
                <Info size={13} />
                <span>
                  0 and 5 share violet. Past rounds don’t predict the next
                  result.
                </span>
              </div>
            </section>

            <section className="guide-card">
              <span className="guide-illustration" aria-hidden="true">
                <Ball number={5} small />
                <Ball number={2} small />
                <Ball number={7} small />
              </span>
              <span className="eyebrow">NEW TO THE CLUB?</span>
              <h3>
                Your colour.
                <br />
                Your kind of game.
              </h3>
              <p>
                Three colours, ten numbers,
                <br />
                and a fresh chance every round.
              </p>
              <button onClick={() => setRules(true)}>
                Learn how it works <ArrowRight size={16} />
              </button>
              <span className="guide-spark one">✦</span>
              <span className="guide-spark two">✧</span>
            </section>
            <div className="connection-status">
              <span className={connected && fresh ? "online" : "offline"} />
              <span>
                {connected && fresh
                  ? "Connected to game server"
                  : "Reconnecting to game server"}
              </span>
              <LockKeyhole size={12} />
            </div>
          </aside></Secondary>
        </div>

        <Secondary><section className="history-section card" ref={historyRef}>
          <div className="history-top">
            <div
              className="history-tabs"
              role="tablist"
              aria-label="Round history"
            >
              {["Game history", "Chart", "My history"].map((item, index) => (
                <button
                  key={item}
                  id={`history-tab-${index}`}
                  role="tab"
                  aria-selected={tab === item}
                  aria-controls="history-panel"
                  className={tab === item ? "active" : ""}
                  onClick={() => setTab(item)}
                >
                  {index === 0 ? (
                    <HistoryIcon size={16} />
                  ) : index === 1 ? (
                    <ChartNoAxesCombined size={16} />
                  ) : (
                    <Layers3 size={16} />
                  )}
                  {item}
                  {item === "My history" && myBets.length > 0 && (
                    <span>{myBets.length}</span>
                  )}
                </button>
              ))}
            </div>
            {tab === "My history" ? (
              <button
                className="export-button"
                onClick={exportHistory}
                disabled={!myBets.length}
              >
                <Download size={14} />
                <span>Export recent</span>
              </button>
            ) : (
              <span className="history-mode">
                Colour Trading
                <ChevronDown size={13} />
              </span>
            )}
          </div>
          <div
            id="history-panel"
            role="tabpanel"
            aria-labelledby={`history-tab-${["Game history", "Chart", "My history"].indexOf(tab)}`}
          >
            {tab === "Chart" ? (
              <div className="chart-panel">
                <div>
                  <h3>Every number has a story.</h3>
                  <p>
                    Most recent {Math.min(20, history.length)} completed rounds
                    · oldest to newest
                  </p>
                </div>
                {history.length > 1 ? (
                  <svg
                    viewBox="0 0 900 190"
                    role="img"
                    aria-label="Recent winning numbers, oldest to newest"
                  >
                    <title>Winning number history</title>
                    {[0, 3, 6, 9].map((n) => (
                      <g key={n}>
                        <text x="2" y={164 - n * 16} className="chart-label">
                          {n}
                        </text>
                        <line
                          x1="25"
                          x2="880"
                          y1={160 - n * 16}
                          y2={160 - n * 16}
                          stroke="#eceef3"
                          strokeDasharray="5 5"
                        />
                      </g>
                    ))}
                    <polyline
                      fill="none"
                      stroke="#d5d8e2"
                      strokeWidth="2"
                      points={history
                        .slice(0, 20)
                        .reverse()
                        .map(
                          (item, index, all) =>
                            `${40 + index * (820 / (all.length - 1))},${160 - item.number * 16}`,
                        )
                        .join(" ")}
                    />
                    {history
                      .slice(0, 20)
                      .reverse()
                      .map((item, index, all) => (
                        <g key={item.period}>
                          <circle
                            cx={40 + index * (820 / (all.length - 1))}
                            cy={160 - item.number * 16}
                            r="12"
                            className={`chart-dot ${[0, 5].includes(item.number) ? "violet" : color(item.number)}`}
                          />
                          <text
                            textAnchor="middle"
                            x={40 + index * (820 / (all.length - 1))}
                            y={164 - item.number * 16}
                            fill="white"
                            fontSize="11"
                            fontWeight="700"
                          >
                            {item.number}
                          </text>
                        </g>
                      ))}
                  </svg>
                ) : (
                  <Empty
                    icon={<ChartNoAxesCombined />}
                    title="The chart is warming up"
                    text="Your number chart will appear after two completed rounds."
                  />
                )}
              </div>
            ) : tab === "Game history" ? (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Number</th>
                        <th>Big / Small</th>
                        <th>Colour</th>
                        <th className="desktop-cell">Result check</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.slice(page * 8, page * 8 + 8).map((item) => (
                        <tr key={item.period}>
                          <td>
                            <span className="period-cell">{item.period}</span>
                            <small className="time-cell">
                              {new Date(item.ends).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                            </small>
                          </td>
                          <td>
                            <span
                              className={`result-number ${color(item.number)} ${[0, 5].includes(item.number) ? "dual-text" : ""}`}
                            >
                              {item.number}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`size-tag ${size(item.number).toLowerCase()}`}
                            >
                              {size(item.number)}
                            </span>
                          </td>
                          <td>
                            <Dots number={item.number} />
                          </td>
                          <td className="desktop-cell">
                            <button
                              className="table-verify"
                              onClick={() => {
                                setProof(item);
                                setVerified("");
                              }}
                            >
                              <ShieldCheck size={14} />
                              Verify
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!history.length && (
                  <Empty
                    icon={<Timer />}
                    title="A fresh start. A fresh round."
                    text="Completed results appear here automatically. Make a pick to get started."
                  />
                )}
              </>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="my-history-table">
                    <thead>
                      <tr>
                        <th>Period / Pick</th>
                        <th>Amount</th>
                        <th>Return</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {myBets.slice(page * 8, page * 8 + 8).map((bet) => (
                        <tr key={bet.id}>
                          <td>
                            <span className="period-cell">{bet.period}</span>
                            <small className={`bet-pick ${bet.pick}`}>
                              {title(bet.pick)}
                            </small>
                          </td>
                          <td>{coins(bet.stake)}</td>
                          <td
                            className={
                              bet.payout && bet.payout > 0 ? "positive" : ""
                            }
                          >
                            {bet.payout === null ? "—" : coins(bet.payout)}
                          </td>
                          <td>
                            <span
                              className={`bet-status ${bet.payout === null ? "pending" : bet.payout > 0 ? "won" : "lost"}`}
                            >
                              {bet.payout === null
                                ? "Pending"
                                : bet.payout > 0
                                  ? "Won"
                                  : "Lost"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!myBets.length && (
                  <Empty
                    icon={<Layers3 />}
                    title="Your next story starts with a pick"
                    text="Choose a colour, number or size. Your predictions will appear here."
                  />
                )}
              </>
            )}
          </div>
          {tab !== "Chart" && (
            <div className="table-footer">
              <span>
                {tab === "Game history"
                  ? `${history.length} completed rounds`
                  : `${myBets.length} recent predictions`}
                <span className="footer-dot">·</span>Colour Trading
              </span>
              <div>
                <button
                  aria-label="Previous history page"
                  disabled={page === 0}
                  onClick={() => setPage((value) => value - 1)}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {page + 1} /{" "}
                  {Math.max(
                    1,
                    Math.ceil(
                      (tab === "Game history"
                        ? history.length
                        : myBets.length) / 8,
                    ),
                  )}
                </span>
                <button
                  aria-label="Next history page"
                  disabled={
                    (page + 1) * 8 >=
                    (tab === "Game history" ? history.length : myBets.length)
                  }
                  onClick={() => setPage((value) => value + 1)}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </section></Secondary>
        <Secondary><footer className="footer">
          <div>
            <MoonStar size={20} aria-hidden="true" />
            <span>Colour Trading</span>
          </div>
          <span>{sharedWallet ? "One wallet across all games · 1 coin = ₹1" : "Practice coins only · No cash value"}</span>
          <button onClick={() => setRules(true)}>
            <ShieldCheck size={13} />
            Game rules & fairness
          </button>
        </footer></Secondary>
      </main>

      <RoundWinPopup win={wins[0] ?? null} onClose={() => setWins(previous => previous.slice(1))} />
      {toast && (
        <div className={`toast ${toast.win ? "win-toast" : ""}`} role="status">
          {toast.win ? <Sparkles size={20} /> : <Info size={20} />}
          <span>{toast.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <Modal
        open={!!confirm}
        onClose={() => {
          if (!busy) setConfirm(null);
        }}
        title="Make it a colourful round"
        description="Review your prediction before placing it."
      >
        {confirm && (
          <>
            <div className={`confirmation-pick ${confirm.pick}`}>
              <span>Your prediction</span>
              <strong>{title(confirm.pick)}</strong>
              <span>
                Colour Trading · #{confirm.period}
              </span>
            </div>
            <div className="receipt">
              <div>
                <span>Play amount</span>
                <b>{coins(confirm.stake)} coins</b>
              </div>
              <div>
                <span>Maximum return</span>
                <b className="positive">
                  {coins(confirm.stake * parseFloat(payoutLabel(confirm.pick)))}{" "}
                  coins
                </b>
              </div>
              {!pricingV2 && ["green", "red"].includes(confirm.pick) && (
                <p>
                  {title(confirm.pick)} pays 1.5× on{" "}
                  {confirm.pick === "green" ? "5" : "0"}, and 2× on its other
                  numbers.
                </p>
              )}
              <p>
                Returns include the stake. No fee. {sharedWallet ? "Bets and winnings use your shared wallet." : "Practice coins have no cash value."}
              </p>
            </div>
            {data?.round.period !== confirm.period && (
              <p className="negative">
                This round has ended. Close and select a new prediction.
              </p>
            )}
            <button
              className="primary-button modal-primary"
              disabled={busy || locked || data?.round.period !== confirm.period}
              onClick={() => void submit()}
            >
              {busy
                ? "Placing prediction…"
                : `Confirm · ${coins(confirm.stake)} coins`}
              <ArrowRight size={18} />
            </button>
          </>
        )}
      </Modal>
      <Modal
        open={rules}
        onClose={() => setRules(false)}
        title="Colour Trading guide"
        description={sharedWallet ? "Colour Trading uses the same wallet as all your games. 1 coin = ₹1." : "A quick guide to Colour Trading practice rounds."}
      >
        <ol className="rules-steps">
          <li>
            <span>1</span>
            <div>
              <b>Join the round</b>
              <p>
                Every round lasts 30 seconds. Place your prediction while betting is open.
              </p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <b>Make your pick</b>
              <p>
                Select one colour, exact number, or Big / Small. Set the base
                {BetControls ? "coin amount. Your selected prediction submits automatically before betting closes. Cancel clears it, and a new round needs a new selection." : "amount and multiplier, then confirm."}
              </p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <b>Watch the reveal</b>
              <p>
                Predictions lock for the final 5 seconds. One number from 0–9 is
                revealed, and winning returns go into your {sharedWallet ? "shared" : "practice"} wallet.
              </p>
            </div>
          </li>
        </ol>
        <table className="rules-table">
          <thead>
            <tr>
              <th>Pick</th>
              <th>Winning numbers</th>
              <th>Return</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Green</td>
              <td>1, 3, 7, 9 / 5</td>
              <td>{pricingV2 ? payoutLabel("green") : "2× / 1.5×"}</td>
            </tr>
            <tr>
              <td>Red</td>
              <td>2, 4, 6, 8 / 0</td>
              <td>{pricingV2 ? payoutLabel("green") : "2× / 1.5×"}</td>
            </tr>
            <tr>
              <td>Violet</td>
              <td>0, 5</td>
              <td>{payoutLabel("violet")}</td>
            </tr>
            <tr>
              <td>Big / Small</td>
              <td>5–9 / 0–4</td>
              <td>{payoutLabel("big")}</td>
            </tr>
            <tr>
              <td>Number</td>
              <td>Your exact number</td>
              <td>{payoutLabel("0")}</td>
            </tr>
          </tbody>
        </table>
        <div className="rules-note">
          <ShieldCheck size={19} />
          <p>
            Each result is randomly selected on the server and committed before
            the reveal. The history lets you check that commitment. Past results
            do not predict future draws. Returns include your stake; there is no extra fee. {payoutVersion === 3 ? "Every winning number bet from 0 to 9 returns ₹1.98 per ₹1: your ₹1 stake plus ₹0.98 profit. Number-pick theoretical RTP is 19.8%; colour and size picks remain at 85%, before paise rounding." : pricingV2 ? "Theoretical RTP is 85% on every pick, before paise rounding; it is not a guarantee per round." : ""}
          </p>
        </div>
      </Modal>
      <Modal
        open={wallet && !sharedWallet}
        onClose={() => setWallet(false)}
        title="Your practice wallet"
        description="A little room to explore. All coins are free and have no cash value."
      >
        <div className="wallet-modal-balance">
          <Wallet size={30} />
          <strong>{data ? coins(data.player.balance) : "—"}</strong>
          <span>practice coins</span>
        </div>
        <div className="receipt">
          <div>
            <span>Predictions settled</span>
            <b>{data?.summary.played ?? 0}</b>
          </div>
          <div>
            <span>Winning predictions</span>
            <b>{data?.summary.won ?? 0}</b>
          </div>
          <div>
            <span>Active predictions</span>
            <b>{data?.pending ?? 0}</b>
          </div>
        </div>
        <p className="wallet-note">
          Start with 10,000 coins. When your balance drops below 1,000 and all
          predictions are settled, refill back to 10,000 for free.
        </p>
        <button
          className="primary-button modal-primary"
          disabled={
            busy ||
            !connected ||
            !data ||
            data.player.balance >= 100000 ||
            data.pending > 0
          }
          onClick={() => void refill()}
        >
          <Plus size={17} />
          Refill practice coins
        </button>
      </Modal>
      <Modal
        open={!!proof}
        onClose={() => setProof(null)}
        title="Check the reveal"
        description="Compare this result with the commitment published before the round ended."
      >
        {proof && (
          <>
            <div className="proof-result">
              <Ball number={proof.number} small />
              <span>Round #{proof.period}</span>
              <Dots number={proof.number} />
            </div>
            <div className="proof-details">
              <label>
                Published SHA-256 commitment<code>{proof.commitment}</code>
              </label>
              <label>
                Revealed secret<code>{proof.secret}</code>
              </label>
              <label>
                Verification input
                <code>
                  {proof.period}:{proof.number}:{proof.secret}
                </code>
              </label>
            </div>
            <p className="wallet-note">
              This confirms the reveal matches the published hash. It does not
              independently certify the operator or random number generator.
            </p>
            <button
              className="primary-button modal-primary"
              onClick={() => void verifyRound()}
            >
              <ShieldCheck size={18} />
              Verify in my browser
            </button>
            {verified && (
              <p className="verification-message" role="status">
                {verified}
              </p>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
function Empty({
  icon,
  title: heading,
  text,
}: {
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-state">
      <span>{icon}</span>
      <h3>{heading}</h3>
      <p>{text}</p>
    </div>
  );
}
