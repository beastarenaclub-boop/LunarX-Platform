import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  CircleHelp,
  History,
  Maximize,
  Minimize,
  RotateCcw,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  Users,
  Check,
  Zap,
} from "lucide-react";
import {
  W20_SPOTS,
  W20_COLORS,
  W20_WHEEL,
  W20_RTP,
  w20Profit,
  type W20Outcome,
  type W20Spot,
} from "@workspace/api-zod/wheel20-live";
import { useWheel20Live } from "@/components/wheel20live/useWheel20Live";
import { PrizeWheel } from "@/components/wheel20live/PrizeWheel";
import {
  StudioPerformance,
  type StudioAudioControl,
  type CommentaryState,
} from "@/components/wheel20live/StudioPerformance";
import type { W20Playback } from "@/components/wheel20live/studioTiming";
import { useAuth } from "@/lib/auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/wheel20live/wheel20-live.css";

const media = `${import.meta.env.BASE_URL}media/wheel20-live/`;
// Start existing installations in automatic mode. Explicit mute choices made
// with the new controls remain remembered across visits.
const commentaryPreference = "w20:commentary:auto-v1";
const money = (n: number | string) =>
  `₹${(Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const chips = [10, 50, 100, 500, 1000, 5000];
const chipColors = [
  "#63b1ee",
  "#dc758a",
  "#b7b9c8",
  "#b596ea",
  "#d9ad59",
  "#79c7aa",
];
function read(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Optional preferences. */
  }
}
function favoriteIds(key: string): string[] {
  try {
    const v = JSON.parse(read(key, "[]"));
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default function Wheel20Live() {
  const game = useWheel20Live(),
    { user } = useAuth();
  const root = useRef<HTMLDivElement>(null),
    music = useRef<HTMLAudioElement>(null),
    audio = useRef<AudioContext | null>(null);
  const playback = useRef<W20Playback>({
    roundId: "",
    stage: "waiting",
    mediaTime: 0,
    ready: false,
  });
  const studioAudio = useRef<StudioAudioControl | null>(null);
  const [commentaryState, setCommentaryState] =
    useState<CommentaryState>("loading");
  const [commentaryDelayed, setCommentaryDelayed] = useState(false);
  useEffect(() => {
    setCommentaryDelayed(false);
    if (commentaryState !== "loading") return;
    const timer = window.setTimeout(() => setCommentaryDelayed(true), 4000);
    return () => window.clearTimeout(timer);
  }, [commentaryState]);
  const [chip, setChip] = useState(10),
    [sound, setSound] = useState(
      () => read(commentaryPreference, "on") === "on",
    );
  const changeSound = (enabled: boolean) => {
    studioAudio.current?.setEnabled(enabled);
    save(commentaryPreference, enabled ? "on" : "off");
    setSound(enabled);
  };
  const [panel, setPanel] = useState<"rules" | "history" | null>(null),
    [fullscreen, setFullscreen] = useState(false),
    [landed, setLanded] = useState<string | null>(null);
  const [verify, setVerify] = useState(""),
    [favorite, setFavorite] = useState(false);
  const favoriteKey = `lunar:lobby:favourites:${user?.id ?? "guest"}`;
  useEffect(
    () => setFavorite(favoriteIds(favoriteKey).includes("wheel-2-live")),
    [favoriteKey],
  );
  const round = game.snapshot,
    id = round?.roundId ?? "",
    outcome = game.outcome;
  const previous =
    (round?.recent[0]?.outcome as W20Outcome | undefined)?.segment ?? 0;
  const landedNow =
    !!outcome &&
    (landed === id || game.clock >= (round?.revealEndsAt ?? Infinity));
  const betting = game.bettingOpen;
  const status = !game.fresh
    ? "CONNECTING TO TABLE"
    : !game.ready
      ? "TABLE UNAVAILABLE"
      : betting
        ? game.confirmed
          ? "BETS CONFIRMED"
          : "PLACE YOUR BETS"
        : landedNow
          ? `WINNING NUMBER · ${outcome!.winner}`
          : "NO MORE BETS · WHEEL SPINNING";
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const tone = useCallback((kind: "tick" | "chip" | "win") => {
    if (!soundRef.current || document.hidden) return;
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      const notes =
        kind === "win"
          ? [523.25, 659.25, 783.99]
          : kind === "tick"
            ? [390]
            : [980];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(),
          g = ctx.createGain(),
          t = ctx.currentTime + i * 0.12;
        o.type = kind === "tick" ? "triangle" : "sine";
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.06);
        g.gain.setValueAtTime(kind === "tick" ? 0.028 : 0.065, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.1);
      });
    } catch {
      /* Optional browser audio. */
    }
  }, []);
  useEffect(() => {
    document.title = "Wheel 2.0 Live · Lunar";
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    const sync = () => {
      if (document.hidden) {
        music.current?.pause();
        return;
      }
      if (music.current) {
        music.current.volume = 0.035;
        if (sound) void music.current.play().catch(() => {});
        else music.current.pause();
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("pointerdown", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("pointerdown", sync);
    };
  }, [sound]);
  const priorResult = useRef<string | null>(null);
  useEffect(() => {
    if (landedNow && priorResult.current !== id) {
      priorResult.current = id;
      if (game.shown[outcome!.winner]) tone("win");
    }
  }, [landedNow, id, outcome, game.shown, tone]);
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      /* Fullscreen unavailable in some embeds. */
    }
  }
  const iconButton = (
    label: string,
    action: () => void,
    icon: React.ReactNode,
    active = false,
  ) => (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={action}
      className={`w20-icon ${active ? "is-active" : ""}`}
    >
      {icon}
    </button>
  );
  return (
    <div
      className="w20-live"
      ref={root}
      data-phase={round?.phase ?? "connecting"}
    >
      <audio
        ref={music}
        src={`${import.meta.env.BASE_URL}media/lucky7-live/lounge-loop-v1.mp3`}
        loop
        preload="none"
      />
      <div className="w20-stage">
        <div className="w20-studio">
          <div className="w20-camera" data-view="wide">
            <img
              className="w20-poster"
              src={`${media}studio-clean-v4.jpg`}
              alt=""
            />
            <StudioPerformance
              roundId={id}
              clock={game.clock}
              bettingEndsAt={round?.bettingEndsAt ?? 0}
              revealEndsAt={round?.revealEndsAt ?? 0}
              bettingMs={round?.config.bettingWindowMs ?? 20000}
              hasOutcome={!!outcome}
              sound={sound}
              playback={playback}
              audioControl={studioAudio}
              onCommentaryState={setCommentaryState}
            />
            <PrizeWheel
              outcome={outcome}
              previous={previous}
              start={round?.bettingEndsAt ?? 0}
              end={(round?.revealEndsAt ?? 0) - 350}
              clock={game.clock}
              roundId={id}
              playback={playback}
              onLand={() => setLanded(id)}
              onTick={() => {
                if (
                  playback.current.stage !== "spin" ||
                  !playback.current.ready
                )
                  tone("tick");
              }}
            />
            <div className={`w20-studio-sign ${outcome ? "has-boost" : ""}`}>
              {outcome ? (
                <>
                  <small>POWER BOOST</small>
                  <strong>{outcome.boost}×</strong>
                  <b style={{ color: W20_COLORS[outcome.boostSpot] }}>
                    {outcome.boostSpot}
                  </b>
                  <span>{Number(outcome.boostSpot) * outcome.boost}:1</span>
                </>
              ) : (
                <>
                  <small>THE LIVE SHOW</small>
                  <strong>WHEEL</strong>
                  <b>2.0</b>
                  <span>EVERY SPIN. A NEW CHANCE.</span>
                </>
              )}
            </div>
            {landedNow && (
              <div
                className="w20-result"
                role="status"
                data-testid="w20-result"
              >
                <span style={{ background: W20_COLORS[outcome!.winner] }}>
                  {outcome!.winner}
                </span>
                <strong>{w20Profit(outcome!)}:1</strong>
                <small>
                  {outcome!.winner === outcome!.boostSpot
                    ? "POWER BOOST WIN"
                    : "WINNING NUMBER"}
                </small>
              </div>
            )}
          </div>
        </div>
        {(!sound || commentaryState === "blocked" || commentaryDelayed) && (
          <button
            type="button"
            className="w20-audio-start"
            onClick={() => changeSound(true)}
          >
            <Volume2 size={19} />
            {!sound
              ? "Sound off · Start Hindi commentary"
              : commentaryDelayed
                ? "Retry Hindi commentary"
                : "Start Hindi commentary"}
          </button>
        )}
      </div>
      <header className="w20-header">
        <div className="w20-brand">
          <span className="w20-logo">
            W<small>2.0</small>
          </span>
          <div>
            <h1>
              Wheel 2.0 <span>LIVE</span>
            </h1>
            <p>
              {money(game.min)} – {money(game.max)} <i /> <Users size={12} />
              {round?.playerCount ?? 0}
            </p>
          </div>
        </div>
        <nav aria-label="Game controls">
          {iconButton(
            favorite ? "Remove favourite" : "Add favourite",
            () => {
              const ids = favoriteIds(favoriteKey).filter(
                (x) => x !== "wheel-2-live",
              );
              if (!favorite) ids.push("wheel-2-live");
              save(favoriteKey, JSON.stringify(ids));
              setFavorite(!favorite);
            },
            <Star size={18} fill={favorite ? "currentColor" : "none"} />,
            favorite,
          )}
          {iconButton(
            sound && commentaryState !== "blocked"
              ? "Mute sound"
              : "Enable sound",
            () => changeSound(!sound || commentaryState === "blocked"),
            sound && commentaryState !== "blocked" ? (
              <Volume2 size={19} />
            ) : (
              <VolumeX size={19} />
            ),
          )}
          {iconButton(
            "Bet history",
            () => setPanel("history"),
            <History size={18} />,
          )}
          {iconButton(
            "Game rules",
            () => setPanel("rules"),
            <CircleHelp size={18} />,
          )}
          {iconButton(
            fullscreen ? "Exit fullscreen" : "Fullscreen",
            () => void toggleFullscreen(),
            fullscreen ? <Minimize size={18} /> : <Maximize size={18} />,
          )}
          <Link href="/" className="w20-lobby" aria-label="Lobby">
            <ArrowLeft size={15} />
            <span>Lobby</span>
          </Link>
        </nav>
      </header>
      <aside className="w20-round-info">
        <span className="w20-live-dot" />{" "}
        {game.fresh ? "TABLE OPEN" : "CONNECTING"}
        <small>ROUND {id ? id.slice(-8).toUpperCase() : "—"}</small>
        <button
          type="button"
          className={`w20-commentary ${commentaryState === "playing" ? "is-playing" : ""}`}
          onClick={() => changeSound(true)}
          aria-label={
            commentaryState === "playing"
              ? "Hindi commentary is on"
              : "Start Hindi commentary"
          }
        >
          <Volume2 size={13} />
          <span>
            {commentaryState === "playing"
              ? "HINDI COMMENTARY ON"
              : commentaryState === "loading"
                ? "LOADING COMMENTARY"
                : "START HINDI COMMENTARY"}
          </span>
          {commentaryState === "playing" && (
            <i className="w20-voice-bars" aria-hidden="true">
              <b />
              <b />
              <b />
            </i>
          )}
        </button>
      </aside>
      <main className="w20-dock">
        <div
          className={`w20-status ${betting ? "is-open" : ""} ${landedNow ? "is-result" : ""}`}
          role="status"
        >
          <span>
            {game.confirmed && betting ? (
              <Check size={15} />
            ) : betting ? (
              <span className="w20-count">{game.countdown}</span>
            ) : (
              <Zap size={15} />
            )}{" "}
            {status}
          </span>
          <div className="w20-timer-track">
            <i
              style={{
                width: `${betting ? Math.max(0, Math.min(100, (((round?.bettingEndsAt ?? 0) - game.clock) / (round?.config.bettingWindowMs ?? 20000)) * 100)) : 0}%`,
              }}
            />
          </div>
        </div>
        <div className="w20-bets" aria-label="Betting board">
          {W20_SPOTS.map((spot: W20Spot) => (
            <button
              key={spot}
              type="button"
              aria-label={`Bet on ${spot}`}
              data-spot={spot}
              disabled={game.locked || !game.ready}
              onClick={() => {
                if (game.add(spot, chip)) tone("chip");
              }}
              className={`w20-bet ${landedNow && outcome?.winner === spot ? "is-winner" : ""} ${game.shown[spot] ? "has-bet" : ""}`}
              style={{ "--spot": W20_COLORS[spot] } as CSSProperties}
            >
              {outcome?.boostSpot === spot && <em>{outcome.boost}× BOOST</em>}
              <span>{spot}</span>
              <small>
                {outcome?.boostSpot === spot
                  ? Number(spot) * outcome.boost
                  : spot}
                :1
              </small>
              {!!game.shown[spot] && (
                <b className="w20-wager">{money(game.shown[spot]!)}</b>
              )}
            </button>
          ))}
        </div>
        <div className="w20-actions">
          <div className="w20-edit-actions">
            <button
              aria-label="Undo bet"
              disabled={!game.canUndo}
              onClick={game.undo}
            >
              <Undo2 size={18} />
              <small>Undo</small>
            </button>
            <button
              aria-label="Clear bets"
              disabled={game.locked || !game.draftTotal}
              onClick={game.clear}
            >
              <Trash2 size={17} />
              <small>Clear</small>
            </button>
          </div>
          <div className="w20-chips" aria-label="Choose chip value">
            {chips.map((v, i) => (
              <button
                key={v}
                aria-label={`Select ₹${v} chip`}
                aria-pressed={v === chip}
                className={v === chip ? "is-selected" : ""}
                style={{ "--chip": chipColors[i] } as CSSProperties}
                onClick={() => {
                  setChip(v);
                  tone("chip");
                }}
              >
                <span>{v >= 1000 ? `${v / 1000}k` : v}</span>
              </button>
            ))}
          </div>
          <div className="w20-edit-actions">
            <button
              aria-label="Double bets"
              disabled={game.locked || !game.draftTotal}
              onClick={game.double}
            >
              <b>2×</b>
              <small>Double</small>
            </button>
            <button
              aria-label="Repeat previous bets"
              disabled={!game.canRepeat}
              onClick={game.repeat}
            >
              <RotateCcw size={18} />
              <small>Rebet</small>
            </button>
          </div>
          <button
            className="w20-confirm"
            disabled={!game.canConfirm}
            onClick={() => void game.confirm()}
          >
            {game.sending ? (
              "CONFIRMING…"
            ) : game.pending ? (
              "RETRY CONFIRMATION"
            ) : game.confirmed ? (
              <>
                <Check size={16} /> CONFIRMED
              </>
            ) : (
              "CONFIRM BETS"
            )}
          </button>
        </div>
        {game.error && (
          <p className="w20-error" role="alert">
            {game.error}
          </p>
        )}
      </main>
      <footer className="w20-footer">
        <div className="w20-balances">
          <div>
            <small>BALANCE</small>
            <strong data-testid="w20-balance">{money(game.wallet)}</strong>
          </div>
          <div>
            <small>TOTAL BET</small>
            <strong data-testid="w20-total">{money(game.total)}</strong>
          </div>
          <div className="w20-lastwin">
            <small>LAST WIN</small>
            <strong>{money(game.lastWin)}</strong>
          </div>
        </div>
        <div className="w20-recent" aria-label="Recent results">
          {round?.recent.length ? (
            round.recent.map((r) => {
              const o = r.outcome as W20Outcome;
              return (
                <span
                  key={r.roundId}
                  title={`Result ${o.winner} · ${w20Profit(o)}:1`}
                  style={{ background: W20_COLORS[o.winner] }}
                >
                  {o.winner}
                  {o.winner === o.boostSpot && <b>{o.boost}×</b>}
                </span>
              );
            })
          ) : (
            <small>Results appear after the first completed round</small>
          )}
        </div>
        <button
          className="w20-fair"
          onClick={() => setPanel("rules")}
          aria-label="Fairness and rules"
        >
          <ShieldCheck size={18} />
          <span>FAIR PLAY</span>
        </button>
      </footer>
      <Dialog
        open={!!panel}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent className="w20-dialog">
          <DialogTitle>
            {panel === "rules" ? "Wheel 2.0 · How to play" : "Your bet history"}
          </DialogTitle>
          <DialogDescription>
            {panel === "rules"
              ? "Choose your numbers, select a chip, and confirm before betting closes."
              : "Confirmed bets and settled returns from your shared wallet."}
          </DialogDescription>
          {panel === "rules" ? (
            <>
              <p>
                The wheel has 54 segments. All players join the same timed
                round. Winning numbers pay the displayed profit odds plus your
                original stake.
              </p>
              <p>
                After bets close, one random number receives a 2×, 3×, 5× or 8×
                Power Boost. If that number wins, the boost multiplies its
                profit odds. For example, ₹10 on 20 with a 5× boost returns
                ₹1,010.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Number</th>
                    <th>Segments</th>
                    <th>Base profit</th>
                    <th>RTP incl. boost</th>
                  </tr>
                </thead>
                <tbody>
                  {W20_SPOTS.map((s) => (
                    <tr key={s}>
                      <td>{s}</td>
                      <td>{W20_WHEEL.filter((v) => v === s).length}/54</td>
                      <td>{s}:1</td>
                      <td>{(W20_RTP[s] * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Boost weights: 2× 75%, 3× 20%, 5× 4%, 8× 1%; the boosted number
                is uniform across nine choices. Maximum profit is 320:1. This is
                an independent Wheel 2.0 game with an animated studio presenter,
                not a camera livestream.
              </p>
              <p>
                Round outcomes come from a committed server seed. Verify
                completed rounds in your history. Unrevealed interrupted rounds
                refund confirmed bets.
              </p>
              <small className="w20-hash">
                Current seed commitment:{" "}
                {round?.serverSeedHash ?? "Waiting for table"}
              </small>
            </>
          ) : (
            <>
              <div className="w20-history-list">
                {game.historyError ? (
                  <p>History is unavailable. Please try again.</p>
                ) : !game.history.length ? (
                  <p>No confirmed bets yet.</p>
                ) : (
                  game.history.map((h) => (
                    <article key={h.roundId}>
                      <div>
                        <strong>
                          {h.outcome
                            ? `Number ${h.outcome.winner} · ${w20Profit(h.outcome)}:1`
                            : h.status}
                        </strong>
                        <small>
                          {h.bets
                            .map((b) => `${b.spot}: ${money(b.amountPaise)}`)
                            .join(" · ")}
                        </small>
                        <small>{new Date(h.createdAt).toLocaleString()}</small>
                      </div>
                      <div>
                        <strong>{money(h.payoutAmount)}</strong>
                        {h.status === "settled" && (
                          <button
                            onClick={async () => {
                              setVerify("Checking…");
                              try {
                                const v = await game.verify(h.roundId);
                                setVerify(
                                  v.verified
                                    ? `Verified round ${h.roundId}`
                                    : "Verification failed",
                                );
                              } catch {
                                setVerify(
                                  "Verification unavailable. Try again.",
                                );
                              }
                            }}
                          >
                            Verify
                          </button>
                        )}
                      </div>
                    </article>
                  ))
                )}
              </div>
              <p role="status">{verify}</p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
