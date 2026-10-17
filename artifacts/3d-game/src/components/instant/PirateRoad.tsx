import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleHelp,
  Coins,
  History,
  Maximize,
  Minimize,
  Music2,
  Music4,
  RefreshCw,
  ShieldCheck,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  collectionMultiplier,
  type CollectionConfig,
  type CollectionOptions,
  type CollectionRound,
} from "@workspace/api-zod/instant-collection";
import { formatRupees } from "@/lib/format";
import { subscribeAudioState, unlockAudio } from "@/game/audio";
import PirateWater from "./PirateWater";
import "./pirate-road.css";

type Props = {
  round: CollectionRound | null;
  stake: string;
  setStake: (value: string) => void;
  options: CollectionOptions;
  setDifficulty: (value: CollectionOptions["difficulty"]) => void;
  config?: CollectionConfig;
  balance?: string;
  busy: boolean;
  locked: boolean;
  pending: boolean;
  canPlay: boolean;
  playHint: string;
  error: string;
  refresh: () => void;
  act: (action: "place" | "reveal" | "cashout", cell?: number) => void;
  sound: boolean;
  toggleSound: () => void;
  music: boolean;
  toggleMusic: () => void;
  selectSound: () => void;
  motion: boolean;
  openPanel: (panel: "rules" | "history" | "fairness") => void;
  children: ReactNode;
};
const money = (paise: string) => `₹${formatRupees(paise)}`;
const art = `${import.meta.env.BASE_URL}media/chicken-pirate/`;
const difficulties = ["easy", "medium", "hard"] as const;

function Raft({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 180 65" fill="none" aria-hidden="true">
      <ellipse cx="90" cy="54" rx="82" ry="8" fill="#087e8650" />
      <path
        d="M20 13 30 5h127l10 10-4 35-143 3Z"
        fill="#704123"
        stroke="#653921"
        strokeWidth="2"
      />
      <path
        d="m18 12 139-3 9 9-145 3Zm-5 15 151-5 5 11-151 5Zm6 17 146-6-7 12-139 6Z"
        fill="#d7934d"
        stroke="#8f542c"
        strokeWidth="2"
      />
      <path
        d="m23 13 128-2M20 29l137-5M24 46l130-6"
        stroke="#ffd391"
        strokeWidth="2"
      />
      <path
        d={
          index % 2
            ? "m83 10-4 10m26 3-5 12m-39 7-6 11"
            : "m118 10-5 9M49 27l-5 9m86 5-6 11"
        }
        stroke="#643c25"
        strokeWidth="3"
      />
      <path d="m35 12-6 36m116-36-5 33" stroke="#9a8051" strokeWidth="6" />
      <path
        d="m34 12-6 36m116-36-5 33"
        stroke="#ead6a0"
        strokeWidth="2"
        strokeDasharray="3 2"
      />
      <path
        d="m47 15 30-1m33 3 18-1M45 31l33-1m31-1 14-1M44 46l26-1m16-1 28-1"
        stroke="#a96332"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function PirateRoad(p: Props) {
  const [audioState, setAudioState] = useState<AudioContextState | "unsupported">("running");
  useEffect(() => subscribeAudioState(setAudioState), []);
  const root = useRef<HTMLDivElement>(null),
    viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200),
    [fullscreen, setFullscreen] = useState(false),
    [screenError, setScreenError] = useState("");
  const active = p.round?.status === "active",
    lost = p.round?.status === "lost";
  const step = p.round?.step ?? 0,
    result = !active ? p.round : null;
  const rtp = active ? p.round!.rtp : (p.config?.rtp ?? 0.97);
  const cap = active
    ? p.round!.maxMultiplier
    : (p.config?.maxMultiplier ?? 1000);
  // The board and the character share coordinates so the current and next raft
  // stay reachable on narrow screens, including when a saved round is restored.
  const laneWidth = Math.max(142, width * 0.2),
    startWidth = Math.max(140, width * 0.34);
  const sceneWidth = Math.max(width, 600),
    trackWidth = startWidth + laneWidth * 12 + 90;
  const position = step + (lost ? 1 : 0);
  const birdX = position
    ? startWidth + (position - 0.5) * laneWidth
    : width < 600
      ? 90
      : width * 0.18;
  const min = Number(p.config?.minStakePaise ?? 100);
  const max = Math.min(
    Number(p.config?.maxStakePaise ?? 1000000),
    Number(p.balance ?? 0),
  );
  const adjustStake = (paise: number) => {
    p.selectSound();
    p.setStake((Math.max(min, Math.min(max, paise)) / 100).toFixed(2));
  };

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    viewport.current?.scrollTo({
      left: position ? Math.max(0, birdX - width * 0.35) : 0,
      behavior: p.motion ? "smooth" : "instant",
    });
  }, [birdX, width, position, p.motion, p.round?.id]);
  useEffect(() => {
    const update = () =>
      setFullscreen(document.fullscreenElement === root.current);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggleFullscreen = async () => {
    p.selectSound();
    try {
      setScreenError("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      setScreenError("Full screen is unavailable in this browser.");
    }
  };

  return (
    <div className="pr-page" ref={root} data-testid="collection-page">
      <div className="pr-shell">
        <header className="pr-header">
          <Link href="/" className="pr-icon pr-back" aria-label="Back to lobby">
            <ArrowLeft size={18} />
          </Link>
          <h1>
            Chicken Road <span>Pirate Edition</span>
          </h1>
          <div className="pr-header-tools">
            <button
              className="pr-icon"
              aria-label="Recent rounds"
              onClick={() => p.openPanel("history")}
            >
              <History size={18} />
            </button>
            {typeof document.documentElement.requestFullscreen ===
              "function" && (
              <button
                className="pr-icon"
                aria-label={
                  fullscreen ? "Exit full screen" : "Enter full screen"
                }
                onClick={() => void toggleFullscreen()}
              >
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            )}
          </div>
        </header>

        <main className="pr-game" aria-label="Chicken Road Pirate Edition game">
          <section
            className={`pr-stage ${active ? "is-playing" : ""} ${lost ? "is-lost" : ""}`}
            aria-label="Tropical crossing"
          >
            <div className="pr-stage-hud">
              <div className="pr-balance">
                <small>BALANCE</small>
                <strong data-testid="collection-balance">
                  {p.balance === undefined ? "Loading…" : money(p.balance)}
                </strong>
              </div>
              <div className="pr-stage-tools">
                <button
                  className="pr-icon"
                  aria-label={p.sound ? "Mute sound" : "Enable sound"}
                  aria-pressed={p.sound}
                  onClick={p.toggleSound}
                >
                  {p.sound ? <Volume2 size={22} /> : <VolumeX size={22} />}
                </button>
                <button
                  className="pr-icon"
                  aria-label={p.music ? "Mute music" : "Enable music"}
                  aria-pressed={p.music}
                  title={p.music ? "Mute music" : "Enable music"}
                  onClick={p.toggleMusic}
                >
                  {p.music ? <Music2 size={22} /> : <Music4 size={22} opacity={0.5} />}
                </button>
                <button
                  className="pr-icon"
                  aria-label="Game rules"
                  onClick={() => p.openPanel("rules")}
                >
                  <CircleHelp size={22} />
                </button>
              </div>
            </div>

            {(!p.sound || audioState === "suspended") && audioState !== "unsupported" && (
              <button
                className="pr-audio-prompt"
                onClick={() => { if (!p.sound) p.toggleSound(); else void unlockAudio(); }}
                data-testid="pirate-audio-prompt"
              >
                <Volume2 size={17} />
                {p.sound ? "Tap to enable audio" : "Turn on sound"}
              </button>
            )}

            <div
              className="pr-crossing"
              ref={viewport}
              aria-label="Stepping platforms"
              tabIndex={0}
            >
              <div
                className="pr-track"
                style={
                  {
                    width: trackWidth,
                    "--pr-scene-width": `${sceneWidth}px`,
                    "--pr-lane-width": `${laneWidth}px`,
                  } as CSSProperties
                }
              >
                <img
                  className="pr-scenery"
                  src={`${art}tropical-bay-layered.png`}
                  alt=""
                  draggable={false}
                />
                {Array.from(
                  { length: Math.ceil(trackWidth / (sceneWidth * 0.6)) },
                  (_, i) => (
                    <span
                      key={i}
                      className="pr-distant-sea"
                      aria-hidden="true"
                      style={{
                        left: sceneWidth * (0.7 + i * 0.6),
                        width: sceneWidth * 0.7,
                        backgroundImage: `url(${art}tropical-bay-layered.png)`,
                      }}
                    />
                  ),
                )}
                <PirateWater
                  scroller={viewport}
                  width={width}
                  sceneWidth={sceneWidth}
                  motion={p.motion}
                  source={`${art}tropical-bay-layered.png`}
                />
                <div className="pr-ship" aria-hidden="true">
                  <div className="pr-ship-drift">
                    <img
                      src={`${art}pirate-ship.png`}
                      alt=""
                      draggable={false}
                    />
                    <span className="pr-ship-wake" />
                  </div>
                </div>
                {Array.from({ length: 12 }, (_, i) => {
                  const safe = i < step,
                    failed = lost && i === step,
                    next = active && i === step;
                  return (
                    <button
                      key={i}
                      className={`pr-lane ${safe ? "is-safe" : ""} ${next ? "is-next" : ""} ${failed ? "is-failed" : ""}`}
                      style={{ left: startWidth + i * laneWidth }}
                      disabled={!next || p.busy}
                      onClick={() => p.act("reveal", i)}
                      aria-label={`Cross lane ${i + 1}`}
                      aria-current={next ? "step" : undefined}
                    >
                      <span className="pr-token">
                        <strong>
                          ×
                          {collectionMultiplier(
                            "road",
                            i + 1,
                            p.options,
                            rtp,
                            cap,
                          ).toFixed(2)}
                        </strong>
                        {safe && <Check className="pr-token-check" size={17} />}
                      </span>
                      <span className="pr-raft">
                        <Raft index={i} />
                      </span>
                      <span className="pr-lane-number">
                        {String(i + 1).padStart(2, "0")}
                        {safe ? " · CROSSED" : i === 11 ? " · FINISH" : ""}
                      </span>
                    </button>
                  );
                })}
                <div
                  className={`pr-character ${position ? "is-at-sea" : ""} ${lost ? "is-sinking" : ""}`}
                  style={{ left: birdX }}
                  data-testid="pirate-character"
                  data-step={position}
                >
                  <div className="pr-character-idle">
                    <img
                      key={`${p.round?.id ?? "ready"}-${position}`}
                      className={position && !lost ? "pr-hop" : ""}
                      src={`${art}chicken-captain.png`}
                      alt={
                        lost
                          ? "The pirate chicken fell into the sea"
                          : `Pirate chicken ${step ? `on platform ${step}` : "on the starting island"}`
                      }
                      draggable={false}
                    />
                  </div>
                </div>
                {lost && (
                  <div
                    className="pr-splash"
                    style={{ left: birdX }}
                    aria-hidden="true"
                  >
                    <span />
                    <span />
                    <span />
                  </div>
                )}
              </div>
            </div>

            <div
              className={`pr-status ${result ? (lost ? "is-loss" : "is-win") : ""}`}
              role="status"
              aria-live="polite"
              data-testid="collection-result"
            >
              {p.busy ? (
                <>
                  <RefreshCw size={15} className="pr-spin" />
                  <span>Making your move…</span>
                </>
              ) : result ? (
                <>
                  <strong>
                    {lost
                      ? "Round over"
                      : `${result.multiplier.toFixed(2)}× · ${money(result.payoutAmount)}`}
                  </strong>
                  <span>
                    {lost
                      ? "The sea got this one. Ready for another adventure?"
                      : "Returned to your wallet"}
                  </span>
                </>
              ) : active ? (
                <>
                  <strong>{p.round!.multiplier.toFixed(2)}×</strong>
                  <span>
                    {step
                      ? "Keep hopping or collect your treasure"
                      : "Take your first step or return your stake"}
                  </span>
                </>
              ) : (
                <span>
                  Hop across the sea. Collect your treasure along the way.
                </span>
              )}
            </div>
          </section>

          <div className="pr-controls">
            <div className="pr-control-tray">
              <div className="pr-bet">
                <label htmlFor="pr-stake" className="pr-sr-only">
                  Bet amount
                </label>
                <div className="pr-amount">
                  <button
                    disabled={p.locked}
                    onClick={() => adjustStake(min)}
                    aria-label="Minimum bet"
                  >
                    MIN
                  </button>
                  <div>
                    <span>₹</span>
                    <input
                      id="pr-stake"
                      aria-label="Bet amount"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={p.stake}
                      onChange={(e) => p.setStake(e.target.value)}
                      disabled={p.locked}
                    />
                  </div>
                  <button
                    disabled={p.locked || p.balance === undefined || max < min}
                    onClick={() => adjustStake(max)}
                    aria-label="Maximum bet"
                  >
                    MAX
                  </button>
                </div>
                <div className="pr-increments">
                  {[10, 20, 50, 100].map((n) => (
                    <button
                      key={n}
                      disabled={p.locked}
                      onClick={() =>
                        adjustStake(
                          (Number.isFinite(Number(p.stake))
                            ? Math.round(Number(p.stake) * 100)
                            : min) +
                            n * 100,
                        )
                      }
                      aria-label={`Add ${n} rupees`}
                    >
                      +{n.toFixed(2)}
                    </button>
                  ))}
                </div>
              </div>
              <fieldset className="pr-difficulty" disabled={p.locked}>
                <legend>Difficulty</legend>
                <p>Higher difficulty, higher multipliers.</p>
                <div className="pr-difficulty-options">
                  {difficulties.map((difficulty) => (
                    <button
                      key={difficulty}
                      aria-pressed={p.options.difficulty === difficulty}
                      onClick={() => p.setDifficulty(difficulty)}
                    >
                      {difficulty[0].toUpperCase() + difficulty.slice(1)}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className={`pr-actions ${active ? "has-round" : ""}`}>
                {active ? (
                  <>
                    <button
                      className="pr-play"
                      disabled={p.busy}
                      onClick={() => p.act("reveal", step)}
                      aria-label={`Cross lane ${step + 1}`}
                    >
                      Hop <ArrowRight size={22} />
                    </button>
                    <button
                      className="pr-cashout"
                      disabled={p.busy}
                      onClick={() => p.act("cashout")}
                      data-testid="collection-cashout"
                    >
                      <span>
                        <Coins size={16} /> {step ? "Cash out" : "Return stake"}
                      </span>
                      <strong>{money(p.round!.cashoutAmount)}</strong>
                    </button>
                  </>
                ) : (
                  <button
                    className="pr-play"
                    disabled={!p.canPlay}
                    onClick={() => p.act("place")}
                    data-testid="collection-play"
                  >
                    {p.busy ? (
                      <RefreshCw className="pr-spin" size={24} />
                    ) : p.pending ? (
                      "Retry pending bet"
                    ) : (
                      "Play"
                    )}
                  </button>
                )}
              </div>
            </div>
            {!active && p.playHint && (
              <p className="pr-play-hint" role="status">
                {p.playHint}
              </p>
            )}
          </div>
          {(p.error || screenError) && (
            <div className="pr-error" role="alert">
              <span>{p.error || screenError}</span>
              <button
                disabled={p.busy}
                onClick={() => {
                  setScreenError("");
                  p.refresh();
                }}
              >
                Refresh
              </button>
            </div>
          )}
        </main>

        <footer className="pr-footer">
          <span>
            <ShieldCheck size={14} />
            {active
              ? `Crossed ${step} of 12 · Round saved`
              : "12 platforms. One brave captain."}
          </span>
          <nav aria-label="Game information">
            <button
              onClick={() => p.openPanel("rules")}
              aria-label="Read game rules"
            >
              How to play
            </button>
            <button onClick={() => p.openPanel("history")}>History</button>
            <button onClick={() => p.openPanel("fairness")}>
              Round details
            </button>
          </nav>
        </footer>
        {p.children}
      </div>
    </div>
  );
}
