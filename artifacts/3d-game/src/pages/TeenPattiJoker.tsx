import { memo, useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  Home,
  CircleHelp,
  History,
  Volume2,
  VolumeX,
  Undo2,
  Trash2,
  RotateCcw,
  ShieldCheck,
  ChevronRight,
  Pause,
  Play,
} from "lucide-react";
import {
  JOKER_CATEGORIES,
  JOKER_TIMING,
  JOKER_LABELS,
  JOKER_RETURNS,
  jokerCardLabel,
  jokerRank,
  jokerSuit,
  jokerWinningSpots,
  type JokerSpot,
  type JokerOutcome,
} from "@workspace/api-zod/teenpatti-joker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { useTeenPattiJoker } from "@/components/teenpattiJoker/useTeenPattiJoker";
import JokerDealer from "@/components/teenpattiJoker/JokerDealer";
import { referenceCardCount } from "@/components/teenpattiJoker/jokerReferenceFilm";
import { cardRankLabel, cardSuitSymbol } from "@/components/baccarat/cards";
import { sfx, unlockAudio, preloadTableAudio } from "@/game/audio";
import "@/components/teenpattiJoker/teenpatti-joker.css";

const money = (n: number | string) =>
  (Number(n) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const chips = [10, 50, 100, 500, 1000, 5000];
const chipColors = [
  "#73bdef",
  "#e8a0ac",
  "#b5b9c8",
  "#ba9cde",
  "#e8c16b",
  "#80c3a6",
];
const symbols: Partial<Record<JokerSpot, string>> = {
  red: "♥ ♦",
  black: "♠ ♣",
  spades: "♠",
  hearts: "♥",
  diamonds: "♦",
  clubs: "♣",
};

const Card = memo(function Card({
  card,
  wild = false,
  faceUp = true,
}: {
  card?: number;
  wild?: boolean;
  faceUp?: boolean;
}) {
  const show = faceUp && card !== undefined;
  return (
    <span
      className={`j20-card ${show ? "is-up" : ""} ${wild && show ? "is-wild" : ""}`}
      aria-label={
        show
          ? `${jokerCardLabel(card)}${wild ? ", wild card" : ""}`
          : "Face-down card"
      }
    >
      <span className="j20-card-inner">
        <span className="j20-card-back">
          <span>♠</span>
        </span>
        <span
          className={`j20-card-face ${card !== undefined && [1, 2].includes(jokerSuit(card)) ? "is-red" : ""}`}
        >
          {show && (
            <>
              <b className="j20-card-rank" aria-hidden="true">
                {cardRankLabel(card)}
              </b>
              <i className="j20-card-suit" aria-hidden="true">
                {cardSuitSymbol(card)}
              </i>
            </>
          )}
          {wild && show && <em>WILD</em>}
        </span>
      </span>
    </span>
  );
});

function Rules() {
  return (
    <div className="j20-rules">
      <p>Two players. Three cards each. One Joker changes everything.</p>
      <p>
        Before the deal, one card from a shuffled 52-card deck becomes the
        Joker. All remaining cards of that rank are wild and take the rank and
        suit needed to make the strongest hand. The higher hand wins.
      </p>
      <div className="j20-rule-example">
        <div>
          <span>Joker</span>
          <Card card={3} />
        </div>
        <div>
          <span>Player A · Color</span>
          <div>
            <Card card={16} wild />
            <Card card={47} />
            <Card card={39} />
          </div>
        </div>
        <ChevronRight size={20} />
        <div>
          <span>Best hand</span>
          <div>
            <Card card={51} />
            <Card card={47} />
            <Card card={39} />
          </div>
        </div>
      </div>
      <p>
        The 4♥ is wild when the Joker is 4♠. With 9♣ and A♣ it becomes K♣,
        making an Ace–King–Nine Color.
      </p>
      <h3>Standard rules</h3>
      <p>Highest to lowest. Pure Sequence ranks above Trail in this game.</p>
      <ol className="j20-rankings">
        {[...JOKER_CATEGORIES].reverse().map((name, i) => (
          <li key={name}>
            <b>{i + 1}</b>
            <span>
              {name}
              <small>
                {
                  [
                    "Three consecutive cards in the same suit",
                    "Three cards of the same rank",
                    "Three consecutive cards",
                    "Three cards in the same suit",
                    "Two cards of the same rank",
                    "Highest card, then the next card",
                  ][i]
                }
              </small>
            </span>
            <div>
              {[
                [0, 12, 11],
                [0, 13, 26],
                [0, 25, 37],
                [0, 12, 9],
                [0, 13, 12],
                [0, 25, 36],
              ][i].map((c) => (
                <Card key={c} card={c} />
              ))}
            </div>
          </li>
        ))}
      </ol>
      <p>
        Sequences: A–K–Q is highest, then A–2–3, K–Q–J, down to 4–3–2. Compare
        ranks within the same category. Suits do not break ties. Identical best
        hands return both Player A and Player B stakes.
      </p>
      <h3>Joker side bets</h3>
      <p>
        Side bets use the actual Joker card, regardless of who wins. Ace=1,
        Jack=11, Queen=12, King=13. Hearts and Diamonds are red; Spades and
        Clubs are black.
      </p>
      <table>
        <thead>
          <tr>
            <th>Selection</th>
            <th>Total return</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Player A / Player B</td>
            <td>1.98×</td>
          </tr>
          <tr>
            <td>Even / Odd</td>
            <td>2.10× / 1.79×</td>
          </tr>
          <tr>
            <td>Red / Black</td>
            <td>1.95×</td>
          </tr>
          <tr>
            <td>Individual suit</td>
            <td>3.75×</td>
          </tr>
        </tbody>
      </table>
      <p>
        Returns include your stake. A 100-point winning Player A bet returns 198
        points. Fractional paise are rounded down. Choose a chip, select
        markets, then confirm before the countdown ends. Confirmed bets cannot
        be changed.
      </p>
      <p className="j20-muted">
        This is a simulated dealer table. Cards, results, and payouts are
        determined by the game server. Past results do not predict the next
        round.
      </p>
    </div>
  );
}

export default function TeenPattiJoker() {
  const game = useTeenPattiJoker(),
    { user } = useAuth();
  const [chip, setChip] = useState(10),
    [panel, setPanel] = useState<"rules" | "history" | "fairness" | null>(null),
    [verification, setVerification] = useState("");
  const [animateDealer, setAnimateDealer] = useState(
    () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [sound, setSound] = useState(() => {
    try {
      return localStorage.getItem("joker2020:sound") !== "off";
    } catch {
      return true;
    }
  });
  const priorCards = useRef(0);
  const round = game.snapshot,
    outcome = game.outcome;
  const elapsed = round ? game.clock - round.bettingEndsAt : 0;
  const revealMs =
    round?.config.revealDurationMs ?? JOKER_TIMING.revealDurationMs;
  const cardCount = outcome ? referenceCardCount(elapsed, revealMs) : 0;
  const complete = !!outcome && cardCount === 7;
  const wins = complete ? jokerWinningSpots(outcome) : [];
  const result = complete
    ? outcome.winner === "tie"
      ? "MATCH TIED · MAIN BETS RETURNED"
      : `${JOKER_LABELS[outcome.winner].toUpperCase()} WINS`
    : "";
  const status = !game.fresh
    ? "CONNECTING TO TABLE"
    : !game.ready
      ? "TABLE UNAVAILABLE"
      : game.bettingOpen
        ? game.confirmed
          ? "BETS CONFIRMED"
          : "PLACE YOUR BETS"
        : result || "BETS CLOSED · DEALING CARDS";
  useEffect(() => {
    document.title = "Teenpatti Joker 20-20 · Crypto777";
    preloadTableAudio();
  }, []);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const changed = () => setAnimateDealer(!preference.matches);
    preference.addEventListener("change", changed);
    return () => preference.removeEventListener("change", changed);
  }, []);
  useEffect(() => {
    if (
      sound &&
      cardCount > priorCards.current &&
      priorCards.current > 0 &&
      !document.hidden
    )
      sfx.teenPattiCardPlace(cardCount);
    priorCards.current = cardCount;
  }, [cardCount, sound]);
  function toggleSound() {
    const next = !sound;
    setSound(next);
    try {
      localStorage.setItem("joker2020:sound", next ? "on" : "off");
    } catch {}
    if (next) unlockAudio();
  }
  function bet(spot: JokerSpot) {
    if (game.add(spot, chip) && sound) {
      unlockAudio();
      sfx.teenPattiChipPlace();
    }
  }
  const betButton = (spot: JokerSpot, main = false) => (
    <button
      key={spot}
      type="button"
      className={`j20-market ${main ? "j20-market-main" : ""} ${wins.includes(spot) ? "is-winning" : ""} ${(game.shown[spot] ?? 0) > 0 ? "has-bet" : ""}`}
      disabled={game.locked || !game.ready}
      aria-label={`Bet on ${JOKER_LABELS[spot]}`}
      onClick={() => bet(spot)}
    >
      <span
        className={`j20-market-name ${["red", "hearts", "diamonds"].includes(spot) ? "is-red" : ""}`}
      >
        {symbols[spot] ?? JOKER_LABELS[spot]}
      </span>
      <b className="j20-odds">
        {(JOKER_RETURNS[spot] / 100).toFixed(2)}
        <small>×</small>
      </b>
      <span className="j20-market-stake">
        {game.shown[spot] ? money(game.shown[spot]!) : main ? "0" : "+"}
      </span>
    </button>
  );
  return (
    <main className="j20-page" data-testid="joker-game">
      <div className="j20-shell">
        <header className="j20-header">
          <Link href="/" aria-label="Back to lobby" className="j20-home">
            <Home size={22} />
          </Link>
          <Link href="/" className="j20-brand">
            <img
              src={`${import.meta.env.BASE_URL}media/b2c/brand-logo.png`}
              alt="Crypto777"
            />
          </Link>
          <div className="j20-account">
            <b>pts: {game.ready ? money(game.wallet) : "—"}</b>
            <span>{user?.displayName ?? "Player"}</span>
          </div>
        </header>
        <div className="j20-topline">
          <span>
            <i />
            TEENPATTI JOKER 20-20
          </span>
          <button onClick={() => setPanel("rules")}>
            <CircleHelp size={15} /> How to play
          </button>
        </div>
        <section className="j20-studio" aria-label="Joker 20-20 card table">
          <div className="j20-camera">
            <JokerDealer
              roundKey={round?.roundId}
              phase={round?.phase}
              elapsed={elapsed}
              bettingDurationMs={
                round?.config.bettingWindowMs ?? JOKER_TIMING.bettingWindowMs
              }
              revealDurationMs={revealMs}
              settleDurationMs={
                round?.config.settleDurationMs ?? JOKER_TIMING.settleDurationMs
              }
              revealing={!!outcome}
              outcome={outcome}
              cardCount={cardCount}
              fresh={game.fresh}
              animate={animateDealer}
            />
            <div className="j20-round-id">
              Round ID:{" "}
              <span>{round?.roundId.slice(-12) ?? "Connecting…"}</span>
            </div>
            <div className="j20-studio-tools">
              <button
                onClick={() => setAnimateDealer((value) => !value)}
                aria-label={
                  animateDealer
                    ? "Pause dealer animation"
                    : "Play dealer animation"
                }
              >
                {animateDealer ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button
                onClick={toggleSound}
                aria-label={sound ? "Mute sound" : "Enable sound"}
              >
                {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
              </button>
              <button onClick={() => setPanel("rules")} aria-label="Game rules">
                <CircleHelp size={18} />
              </button>
            </div>
            <div className="j20-scene-title">
              <span>TEEN PATTI</span>
              <b>
                JOKER <em>20-20</em>
              </b>
              <small>AI DEALER TABLE</small>
            </div>
          </div>
          <div className="j20-hands" aria-label="Current round cards">
            {(["A", "B"] as const).map((side, handIndex) => {
              const cards =
                  side === "A" ? outcome?.handACards : outcome?.handBCards,
                hand = side === "A" ? outcome?.handA : outcome?.handB;
              return (
                <div
                  key={side}
                  className={`j20-hand j20-hand-${side} ${complete && outcome.winner === (side === "A" ? "playerA" : "playerB") ? "is-winner" : ""}`}
                >
                  <div className="j20-hand-cards">
                    {(side === "A" ? [0, 1, 2] : [2, 1, 0]).map((i) => (
                      <Card
                        key={`${round?.roundId}-${i}`}
                        card={cards?.[i]}
                        faceUp={cardCount >= 2 + i * 2 + handIndex}
                        wild={
                          !!cards &&
                          !!outcome &&
                          jokerRank(cards[i]) === jokerRank(outcome.joker)
                        }
                      />
                    ))}
                  </div>
                  <strong>PLAYER {side}</strong>
                  <small>{complete ? hand?.category : "3 CARDS"}</small>
                </div>
              );
            })}
            <div className="j20-joker">
              <Card card={outcome?.joker} faceUp={cardCount >= 1} />
              <strong>JOKER</strong>
            </div>
          </div>
        </section>
        <div
          className={`j20-status ${game.bettingOpen ? "is-open" : complete ? "is-result" : ""}`}
          role="status"
        >
          <span>
            <i />
            {status}
          </span>
          <b>
            {game.fresh
              ? `${game.countdown.toString().padStart(2, "0")}s`
              : "—"}
          </b>
          <div
            style={{
              width: `${game.bettingOpen ? Math.min(100, (game.countdown / ((round?.config.bettingWindowMs ?? 20000) / 1000)) * 100) : 0}%`,
            }}
          />
        </div>
        <section className="j20-board" aria-label="Betting markets">
          <div className="j20-market-heading">
            <span>Match winner</span>
            <small>Total return · includes stake</small>
          </div>
          <div className="j20-main-markets">
            {betButton("playerA", true)}
            {betButton("playerB", true)}
          </div>
          <div className="j20-divider">
            <span>Joker</span>
            <small>Bet on the Joker card</small>
          </div>
          <div className="j20-side-markets">
            {(["even", "odd", "red", "black"] as JokerSpot[]).map((s) =>
              betButton(s),
            )}
          </div>
          <div className="j20-side-markets j20-suits">
            {(["spades", "hearts", "diamonds", "clubs"] as JokerSpot[]).map(
              (s) => betButton(s),
            )}
          </div>
        </section>
        <section className="j20-bet-controls" aria-label="Bet controls">
          <div className="j20-chip-row">
            <span>CHIP VALUE</span>
            <div className="j20-chips">
              {chips.map((c, i) => (
                <button
                  key={c}
                  className={`j20-chip ${chip === c ? "is-selected" : ""}`}
                  style={{ "--chip": chipColors[i] } as CSSProperties}
                  onClick={() => setChip(c)}
                  aria-label={`Select ${c} point chip`}
                  aria-pressed={chip === c}
                >
                  {c >= 1000 ? `${c / 1000}k` : c}
                </button>
              ))}
            </div>
          </div>
          <div className="j20-actions">
            <button
              onClick={game.undo}
              disabled={!game.canUndo}
              aria-label="Undo last chip"
            >
              <Undo2 size={17} />
            </button>
            <button
              onClick={game.clear}
              disabled={game.locked || !game.draftTotal}
              aria-label="Clear bets"
            >
              <Trash2 size={17} />
            </button>
            <button
              onClick={game.repeat}
              disabled={!game.canRepeat}
              aria-label="Repeat previous bet"
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="j20-double"
              onClick={game.double}
              disabled={game.locked || !game.draftTotal}
            >
              2×
            </button>
            <div className="j20-total">
              <span>Total bet</span>
              <b>{money(game.total)}</b>
            </div>
            <button
              className="j20-confirm"
              disabled={!game.canConfirm}
              onClick={() => void game.confirm()}
            >
              {game.sending
                ? "Confirming…"
                : game.pending
                  ? "Retry confirmation"
                  : game.confirmed
                    ? "Confirmed ✓"
                    : "Confirm bet"}
            </button>
          </div>
          {game.error && (
            <p className="j20-error" role="alert">
              {game.error}
            </p>
          )}
          <div className="j20-limits">
            <span>
              Limits: {money(game.min)} – {money(game.max)} pts
            </span>
            <span>
              Last return: <b>{money(game.lastWin)}</b>
            </span>
          </div>
        </section>
        <section className="j20-results" aria-label="Recent results">
          <div>
            <span>LAST RESULTS</span>
            <button onClick={() => setPanel("history")}>
              <History size={14} /> My bets
            </button>
          </div>
          <div className="j20-result-strip">
            {round?.recent.length ? (
              round.recent.slice(0, 16).map((r) => {
                const o = r.outcome as JokerOutcome;
                return (
                  <button
                    key={r.roundId}
                    className={`result-${o.winner}`}
                    title={`Round ${r.roundId}: ${o.winner === "tie" ? "Tie" : JOKER_LABELS[o.winner]}`}
                    onClick={() => {
                      setVerification("");
                      setPanel("fairness");
                      void game
                        .verify(r.roundId)
                        .then((v) =>
                          setVerification(
                            v.verified
                              ? `Verified · ${r.roundId}\nServer seed: ${v.serverSeed}\nCommitment: ${v.serverSeedHash}\nClient seed: ${v.clientSeed}\nNonce: ${v.nonce}`
                              : "Verification did not match.",
                          ),
                        )
                        .catch(() =>
                          setVerification(
                            "Unable to verify this round. Please try again.",
                          ),
                        );
                    }}
                  >
                    {o.winner === "playerA"
                      ? "A"
                      : o.winner === "playerB"
                        ? "B"
                        : "T"}
                  </button>
                );
              })
            ) : (
              <p>Completed rounds will appear here.</p>
            )}
          </div>
        </section>
        <footer className="j20-footer">
          <span>
            <ShieldCheck size={15} /> Server-verified rounds
          </span>
          <button onClick={() => setPanel("rules")}>Rules</button>
          <Link href="/help">Support</Link>
        </footer>
      </div>
      <Dialog
        open={panel !== null}
        onOpenChange={(open) => {
          if (!open) setPanel(null);
        }}
      >
        <DialogContent className="j20-dialog">
          <DialogTitle>
            {panel === "rules"
              ? "Teenpatti Joker 20-20 · Rules"
              : panel === "history"
                ? "My bet history"
                : "Round verification"}
          </DialogTitle>
          <DialogDescription>
            {panel === "rules"
              ? "Joker rules, hand rankings, and payouts"
              : panel === "history"
                ? "Your confirmed wagers and settled returns"
                : "Replay the completed round from its committed seed."}
          </DialogDescription>
          {panel === "rules" ? (
            <Rules />
          ) : panel === "history" ? (
            <div className="j20-history">
              {game.historyError ? (
                <p>History is unavailable. Please try again.</p>
              ) : game.history.length ? (
                game.history.map((h) => (
                  <article key={h.roundId}>
                    <div>
                      <b>
                        {h.outcome
                          ? h.outcome.winner === "tie"
                            ? "Tie · stakes returned"
                            : `${JOKER_LABELS[h.outcome.winner]} wins`
                          : h.status === "void"
                            ? "Round refunded"
                            : "Bet confirmed"}
                      </b>
                      <time>{new Date(h.createdAt).toLocaleString()}</time>
                    </div>
                    <p>
                      {h.bets
                        .map(
                          (b) =>
                            `${JOKER_LABELS[b.spot]}: ${money(b.amountPaise)}`,
                        )
                        .join(" · ")}
                    </p>
                    <div>
                      <span>Stake {money(h.totalStake)}</span>
                      <b>Return {money(h.payoutAmount)}</b>
                    </div>
                  </article>
                ))
              ) : (
                <p>No bets yet. Confirm a bet to start your history.</p>
              )}
            </div>
          ) : (
            <pre className="j20-verification">
              {verification || "Checking round…"}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
