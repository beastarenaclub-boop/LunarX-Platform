import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
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
} from "lucide-react";
import {
  L7_LABELS,
  L7_PROFIT,
  L7_SPOTS,
  isRed,
  mainSpot,
  rankLabel,
  wins,
  type L7Card,
  type L7Spot,
} from "@workspace/api-zod/lucky7-live";
import { useLucky7Live } from "@/components/lucky7live/useLucky7Live";
import { useDealerVideo } from "@/components/lucky7live/useDealerVideo";
import { useTableMusic } from "@/components/lucky7live/useTableMusic";
import { TrackedCard } from "@/components/lucky7live/TrackedCard";
import { CardInk } from "@/components/lucky7live/CardInk";
import { useAuth } from "@/lib/auth";
import { installAudioAutostart } from "@/game/audioAutostart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import "@/components/lucky7live/lucky7-live.css";

const media = `${import.meta.env.BASE_URL}media/lucky7-live/`;
function favorites(key: string): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(ids)
      ? ids.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
function soundEnabled() {
  try {
    return localStorage.getItem("l7:sound") !== "off";
  } catch {
    return true;
  }
}
const suits = { hearts: "♥", diamonds: "♦", clubs: "♣", spades: "♠" };
const money = (n: number | string) =>
  `₹${(Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const chips = [50, 100, 500, 1000, 5000, 10000];
const colors = [
  "#d18c61",
  "#afbccb",
  "#b53950",
  "#324785",
  "#654287",
  "#b4a466",
];
const short = (n: number) => (n >= 1000 ? `${n / 1000}k` : String(n));
function Logo({ small = false }: { small?: boolean }) {
  return (
    <div
      className={`l7-logo${small ? " l7-logo-small" : ""}`}
      aria-label="Lucky 7 Live"
    >
      <span>LIVE</span>
      <strong>7</strong>
      <b>LUCKY</b>
    </div>
  );
}
function PlayingCard({ card, mini = false }: { card: L7Card; mini?: boolean }) {
  return (
    <span
      className={`l7-card ${isRed(card) ? "is-red" : ""} ${mini ? "is-mini" : ""}`}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
    >
      <CardInk card={card} />
    </span>
  );
}
export default function Lucky7Live() {
  const game = useLucky7Live();
  const { user } = useAuth();
  const favoriteKey = `lunar:lobby:favourites:${user?.id ?? "guest"}`;
  const root = useRef<HTMLDivElement>(null),
    audio = useRef<AudioContext | null>(null);
  const [chip, setChip] = useState(50),
    [panel, setPanel] = useState<"rules" | "history" | "settings" | null>(null);
  const [sound, setSound] = useState(soundEnabled);
  const music = useTableMusic(sound);
  const [favorite, setFavorite] = useState(() =>
    favorites(favoriteKey).includes("lucky-7-live"),
  );
  const [motion, setMotion] = useState(
      () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [full, setFull] = useState(false),
    [roadmap, setRoadmap] = useState(false);
  const [verification, setVerification] = useState("");
  const [dealerSource] = useState(
    () =>
      `${media}${window.matchMedia("(max-width: 700px)").matches ? "dealer-natural-mobile-v5.mp4" : "dealer-natural-v5.mp4"}`,
  );
  const dealer = useDealerVideo({
    snapshot: game.snapshot,
    clock: game.clock,
    fresh: game.fresh,
    motion,
    hasCard: !!game.card,
  });
  const card = dealer.faceReady ? game.card : null;
  const previousCard = useRef<L7Card | null>(null);
  useEffect(() => {
    if (game.card) previousCard.current = game.card;
  }, [game.card]);
  // Keep the previous ink on the physical card during collection. The
  // betting/result UI still uses only the current round's outcome.
  const tableCard =
    game.card ??
    (game.snapshot?.phase === "betting"
      ? (previousCard.current ??
        (game.snapshot.recent[0]?.outcome as L7Card | undefined) ??
        null)
      : null);
  function tone(kind: "chip" | "card" | "win") {
    if (!sound || document.hidden || audio.current?.state !== "running") return;
    try {
      const ctx = (audio.current ??= new AudioContext());
      void ctx.resume();
      const frequencies =
        kind === "win"
          ? [523.25, 659.25, 783.99]
          : kind === "card"
            ? [330, 440]
            : [1100];
      frequencies.forEach((f, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          start = ctx.currentTime + i * 0.09;
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.045, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.15);
      });
    } catch {
      /* Audio is optional. */
    }
  }
  const seenCard = useRef<string | null>(null),
    seenPayout = useRef<string | null>(null);
  useEffect(() => {
    if (!sound) return;
    return installAudioAutostart(() => {
      const ctx = (audio.current ??= new AudioContext());
      return ctx.state !== "running" ? ctx.resume() : undefined;
    });
  }, [sound]);
  useEffect(() => {
    document.title = "Lucky 7 Live · Lunar";
    return () => {
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (card && game.snapshot?.roundId !== seenCard.current) {
      seenCard.current = game.snapshot?.roundId ?? null;
      tone("card");
    }
  }, [card, game.snapshot?.roundId]);
  useEffect(() => {
    const h = game.history.find((h) => h.status === "settled");
    if (!h) return;
    if (
      seenPayout.current &&
      seenPayout.current !== h.roundId &&
      Number(h.payoutAmount) > 0
    )
      tone("win");
    seenPayout.current = h.roundId;
  }, [game.history]);
  useEffect(() => {
    const cb = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", cb);
    return () => document.removeEventListener("fullscreenchange", cb);
  }, []);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {
      /* Browser may disallow fullscreen in embedded views. */
    }
  }
  const toggleSound = () =>
    setSound((s) => {
      try {
        localStorage.setItem("l7:sound", s ? "off" : "on");
      } catch {
        /* Optional preference. */
      }
      return !s;
    });
  const recent = game.snapshot?.recent ?? [];
  const status = !game.fresh
    ? "CONNECTING TO TABLE"
    : !game.ready && game.bettingOpen
      ? "TABLE UNAVAILABLE"
      : game.bettingOpen
        ? game.confirmed
          ? "BETS CONFIRMED"
          : "PLACE YOUR BETS"
        : card
          ? "GAME RESULT"
          : "NO MORE BETS";
  const betSpot = (spot: L7Spot, main = false) => (
    <button
      key={spot}
      type="button"
      data-spot={spot}
      aria-label={`Bet on ${L7_LABELS[spot]}`}
      disabled={game.locked || !game.ready}
      onClick={() => {
        if (game.add(spot, chip)) tone("chip");
      }}
      className={`l7-spot l7-${spot} ${main ? "is-main" : ""} ${card && wins(spot, card) ? "is-winner" : ""}`}
    >
      <span>{spot === "seven" ? "7" : L7_LABELS[spot].toUpperCase()}</span>
      <small>{L7_PROFIT[spot]}</small>
      {main && card && mainSpot(card) === spot && (
        <span className="l7-winning-card" data-testid="l7-result-card">
          <PlayingCard card={card} />
        </span>
      )}
      {!!game.shown[spot] && !(main && card) && (
        <b className="l7-placed-chip">{money(game.shown[spot]!)}</b>
      )}
    </button>
  );
  return (
    <div ref={root} className="l7-live">
      <link
        rel="preload"
        as="image"
        href={`${media}dealer-hand-masks-v5.png`}
      />
      <audio
        ref={music}
        src={`${media}lounge-loop-v1.mp3`}
        preload="none"
        loop
        data-testid="l7-background-music"
      />
      <header className="l7-header">
        <Link href="/" className="l7-icon" aria-label="Back to lobby">
          <ArrowLeft size={19} />
        </Link>
        <h1>
          Lucky 7 <span>Live</span>
        </h1>
        <div className="l7-header-spacer" />
        <span className="l7-connection">
          <i className={game.fresh ? "is-online" : ""} />
          {game.fresh ? "TABLE CONNECTED" : "CONNECTING"}
        </span>
        <button
          className={`l7-icon ${favorite ? "is-favorite" : ""}`}
          aria-label={favorite ? "Remove favorite" : "Add favorite"}
          aria-pressed={favorite}
          onClick={() => {
            setFavorite(!favorite);
            try {
              const ids = favorites(favoriteKey).filter(
                (id) => id !== "lucky-7-live",
              );
              if (!favorite) ids.push("lucky-7-live");
              localStorage.setItem(favoriteKey, JSON.stringify(ids));
            } catch {
              /* Optional. */
            }
          }}
        >
          <Star size={18} />
        </button>
        <button
          className="l7-icon"
          aria-label="Toggle fullscreen"
          onClick={fullscreen}
        >
          {full ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </header>
      <main className="l7-table-shell">
        <section
          className="l7-stage"
          aria-label="Lucky 7 dealer studio"
          style={
            {
              "--l7-poster": `url(${media}dealer-natural-poster-v5.jpg)`,
            } as CSSProperties
          }
        >
          <div className="l7-camera" data-dealer-cue={dealer.cueName}>
            <video
              ref={dealer.video}
              className="l7-dealer"
              style={{ opacity: dealer.mediaError ? 0 : 1 }}
              muted
              playsInline
              preload="auto"
              poster={`${media}dealer-natural-poster-v5.jpg`}
              onError={dealer.onMediaError}
              onLoadedData={dealer.onMediaLoaded}
            >
              <source
                src={dealerSource}
                type="video/mp4"
                onError={dealer.onMediaError}
              />
            </video>
            <canvas
              ref={dealer.transition}
              hidden={dealer.mediaError}
              className="l7-dealer-transition"
              aria-hidden="true"
            />
            <div
              className={`l7-deal-zone ${!game.bettingOpen && game.fresh && !card ? "is-dealing" : ""}`}
            >
              <TrackedCard
                card={tableCard}
                time={dealer.frameTime}
                fallback={dealer.mediaError}
                video={dealer.video}
              />
            </div>
          </div>
          <div className="l7-stage-shade" />
          <div className="l7-stage-top">
            <Link href="/" className="l7-more">
              <span>L</span> More Games
            </Link>
            <div className="l7-tools">
              <button
                type="button"
                className={`l7-live-button ${motion && game.fresh && !dealer.mediaError ? "is-live" : ""}`}
                aria-label={motion ? "Pause live dealer" : "Resume live dealer"}
                aria-pressed={motion}
                title={
                  motion ? "Pause dealer video" : "Resume live dealer video"
                }
                onClick={() => setMotion((playing) => !playing)}
              >
                <i aria-hidden="true" /> LIVE
              </button>
              <button aria-label="Game rules" onClick={() => setPanel("rules")}>
                <CircleHelp />
              </button>
              <button
                aria-label="Bet history"
                onClick={() => setPanel("history")}
              >
                <History />
              </button>
              <button
                aria-label={sound ? "Mute sound" : "Enable sound"}
                aria-pressed={sound}
                onClick={toggleSound}
              >
                {sound ? <Volume2 /> : <VolumeX />}
              </button>
              <button
                aria-label="Table settings"
                onClick={() => setPanel("settings")}
              >
                <span className="l7-menu-lines">☰</span>
              </button>
            </div>
          </div>
          <span className="l7-studio-label">
            LUNAR STUDIO <i /> AI DEALER
          </span>
          {dealer.mediaError && (
            <span className="l7-media-note">
              Dealer video unavailable · table remains connected
            </span>
          )}
          {card && (
            <div
              className={`l7-result l7-result-${mainSpot(card)}`}
              role="status"
            >
              <span>
                {mainSpot(card) === "seven"
                  ? "LUCKY 7"
                  : L7_LABELS[mainSpot(card)].toUpperCase()}{" "}
                WINS
              </span>
              <small>
                {rankLabel(card.rank)} {suits[card.suit]} ·{" "}
                {isRed(card) ? "RED" : "BLACK"} ·{" "}
                {card.rank % 2 ? "ODD" : "EVEN"}
              </small>
            </div>
          )}
          {game.bettingOpen && (
            <div
              className="l7-countdown"
              style={
                {
                  "--progress": `${Math.min(100, (game.countdown / ((game.snapshot?.config.bettingWindowMs ?? 20000) / 1000)) * 100)}%`,
                } as CSSProperties
              }
            >
              <strong>{game.countdown}</strong>
              <span>BETTING</span>
            </div>
          )}
          <button
            className="l7-road-toggle"
            aria-expanded={roadmap}
            onClick={() => setRoadmap(!roadmap)}
          >
            {roadmap ? <ChevronDown size={17} /> : <ChevronUp size={17} />}{" "}
            Recent results
          </button>
          {roadmap && (
            <div className="l7-roadmap">
              <span>LAST 20</span>
              {recent.length ? (
                recent.map((r) => (
                  <PlayingCard
                    key={r.roundId}
                    card={r.outcome as L7Card}
                    mini
                  />
                ))
              ) : (
                <p>Results appear after the first round.</p>
              )}
            </div>
          )}
        </section>
        <section className="l7-dock" aria-label="Betting controls">
          <div className={`l7-phase ${game.bettingOpen ? "is-open" : ""}`}>
            <span>{status}</span>
            {game.fresh && <b>{game.countdown}s</b>}
            <div
              style={{
                width: game.bettingOpen
                  ? `${Math.min(100, (game.countdown * 100) / ((game.snapshot?.config.bettingWindowMs ?? 20000) / 1000))}%`
                  : "0%",
              }}
            />
          </div>
          <div className="l7-bet-layout">
            <div className="l7-brand">
              <Logo small />
              <span>ONE CARD. YOUR LUCK.</span>
            </div>
            <div className="l7-main-bets">
              {betSpot("up", true)}
              {betSpot("seven", true)}
              {betSpot("down", true)}
            </div>
            <div className="l7-side-area">
              <span className="l7-side-title">
                SIDE BETS{" "}
                <button
                  aria-label="Side bet rules"
                  onClick={() => setPanel("rules")}
                >
                  <CircleHelp size={12} />
                </button>
              </span>
              <div className="l7-side-bets">
                {["red", "odd", "black", "even"].map((s) =>
                  betSpot(s as L7Spot),
                )}
              </div>
            </div>
          </div>
          <div className="l7-controls">
            <div className="l7-chip-rack" aria-label="Choose chip value">
              {chips.map((c, i) => (
                <button
                  key={c}
                  aria-label={`${c} rupee chip`}
                  aria-pressed={chip === c}
                  className={`l7-chip ${chip === c ? "is-selected" : ""}`}
                  style={{ "--chip-color": colors[i] } as CSSProperties}
                  onClick={() => {
                    setChip(c);
                    tone("chip");
                  }}
                >
                  <span>{short(c)}</span>
                </button>
              ))}
            </div>
            <div className="l7-actions">
              <button
                disabled={!game.canUndo}
                onClick={game.undo}
                aria-label="Undo last chip"
              >
                <Undo2 />
                <span>Undo</span>
              </button>
              <button
                aria-label="Double"
                disabled={game.locked || !game.draftTotal}
                onClick={game.double}
              >
                <b>2×</b>
                <span>Double</span>
              </button>
              <button disabled={!game.canRepeat} onClick={game.repeat}>
                <RotateCcw />
                <span>Repeat</span>
              </button>
              <button
                disabled={game.locked || !game.draftTotal}
                onClick={game.clear}
                aria-label="Clear bets"
              >
                <Trash2 />
                <span>Clear</span>
              </button>
            </div>
            <button
              className="l7-confirm"
              disabled={!game.canConfirm}
              onClick={() => {
                tone("chip");
                void game.confirm();
              }}
            >
              {game.sending
                ? "Confirming…"
                : game.pending
                  ? "Retry confirmation"
                  : game.confirmed
                    ? "Bets confirmed ✓"
                    : "Confirm bets"}
              {!game.confirmed && game.total > 0 && (
                <span>{money(game.total)}</span>
              )}
            </button>
          </div>
          <div className="l7-feedback" role="status">
            {game.error ? (
              <span className="l7-error">{game.error}</span>
            ) : game.confirmed ? (
              "Your bets are accepted. Good luck!"
            ) : game.pending ? (
              "Checking your previous confirmation. Retry safely."
            ) : game.bettingOpen ? (
              "Select a chip, choose your bets, then confirm."
            ) : (
              "Next round starts automatically."
            )}
          </div>
          <footer className="l7-footer">
            <span>
              Lucky 7{" "}
              <b>
                {money(game.min)} – {money(game.max)}
              </b>
            </span>
            <span>
              Balance{" "}
              <strong data-testid="l7-wallet">{money(game.wallet)}</strong>
            </span>
            <span>
              Bet <strong>{money(game.total)}</strong>
            </span>
            <span>
              Last return <strong>{money(game.lastWin)}</strong>
            </span>
            <span className="l7-round-id">
              #{game.snapshot?.roundId.slice(-10) ?? "—"}
            </span>
          </footer>
        </section>
      </main>
      <Dialog
        open={!!panel}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent className="l7-dialog">
          <DialogHeader>
            <DialogTitle>
              {panel === "rules"
                ? "How to play Lucky 7"
                : panel === "history"
                  ? "Your bet history"
                  : "Table settings"}
            </DialogTitle>
            <DialogDescription>
              {panel === "rules"
                ? "One card is drawn from a fresh 52-card deck each round."
                : panel === "history"
                  ? "Confirmed bets and returns from your shared wallet."
                  : "Personalize your table experience."}
            </DialogDescription>
          </DialogHeader>
          {panel === "rules" && (
            <div className="l7-rules">
              <p>
                Select a chip, tap one or more selections and press{" "}
                <b>Confirm bets</b> before the countdown ends. Unconfirmed chips
                are cleared for the next round.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Selection</th>
                    <th>Winning cards</th>
                    <th>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {L7_SPOTS.map((s) => (
                    <tr key={s}>
                      <td>{L7_LABELS[s]}</td>
                      <td>
                        {
                          {
                            up: "8, 9, 10, J, Q, K",
                            seven: "7",
                            down: "A, 2, 3, 4, 5, 6",
                            red: "♥ Hearts / ♦ Diamonds",
                            black: "♣ Clubs / ♠ Spades",
                            odd: "A, 3, 5, 7, 9, J, K",
                            even: "2, 4, 6, 8, 10, Q",
                          }[s]
                        }
                      </td>
                      <td>{L7_PROFIT[s]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p>
                Ace is 1, Jack 11, Queen 12 and King 13. A seven loses both Up
                and Down, and wins Odd. Returns include your stake; winnings are
                credited after settlement. Each new round uses an independent
                draw.
              </p>
              <p>
                RTP: Up/Down/Seven/Even 92.31%, Red/Black 95%, Odd 96.92%,
                before paise rounding. The dealer is an AI-generated studio
                video; cards and payouts are controlled by the game server.
              </p>
              <p>
                <ShieldCheck size={15} /> The server commits a seed hash before
                betting. Settled rounds can be verified in your history.
              </p>
            </div>
          )}
          {panel === "history" && (
            <div className="l7-history">
              {!game.history.length && (
                <p>
                  {game.historyError
                    ? "History is unavailable. Please reconnect."
                    : "No bets yet. Your confirmed bets will appear here."}
                </p>
              )}
              {game.history.map((h) => (
                <div className="l7-history-row" key={h.roundId}>
                  {h.card ? (
                    <PlayingCard card={h.card} mini />
                  ) : (
                    <span className="l7-pending-card">?</span>
                  )}
                  <div>
                    <b>#{h.roundId.slice(-8)}</b>
                    <small>
                      {h.bets.map((b) => L7_LABELS[b.spot]).join(" · ")}
                    </small>
                    <small>{new Date(h.createdAt).toLocaleString()}</small>
                  </div>
                  <div>
                    <b>
                      {h.status === "pending"
                        ? "Pending"
                        : h.status === "refunded"
                          ? "Refunded"
                          : money(h.payoutAmount)}
                    </b>
                    <small>Bet {money(h.totalStake)}</small>
                    {h.status === "settled" && (
                      <button
                        onClick={async () => {
                          setVerification("Verifying…");
                          try {
                            const v = await game.verify(h.roundId);
                            setVerification(
                              v.verified
                                ? `Verified #${h.roundId.slice(-8)} · Seed ${v.serverSeed} · Client ${v.clientSeed} · Nonce ${v.nonce}`
                                : "Verification mismatch. Contact support.",
                            );
                          } catch {
                            setVerification(
                              "Verification is not ready. Try again after settlement.",
                            );
                          }
                        }}
                      >
                        Verify round
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {verification && (
                <p className="l7-verification" role="status">
                  {verification}
                </p>
              )}
            </div>
          )}
          {panel === "settings" && (
            <div className="l7-settings">
              <label>
                Music & sound
                <button onClick={toggleSound} aria-pressed={sound}>
                  {sound ? "On" : "Off"}
                </button>
              </label>
              <label>
                Dealer video
                <button
                  onClick={() => setMotion(!motion)}
                  aria-pressed={motion}
                  aria-label={
                    motion ? "Pause dealer video" : "Play dealer video"
                  }
                >
                  {motion ? "Playing" : "Paused"}
                </button>
              </label>
              <p>
                Pausing the dealer video does not pause the shared game round.
              </p>
              <button onClick={fullscreen}>
                <Maximize size={16} /> Toggle fullscreen
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
