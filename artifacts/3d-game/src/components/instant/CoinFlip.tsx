import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "wouter";
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
  collectionPayout,
  type CollectionConfig,
  type CollectionRound,
} from "@workspace/api-zod/instant-collection";
import ChipRack from "@/components/table/chips";
import { B2C_BRAND, B2C_STANDALONE } from "@/components/b2c/config";
import { formatRupees } from "@/lib/format";
import "./coin-flip.css";

type Side = "heads" | "tails";
interface Props {
  round: CollectionRound | null;
  history: CollectionRound[];
  stake: string;
  setStake: (value: string) => void;
  choice: string;
  select: (side: Side) => void;
  config?: CollectionConfig;
  balance?: string;
  busy: boolean;
  locked: boolean;
  pending: boolean;
  canPlay: boolean;
  playHint: string;
  error: string;
  refresh: () => void;
  play: () => void;
  sound: boolean;
  motion: boolean;
  toggleSound: () => void;
  openPanel: (panel: "rules" | "history" | "fairness") => void;
  children: ReactNode;
}
const media = `${import.meta.env.BASE_URL}media/`;
const face = (side: Side) => `${media}instant/coin-${side}.svg`;
const money = (value: string | bigint) => `₹${formatRupees(String(value))}`;
const sideOf = (round: CollectionRound): Side =>
  round.outcome[0] === 0 ? "heads" : "tails";

/** A cosmetic flip: its final face always comes from the server receipt. */
function useCoinAnimation(
  busy: boolean,
  pending: boolean,
  motion: boolean,
  round: CollectionRound | null,
) {
  const coin = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const wasBusy = useRef(false);
  const [landing, setLanding] = useState(false);
  const side = round ? sideOf(round) : "heads";
  useLayoutEffect(() => {
    const el = coin.current;
    if (!el) return;
    // Continue from the visible angle instead of snapping at the API response.
    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const current =
      ((Math.atan2(-matrix.m13, matrix.m11) * 180) / Math.PI + 360) % 360;
    animation.current?.cancel();
    const target = side === "heads" ? 0 : 180;
    let canceled = false;
    if (busy) {
      wasBusy.current = true;
      setLanding(false);
      if (motion)
        animation.current = el.animate(
          [
            { transform: `rotateY(${current}deg)` },
            { transform: `rotateY(${current + 1080}deg)` },
          ],
          { duration: 1250, iterations: Infinity, easing: "linear" },
        );
    } else if (wasBusy.current && !pending && round && motion) {
      wasBusy.current = false;
      setLanding(true);
      const finish = el.animate(
        [
          { transform: `rotateY(${current}deg)` },
          { transform: `rotateY(${1080 + target}deg)` },
        ],
        {
          duration: 1100,
          easing: "cubic-bezier(.12,.65,.18,1)",
          fill: "forwards",
        },
      );
      animation.current = finish;
      void finish.finished
        .then(() => {
          if (!canceled) {
            el.style.transform = `rotateY(${target}deg)`;
            finish.cancel();
            setLanding(false);
          }
        })
        .catch(() => {});
    } else {
      wasBusy.current = false;
      setLanding(false);
      el.style.transform = `rotateY(${target}deg)`;
    }
    return () => {
      canceled = true;
      el.style.transform = getComputedStyle(el).transform;
      animation.current?.cancel();
    };
  }, [busy, pending, motion, round?.requestId, side]);
  return { coin, landing, side };
}

export default function CoinFlip(p: Props) {
  const { coin, landing, side } = useCoinAnimation(
    p.busy,
    p.pending,
    p.motion,
    p.round,
  );
  const [hostPaused, setHostPaused] = useState(false);
  const [hostFailed, setHostFailed] = useState(false);
  const [pageVisible, setPageVisible] = useState(!document.hidden);
  const video = useRef<HTMLVideoElement>(null);
  const moving = p.busy || landing;
  const disabled = p.locked || landing;
  const result = !moving && !p.pending ? p.round : null;
  const won = result?.status === "won";
  const multiplier = p.config
    ? Math.min(
        p.config.maxMultiplier,
        Math.floor((p.config.rtp * 2 + 1e-10) * 100) / 100,
      )
    : null;
  const valid =
    /^\d+(\.\d{1,2})?$/.test(p.stake) &&
    Number.isSafeInteger(Math.round(Number(p.stake) * 100));
  const expected =
    multiplier !== null && valid
      ? collectionPayout(BigInt(Math.round(Number(p.stake) * 100)), multiplier)
      : null;
  const min = Number(p.config?.minStakePaise ?? 100) / 100;
  const max =
    Math.min(Number(p.config?.maxStakePaise ?? 0), Number(p.balance ?? 0)) /
    100;
  const clampStake = (value: number) =>
    p.setStake(Math.max(0, Math.min(max, Math.max(min, value))).toFixed(2));
  const hostPlaying = p.motion && !hostPaused && pageVisible && !hostFailed;
  useEffect(() => {
    const change = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", change);
    return () => document.removeEventListener("visibilitychange", change);
  }, []);
  useEffect(() => {
    if (!video.current) return;
    if (hostPlaying) void video.current.play().catch(() => setHostPaused(true));
    else video.current.pause();
  }, [hostPlaying]);
  const recent = p.history.filter((r) => r.status !== "active").slice(0, 10);
  return (
    <div className="cf-page" data-testid="collection-page">
      <header className="cf-header">
        <div className="cf-brand">
          <Link href="/" className="cf-icon" aria-label="Back to lobby">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <span>{B2C_STANDALONE ? B2C_BRAND : "LUNAR"} ORIGINALS</span>
            <h1>
              Coin Flip<span className="cf-edition">STUDIO</span>
            </h1>
          </div>
        </div>
        <div className="cf-header-tools">
          <div className="cf-wallet">
            <Wallet size={18} />
            <div>
              <small>YOUR BALANCE</small>
              <strong data-testid="collection-balance">
                {p.balance === undefined ? "Connecting…" : money(p.balance)}
              </strong>
            </div>
          </div>
          <button
            className="cf-icon"
            aria-label="Game rules"
            onClick={() => p.openPanel("rules")}
          >
            <CircleHelp size={20} />
          </button>
          <button
            className="cf-icon"
            aria-label={p.sound ? "Mute sound" : "Enable sound"}
            onClick={p.toggleSound}
          >
            {p.sound ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
        </div>
      </header>
      <main className="cf-layout">
        <section className="cf-experience" aria-label="Coin Flip studio">
          <div className={`cf-studio ${moving ? "is-flipping" : ""}`}>
            <div className="cf-studio-arch" />
            <div className="cf-studio-heading">
              <span className="cf-eyebrow">THE COIN FLIP STUDIO</span>
              <h2>
                One coin.
                <br />
                <em>Your call.</em>
              </h2>
              <p>Heads or tails. Make your pick.</p>
            </div>
            <div className="cf-host">
              <img
                className="cf-host-poster"
                src={`${media}dragon-tiger-one-day/dealer-studio.jpg`}
                alt="AI animated female studio host"
              />
              {!hostFailed && p.motion && (
                <video
                  ref={video}
                  className="cf-host-video"
                  src={`${media}dragon-tiger-one-day/dealer-idle.mp4`}
                  poster={`${media}dragon-tiger-one-day/dealer-studio.jpg`}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  onError={() => setHostFailed(true)}
                  aria-hidden="true"
                  data-testid="coin-host-video"
                />
              )}
              <div className="cf-host-caption">
                <span>YOUR AI HOST</span>
                <small>Looped studio video</small>
              </div>
            </div>
            {p.motion && !hostFailed && (
              <button
                className="cf-host-toggle"
                aria-label={hostPaused ? "Play host video" : "Pause host video"}
                onClick={() => setHostPaused((v) => !v)}
              >
                {hostPaused ? <Play size={13} /> : <Pause size={13} />}
              </button>
            )}
            <div className="cf-table" />
            <div className="cf-coin-scene">
              <div className="cf-coin-halo" />
              <div className="cf-coin-lift">
                <div
                  ref={coin}
                  className="cf-coin"
                  role="img"
                  aria-label={moving ? "Coin flipping" : `Coin showing ${side}`}
                  data-testid="coin-face"
                  data-side={moving ? "flipping" : side}
                >
                  <div className="cf-coin-front">
                    <img src={face("heads")} alt="" draggable={false} />
                  </div>
                  <div className="cf-coin-back">
                    <img src={face("tails")} alt="" draggable={false} />
                  </div>
                </div>
              </div>
              <div className="cf-coin-shadow" />
            </div>
            <div
              className={`cf-result ${won ? "is-win" : result ? "is-loss" : ""}`}
              role="status"
              aria-live="polite"
              data-testid="collection-result"
            >
              {moving ? (
                <>
                  <span className="cf-eyebrow">
                    {landing ? "THE COIN IS LANDING" : "YOUR FLIP IS IN PLAY"}
                  </span>
                  <strong>Flipping the coin…</strong>
                  <small>Your call: {p.choice.toUpperCase()}</small>
                </>
              ) : p.pending ? (
                <>
                  <span className="cf-eyebrow">BET AWAITING CONFIRMATION</span>
                  <strong>Recover your flip</strong>
                  <small>Retry your original bet to confirm its result.</small>
                </>
              ) : result ? (
                <>
                  <span className="cf-eyebrow">
                    {side.toUpperCase()} LANDED · YOU PICKED{" "}
                    {result.options.choice.toUpperCase()}
                  </span>
                  <strong>
                    {won
                      ? `${money(result.payoutAmount)} returned`
                      : "Round over · no win"}
                  </strong>
                  <small>
                    {won
                      ? "Returned to your wallet"
                      : `Stake ${money(result.stakeAmount)} · Return ₹0.00`}
                  </small>
                </>
              ) : (
                <>
                  <span className="cf-eyebrow">READY WHEN YOU ARE</span>
                  <strong>Heads or tails?</strong>
                  <small>Select a side, set your stake, then flip.</small>
                </>
              )}
            </div>
          </div>
          <div className="cf-recent">
            <div>
              <History size={15} />
              <span>Your recent flips</span>
            </div>
            <div className="cf-recent-coins">
              {recent.length ? (
                recent.map((r) => (
                  <span
                    key={r.requestId}
                    title={`${sideOf(r).toUpperCase()} · ${r.status} · Return ${money(r.payoutAmount)}`}
                    aria-label={`${sideOf(r)}: ${r.status}`}
                  >
                    <img src={face(sideOf(r))} alt="" />
                  </span>
                ))
              ) : (
                <small>Your results will appear here</small>
              )}
            </div>
            <button
              className="cf-icon"
              aria-label="Recent rounds"
              onClick={() => p.openPanel("history")}
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
            {(["heads", "tails"] as const).map((s) => (
              <button
                key={s}
                aria-label={`Bet on ${s === "heads" ? "Heads" : "Tails"}`}
                aria-pressed={p.choice === s}
                disabled={disabled}
                onClick={() => p.select(s)}
                className={`cf-choice ${p.choice === s ? "is-selected" : ""}`}
              >
                <span className="cf-choice-check">
                  {p.choice === s && <Check size={12} />}
                </span>
                <img src={face(s)} alt="" />
                <strong>{s.toUpperCase()}</strong>
                <small>
                  {multiplier === null ? "—" : `${multiplier.toFixed(2)}×`}{" "}
                  return
                </small>
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
              value={p.stake}
              onChange={(e) => p.setStake(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              disabled={disabled}
            />
            <button
              aria-label="Halve bet"
              disabled={disabled || !valid || max < min}
              onClick={() => clampStake(Number(p.stake) / 2)}
            >
              ½
            </button>
            <button
              aria-label="Double bet"
              disabled={disabled || !valid || max < min}
              onClick={() => clampStake(Number(p.stake) * 2)}
            >
              2×
            </button>
          </div>
          <div className="cf-limits">
            <span>
              {p.config
                ? `Min ${money(p.config.minStakePaise)} · Max ${money(p.config.maxStakePaise)}`
                : "Loading game limits…"}
            </span>
            <button
              disabled={disabled || max < min}
              onClick={() => clampStake(max)}
              aria-label="Maximum bet"
            >
              MAX
            </button>
          </div>
          <ChipRack
            chip={Number(p.stake) || 0}
            onSelect={(value) => p.setStake(String(value))}
            disabled={disabled || !p.config}
            layout="fit"
            minValue={min}
            maxValue={max}
            idSuffix="-coin-flip"
          />
          <div className="cf-return">
            <div>
              <span>Total return on a win</span>
              <small>Includes your stake</small>
            </div>
            <strong data-testid="coin-potential-return">
              {expected === null ? "—" : money(expected)}
            </strong>
          </div>
          {p.error && (
            <div className="cf-error" role="alert">
              <span>{p.error}</span>
              <button onClick={p.refresh} disabled={moving}>
                <RefreshCw size={14} /> Reconnect
              </button>
            </div>
          )}
          <button
            className="cf-play"
            data-testid="collection-play"
            disabled={moving || !p.canPlay}
            onClick={p.play}
          >
            {moving ? (
              <>
                <RefreshCw size={18} className="ic-spin" /> Flipping…
              </>
            ) : p.pending ? (
              <>
                <RefreshCw size={18} /> Retry pending bet
              </>
            ) : (
              <>
                <span>Flip the coin</span>
                <ArrowUpRight size={20} />
              </>
            )}
          </button>
          <p className="cf-play-hint">
            {moving
              ? "Your bet is locked while the coin flips."
              : p.playHint ||
                `${p.choice === "tails" ? "Tails" : "Heads"} selected · Tap to place your bet`}
          </p>
          <p className="cf-host-note">
            AI animated host presentation. Each flip is an independent game result.
          </p>
        </section>
      </main>
      <footer className="cf-footer">
        <span>
          COIN FLIP <i />{" "}
          {p.config
            ? `${(p.config.rtp * 100).toFixed(0)}% target RTP`
            : "Instant game"}
        </span>
        <div>
          <button
            onClick={() => p.openPanel("rules")}
            aria-label="Read game rules"
          >
            <CircleHelp size={14} /> How to play
          </button>
          <button onClick={() => p.openPanel("fairness")}>
            <ShieldCheck size={14} /> Round details
          </button>
        </div>
      </footer>
      {p.children}
    </div>
  );
}
