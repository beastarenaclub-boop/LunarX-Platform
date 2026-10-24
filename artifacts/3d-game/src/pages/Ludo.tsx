import { useState, type CSSProperties } from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  Crown,
  History,
  Info,
  ShieldCheck,
  Trophy,
  Users,
  Wallet,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import {
  LUDO,
  ludoColors,
  type LudoState,
  type LudoPlayer,
} from "@workspace/api-zod/ludo";
import { useAuth } from "@/lib/auth";
import { useLudo } from "@/components/ludo/useLudo";
import { LudoBoard, COLORS } from "@/components/ludo/LudoBoard";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/components/ludo/ludo.css";
const money = (v: string | number) =>
  `₹${(Number(v) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const preview: LudoState = {
  players: ludoColors(4).map((color, seat) => ({
    seat,
    color,
    name: "",
    kind: "computer",
    tokens: [-1, -1, -1, -1],
    auto: true,
    forfeited: false,
  })),
  turn: 0,
  phase: "roll",
  dice: null,
  sixes: 0,
  winner: null,
  rollNonce: 0,
  last: null,
};
function Dice({
  value = 6,
  rolling = false,
}: {
  value?: number;
  rolling?: boolean;
}) {
  const dots: Record<number, number[]> = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
  return (
    <span
      className={`ld-dice${rolling ? " ld-dice-roll" : ""}`}
      aria-label={`Dice ${value}`}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <i
          key={i}
          style={{
            visibility: dots[value]?.includes(i) ? "visible" : "hidden",
          }}
        />
      ))}
    </span>
  );
}
function Player({
  p,
  active,
  you,
}: {
  p: LudoPlayer | null;
  active: boolean;
  you: boolean;
}) {
  return (
    <div
      className={`ld-player${active ? " ld-player-active" : ""}${p?.forfeited ? " ld-left" : ""}`}
      style={{ "--seat": p ? COLORS[p.color] : "#79879c" } as CSSProperties}
    >
      <span className="ld-avatar">
        {p?.kind === "computer" ? (
          <Bot size={20} />
        ) : (
          p?.name.slice(0, 1).toUpperCase() || <Users size={19} />
        )}
      </span>
      <div>
        <strong>
          {p?.name || "Finding player…"}
          {you && <em>YOU</em>}
        </strong>
        <small>
          {!p
            ? "Waiting for a real player"
            : p.forfeited
              ? "Left match"
              : p.kind === "computer"
                ? "Computer"
                : p.auto
                  ? "Player · auto move"
                  : "Player"}
        </small>
      </div>
      {p && (
        <span className="ld-home-count">
          {p.tokens.filter((t) => t === 56).length}
          <small>/4</small>
        </span>
      )}
    </div>
  );
}
export default function Ludo() {
  const { user } = useAuth();
  return user ? (
    <LudoGame key={user.id} userId={user.id} demo={!!user.isDemo} />
  ) : null;
}
function LudoGame({ userId, demo }: { userId: string; demo: boolean }) {
  const game = useLudo(userId),
    { data, busy, offline } = game;
  const [capacity, setCapacity] = useState<2 | 4>(2),
    [entry, setEntry] = useState(1000),
    [dialog, setDialog] = useState<"rules" | "history" | "leave" | null>(null),
    [dismissed, setDismissed] = useState<string | null>(null),
    [proof, setProof] = useState("");
  const m = data?.match,
    live =
      m &&
      (m.status === "waiting" || m.status === "playing") &&
      !m.state.players[m.you]?.forfeited;
  const show = m && (live || dismissed !== m.id),
    s = show ? m.state : preview;
  const waiting = show && m.status === "waiting",
    playing = show && m.status === "playing",
    ended = show && !waiting && !playing;
  const yours =
    !!playing && m.state.turn === m.you && !m.state.players[m.you]?.forfeited;
  const remaining = m
    ? Math.max(0, Math.ceil((m.deadline - game.time) / 1000))
    : 0;
  const winner =
    show && m.state.winner !== null ? m.state.players[m.state.winner] : null;
  const seats = show ? m.capacity : capacity,
    chosenPrize = entry * capacity * 0.9;
  const heading = waiting
    ? "Finding your opponents"
    : ended
      ? m.status === "cancelled"
        ? "Entry refunded"
        : winner?.seat === m.you
          ? "You take the crown!"
          : winner
            ? `${winner.name} wins!`
            : "Match ended"
      : playing
        ? yours
          ? "Your turn"
          : `${s.players[s.turn]?.name}'s turn`
        : "Your next win starts here.";
  const verify = async () => {
    if (!m) return;
    try {
      const p = await customFetch<{
        seed: string;
        commitment: string;
        rolls: unknown[];
      }>(`/api/ludo/${m.id}/proof`);
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(p.seed),
      );
      const hex = Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, "0"),
      ).join("");
      if (hex !== p.commitment) throw new Error("Commitment mismatch");
      const blob = new Blob([JSON.stringify(p, null, 2)], {
          type: "application/json",
        }),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `ludo-${m.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setProof(`Seed verified · ${p.rolls.length} rolls downloaded`);
    } catch (e) {
      setProof(e instanceof Error ? e.message : "Verification unavailable");
    }
  };
  return (
    <main className="ld-app">
      <header className="ld-header">
        <Link href="/" className="ld-back" aria-label="Back to lobby">
          <ArrowLeft size={19} />
        </Link>
        <Link href="/ludo" className="ld-brand">
          <span>
            <Crown size={25} />
          </span>
          <div>
            LUDO <b>LIVE</b>
            <small>THE CLASSIC. TOGETHER.</small>
          </div>
        </Link>
        <div className="ld-wallet">
          <Wallet size={17} />
          <span>
            <small>{demo ? "Demo wallet" : "Your wallet"}</small>
            <b>{data ? money(data.balancePaise) : "—"}</b>
          </span>
        </div>
        <button
          className="ld-icon"
          aria-label="Game rules"
          onClick={() => setDialog("rules")}
        >
          <Info size={21} />
        </button>
      </header>
      <div className="ld-main">
        <aside className="ld-sidebar">
          <div className="ld-eyebrow">
            <span /> REAL PLAYERS. REAL MATCHES.
          </div>
          <h1>
            Four colours.
            <br />
            <span>One champion.</span>
          </h1>
          <p className="ld-intro">
            Race your tokens home. Make your move. Own the board.
          </p>
          <section className="ld-room-card">
            <div className="ld-section-label">
              <Users size={16} />
              {live ? "YOUR MATCH" : "CHOOSE YOUR TABLE"}
            </div>
            {live ? (
              <>
                <div className="ld-match-id">
                  MATCH {m.id.slice(0, 8).toUpperCase()}
                  <span>{m.capacity} PLAYERS</span>
                </div>
                <dl className="ld-breakdown">
                  <div>
                    <dt>Your entry</dt>
                    <dd>{money(m.entryPaise)}</dd>
                  </div>
                  <div>
                    <dt>Total seat pool</dt>
                    <dd>{money(Number(m.entryPaise) * m.capacity)}</dd>
                  </div>
                  <div>
                    <dt>Platform fee · 10%</dt>
                    <dd>{money(m.commissionPaise)}</dd>
                  </div>
                </dl>
                <div className="ld-prize">
                  <Trophy />
                  <span>
                    WINNER TAKES<b>{money(m.prizePaise)}</b>
                  </span>
                </div>
                <button
                  className="ld-secondary ld-full"
                  disabled={busy || game.retry}
                  onClick={() =>
                    waiting ? game.act("leave") : setDialog("leave")
                  }
                >
                  {waiting ? "Cancel & refund entry" : "Leave match"}
                </button>
                <p className="ld-note">
                  {waiting
                    ? "Full refund when you cancel before the match starts."
                    : "Your match stays open when you refresh or leave this page."}
                </p>
              </>
            ) : (
              <>
                <div
                  className="ld-mode"
                  role="group"
                  aria-label="Number of players"
                >
                  {([2, 4] as const).map((n) => (
                    <button
                      key={n}
                      aria-pressed={capacity === n}
                      onClick={() => setCapacity(n)}
                    >
                      <Users size={20} />
                      <strong>{n} players</strong>
                      <small>
                        {n === 2 ? "Head to head" : "Classic battle"}
                      </small>
                      {capacity === n && <Check size={13} />}
                    </button>
                  ))}
                </div>
                <label className="ld-label">ENTRY FEE</label>
                <div className="ld-entries">
                  {(data?.entries ?? LUDO.entries).map((amount) => (
                    <button
                      key={amount}
                      aria-pressed={entry === amount}
                      onClick={() => setEntry(amount)}
                    >
                      {money(amount)}
                    </button>
                  ))}
                </div>
                <div className="ld-prize">
                  <Trophy />
                  <span>
                    WINNER TAKES<b>{money(chosenPrize)}</b>
                  </span>
                  <small>
                    After 10%
                    <br />
                    platform fee
                  </small>
                </div>
                <button
                  className="ld-primary ld-full"
                  disabled={
                    !data ||
                    busy ||
                    offline ||
                    game.retry ||
                    !data.enabled ||
                    !data.entries.includes(entry) ||
                    Number(data.balancePaise) < entry
                  }
                  onClick={() => {
                    setDismissed(null);
                    setProof("");
                    game.join(capacity, entry);
                  }}
                >
                  {" "}
                  {busy
                    ? "Joining…"
                    : !data
                      ? "Connecting…"
                      : !data.enabled
                        ? "Tables paused"
                        : Number(data.balancePaise) < entry
                          ? "Insufficient balance"
                          : "Find a match"}
                  <ArrowRight size={18} />
                </button>
                <p className="ld-note">
                  Entry is debited when you join.
                  <br />
                  No opponents? Computer joins in 20 seconds.
                </p>
              </>
            )}
          </section>
          <div className="ld-trust">
            <ShieldCheck size={22} />
            <div>
              <strong>Same dice. Fair play.</strong>
              <small>Every roll is verifiable after the match.</small>
            </div>
          </div>
          <button
            className="ld-history-link"
            onClick={() => setDialog("history")}
          >
            <History size={17} /> My matches <ChevronRight size={15} />
          </button>
        </aside>
        <section className="ld-arena">
          <div className="ld-arena-top">
            <span className={`ld-connection${offline ? " ld-offline" : ""}`}>
              <i />
              {offline ? "Reconnecting…" : demo ? "DEMO TABLE" : "LIVE TABLE"}
            </span>
            <span>
              {show ? m.capacity : capacity} PLAYERS{" "}
              <span className="ld-dot">·</span> CLASSIC LUDO
            </span>
          </div>
          <div className="ld-board-layout">
            <div className="ld-players ld-players-top">
              {show ? (
                [0, ...(seats === 4 ? [1] : [])].map((i) => (
                  <Player
                    key={i}
                    p={s.players[i]}
                    active={!!playing && s.turn === i}
                    you={m.you === i}
                  />
                ))
              ) : (
                <>
                  <Player
                    p={{ ...preview.players[0]!, kind: "human", name: "You", auto:false }}
                    active={false}
                    you
                  />
                  <Player p={null} active={false} you={false} />
                </>
              )}
            </div>
            <LudoBoard
              state={s}
              you={show ? m.you : undefined}
              legal={show ? m.legalTokens : []}
              disabled={
                busy || offline || game.retry || !playing || remaining === 0
              }
              onMove={(token) => game.act("move", token)}
            />
            {yours && s.phase === "move" && (
              <div className="ld-moves" aria-label="Choose a token">
                {m.legalTokens.map((token) => (
                  <button
                    key={token}
                    disabled={busy || offline || game.retry || remaining === 0}
                    onClick={() => game.act("move", token)}
                  >
                    Move {token + 1}
                  </button>
                ))}
              </div>
            )}
            {show && (
              <div className="ld-players ld-players-bottom">
                {(seats === 4 ? [3, 2] : [1]).map((i) => (
                  <Player
                    key={i}
                    p={s.players[i]}
                    active={!!playing && s.turn === i}
                    you={m.you === i}
                  />
                ))}
              </div>
            )}
            <div className="ld-turn" role="status" aria-live="polite">
              <div>
                <h2>{heading}</h2>
                <p>
                  {waiting
                    ? `${s.players.filter(Boolean).length}/${m.capacity} joined · Computer fills empty seats in ${remaining}s`
                    : ended
                      ? m.reason ||
                        (winner?.seat === m.you
                          ? `${money(m.prizePaise)} credited to your wallet`
                          : "Play another match for a fresh start.")
                      : playing
                        ? yours
                          ? s.phase === "move"
                            ? "Tap a glowing token to move"
                            : "Roll the dice to make your move"
                          : s.players[s.turn]?.kind === "computer"
                            ? "Computer is making a move…"
                            : "Waiting for their move…"
                        : "Choose 2 or 4 players and find a match."}
                </p>
              </div>
              {waiting ? (
                <div className="ld-countdown">
                  {remaining}
                  <small>SEC</small>
                </div>
              ) : playing ? (
                <button
                  className="ld-roll"
                  disabled={
                    !yours ||
                    s.phase !== "roll" ||
                    busy ||
                    offline ||
                    game.retry ||
                    remaining === 0
                  }
                  onClick={() => game.act("roll")}
                  aria-label="Roll dice"
                >
                  <Dice value={s.dice ?? s.last?.dice ?? 6} rolling={busy} />
                  <span>
                    {yours && s.phase === "roll"
                      ? "ROLL DICE"
                      : `${remaining}s`}
                  </span>
                </button>
              ) : ended ? (
                <button
                  className="ld-primary"
                  onClick={() => setDismissed(m.id)}
                >
                  Play again
                  <ArrowRight size={17} />
                </button>
              ) : (
                <Dice />
              )}
            </div>
            {playing && (
              <div className="ld-timer">
                <span
                  style={{
                    width: `${Math.min(100, (remaining / (s.players[s.turn]?.kind === "computer" ? 1 : 25)) * 100)}%`,
                    background: COLORS[s.players[s.turn]!.color],
                  }}
                />
              </div>
            )}
            <div className="ld-last">
              {show
                ? s.last?.text || "Ready when you are"
                : "Roll a 6 to start · Capture opponents · Get all 4 tokens home"}
            </div>
            {ended && m.seed && (
              <button className="ld-proof" onClick={() => void verify()}>
                <ShieldCheck size={15} />
                {proof || "Verify dice & download match record"}
              </button>
            )}
          </div>
          {!busy && (game.error || offline || game.retry) && (
            <div className="ld-error" role="alert">
              {game.error ||
                "Connection interrupted. Your match and wallet are saved."}
              {game.retry ? (
                <button disabled={busy} onClick={game.retryAction}>
                  Retry last action
                </button>
              ) : offline ? (
                <button onClick={() => void game.sync()}>Reconnect</button>
              ) : null}
            </div>
          )}
          <footer className="ld-arena-footer">
            <span>
              <Bot size={15} /> Computer players are always labelled
            </span>
            <button onClick={() => setDialog("rules")}>
              How to play <Info size={14} />
            </button>
          </footer>
        </section>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="ld-modal">
          <DialogTitle>
            {dialog === "rules"
              ? "How to play Ludo Live"
              : dialog === "history"
                ? "Your recent matches"
                : "Leave this match?"}
          </DialogTitle>
          <DialogDescription>
            {dialog === "rules"
              ? "Classic rules for every human and Computer player."
              : dialog === "history"
                ? "Entries, results and wallet payouts."
                : "Leaving after a match starts forfeits your entry fee. Refreshing or closing this page keeps your seat."}
          </DialogDescription>
          {dialog === "rules" ? (
            <div className="ld-rules">
              <ol>
                <li>
                  Roll a 6 to move a token out of its yard. Red starts; turns
                  move clockwise. Two-player games use red and yellow.
                </li>
                <li>
                  Roll, then tap a highlighted token. A 6, capture or token
                  reaching home earns another roll. Three consecutive sixes end
                  the turn.
                </li>
                <li>
                  Land on an opponent to send their tokens back. Star squares
                  are safe. Tokens may share a square; stacks do not block
                  movement.
                </li>
                <li>
                  Use an exact roll to reach home. First to get all four tokens
                  home wins the match.
                </li>
                <li>
                  Each roll or move has 25 seconds. On timeout the computer
                  makes that action for your seat. You can resume on your next
                  action.
                </li>
              </ol>
              <h3>Entry & prize</h3>
              <p>
                Entry is deducted from your shared wallet when you join. The
                winner receives 90% of the total seat pool; the platform keeps
                10%. No extra charge at settlement.
              </p>
              <p>
                Empty seats fill with labelled Computer players after 20
                seconds. The platform funds their share of the advertised pool.
                If Computer wins, no human player receives the prize. Computer
                uses the same dice and rules.
              </p>
              <p>
                Cancel before the match starts for a full refund. Leaving after
                start forfeits your entry. Matches exceeding two hours are
                cancelled and unsettled entries refunded. A server restart
                preserves your match; a long interruption resets the turn timer.
              </p>
              <p>
                Each match commits to a secret seed before the first roll. After
                completion you can download the seed, rolls and action record.
              </p>
            </div>
          ) : dialog === "history" ? (
            <div className="ld-history">
              {data?.recent.length ? (
                data.recent.map((h, i) => (
                  <div key={`${h.id}:${i}`}>
                    <span>
                      <strong>
                        {h.capacity} players · {money(h.entryPaise)}
                      </strong>
                      <small>
                        {new Date(h.at).toLocaleString()} · {h.id.slice(0, 8)}
                      </small>
                    </span>
                    <span className={h.result === "won" ? "ld-win" : ""}>
                      <strong>
                        {h.result === "voided"
                          ? "Refunded"
                          : h.result === "won"
                            ? "Won"
                            : "Lost"}
                      </strong>
                      <small>{money(h.payoutPaise)}</small>
                    </span>
                  </div>
                ))
              ) : (
                <p>Your completed matches will appear here.</p>
              )}
            </div>
          ) : (
            <div className="ld-confirm">
              <button className="ld-secondary" onClick={() => setDialog(null)}>
                Keep playing
              </button>
              <button
                className="ld-danger"
                disabled={busy || game.retry}
                onClick={() => {
                  setDialog(null);
                  game.act("leave");
                }}
              >
                Forfeit & leave
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
