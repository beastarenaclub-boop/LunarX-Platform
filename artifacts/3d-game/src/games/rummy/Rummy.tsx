/**
 * Rummy Royale — one player, three computer seats, real money.
 *
 * The Rummy Royale kit's page (2026-09-29) on the platform's table: the kit
 * ran a local practice engine on practice chips; here the SERVER holds the
 * table (`useRummy`), the entry is a real bet debited from the lunar wallet,
 * and the page draws what the server says and asks for moves. The kit's
 * auto-bet plan and practice refill are gone — a stake here is money — and
 * its "Provably fair"-style copy was never carried: the deal is chosen by the
 * result engine and no seed is disclosed.
 *
 * `embedded` is the partner iframe (the launcher passes it): no way out to
 * OUR lobby and no redirect to our login when the session lapses — the
 * launcher reports SESSION_EXPIRED to the partner instead.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Coins,
  Crown,
  History,
  LockKeyhole,
  Play,
  RotateCcw,
  ShieldCheck,
  Timer,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useAuth } from "@/lib/auth";
import { formatRupees, paiseToRupees, rupeesToPaise } from "@/lib/format";
import { sfx, unlockAudio } from "@/game/audio";
import { CoinFace } from "@/components/table/chips";
import { useGetWalletBalance, getGetWalletBalanceQueryKey } from "@workspace/api-client-react";
import RummyDealer from "./RummyDealer";
import { analyzeHand, bestDiscard, cardLabel, isWild, rankLabel, SUITS, SYMBOLS, type Card, type MeldKind } from "./rules";
import { useRummy, type RummyRound } from "./useRummy";
import "./rummy.css";
import "./rummy-studio.css";

/** The kit's chip rack, in rupees; the table's min/max trims it. */
const STAKES = [25, 50, 100, 250, 500, 1000, 2000, 5000, 10000];
const format = (n: number) => n.toLocaleString("en-IN");
const groupName: Record<MeldKind, string> = {
  pure: "Pure sequence",
  sequence: "Sequence",
  set: "Set",
};

function PlayingCard({ card, wild = 0, back = false, small = false }: { card?: Card; wild?: number; back?: boolean; small?: boolean }) {
  if (back || !card)
    return (
      <span className={`rm-card rm-card-back ${small ? "rm-card-small" : ""}`} aria-hidden="true">
        <span>♠</span>
      </span>
    );
  return (
    <span className={`rm-card ${card.suit === "H" || card.suit === "D" ? "rm-card-red" : ""} ${small ? "rm-card-small" : ""}`}>
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

function Rules({ winReturn }: { winReturn: number }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="rm-quiet-btn">
          <BookOpen size={16} /> How to play
        </button>
      </DialogTrigger>
      <DialogContent className="rm-dialog">
        <DialogHeader>
          <DialogTitle>13 cards. One winning hand.</DialogTitle>
          <DialogDescription>Rummy Royale · Table rules</DialogDescription>
        </DialogHeader>
        <ol className="rm-rules-list">
          <li>
            <b>Deal in.</b> Four seats — you and three computer players — and two 53-card decks. Your entry is debited when the cards
            are dealt. Each player gets 13 cards.
          </li>
          <li>
            <b>Draw, then discard.</b> Take one closed card or the top open card, then discard one. An open joker cannot be picked, and a
            card picked from the open pile cannot be discarded in the same turn. You have 20 seconds a turn; after that the table plays
            one action for you.
          </li>
          <li>
            <b>Make your groups.</b> A sequence is 3 or more consecutive cards of the same suit. A set is 3 or 4 equal ranks of different
            suits. Aces work in A-2-3 or Q-K-A, never K-A-2.
          </li>
          <li>
            <b>Use jokers.</b> Printed jokers and cards matching the indicator rank are wild. A printed indicator makes aces wild. A wild
            card in its own natural position can belong to a pure sequence; a substituted joker cannot.
          </li>
          <li>
            <b>Declare.</b> Select your 14th card to discard and press Declare. The other 13 must all fit valid groups with at least two
            sequences, including one pure sequence. An invalid attempt is refused and keeps your turn.
          </li>
          <li>
            <b>Win.</b> The first valid declaration wins: your entry returns <b>{winReturn}x</b> (stake included). If a computer player
            declares first, your entry is lost. If the closed deck runs out or 200 turns pass, the table is drawn and your entry is
            returned.
          </li>
          <li>
            <b>Drop or leave.</b> Drop before drawing to sit the round out; your entry is lost. A table you leave open resumes when you
            return, and the clock keeps running — turns you miss are played for you.
          </li>
        </ol>
        <p className="rm-rules-note">The server deals and settles every round. Computer players use only their own hand and the open card.</p>
      </DialogContent>
    </Dialog>
  );
}

export default function Rummy({ embedded = false }: { embedded?: boolean }) {
  // Live-player beacon: subscription only, nothing publishes here.

  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => {
    if (!embedded && !authLoading && !user) navigate("/");
  }, [embedded, authLoading, user, navigate]);
  // The tables share ONE balance with the crash game.
  const balance = useGetWalletBalance(
    { game: "lunar" },
    { query: { queryKey: getGetWalletBalanceQueryKey({ game: "lunar" }), enabled: !!user, retry: false } },
  );
  return (
    <RummyTable
      key={user?.id ?? "anon"}
      name={user?.displayName || "You"}
      balancePaise={balance.data?.balance ?? "0"}
      embedded={embedded}
    />
  );
}

function RummyTable({ name, balancePaise, embedded }: { name: string; balancePaise: string; embedded: boolean }) {
  const rummy = useRummy();
  const { config, view, round, playing, busy, error, loaded, deadline, lastMove } = rummy;
  const tableRef = useRef<HTMLElement>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [sorted, setSorted] = useState(false);
  const [hint, setHint] = useState("");
  const [autoPlay, setAutoPlay] = useState(false);
  const [now, setNow] = useState(Date.now());

  const hand = view?.hand ?? [];
  const wild = view?.wild ?? 0;
  const seats = view?.seats ?? [];
  const analysis = useMemo(() => analyzeHand(hand, wild), [hand, wild]);
  const winnerSeat = view?.result?.winner ?? null;
  const winningGroups = useMemo(() => {
    const h = winnerSeat === null ? null : seats[winnerSeat]?.hand;
    return h ? analyzeHand(h, wild).groups : [];
  }, [winnerSeat, seats, wild]);
  const selectedAnalysis = useMemo(
    () => (selected && hand.length === 14 ? analyzeHand(hand.filter((c) => c.id !== selected), wild) : null),
    [hand, selected, wild],
  );
  const groups = useMemo(() => {
    if (sorted)
      return [{ label: "Sorted by suit", kind: "loose", cards: [...hand].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || a.rank - b.rank) }];
    return [
      ...analysis.groups.map((g) => ({ label: groupName[g.kind], kind: g.kind as string, cards: g.cards })),
      ...(analysis.unmatched.length ? [{ label: "Ungrouped", kind: "loose", cards: analysis.unmatched }] : []),
    ];
  }, [analysis, hand, sorted]);

  const live = !!view && view.status === "active" && view.phase === "playing";
  const folded = seats[0]?.folded ?? false;
  const yourTurn = live && view!.current === 0 && !folded && !playing;
  const manualTurn = yourTurn && !autoPlay && !busy;
  const canDiscard = manualTurn && view!.step === "discard" && !!selected && selected !== view!.drawnFromOpen;
  const open = view?.discard.at(-1);
  const canStart = loaded && !busy && !playing && (!round || round.status !== "active");
  const stakeRupees = view ? paiseToRupees(view.stakeAmount) : 0;
  const winReturn = view?.returns.you ?? config?.returns.you ?? 0;
  const shownAnalysis = selectedAnalysis ?? analysis;
  const seconds = deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    setSelected(null);
    setHint("");
  }, [view?.id, view?.current, view?.step, view?.turns]);
  useEffect(() => {
    document.title = "Rummy Royale";
    return () => {
      document.title = "Lunar Casino";
    };
  }, []);

  // Card foley per move, the Teen Patti table's recordings; a verdict when the
  // round commits. Both read the SERVER's frames, never a guess.
  useEffect(() => {
    if (!lastMove) return;
    if (lastMove.action === "draw") sfx.teenPattiCardLift(lastMove.seat);
    else sfx.teenPattiCardPlace(lastMove.seat);
  }, [lastMove]);
  const verdictRef = useRef<string | null>(null);
  useEffect(() => {
    if (!round || round.status === "active" || verdictRef.current === round.id) return;
    verdictRef.current = round.id;
    if (round.status === "won") sfx.tableWin("rummy-royale");
    else if (round.status === "lost") sfx.tableLose("rummy-royale");
  }, [round]);

  // Auto-play: the computer policy on the player's own hand, one move a beat,
  // each still a request the server judges like any other. Deps are the two
  // stable callbacks, NOT the hook's return object: that is a fresh object
  // every render and the clock re-renders four times a second, so keyed on it
  // the 700 ms timer was re-armed for ever and never fired.
  const { draw, discard } = rummy;
  useEffect(() => {
    if (!autoPlay || !yourTurn || busy || !view) return;
    const id = window.setTimeout(() => {
      if (view.step === "draw") {
        const current = analyzeHand(view.hand, view.wild);
        const top = view.discard.at(-1);
        if (top && !isWild(top, view.wild)) {
          const proposed = bestDiscard([...view.hand, top], view.wild, top.id);
          if (proposed.analysis.score > current.score) return void draw("open");
        }
        return void draw("stock");
      }
      const choice = bestDiscard(view.hand, view.wild, view.drawnFromOpen ?? undefined);
      void discard(choice.card.id, choice.analysis.valid);
    }, 700);
    return () => window.clearTimeout(id);
  }, [autoPlay, yourTurn, busy, view, draw, discard]);

  const declare = () => {
    if (!canDiscard) return;
    if (!selectedAnalysis?.valid) {
      setHint("Keep 13 cards in valid groups: 2 sequences, including 1 pure sequence. Try Auto group.");
      return;
    }
    void rummy.discard(selected!, true);
  };

  const net = round && round.status !== "active" ? paiseToRupees(round.payoutAmount ?? "0") - paiseToRupees(round.stakeAmount) : 0;

  return (
    <main
      className="rm-app"
      style={{ "--rm-dock-height": `${dockHeight}px` } as CSSProperties}
      data-testid="rummy-page"
      data-phase={view ? (view.status === "active" ? "playing" : "finished") : "ready"}
    >
      <header className="rm-header">
        {!embedded && (
          <Link href="/" className="rm-back" aria-label="Back to lobby">
            <ArrowLeft size={19} />
          </Link>
        )}
        <div className="rm-brand">
          <span className="rm-brand-mark">♠</span>
          <div>
            RUMMY<span>ROYALE</span>
          </div>
        </div>
        <span className="rm-header-divider" />
        <span className="rm-header-caption">THE CARD ROOM</span>
        <div className="rm-header-right">
          <div className="rm-wallet">
            <Wallet size={18} />
            <div>
              <small>Balance</small>
              <b data-testid="rummy-balance">₹{formatRupees(balancePaise)}</b>
            </div>
          </div>
        </div>
      </header>

      <div className="rm-content">
        <div className="rm-titlebar">
          <div>
            <div className="rm-eyebrow">A LITTLE STRATEGY. A WINNING HAND.</div>
            <h1>
              Welcome to your table<span>.</span>
            </h1>
            <p>You against three computer players. First valid declaration wins.</p>
          </div>
          <Rules winReturn={winReturn} />
        </div>
        <div className="rm-layout">
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
                <span className="rm-tiny-label">{view ? "ROUND" : "TABLE STATUS"}</span>
                <b>{view ? `#${view.id.slice(-6).toUpperCase()}` : "Ready to deal"}</b>
              </div>
              <div className="rm-dealer-tag">
                <span /> ASHA <small>ANIMATED DEALER</small>
              </div>
              {(seats.length ? seats.slice(1) : [{ name: "Arjun" }, { name: "Meera" }, { name: "Kabir" }]).map((p, i) => (
                <div
                  key={p.name}
                  className={`rm-seat rm-seat-${i + 1} ${live && view!.current === i + 1 ? "is-active" : ""}`}
                  data-testid={`rummy-bot-${i + 1}`}
                >
                  <span className={`rm-avatar rm-avatar-${i}`}>
                    {p.name[0]}
                    <span>AI</span>
                  </span>
                  <div>
                    <b>{p.name}</b>
                    <small>
                      {live && view!.current === i + 1
                        ? lastMove && lastMove.seat === i + 1 && playing
                          ? lastMove.action === "draw"
                            ? "Drawing…"
                            : "Discarding…"
                          : "Thinking…"
                        : !view
                          ? "Ready to play"
                          : `${"cards" in p ? (p as { cards: number }).cards : 13} cards`}
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
                    <CoinFace key={i} value={stakeRupees || STAKES[0]!} sizeClass="rm-pot-coin" />
                  ))}
                </div>
                <span>WIN PAYS</span>
                <strong>
                  <Coins size={17} /> {view ? `₹${format(Math.floor(stakeRupees * winReturn * 100) / 100)}` : `${winReturn}x`}
                </strong>
                <small>{view ? `₹${format(stakeRupees)} entry × ${winReturn}` : "Choose your entry to begin"}</small>
              </div>
              <div className="rm-piles">
                <div className="rm-joker-pile">
                  <span className="rm-pile-label">WILD JOKER</span>
                  <PlayingCard card={view?.indicator ?? undefined} small />
                  <small>{view?.indicator ? `All ${rankLabel(wild)}s are wild` : "Revealed on deal"}</small>
                </div>
                <button
                  className={`rm-pile rm-closed ${manualTurn && view!.step === "draw" ? "can-draw" : ""}`}
                  aria-label="Draw from closed deck"
                  data-testid="rummy-draw-stock"
                  disabled={!manualTurn || view!.step !== "draw"}
                  onClick={() => void rummy.draw("stock")}
                >
                  <PlayingCard back />
                  <span>CLOSED DECK</span>
                  <small>{view ? view.stockCount : "—"} cards</small>
                </button>
                <button
                  className={`rm-pile ${manualTurn && view!.step === "draw" && open && !isWild(open, wild) ? "can-draw" : ""}`}
                  aria-label="Draw from open pile"
                  data-testid="rummy-draw-open"
                  disabled={!manualTurn || view!.step !== "draw" || !open || isWild(open, wild)}
                  onClick={() => void rummy.draw("open")}
                >
                  <PlayingCard card={open} wild={wild} />
                  <span>OPEN PILE</span>
                  <small>{open ? (isWild(open, wild) ? "Joker locked" : cardLabel(open)) : "—"}</small>
                </button>
              </div>
              {!view && (
                <div className="rm-table-invite">
                  <Trophy size={14} /> Your next great hand starts here.
                </div>
              )}
              {round && round.status !== "active" && !playing && round.result && (
                <div className="rm-result" role="status" data-testid="rummy-result" data-status={round.status}>
                  <Trophy size={24} />
                  <div>
                    <strong>
                      {round.result.winner === null
                        ? "Table drawn"
                        : round.result.winner === 0
                          ? "You won the table!"
                          : `${round.seats[round.result.winner]?.name ?? "Computer"} wins`}
                    </strong>
                    <span>
                      {round.result.reason} · {net > 0 ? "+" : ""}₹{format(net)}
                    </span>
                  </div>
                </div>
              )}
              <div className="rm-stage-footer">
                <span>
                  <ShieldCheck size={12} /> Server-dealt table
                </span>
                <span>
                  <Users size={12} /> You + 3 computer players
                </span>
              </div>
            </div>

            <div className="rm-hand-area">
              <div className="rm-hand-heading">
                <div className="rm-you-avatar">{name[0]?.toUpperCase() ?? "Y"}</div>
                <div>
                  <b>
                    Your hand <span>{hand.length}/13</span>
                  </b>
                  <small>
                    {folded
                      ? "Watching this round"
                      : yourTurn
                        ? view!.step === "draw"
                          ? "Pick a card from either pile"
                          : "Select a card to discard"
                        : !view
                          ? "Your seat is reserved"
                          : view.status !== "active"
                            ? "Round complete"
                            : `${seats[view.current]?.name ?? "The table"} is playing`}
                  </small>
                </div>
                <div className="rm-hand-tools">
                  {live && <span className={`rm-turn-timer ${yourTurn ? "is-yours" : ""}`}>{yourTurn ? `${seconds}s` : "…"}</span>}
                  <button className="rm-quiet-btn" disabled={!hand.length} onClick={() => setSorted(!sorted)}>
                    <ArrowUpDown size={14} /> {sorted ? "Auto group" : "Sort cards"}
                  </button>
                </div>
              </div>
              <div className="rm-hand-scroll" data-testid="rummy-hand">
                {!hand.length ? (
                  <div className="rm-empty-hand">
                    {Array.from({ length: 13 }, (_, i) => (
                      <div className="rm-empty-card" key={i}>
                        <span>♠</span>
                      </div>
                    ))}
                    <span className="rm-empty-caption">A fresh deck. A fresh start.</span>
                  </div>
                ) : (
                  groups.map((g, index) => (
                    <div className={`rm-hand-group rm-group-${g.kind}`} key={`${index}-${g.kind}`}>
                      <div className="rm-group-cards">
                        {g.cards.map((card, i) => (
                          <button
                            key={card.id}
                            style={{ "--card-i": i } as CSSProperties}
                            className={`rm-hand-card ${selected === card.id ? "is-selected" : ""}`}
                            aria-label={`${cardLabel(card)}${isWild(card, wild) ? ", wild" : ""}`}
                            aria-pressed={selected === card.id}
                            disabled={!manualTurn || view!.step !== "discard" || card.id === view!.drawnFromOpen}
                            data-card-id={card.id}
                            onClick={() => {
                              setSelected(selected === card.id ? null : card.id);
                              setHint("");
                            }}
                          >
                            <PlayingCard card={card} wild={wild} />
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
                  <span className={shownAnalysis.sequences >= 2 ? "complete" : ""}>
                    <Check size={12} /> 2 sequences
                  </span>
                  <span className="rm-points">{analysis.points} points</span>
                </div>
                <div className="rm-hand-actions">
                  <button className="rm-drop" disabled={!manualTurn || view!.step !== "draw"} onClick={() => void rummy.drop()}>
                    Drop
                  </button>
                  <button className="rm-discard" data-testid="rummy-discard" disabled={!canDiscard} onClick={() => void rummy.discard(selected!)}>
                    <ArrowDown size={15} /> Discard
                  </button>
                  <button className="rm-declare" data-testid="rummy-declare" disabled={!canDiscard} onClick={declare}>
                    <Trophy size={15} /> Declare
                  </button>
                </div>
              </div>
              <p className={`rm-status ${hint || error ? "is-warning" : ""}`} role="status" data-testid="rummy-status">
                {hint || error || view?.message || (config && !config.enabled ? "Rummy Royale is closed right now." : "Choose an entry and deal in.")}
              </p>
            </div>
          </section>

          <aside className="rm-sidebar">
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
                  {config
                    ? `₹${format(paiseToRupees(config.minStakePaise))}–₹${format(paiseToRupees(config.maxStakePaise))}`
                    : "—"}
                </b>
              </div>
              <div>
                <span>Win pays</span>
                <b>{winReturn}x entry</b>
              </div>
              <p>
                <ShieldCheck size={13} /> Drawn table · entry returned
              </p>
            </section>
            <section className="rm-history">
              <div className="rm-history-heading">
                <h3>
                  <History size={16} /> Recent rounds
                </h3>
              </div>
              {!rummy.recent.length ? (
                <div className="rm-history-empty">
                  <span>♠ ♥ ♣ ♦</span>
                  <p>Your story starts with the first hand.</p>
                  <small>Round results will appear here.</small>
                </div>
              ) : (
                <div className="rm-history-list">
                  {rummy.recent.slice(0, 5).map((h: RummyRound) => {
                    const hn = h.status === "active" ? 0 : paiseToRupees(h.payoutAmount ?? "0") - paiseToRupees(h.stakeAmount);
                    return (
                      <div key={h.id}>
                        <span className={`rm-history-icon ${h.status === "won" ? "won" : ""}`}>
                          {h.status === "won" ? <Trophy size={14} /> : <History size={14} />}
                        </span>
                        <div>
                          <b>#{h.id.slice(-6).toUpperCase()}</b>
                          <small>
                            {h.status === "active"
                              ? "In play"
                              : h.status === "drawn"
                                ? "Entry returned"
                                : h.status === "won"
                                  ? "You won"
                                  : `${h.result?.winner != null ? h.seats[h.result.winner]?.name ?? "Computer" : "Computer"} won`}
                          </small>
                        </div>
                        <strong className={hn > 0 ? "positive" : ""}>
                          {hn > 0 ? "+" : ""}₹{format(hn)}
                        </strong>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            <div className="rm-tip">
              <CircleHelp size={18} />
              <div>
                <b>A little table wisdom</b>
                <p>Build your pure sequence first. Save jokers for the gaps in your other groups.</p>
              </div>
            </div>
          </aside>
        </div>
        {round && round.status !== "active" && !playing && winnerSeat !== null && winningGroups.length > 0 && (
          <section className="rm-winning-hand">
            <h3>
              <Crown size={17} /> Winning hand · {seats[winnerSeat]?.name}
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
        <BettingDock
          rummy={rummy}
          balancePaise={balancePaise}
          canStart={canStart}
          autoPlay={autoPlay}
          setAutoPlay={setAutoPlay}
          tableRef={tableRef}
          onHeightChange={setDockHeight}
        />
        <footer className="rm-footer">
          <span>♠ RUMMY ROYALE</span>
          <p>Think ahead. Play your hand. Enjoy the game.</p>
          <span>13-card rummy · you vs the computer</span>
        </footer>
      </div>
    </main>
  );
}

function BettingDock({
  rummy,
  balancePaise,
  canStart,
  autoPlay,
  setAutoPlay,
  tableRef,
  onHeightChange,
}: {
  rummy: ReturnType<typeof useRummy>;
  balancePaise: string;
  canStart: boolean;
  autoPlay: boolean;
  setAutoPlay: (v: boolean) => void;
  tableRef: React.RefObject<HTMLElement | null>;
  onHeightChange: (h: number) => void;
}) {
  const { config, round, recent } = rummy;
  const minR = config ? paiseToRupees(config.minStakePaise) : STAKES[0]!;
  const maxR = config ? paiseToRupees(config.maxStakePaise) : STAKES[STAKES.length - 1]!;
  const rack = STAKES.filter((v) => v >= minR && v <= maxR);
  const [stake, setStake] = useState<number>(0);
  const chosen = stake || rack.find((v) => v >= 100) || rack[0] || minR;
  const [expanded, setExpanded] = useState(false);
  const [frame, setFrame] = useState({ left: 0, width: 0 });
  const dockRef = useRef<HTMLElement>(null);
  const balanceR = paiseToRupees(balancePaise);
  const lastStake = round ? paiseToRupees(round.stakeAmount) : recent[0] ? paiseToRupees(recent[0].stakeAmount) : 0;
  const enabled = config?.enabled ?? true;
  const editable = canStart && enabled;
  const winReturn = config?.returns.you ?? 0;

  useEffect(() => {
    const dock = dockRef.current;
    const table = tableRef.current;
    if (!dock || !table) return;
    const measure = () => {
      const rect = table.getBoundingClientRect();
      setFrame({
        left: window.innerWidth <= 950 ? 0 : rect.left,
        width: window.innerWidth <= 950 ? window.innerWidth : rect.width,
      });
      onHeightChange(Math.ceil(dock.getBoundingClientRect().height));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    observer.observe(table);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [tableRef, onHeightChange]);

  const start = (rupees: number) => {
    unlockAudio();
    sfx.teenPattiChipPlace();
    void rummy.deal(rupeesToPaise(rupees));
  };

  return (
    <section
      ref={dockRef}
      className="rm-betting-dock"
      style={frame.width ? { left: frame.left, width: frame.width } : undefined}
      data-testid="rummy-betting-dock"
      data-active={!canStart}
      data-expanded={expanded}
      aria-label="Rummy betting controls"
    >
      <div className="rm-dock-scroll">
        <div className="rm-betting-heading">
          <span className={editable ? "is-open" : ""}>
            {editable ? <Timer size={14} /> : <LockKeyhole size={14} />}
            {editable ? "PLACE YOUR ENTRY" : enabled ? "ROUND IN PROGRESS" : "TABLE CLOSED"}
          </span>
          <span>
            13-CARD RUMMY <b>4 SEATS</b>
          </span>
          {!canStart && (
            <button className="rm-expand-bets" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide bets" : "Bet controls"}
            </button>
          )}
        </div>
        <div className="rm-bet-options">
          <div className="rm-bet-spots">
            <div className="rm-mode-spots" role="tablist" aria-label="Bet mode">
              <button role="tab" aria-selected className="rm-bet-spot rm-spot-blue">
                <Play size={17} />
                <strong>Manual</strong>
                <small>Play your own hand</small>
                <span>₹{format(chosen)} ENTRY</span>
              </button>
            </div>
            <button
              className="rm-bet-spot rm-spot-rose"
              aria-label="Repeat last entry"
              disabled={!editable || !lastStake || balanceR < lastStake || lastStake < minR || lastStake > maxR}
              onClick={() => {
                setStake(lastStake);
                start(lastStake);
              }}
            >
              <RotateCcw size={17} />
              <strong>Repeat last</strong>
              <small>Same entry, new hand</small>
              <span>{lastStake ? `₹${format(lastStake)} ENTRY` : "AFTER FIRST ROUND"}</span>
            </button>
          </div>
          <div className="rm-chip-line">
            <div className="rm-chip-rack" role="group" aria-label="Entry chip denomination" title={`Entries from ₹${format(minR)} to ₹${format(maxR)}`}>
              {rack.map((value) => (
                <button
                  key={value}
                  className="rm-stake-chip"
                  disabled={!editable}
                  aria-pressed={chosen === value}
                  aria-label={`Entry ${value} rupees`}
                  data-testid={`rummy-chip-${value}`}
                  onClick={() => setStake(value)}
                >
                  <CoinFace value={value} sizeClass="rm-coin-face" />
                </button>
              ))}
            </div>
            <div className="rm-placed-total">
              <small>{canStart ? "SELECTED ENTRY" : "THIS ROUND"}</small>
              <b data-testid="rummy-selected-entry">
                ₹{format(canStart || !round ? chosen : paiseToRupees(round.stakeAmount))}
              </b>
            </div>
          </div>
        </div>
        {rummy.error && (
          <p className="rm-control-notice" role="status">
            {rummy.error}
          </p>
        )}
        {balanceR < chosen && editable && (
          <p className="rm-control-notice">Not enough balance for this entry — choose a lower one or top up.</p>
        )}
      </div>
      <div className="rm-dock-actions">
        <label className="rm-autoplay">
          <input type="checkbox" role="switch" aria-label="Auto-play my hand" checked={autoPlay} onChange={(e) => setAutoPlay(e.target.checked)} />
          <span>
            Auto-play<small>Draw & discard for me</small>
          </span>
        </label>
        <div className="rm-dock-pot">
          <Coins size={15} />
          <span>
            Win pays<b>₹{format(Math.floor((canStart || !round ? chosen : paiseToRupees(round.stakeAmount)) * winReturn * 100) / 100)}</b>
          </span>
        </div>
        <button
          className="rm-start"
          data-testid="rummy-start"
          disabled={!editable || balanceR < chosen || chosen < minR || chosen > maxR}
          onClick={() => start(chosen)}
        >
          <Play size={16} fill="currentColor" />
          {!canStart ? "Playing" : round ? "Deal next round" : "Deal me in"}
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="rm-dock-footnote">
        <ShieldCheck size={10} /> Real money <span>Win pays {winReturn}x · drawn table returns the entry</span>
      </div>
    </section>
  );
}
