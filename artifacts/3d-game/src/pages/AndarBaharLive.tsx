import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  BarChart3,
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
import { CardInk } from "@/components/lucky7live/CardInk";
import { useTableMusic } from "@/components/lucky7live/useTableMusic";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { installAudioAutostart } from "@/game/audioAutostart";
import {
  DealerStudio,
  type Presentation,
} from "@/components/andarbaharlive/DealerStudio";
import { useAndarBaharLive } from "@/components/andarbaharlive/useAndarBaharLive";
import {
  label,
  money,
  orderedCards,
  RANGES,
  type Deal,
  type Side,
  type Spot,
} from "@/components/andarbaharlive/model";
import "@/components/andarbaharlive/andar-bahar-live.css";

const chips = [100, 200, 500, 1000, 5000, 10000];
const colors = [
  "#d8d2bd",
  "#bb8568",
  "#a84e53",
  "#608475",
  "#677cb0",
  "#8967a8",
];
function Card({ id }: { id: number }) {
  return (
    <span className="ab-card">
      <CardInk
        card={{
          rank: (id % 13) + 1,
          suit: (["spades", "hearts", "diamonds", "clubs"] as const)[
            Math.floor(id / 13)
          ],
        }}
      />
    </span>
  );
}
function preference(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === "on";
  } catch {
    return fallback;
  }
}
export default function AndarBaharLive() {
  const game = useAndarBaharLive(),
    { user } = useAuth();
  const root = useRef<HTMLDivElement>(null),
    audio = useRef<AudioContext | null>(null);
  const [chip, setChip] = useState(100),
    [panel, setPanel] = useState<"rules" | "history" | "settings" | null>(null);
  const [sound, setSound] = useState(() => preference("ab-live:sound", true));
  const [motion, setMotion] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [full, setFull] = useState(false),
    [expanded, setExpanded] = useState(false),
    [verification, setVerification] = useState("");
  const favoriteKey = `lunar:lobby:favourites:${user?.id ?? "guest"}`;
  const [favorite, setFavorite] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(favoriteKey) ?? "[]").includes(
        "andar-bahar-live",
      );
    } catch {
      return false;
    }
  });
  const music = useTableMusic(sound);
  const snapshot = game.snapshot;
  const [presentation, setPresentation] = useState<Presentation>({
    roundId: "",
    joker: false,
    dealt: 0,
  });
  const sameRound = !!game.deal && presentation.roundId === snapshot?.roundId;
  const dealt = sameRound ? presentation.dealt : 0;
  const jokerReady = sameRound && presentation.joker;
  const finished = !!game.deal && dealt >= game.deal.cardsDealt;
  const sequence = game.deal ? orderedCards(game.deal).slice(0, dealt) : [];
  const latestCard = (side: Side) =>
    sequence.filter((c) => c.side === side).at(-1)?.card;
  const recent = (snapshot?.recent ?? []).filter(
    (r) => r.outcome && typeof (r.outcome as Deal).winner === "string",
  );
  const andarCount = recent.filter(
    (r) => (r.outcome as Deal).winner === "andar",
  ).length;
  const andarPercent = recent.length
    ? Math.round((andarCount / recent.length) * 100)
    : 0;
  const status = !game.fresh
    ? "CONNECTING TO TABLE"
    : !game.ready
      ? "TABLE UNAVAILABLE"
      : game.uncertain
        ? "CHECKING BET RECEIPT"
        : game.bettingOpen
          ? game.confirmed
            ? "BETS CONFIRMED"
            : "PLACE YOUR BETS"
          : finished
            ? `${game.deal!.winner.toUpperCase()} WINS`
            : game.deal
              ? "DEALING CARDS"
              : "NO MORE BETS";
  useEffect(() => {
    document.title = "Andar Bahar Live · Lunar";
    const update = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      void audio.current?.close();
    };
  }, []);
  useEffect(() => {
    if (!sound) return;
    // Prepare on entry, away from the frame where a card lands.
    const unlock = () => {
      try {
        const ctx = (audio.current ??= new AudioContext());
        if (ctx.state !== "running") void ctx.resume().catch(() => {});
      } catch {
        /* Optional audio. */
      }
    };
    return installAudioAutostart(unlock);
  }, [sound]);
  function tone(win = false) {
    const ctx = audio.current;
    if (!sound || !ctx || ctx.state !== "running") return;
    try {
      (win ? [523, 659, 784] : [850]).forEach((hz, i) => {
        const osc = ctx.createOscillator(),
          gain = ctx.createGain(),
          start = ctx.currentTime + i * 0.1;
        osc.frequency.value = hz;
        gain.gain.setValueAtTime(0.035, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.11);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.13);
      });
    } catch {
      /* Optional audio. */
    }
  }
  const lastCard = useRef(0);
  useEffect(() => {
    if (dealt > lastCard.current) tone(finished);
    lastCard.current = dealt;
  }, [dealt]);
  function toggleSound() {
    setSound((s) => {
      try {
        localStorage.setItem("ab-live:sound", s ? "off" : "on");
      } catch {}
      return !s;
    });
  }
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await root.current?.requestFullscreen();
    } catch {}
  }
  function toggleFavorite() {
    try {
      const raw = JSON.parse(localStorage.getItem(favoriteKey) ?? "[]");
      const ids: string[] = Array.isArray(raw)
        ? raw.filter((id: unknown) => typeof id === "string")
        : [];
      localStorage.setItem(
        favoriteKey,
        JSON.stringify(
          favorite
            ? ids.filter((id) => id !== "andar-bahar-live")
            : [...new Set([...ids, "andar-bahar-live"])],
        ),
      );
      setFavorite(!favorite);
    } catch {}
  }
  const mainReturn = (side: Side) => {
    const p = game.config?.payouts;
    if (!p) return "—";
    if (game.deal)
      return `${game.deal.firstSide === side ? p.firstSide : p.secondSide}×`;
    return `${Math.min(p.firstSide, p.secondSide)}–${Math.max(p.firstSide, p.secondSide)}×`;
  };
  function betButton(spot: Spot) {
    const isMain = spot === "andar" || spot === "bahar";
    const range = RANGES.find((r) => r[0] === spot);
    const wins =
      finished &&
      (isMain
        ? game.deal!.winner === spot
        : !!range &&
          game.deal!.cardsDealt >= range[1] &&
          game.deal!.cardsDealt <= range[2]);
    const card = isMain ? latestCard(spot) : undefined;
    return (
      <button
        key={spot}
        type="button"
        aria-label={`Bet on ${label(spot)}`}
        disabled={game.locked}
        data-spot={spot}
        className={`ab-bet ab-${spot} ${isMain ? "ab-main-bet" : "ab-range-bet"} ${wins ? "is-winner" : ""}`}
        onClick={() => {
          if (game.add(spot, chip)) tone();
        }}
      >
        <span className="ab-bet-label">{label(spot)}</span>
        <small>
          {isMain
            ? mainReturn(spot)
            : `${game.config?.payouts.ranges[spot]?.multiplier ?? "—"}×`}{" "}
          <em>return</em>
        </small>
        {card !== undefined && (
          <span className="ab-last-card">
            <Card id={card} />
          </span>
        )}
        {!!game.shown[spot] && (
          <b className="ab-placed-chip">{money(game.shown[spot]!)}</b>
        )}
        {wins && <span className="ab-winner-label">WIN</span>}
      </button>
    );
  }
  return (
    <div
      ref={root}
      className="ab-live"
      data-testid="andar-bahar-live"
      data-motion={motion}
    >
      <audio
        ref={music}
        src={`${import.meta.env.BASE_URL}media/lucky7-live/lounge-loop-v1.mp3`}
        loop
        preload="none"
      />
      <header className="ab-header">
        <Link href="/" className="ab-more">
          <ArrowLeft size={17} />
          <span>More games</span>
        </Link>
        <div className="ab-title">
          <h1>ANDAR BAHAR</h1>
          <span>
            <i /> LIVE
          </span>
        </div>
        <nav aria-label="Table controls">
          <button
            className={favorite ? "is-favorite" : ""}
            aria-label={
              favorite ? "Remove from favourites" : "Add to favourites"
            }
            aria-pressed={favorite}
            onClick={toggleFavorite}
          >
            <Star />
          </button>
          <button aria-label="Bet history" onClick={() => setPanel("history")}>
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
            aria-label={full ? "Exit fullscreen" : "Enter fullscreen"}
            onClick={fullscreen}
          >
            {full ? <Minimize /> : <Maximize />}
          </button>
          <button aria-label="Game rules" onClick={() => setPanel("rules")}>
            <CircleHelp />
          </button>
        </nav>
      </header>
      <section className="ab-stage" aria-label="Live dealer studio">
        <DealerStudio
          deal={game.deal}
          snapshot={snapshot}
          clock={game.clock}
          onPresentation={setPresentation}
          motion={motion}
          fresh={game.fresh}
        />

        <div className="ab-table-caption">
          <span>ANDAR BAHAR</span>
          <small>THE LIVE TABLE</small>
        </div>
        {game.bettingOpen && (
          <div
            className="ab-timer"
            role="timer"
            aria-label="Betting time remaining"
            style={
              {
                "--timer": `${Math.min(100, (game.countdown / ((snapshot?.config.bettingWindowMs ?? 20000) / 1000)) * 100)}%`,
              } as CSSProperties
            }
          >
            <strong>{game.countdown}</strong>
            <span>BETTING</span>
          </div>
        )}
        {finished && (
          <div
            className={`ab-result ab-result-${game.deal!.winner}`}
            role="status"
          >
            <small>ROUND RESULT</small>
            <strong>{label(game.deal!.winner)} wins</strong>
            <span>{game.deal!.cardsDealt} cards dealt · Joker matched</span>
          </div>
        )}
        <div className="ab-studio-footer">
          <span>
            <i className={game.fresh ? "is-connected" : ""} />
            {game.fresh ? "TABLE CONNECTED" : "RECONNECTING"}
          </span>
          <button onClick={() => setPanel("settings")}>Table settings</button>
        </div>
      </section>
      <section className="ab-console" aria-label="Betting table">
        <div
          className={`ab-chips ${game.locked ? "is-locked" : ""}`}
          aria-label="Chip values"
        >
          {chips.map((amount, i) => (
            <button
              type="button"
              key={amount}
              disabled={game.locked}
              aria-label={`Select ₹${amount} chip`}
              aria-pressed={chip === amount}
              className={chip === amount ? "is-selected" : ""}
              style={{ "--chip": colors[i] } as CSSProperties}
              onClick={() => {
                setChip(amount);
                tone();
              }}
            >
              <span>{amount >= 1000 ? `${amount / 1000}k` : amount}</span>
            </button>
          ))}
        </div>

        <div className="ab-status-row">
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <BarChart3 size={14} />
            Statistics
          </button>
          <div
            className={`ab-status ${game.bettingOpen ? "is-open" : ""} ${finished ? `is-${game.deal!.winner}` : ""}`}
            role="status"
          >
            {status}
            {game.bettingOpen && <b>{game.countdown}</b>}
          </div>
          <span>
            BET HOW MANY CARDS WILL BE DEALT{" "}
            <b data-testid="ab-card-count">{game.deal ? dealt : ""}</b>
          </span>
        </div>
        <div className="ab-board">
          <div className="ab-statistics" aria-label="Recent round statistics">
            <div className="ab-roadmap">
              {Array.from({ length: 72 }, (_, i) => {
                const row = recent.slice(0, 72).reverse()[i];
                const winner = (row?.outcome as Deal | undefined)?.winner;
                return (
                  <span
                    key={i}
                    className={winner ? `ab-road-${winner}` : "is-empty"}
                    title={winner ? `${label(winner)} won` : "No result"}
                  >
                    {winner ? (winner === "andar" ? "A" : "B") : ""}
                  </span>
                );
              })}
            </div>
            <div className="ab-stats-summary">
              <div>
                <strong>{recent.length ? `${andarPercent}%` : "—"}</strong>
                <span>ANDAR</span>
                <b>{andarCount}</b>
              </div>
              <div>
                <strong>
                  {recent.length ? `${100 - andarPercent}%` : "—"}
                </strong>
                <span>BAHAR</span>
                <b>{recent.length - andarCount}</b>
              </div>
              <small>
                {recent.length
                  ? `LAST ${recent.length} ROUNDS`
                  : "WAITING FOR RESULTS"}
              </small>
            </div>
          </div>
          <div className="ab-main-spots">
            {betButton("andar")}
            {betButton("bahar")}
            <div className="ab-joker" data-testid="ab-joker">
              {game.deal && jokerReady ? (
                <Card id={game.deal.joker} />
              ) : (
                <span>JOKER</span>
              )}
            </div>
          </div>
          <div className="ab-range-spots">
            {RANGES.map((r) => betButton(r[0]))}
          </div>
        </div>
        <div className="ab-actions">
          <span className="ab-help-hint">
            {game.confirmed
              ? "Your bets are confirmed for this round"
              : game.uncertain
                ? "Checking receipt…"
                : "Choose a chip, tap a spot and confirm"}
          </span>
          <button
            aria-label="Undo last bet"
            disabled={!game.canUndo}
            onClick={game.undo}
          >
            <Undo2 />
            <span>Undo</span>
          </button>
          <button
            aria-label="Double bets"
            disabled={game.locked || !game.total}
            onClick={game.double}
          >
            <b>2×</b>
            <span>Double</span>
          </button>
          <button
            aria-label="Repeat last bets"
            disabled={!game.canRepeat}
            onClick={game.repeat}
          >
            <RotateCcw />
            <span>Rebet</span>
          </button>
          <button
            aria-label="Clear bets"
            disabled={game.locked || !game.total}
            onClick={game.clear}
          >
            <Trash2 />
            <span>Clear</span>
          </button>
          <button
            className="ab-confirm"
            disabled={!game.canConfirm}
            onClick={() => void game.confirm()}
          >
            {game.sending
              ? "CONFIRMING…"
              : game.confirmed
                ? "BETS CONFIRMED ✓"
                : "CONFIRM BETS"}
          </button>
        </div>
        {game.error && (
          <p className="ab-error" role="alert">
            {game.error}
          </p>
        )}
        {expanded && (
          <div className="ab-expanded-history">
            {recent.length ? (
              recent.slice(0, 16).map((r) => {
                const d = r.outcome as Deal;
                return (
                  <span key={r.roundId} className={`ab-history-${d.winner}`}>
                    <Card id={d.joker} />
                    <b>{label(d.winner)}</b>
                    <small>{d.cardsDealt} cards</small>
                  </span>
                );
              })
            ) : (
              <p>Completed rounds will appear here.</p>
            )}
          </div>
        )}
        <footer className="ab-footer">
          <span>
            Andar Bahar{" "}
            <b>
              {money(game.min)} – {money(game.max)}
            </b>
          </span>
          <span>
            Balance <b data-testid="ab-balance">{money(game.wallet)}</b>
          </span>
          <span>
            Total bet <b data-testid="ab-total">{money(game.total)}</b>
          </span>
          <span>
            Last win <b>{money(game.lastWin)}</b>
          </span>
          <span className="ab-round-id">
            #{snapshot?.roundId.slice(-10) ?? "CONNECTING"}
          </span>
        </footer>
      </section>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent className="ab-dialog">
          <DialogHeader>
            <DialogTitle>
              {panel === "rules"
                ? "How to play Andar Bahar"
                : panel === "history"
                  ? "Your bet history"
                  : "Table settings"}
            </DialogTitle>
            <DialogDescription>
              {panel === "rules"
                ? "Match the joker’s rank to win."
                : panel === "history"
                  ? "Your settled Andar Bahar rounds and returns."
                  : "Adjust your table experience."}
            </DialogDescription>
          </DialogHeader>
          {panel === "rules" && (
            <div className="ab-rules">
              <ol>
                <li>
                  Select a chip and place it on Andar, Bahar or a card-count
                  range. Press Confirm Bets before the countdown ends.
                </li>
                <li>
                  A joker is drawn from a single 52-card deck. Black joker:
                  Andar receives the first card. Red joker: Bahar receives the
                  first card.
                </li>
                <li>
                  Cards alternate between the sides. The first side to receive
                  the joker’s rank wins.
                </li>
                <li>
                  Card-count bets include the matching card, but exclude the
                  joker.
                </li>
              </ol>
              <p>
                All displayed multipliers are total returns, including your
                stake. First-dealt side: {game.config?.payouts.firstSide ?? "—"}
                ×. Other side: {game.config?.payouts.secondSide ?? "—"}×. Up to{" "}
                {game.config?.maxBetsPerDeal ?? 6} spots per round.
              </p>
              <p>
                Andar Bahar Live uses the shared Andar Bahar table and wallet.
                The studio is recorded footage; cards, round results and
                settlements come from the game server.
              </p>
              <p>
                <ShieldCheck size={15} /> Settled bets can be verified in your
                history.
              </p>
            </div>
          )}
          {panel === "history" && (
            <div className="ab-personal-history">
              {game.historyError ? (
                <p>History is unavailable. Please try again shortly.</p>
              ) : !game.history.length ? (
                <p>
                  No settled bets yet. Your completed rounds will appear here.
                </p>
              ) : (
                game.history.map((h) => (
                  <div key={h.id}>
                    <Card id={h.joker} />
                    <span>
                      <b>{label(h.winner)} won</b>
                      <small>
                        {h.cardsDealt} cards · {money(h.totalStake)} bet
                      </small>
                    </span>
                    <strong>{money(h.payoutAmount)}</strong>
                    <button
                      onClick={async () => {
                        setVerification("Verifying…");
                        try {
                          const result = await game.verify(h.id);
                          setVerification(
                            result.verified
                              ? "Verified: deal and payout match the committed seed."
                              : "Verification did not match.",
                          );
                        } catch {
                          setVerification(
                            "Could not verify this round. Try again shortly.",
                          );
                        }
                      }}
                    >
                      Verify
                    </button>
                  </div>
                ))
              )}
              <p role="status">{verification}</p>
            </div>
          )}
          {panel === "settings" && (
            <div className="ab-settings">
              <label>
                <span>Table sound & music</span>
                <input type="checkbox" checked={sound} onChange={toggleSound} />
              </label>
              <label>
                <span>Dealer & card motion</span>
                <input
                  type="checkbox"
                  checked={motion}
                  onChange={(e) => setMotion(e.target.checked)}
                />
              </label>
              <p>
                Disabling motion keeps the table still while cards continue to
                follow the live round.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
