import { GameInformationDrawer } from "@/components/game/GameInformation";
import { GameInformationSection, GameInformationTarget } from "@/components/game/GameInformation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowDown,
  ArrowUpDown,
  Info,
  Check,
  CircleHelp,
  Coins,
  Crown,
  History,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
} from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import RummyDealer from "@/components/rummy/RummyDealer";
import RummyBettingDock from "@/components/rummy/RummyBettingDock";
import { CoinFace } from "@/components/table/chips";
import RoundWinDialog, { useRoundWin } from "@/components/table/RoundWinDialog";
import { preloadTableAudio, sfx, unlockAudio, playGameSound } from "@/game/audio";
import { store } from "@/game/store";
import {
  analyzeHand,
  cardLabel,
  isWild,
  rankLabel,
  STAKES,
  SUITS,
  SYMBOLS,
  type Card,
  type MeldKind,
} from "@/game/rummy/engine";
import { useRummy } from "@/game/rummy/useRummy";
import "@/components/rummy/rummy.css";
import "@/components/rummy/rummy-studio.css";

const format = (n: number) => n.toLocaleString("en-IN");
const groupName: Record<MeldKind, string> = {
  pure: "Pure sequence",
  sequence: "Sequence",
  set: "Set",
};
function PlayingCard({
  card,
  wild = 0,
  back = false,
  small = false,
}: {
  card?: Card;
  wild?: number;
  back?: boolean;
  small?: boolean;
}) {
  if (back || !card)
    return (
      <span
        className={`rm-card rm-card-back ${small ? "rm-card-small" : ""}`}
        aria-hidden="true"
      >
        <span>♠</span>
      </span>
    );
  return (
    <span
      className={`rm-card ${card.suit === "H" || card.suit === "D" ? "rm-card-red" : ""} ${small ? "rm-card-small" : ""}`}
    >
      <span className="rm-card-corner">
        <b>{rankLabel(card.rank)}</b>
        <span>{SYMBOLS[card.suit]}</span>
      </span>
      <span className="rm-card-symbol">{SYMBOLS[card.suit]}</span>
      <span className="rm-card-bottom">
        {rankLabel(card.rank)}
        {SYMBOLS[card.suit]}
      </span>
      {isWild(card, wild) && <span className="rm-wild-star">★</span>}
    </span>
  );
}

function Rules() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="rm-quiet-btn" aria-label="Game information" data-testid="btn-game-rules">
          <Info size={18} />
        </button>
      </DialogTrigger>
      <GameInformationDrawer className="rm-dialog">
        <DialogHeader>
          <DialogTitle>13 cards. One winning hand.</DialogTitle>
          <DialogDescription>
            Rummy Royale · Shared wallet rules
          </DialogDescription>
        </DialogHeader>
        <GameInformationTarget />
        <ol className="rm-rules-list">
          <li>
            <b>Deal in.</b> Four seats, two 53-card decks. Everyone contributes
            the same entry in wallet chips. The dealer gives each player 13
            cards.
          </li>
          <li>
            <b>Draw, then discard.</b> Take one closed card or the top open
            card, then discard one. An open joker cannot be picked, and a card
            picked from the open pile cannot be discarded in that same turn.
          </li>
          <li>
            <b>Make your groups.</b> A sequence is 3 or more consecutive cards
            of the same suit. A set is 3 or 4 equal ranks of different suits.
            Aces work in A-2-3 or Q-K-A, never K-A-2.
          </li>
          <li>
            <b>Use jokers.</b> Printed jokers and cards matching the indicator
            rank are wild. A printed indicator makes aces wild. A wild card in
            its own natural position can belong to a pure sequence; a
            substituted joker cannot. Every group needs at least one natural
            card.
          </li>
          <li>
            <b>Declare.</b> Select your 14th card to discard. The other 13 must
            all fit valid groups with at least two sequences, including one pure
            sequence. Invalid attempts show a hint and keep your turn.
          </li>
          <li>
            <b>Win the pot.</b> The displayed pot is after a 15% table commission. Return depends on play. This table uses a fixed entry: the first valid
            declaration wins all four entries, with no fee. Unmatched points
            (capped at 80) are guidance, not extra charges. If the closed deck
            runs out or 200 turns pass, everyone gets their entry back.
          </li>
          <li>
            <b>Automatic play.</b> Computer opponents use their own hand and the
            open card. Auto-play also handles your turns. A 20-second timeout
            plays one action for you. Auto-bet repeats entries up to your round
            and loss/profit limits; Stop prevents the next entry.
          </li>
          <li>
            <b>Drop or leave.</b> Drop before drawing to sit out; your entry
            stays in the pot. Your table and turn clock continue when you leave.
            Auto-bet continues up to your limits; use Stop to cancel future entries.
          </li>
        </ol>
        <p className="rm-rules-note">
          Wallet chips only. Computer opponents and an animated dealer.{" "}
          <a
            href="https://www.rummycircle.com/how-to-play-rummy/rummy-rules.html"
            target="_blank"
            rel="noreferrer"
          >
            13-card rules reference ↗
          </a>
        </p>
      </GameInformationDrawer>
    </Dialog>
  );
}

export default function Rummy() {
  const { user } = useAuth();
  return (
    <RummyTable
      key={user?.id ?? "practice"}
      userId={user?.id ?? "practice"}
      name={user?.displayName || "You"}
    />
  );
}

function RummyTable({ userId, name }: { userId: string; name: string }) {
  const session = useRummy(userId, name);
  const { table: t, auto, autoPlay, seconds, dispatch } = session;
  const roundWin = useRoundWin({ game: "rummy", userId, roundId: `wallet:${t.round}`,
    eligible: t.phase === "finished",
    bets: t.result ? [{ status: "settled", totalStake: String(t.result.stake * 100), payoutAmount: String(t.result.payout * 100) }] : [] });
  useEffect(() => { preloadTableAudio(); }, []);
  useEffect(() => {
    if (t.phase === "dealing" && store.getState().settings.sound) playGameSound("roll", "rummy");
  }, [t.round, t.phase]);
  const previousAction = useRef(`${t.round}:${t.turns}:${t.current}:${t.step}`);
  useEffect(() => {
    const action = `${t.round}:${t.turns}:${t.current}:${t.step}`;
    if (previousAction.current === action) return;
    previousAction.current = action;
    if (t.phase === "playing" && store.getState().settings.sound) playGameSound(t.step === "discard" ? "deal" : "settle", "rummy");
  }, [t.round, t.turns, t.current, t.step, t.phase]);
  const soundedResult = useRef(0);
  useEffect(() => {
    if (t.phase !== "finished" || !t.result || soundedResult.current === t.round) return;
    soundedResult.current = t.round;
    if (t.result.payout < t.result.stake && store.getState().settings.sound) sfx.tableLose("rummy");
  }, [t.phase, t.result, t.round]);
  const tableRef = useRef<HTMLElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sorted, setSorted] = useState(false);
  const [hint, setHint] = useState("");
  const hand = t.players[0].hand;
  const analysis = useMemo(() => analyzeHand(hand, t.wild), [hand, t.wild]);
  const winningGroups = useMemo(
    () =>
      t.result && t.result.winner !== null
        ? analyzeHand(t.players[t.result.winner].hand, t.wild).groups
        : [],
    [t.result, t.players, t.wild],
  );
  const selectedAnalysis = useMemo(
    () =>
      selected && hand.length === 14
        ? analyzeHand(
            hand.filter((c) => c.id !== selected),
            t.wild,
          )
        : null,
    [hand, selected, t.wild],
  );
  const groups = useMemo(() => {
    if (sorted)
      return [
        {
          label: "Sorted by suit",
          kind: "loose",
          cards: [...hand].sort(
            (a, b) =>
              SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank,
          ),
        },
      ];
    return [
      ...analysis.groups.map((g) => ({
        label: groupName[g.kind],
        kind: g.kind,
        cards: g.cards,
      })),
      ...(analysis.unmatched.length
        ? [{ label: "Ungrouped", kind: "loose", cards: analysis.unmatched }]
        : []),
    ];
  }, [analysis, hand, sorted]);
  const yourTurn =
    t.phase === "playing" && t.current === 0 && !t.players[0].folded;
  const manualTurn = yourTurn && !autoPlay;
  const canDiscard =
    manualTurn &&
    t.step === "discard" &&
    !!selected &&
    selected !== t.drawnFromOpen;
  const open = t.discard.at(-1);
  const sessionNet = t.history.reduce((sum, h) => sum + h.net, 0);
  const shownAnalysis = selectedAnalysis ?? analysis;

  useEffect(() => {
    setSelected(null);
    setHint("");
  }, [t.round, t.current, t.step, t.turns]);
  useEffect(() => {
    document.title = "Rummy Royale · Shared Wallet";
    return () => {
      document.title = "Lunar Casino";
    };
  }, []);

  const declare = () => {
    if (!canDiscard) return;
    if (!selectedAnalysis?.valid)
      setHint(
        "Keep 13 cards in valid groups: 2 sequences, including 1 pure sequence. Try Auto group.",
      );
    dispatch({ type: "discard", id: selected!, declare: true });
  };

  return (
    <main
      className="game-page rm-app"
      style={{ "--rm-dock-height": `${dockHeight}px` } as CSSProperties}
      data-testid="rummy-page"
      data-phase={t.phase}
      onPointerDownCapture={() => { void unlockAudio(); }}
      onKeyDownCapture={() => { void unlockAudio(); }}
    >
      <header className="rm-header">
        <Link href="/" className="rm-back" aria-label="Back to lobby">
          <ArrowLeft size={19} />
        </Link>
        <div className="rm-brand">
          <span className="rm-brand-mark">♠</span>
          <div>
            RUMMY<span>ROYALE</span>
          </div>
        </div>
        <span className="rm-header-divider" />
        <span className="rm-header-caption">THE CARD ROOM</span>
        <div className="rm-header-right">
          <Rules />
          <span className="rm-practice-badge">
            <span /> SHARED WALLET
          </span>
          <div className="rm-wallet">
            <Coins size={18} />
            <div>
              <small>Wallet chips</small>
              <b data-testid="rummy-balance">{format(t.balance)}</b>
            </div>
          </div>
        </div>
      </header>

      <div className="rm-content">
        <GameInformationSection><div className="rm-titlebar">
          <div>
            <div className="rm-eyebrow">A LITTLE STRATEGY. A WINNING HAND.</div>
            <h1>
              Welcome to your table<span>.</span>
            </h1>
            <p>The casino studio. The cards. Your next winning hand.</p>
          </div>
        </div></GameInformationSection>
        <div data-game-screen="rummy" className="rm-layout">
          <section ref={tableRef} className="rm-game" aria-label="Rummy table">
            <div className="rm-stage" data-testid="rummy-stage">
              <RummyDealer />
              <div className="rm-table-info">
                <span className="rm-tiny-label">ROYAL ROOM</span>
                <b>
                  Table 01 <span>·</span> 4 seats
                </b>
              </div>
              <div className="rm-table-round">
                <span className="rm-tiny-label">
                  {t.round ? "ROUND" : "TABLE STATUS"}
                </span>
                <b>
                  {t.round
                    ? `#${String(t.round).padStart(4, "0")}`
                    : "Ready to deal"}
                </b>
              </div>
              <div className="rm-dealer-tag">
                <span /> ASHA <small>ANIMATED DEALER</small>
              </div>
              {t.players.slice(1).map((p, i) => (
                <div
                  key={p.name}
                  className={`rm-seat rm-seat-${i + 1} ${t.phase === "playing" && t.current === i + 1 ? "is-active" : ""}`}
                  data-testid={`rummy-bot-${i + 1}`}
                >
                  <span className={`rm-avatar rm-avatar-${i}`}>
                    {p.name[0]}
                    <span>AI</span>
                  </span>
                  <div>
                    <b>{p.name}</b>
                    <small>
                      {t.phase === "playing" && t.current === i + 1
                        ? "Thinking…"
                        : t.phase === "ready"
                          ? "Ready to play"
                          : `${p.hand.length} cards`}
                    </small>
                  </div>
                  <div className="rm-mini-hand">
                    {[0, 1, 2].map((n) => (
                      <PlayingCard key={n} back small />
                    ))}
                  </div>
                </div>
              ))}
              <div className="rm-pot">
                <div className="rm-pot-stack" aria-hidden="true">
                  {[0, 1, 2].map((i) => (
                    <CoinFace key={i} value={t.stake} sizeClass="rm-pot-coin" />
                  ))}
                </div>
                <span>TABLE POT</span>
                <strong>
                  <Coins size={17} /> {format(t.pot)}
                </strong>
                <small>
                  {t.pot
                    ? `${format(t.stake)} × 4 players · 15% commission`
                    : "Choose your entry to begin"}
                </small>
              </div>
              <div className="rm-piles">
                <div className="rm-joker-pile">
                  <span className="rm-pile-label">WILD JOKER</span>
                  <PlayingCard card={t.indicator ?? undefined} small />
                  <small>
                    {t.indicator
                      ? `All ${rankLabel(t.wild)}s are wild`
                      : "Revealed on deal"}
                  </small>
                </div>
                <button
                  className={`rm-pile rm-closed ${manualTurn && t.step === "draw" ? "can-draw" : ""}`}
                  aria-label="Draw from closed deck"
                  data-testid="rummy-draw-stock"
                  disabled={!manualTurn || t.step !== "draw"}
                  onClick={() => dispatch({ type: "draw", source: "stock" })}
                >
                  <PlayingCard back />
                  <span>CLOSED DECK</span>
                  <small>{t.round ? t.stock.length : "—"} cards</small>
                </button>
                <button
                  className={`rm-pile ${manualTurn && t.step === "draw" && open && !isWild(open, t.wild) ? "can-draw" : ""}`}
                  aria-label="Draw from open pile"
                  data-testid="rummy-draw-open"
                  disabled={
                    !manualTurn ||
                    t.step !== "draw" ||
                    !open ||
                    isWild(open, t.wild)
                  }
                  onClick={() => dispatch({ type: "draw", source: "open" })}
                >
                  <PlayingCard card={open} wild={t.wild} />
                  <span>OPEN PILE</span>
                  <small>
                    {open
                      ? isWild(open, t.wild)
                        ? "Joker locked"
                        : cardLabel(open)
                      : "—"}
                  </small>
                </button>
              </div>
              {t.phase === "dealing" && (
                <div className="rm-deal-flight" aria-hidden="true">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                    <span
                      key={i}
                      style={
                        {
                          "--i": i,
                          "--x": `${((i % 4) - 1.5) * 110}px`,
                          "--y": `${75 + (i % 2) * 75}px`,
                        } as CSSProperties
                      }
                    >
                      <PlayingCard back small />
                    </span>
                  ))}
                </div>
              )}
              {t.phase === "ready" && (
                <div className="rm-table-invite">
                  <Sparkles size={14} /> Your next great hand starts here.
                </div>
              )}
              {t.result && (
                <div
                  className="rm-result"
                  role="status"
                  data-testid="rummy-result"
                >
                  <Trophy size={24} />
                  <div>
                    <strong>
                      {t.result.winner === null
                        ? "Round drawn"
                        : t.result.winner === 0
                          ? "You won the table!"
                          : `${t.players[t.result.winner].name} wins`}
                    </strong>
                    <span>
                      {t.result.reason} · {t.result.net > 0 ? "+" : ""}
                      {format(t.result.net)} chips
                    </span>
                  </div>
                  {auto && <small>Next in {seconds}s</small>}
                </div>
              )}
              <div className="rm-stage-footer">
                <span>
                  <ShieldCheck size={12} /> Shared wallet chips
                </span>
                <span>
                  <Users size={12} /> You + 3 computer players
                </span>
              </div>
            </div>

            <div className="rm-hand-area">
              <div className="rm-hand-heading">
                <div className="rm-you-avatar">
                  {name[0]?.toUpperCase() ?? "Y"}
                </div>
                <div>
                  <b>
                    Your hand <span>{hand.length}/13</span>
                  </b>
                  <small>
                    {t.players[0].folded
                      ? "Watching this round"
                      : yourTurn
                        ? t.step === "draw"
                          ? "Pick a card from either pile"
                          : "Select a card to discard"
                        : t.phase === "ready"
                          ? "Your seat is reserved"
                          : t.phase === "dealing"
                            ? "Dealing your cards…"
                            : t.phase === "finished"
                              ? "Round complete"
                              : `${t.players[t.current].name} is playing`}
                  </small>
                </div>
                <div className="rm-hand-tools">
                  {t.phase === "playing" && (
                    <span
                      className={`rm-turn-timer ${yourTurn ? "is-yours" : ""}`}
                    >
                      {seconds}s
                    </span>
                  )}
                  <button
                    className="rm-quiet-btn"
                    disabled={!hand.length}
                    onClick={() => setSorted(!sorted)}
                  >
                    <ArrowUpDown size={14} />{" "}
                    {sorted ? "Auto group" : "Sort cards"}
                  </button>
                </div>
              </div>
              <div
                className={`rm-hand-scroll ${t.phase === "dealing" ? "is-dealing" : ""}`}
                data-testid="rummy-hand"
              >
                {!hand.length ? (
                  <div className="rm-empty-hand">
                    {Array.from({ length: 13 }, (_, i) => (
                      <div className="rm-empty-card" key={i}>
                        <span>♠</span>
                      </div>
                    ))}
                    <span className="rm-empty-caption">
                      A fresh deck. A fresh start.
                    </span>
                  </div>
                ) : (
                  groups.map((g, index) => (
                    <div
                      className={`rm-hand-group rm-group-${g.kind}`}
                      key={`${index}-${g.kind}`}
                    >
                      <div className="rm-group-cards">
                        {g.cards.map((card, i) => (
                          <button
                            key={card.id}
                            style={{ "--card-i": i } as CSSProperties}
                            className={`rm-hand-card ${selected === card.id ? "is-selected" : ""}`}
                            aria-label={`${cardLabel(card)}${isWild(card, t.wild) ? ", wild" : ""}`}
                            aria-pressed={selected === card.id}
                            disabled={
                              !manualTurn ||
                              t.step !== "discard" ||
                              card.id === t.drawnFromOpen
                            }
                            data-card-id={card.id}
                            onClick={() => {
                              setSelected(
                                selected === card.id ? null : card.id,
                              );
                              setHint("");
                            }}
                          >
                            <PlayingCard card={card} wild={t.wild} />
                            {selected === card.id && (
                              <span className="rm-selected-check">
                                <Check size={11} />
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                      <span className="rm-group-label">
                        {g.kind !== "loose" && <Check size={10} />}
                        {g.label}
                      </span>
                    </div>
                  ))
                )}
              </div>
              <div className="rm-hand-bottom">
                <div className="rm-hand-checks">
                  <span className={shownAnalysis.pure ? "complete" : ""}>
                    <Check size={12} /> 1 pure sequence
                  </span>
                  <span
                    className={shownAnalysis.sequences >= 2 ? "complete" : ""}
                  >
                    <Check size={12} /> 2 sequences
                  </span>
                  <span className="rm-points">{analysis.points} points</span>
                </div>
                <div className="rm-hand-actions">
                  <button
                    className="rm-drop"
                    disabled={!manualTurn || t.step !== "draw"}
                    onClick={() => dispatch({ type: "drop" })}
                  >
                    Drop
                  </button>
                  <button
                    className="rm-discard"
                    disabled={!canDiscard}
                    onClick={() => dispatch({ type: "discard", id: selected! })}
                  >
                    <ArrowDown size={15} /> Discard
                  </button>
                  <button
                    className="rm-declare"
                    disabled={!canDiscard}
                    onClick={declare}
                  >
                    <Trophy size={15} /> Declare
                  </button>
                </div>
              </div>
              <p
                className={`rm-status ${hint ? "is-warning" : ""}`}
                role="status"
              >
                {hint || t.message}
              </p>
            </div>
          </section>

          <GameInformationSection><aside className="rm-sidebar">
            <section className="rm-table-summary">
              <span className="rm-tiny-label">RUMMY ROYALE · TABLE 01</span>
              <h2>A seat at the table.</h2>
              <div>
                <span>Players</span>
                <b>You + 3 opponents</b>
              </div>
              <div>
                <span>Cards per hand</span>
                <b>13 cards</b>
              </div>
              <div>
                <span>Table entry</span>
                <b>
                  {t.round
                    ? format(t.stake)
                    : `${format(STAKES[0])}–${format(STAKES[STAKES.length - 1])}`}{" "}
                  chips
                </b>
              </div>
              <p>
                <ShieldCheck size={13} /> Shared wallet · No table fee
              </p>
            </section>
            <section className="rm-history">
              <div className="rm-history-heading">
                <h3>
                  <History size={16} /> Recent rounds
                </h3>
                <span
                  title="Net chips over the last 20 rounds"
                  className={sessionNet > 0 ? "positive" : ""}
                >
                  {sessionNet > 0 ? "+" : ""}
                  {format(sessionNet)}
                </span>
              </div>
              {!t.history.length ? (
                <div className="rm-history-empty">
                  <span>♠ ♥ ♣ ♦</span>
                  <p>Your story starts with the first hand.</p>
                  <small>Round results will appear here.</small>
                </div>
              ) : (
                <div className="rm-history-list">
                  {t.history.slice(0, 5).map((h) => (
                    <div key={h.round}>
                      <span
                        className={`rm-history-icon ${h.winner === 0 ? "won" : ""}`}
                      >
                        {h.winner === 0 ? (
                          <Trophy size={14} />
                        ) : (
                          <History size={14} />
                        )}
                      </span>
                      <div>
                        <b>Round #{String(h.round).padStart(4, "0")}</b>
                        <small>
                          {h.winner === null
                            ? "Entry returned"
                            : `${h.winner === 0 ? "You" : t.players[h.winner].name} won`}
                        </small>
                      </div>
                      <strong className={h.net > 0 ? "positive" : ""}>
                        {h.net > 0 ? "+" : ""}
                        {format(h.net)}
                      </strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <div className="rm-tip">
              <CircleHelp size={18} />
              <div>
                <b>A little table wisdom</b>
                <p>
                  Build your pure sequence first. Save jokers for the gaps in
                  your other groups.
                </p>
              </div>
            </div>
          </aside></GameInformationSection>
        </div>
        {t.result?.winner !== null && t.result && (
          <section className="rm-winning-hand">
            <h3>
              <Crown size={17} /> Winning hand ·{" "}
              {t.players[t.result.winner!].name}
            </h3>
            <div>
              {winningGroups.map((g, i) => (
                <div key={i}>
                  <span>{groupName[g.kind]}</span>
                  <p>{g.cards.map((c) => cardLabel(c)).join("  ·  ")}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        <RummyBettingDock
          userId={userId}
          session={session}
          tableRef={tableRef}
          onHeightChange={setDockHeight}
        />
        <GameInformationSection><footer className="rm-footer">
          <span>♠ RUMMY ROYALE</span>
          <p>Think ahead. Play your hand. Enjoy the game.</p>
          <span>Shared wallet · 13-card rummy</span>
        </footer></GameInformationSection>
      </div>
      <RoundWinDialog win={roundWin.win} onClose={roundWin.dismiss} />
    </main>
  );
}
