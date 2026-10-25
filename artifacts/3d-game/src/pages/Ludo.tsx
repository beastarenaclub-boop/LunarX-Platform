import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  Coins,
  Crown,
  History,
  Info,
  ShieldCheck,
  Trophy,
  Users,
  Minus,
  Plus,
  Maximize,
  Minimize,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import {
  LUDO,
  ludoColors,
  LUDO_COLORS,
  type LudoColor,
  type LudoState,
  type LudoPlayer,
} from "@workspace/api-zod/ludo";
import { useAuth } from "@/lib/auth";
import { useLudo } from "@/components/ludo/useLudo";
import { LudoBoard, COLORS } from "@/components/ludo/LudoBoard";
import { LudoPin } from "@/components/ludo/LudoPin";
import { LudoHome, LudoMatchmaking } from "@/components/ludo/LudoLobby";
import { useLudoAudio } from "@/components/ludo/useLudoAudio";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/components/ludo/ludo.css";
import "@/components/ludo/ludo-lobby.css";
import "@/components/ludo/ludo-home.css";
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
  color,
  active,
  you,
  dice,
  remaining,
  disabled,
  rolling,
  onRoll,
}: {
  p: LudoPlayer | null;
  color: LudoColor;
  active: boolean;
  you: boolean;
  dice?: number;
  remaining: number;
  disabled: boolean;
  rolling: boolean;
  onRoll: () => void;
}) {
  return (
    <div
      className={`ld-player ld-seat-${color}${active ? " ld-player-active" : ""}${p?.forfeited ? " ld-left" : ""}`}
      data-you={you || undefined}
      style={
        {
          "--seat": COLORS[color],
          "--turn": `${active ? Math.min(100, (remaining / (p?.kind === "computer" ? 1 : 25)) * 100) : 0}%`,
        } as CSSProperties
      }
    >
      <div className="ld-player-controls">
        <span className="ld-avatar">
          {p?.kind === "computer" ? (
            <Bot size={20} />
          ) : (
            p?.name.slice(0, 1).toUpperCase() || <Users size={19} />
          )}
        </span>
        {you ? (
          <button
            className="ld-roll"
            disabled={disabled}
            onClick={onRoll}
            aria-label="Roll dice"
          >
            <Dice value={dice} rolling={rolling} />
            <span>
              {active && !disabled ? "ROLL" : active ? `${remaining}s` : "DICE"}
            </span>
          </button>
        ) : (
          <div
            className="ld-other-dice"
            aria-label={
              active
                ? `Opponent turn, ${remaining} seconds`
                : "Waiting for turn"
            }
          >
            {dice ? (
              <Dice value={dice} />
            ) : (
              <span className="ld-dice-blank">
                {p ? <Crown size={22} /> : <Users size={22} />}
              </span>
            )}
            {active && <small>{remaining}s</small>}
          </div>
        )}
        <span
          className="ld-progress"
          aria-label={`${p?.tokens.filter((t) => t === 56).length ?? 0} of 4 tokens home`}
        >
          {[0, 1, 2, 3].map((i) => (
            <i
              key={i}
              className={
                i < (p?.tokens.filter((t) => t === 56).length ?? 0)
                  ? "ld-home"
                  : ""
              }
            />
          ))}
        </span>
      </div>
      <div className="ld-player-name">
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
    </div>
  );
}
export default function Ludo() {
  const { user } = useAuth();
  return user ? (
    <LudoGame
      key={user.id}
      userId={user.id}
      name={user.displayName || "Player"}
      demo={!!user.isDemo}
    />
  ) : null;
}
function LudoGame({
  userId,
  name,
  demo,
}: {
  userId: string;
  name: string;
  demo: boolean;
}) {
  const game = useLudo(userId),
    { data, busy, offline } = game;
  const audio = useLudoAudio(userId, data?.match);
  const [menu, setMenu] = useState<{
    screen: "home" | "setup";
    mode: "online" | "computer";
  }>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`ludo-menu:${userId}`) || "null",
      );
      return {
        screen: saved?.screen === "setup" ? "setup" : "home",
        mode: saved?.mode === "computer" ? "computer" : "online",
      };
    } catch {
      return { screen: "home", mode: "online" };
    }
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(`ludo-menu:${userId}`, JSON.stringify(menu));
    } catch {}
  }, [menu, userId]);
  const seenActive = useRef<string | null>(null);
  const app = useRef<HTMLElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [colour, setColour] = useState<LudoColor>(() => {
    try {
      const saved = localStorage.getItem(`ludo-colour:${userId}`);
      if (LUDO_COLORS.includes(saved as LudoColor)) return saved as LudoColor;
    } catch {}
    return "blue";
  });
  useEffect(() => {
    const change = () =>
      setFullscreen(document.fullscreenElement === document.documentElement);
    document.addEventListener("fullscreenchange", change);
    return () => document.removeEventListener("fullscreenchange", change);
  }, []);
  const [capacity, setCapacity] = useState<2 | 4>(2),
    [entry, setEntry] = useState(1000),
    [dialog, setDialog] = useState<
      "rules" | "history" | "leave" | "settings" | null
    >(null),
    [dismissed, setDismissed] = useState<string | null>(null),
    [proof, setProof] = useState("");
  const m = data?.match,
    live =
      m &&
      (m.status === "waiting" || m.status === "playing") &&
      !m.state.players[m.you]?.forfeited;
  useEffect(() => {
    if (live && m) seenActive.current = m.id;
  }, [live, m?.id]);
  const show =
      m && (live || (seenActive.current === m.id && dismissed !== m.id)),
    canonical = show ? m.state : preview;
  // Presentation-only cyclic palette: seat IDs, dice, progress and moves stay canonical.
  const shift =
    (LUDO_COLORS.indexOf(colour) -
      LUDO_COLORS.indexOf(show ? ludoColors(m.capacity)[m.you] : "red") +
      4) %
    4;
  const displayColour = (color: LudoColor) =>
    LUDO_COLORS[(LUDO_COLORS.indexOf(color) + shift) % 4];
  const s: LudoState = {
    ...canonical,
    players: canonical.players.map((p) =>
      p ? { ...p, color: displayColour(p.color) } : null,
    ),
  };
  const waiting = show && m.status === "waiting",
    forfeited = !!show && !!m.state.players[m.you]?.forfeited,
    playing = show && m.status === "playing" && !forfeited,
    ended = show && !waiting && !playing;
  const home = !show && menu.screen === "home";
  const view = home ? "home" : !show ? "setup" : waiting ? "search" : "board";
  useLayoutEffect(() => {
    const viewport = app.current?.closest<HTMLElement>(
      '[data-game-viewport="ludo"]',
    );
    if (viewport) viewport.scrollTop = 0;
  }, [view, m?.id]);
  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {}
  };
  const yours =
    !!playing && m.state.turn === m.you && !m.state.players[m.you]?.forfeited;
  const remaining = m
    ? Math.max(0, Math.ceil((m.deadline - game.time) / 1000))
    : 0;
  const winner =
    show && m.state.winner !== null ? m.state.players[m.state.winner] : null;
  const seats = show ? m.capacity : capacity,
    chosenPrize = entry * capacity * 0.9;
  const entries = data?.entries ?? [...LUDO.entries];
  const entryIndex = entries.indexOf(entry);
  const locked = busy || offline || game.retry || !playing || remaining === 0;
  const renderPlayer = (color: LudoColor) => {
    const i = ludoColors(seats).findIndex((c) => displayColour(c) === color);
    if (i < 0)
      return <div className="ld-empty-seat" key={color} aria-hidden="true" />;
    const p = s.players[i];
    const active = !!playing && s.turn === i;
    return (
      <Player
        key={color}
        color={color}
        p={p}
        active={active}
        you={!!show && m.you === i}
        dice={
          active && s.dice
            ? s.dice
            : s.last?.seat === i
              ? s.last.dice
              : undefined
        }
        remaining={remaining}
        disabled={locked || !yours || s.phase !== "roll"}
        rolling={busy && active && s.phase === "roll"}
        onRoll={() => game.act("roll")}
      />
    );
  };
  const heading = waiting
    ? "Finding your opponents"
    : ended
      ? m.status === "cancelled"
        ? "Entry refunded"
        : forfeited
          ? "You left the match"
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
    <main
      ref={app}
      onPointerDownCapture={audio.unlock}
      className={
        "ld-app " +
        (home
          ? "ld-in-home"
          : waiting
            ? "ld-in-search"
            : show
              ? "ld-in-match"
              : "ld-in-lobby")
      }
    >
      {!home && !waiting && (
        <header className="ld-header">
          {!show ? (
            <button
              className="ld-back"
              aria-label="Back to main menu"
              onClick={() => setMenu((v) => ({ ...v, screen: "home" }))}
            >
              <ArrowLeft size={21} />
            </button>
          ) : (
            <Link href="/" className="ld-back" aria-label="Back to lobby">
              <ArrowLeft size={21} />
            </Link>
          )}
          <Link href="/ludo" className="ld-brand">
            <Crown size={25} />
            <span>
              LUDO <b>LIVE</b>
            </span>
          </Link>
          <div className="ld-wallet">
            <Coins size={22} />
            <span>
              <small>{demo ? "Demo wallet" : "Your wallet"}</small>
              <b title={data ? money(data.balancePaise) : undefined}>
                {data ? money(data.balancePaise) : "—"}
              </b>
            </span>
          </div>
          <button
            className="ld-icon"
            aria-label="Game rules"
            onClick={() => setDialog("rules")}
          >
            <Info size={20} />
          </button>
        </header>
      )}
      <div className="ld-main">
        {home ? (
          <LudoHome
            name={name}
            balance={data?.balancePaise}
            demo={demo}
            offline={offline}
            onChoose={(mode) => setMenu({ screen: "setup", mode })}
            onSettings={() => setDialog("settings")}
            onHistory={() => setDialog("history")}
            fullscreen={fullscreen}
            onFullscreen={() => void toggleFullscreen()}
          />
        ) : !show ? (
          <section className="ld-lobby">
            <div className="ld-lobby-hero">
              <span className="ld-hero-crown">
                <Crown size={36} />
              </span>
              <h1>
                LUDO <span>LIVE</span>
              </h1>
              <p>
                {menu.mode === "computer"
                  ? "PLAY AGAINST COMPUTER"
                  : "ONLINE MULTIPLAYER"}
              </p>
            </div>
            <div className="ld-room-card">
              <section className="ld-setup-section">
                <h2>SELECT YOUR COLOUR</h2>
                <div
                  className="ld-colours"
                  role="group"
                  aria-label="Your token colour"
                >
                  {(["blue", "red", "green", "yellow"] as const).map((c) => (
                    <button
                      key={c}
                      aria-label={c + " tokens"}
                      aria-pressed={colour === c}
                      style={{ "--seat": COLORS[c] } as CSSProperties}
                      onClick={() => {
                        setColour(c);
                        try {
                          localStorage.setItem(`ludo-colour:${userId}`, c);
                        } catch {}
                      }}
                    >
                      <LudoPin color={COLORS[c]} />
                      <span>
                        {colour === c && <Check size={17} strokeWidth={3} />}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="ld-colour-note">Your personal board view</p>
              </section>
              <section className="ld-setup-section">
                <h2>SELECT PLAYERS</h2>
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
                      <span className="ld-radio">
                        {capacity === n && <Check size={18} strokeWidth={3} />}
                      </span>
                      <span>
                        <strong>{n} players</strong>
                        <small>
                          {n === 2 ? "Head to head" : "Classic battle"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="ld-setup-section ld-select-game">
                <h2>SELECT YOUR GAME</h2>
                <div className="ld-stakes">
                  <button
                    className="ld-step"
                    aria-label="Lower entry fee"
                    disabled={entryIndex <= 0}
                    onClick={() => setEntry(entries[entryIndex - 1])}
                  >
                    <Minus />
                  </button>
                  <div className="ld-prize">
                    <span>
                      <Trophy size={22} /> WIN
                    </span>
                    <b>{money(chosenPrize)}</b>
                    <small>Entry: {money(entry)}</small>
                  </div>
                  <button
                    className="ld-step"
                    aria-label="Higher entry fee"
                    disabled={
                      entryIndex < 0 || entryIndex >= entries.length - 1
                    }
                    onClick={() => setEntry(entries[entryIndex + 1])}
                  >
                    <Plus />
                  </button>
                </div>
                <div className="ld-entries" role="group" aria-label="Entry fee">
                  {entries.map((amount) => (
                    <button
                      key={amount}
                      aria-pressed={entry === amount}
                      onClick={() => setEntry(amount)}
                    >
                      {money(amount)}
                    </button>
                  ))}
                </div>
                <p className="ld-fee">Prize after 10% platform commission</p>
                <button
                  className="ld-primary ld-play"
                  aria-label={
                    data && data.enabled && Number(data.balancePaise) >= entry
                      ? "Find a match"
                      : undefined
                  }
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
                    game.join(capacity, entry, menu.mode);
                  }}
                >
                  {busy ? (
                    "Joining…"
                  ) : !data ? (
                    "Connecting…"
                  ) : !data.enabled ? (
                    "Tables paused"
                  ) : Number(data.balancePaise) < entry ? (
                    "Insufficient balance"
                  ) : (
                    <>
                      PLAY <ArrowRight size={22} />
                    </>
                  )}
                </button>
                <p className="ld-note">
                  {menu.mode === "computer" ? (
                    <>
                      Entry debited on joining.
                      <br />
                      Computer opponents connect instantly.
                    </>
                  ) : (
                    <>
                      Entry debited on joining. Empty seats get
                      <br />
                      Computer players after 20 seconds.
                    </>
                  )}
                </p>
              </section>
            </div>
            <div className="ld-lobby-links">
              <button onClick={() => setDialog("history")}>
                <History size={16} /> My matches
              </button>
              <button onClick={() => setDialog("rules")}>
                <Info size={16} /> How to play
              </button>
            </div>
          </section>
        ) : waiting ? (
          <LudoMatchmaking
            match={m}
            state={s}
            remaining={Math.min(20, remaining)}
            offline={offline}
            busy={busy || game.retry}
            audio={audio}
            onCancel={() => game.act("leave")}
          />
        ) : (
          <section className="ld-arena">
            <div className="ld-match-bar">
              <div className="ld-match-id">
                MATCH {m.id.slice(0, 8).toUpperCase()}
                <small>
                  {m.capacity} players · Entry {money(m.entryPaise)}
                </small>
              </div>
              <div className="ld-match-prize">
                <Trophy size={18} />
                <span>
                  WIN<b>{money(m.prizePaise)}</b>
                </span>
              </div>
              {live && (
                <button
                  className="ld-leave"
                  disabled={busy || game.retry}
                  onClick={() =>
                    waiting ? game.act("leave") : setDialog("leave")
                  }
                >
                  {waiting ? "Cancel & refund entry" : "Leave match"}
                </button>
              )}
            </div>
            <div className="ld-arena-top">
              <span
                className={"ld-connection" + (offline ? " ld-offline" : "")}
              >
                <i />
                {offline ? "Reconnecting…" : demo ? "DEMO TABLE" : "LIVE TABLE"}
              </span>
              <span>
                {waiting
                  ? "MATCHMAKING"
                  : forfeited && m.status === "playing"
                    ? "YOU LEFT"
                    : ended
                      ? "MATCH COMPLETE"
                      : "CLASSIC LUDO"}
              </span>
            </div>
            <div className="ld-board-layout">
              <div className="ld-players ld-players-top">
                {(["red", "green"] as const).map(renderPlayer)}
              </div>
              <div className="ld-board-wrap">
                <LudoBoard
                  state={s}
                  you={m.you}
                  legal={m.legalTokens}
                  disabled={locked}
                  onMove={(token) => game.act("move", token)}
                />
                {waiting && (
                  <div className="ld-search-overlay">
                    <span className="ld-search-spinner">
                      <Users size={22} />
                    </span>
                    <strong>
                      {s.players.filter(Boolean).length} / {m.capacity} joined
                    </strong>
                    <span>Computer joins in {remaining}s</span>
                  </div>
                )}
              </div>
              <div className="ld-players ld-players-bottom">
                {(["blue", "yellow"] as const).map(renderPlayer)}
              </div>
              <div
                className={"ld-turn" + (yours ? " ld-your-turn" : "")}
                role="status"
                aria-live="polite"
              >
                <div>
                  <h2>{heading}</h2>
                  <p>
                    {waiting
                      ? "Looking for live players. Empty seats fill automatically."
                      : ended
                        ? (forfeited
                            ? "Entry forfeited. You can join a new table."
                            : m.reason) ||
                          (winner?.seat === m.you
                            ? money(m.prizePaise) + " credited to your wallet"
                            : "Ready for another game?")
                        : yours
                          ? s.phase === "move"
                            ? "Tap a glowing token or choose below"
                            : "Tap the dice beside your name"
                          : s.players[s.turn]?.kind === "computer"
                            ? "Computer is making a move…"
                            : "Waiting for their move…"}
                  </p>
                </div>
                {waiting ? (
                  <div className="ld-countdown">
                    {remaining}
                    <small>SEC</small>
                  </div>
                ) : ended ? (
                  <button
                    className="ld-primary"
                    onClick={() => {
                      setDismissed(m.id);
                      setMenu((v) => ({ ...v, screen: "setup" }));
                    }}
                  >
                    Play again <ArrowRight size={16} />
                  </button>
                ) : (
                  <span className="ld-turn-clock">
                    {remaining}
                    <small>SEC</small>
                  </span>
                )}
              </div>
              {yours && s.phase === "move" && (
                <div className="ld-moves" aria-label="Choose a token">
                  {m.legalTokens.map((token) => (
                    <button
                      key={token}
                      disabled={locked}
                      onClick={() => game.act("move", token)}
                    >
                      <span style={{ background: COLORS[colour] }} />
                      Move {token + 1}
                    </button>
                  ))}
                </div>
              )}
              <div className="ld-last">
                {s.last?.text === "Match started · Red rolls first"
                  ? "Match started · " +
                    (s.players[0]?.name || "First seat") +
                    " rolls first"
                  : s.last?.text ||
                    "Roll a six to bring your tokens into play."}
              </div>
              {ended && m.seed && (
                <button className="ld-proof" onClick={() => void verify()}>
                  <ShieldCheck size={15} />
                  {proof || "Verify dice & download match record"}
                </button>
              )}
            </div>
            <footer className="ld-arena-footer">
              <button
                onClick={() => setDialog("history")}
                aria-label="My matches"
              >
                <History size={18} />
              </button>
              <button onClick={() => setDialog("rules")}>
                How to play <Info size={14} />
              </button>
              <button
                className="ld-fullscreen"
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                onClick={async () => {
                  try {
                    if (document.fullscreenElement)
                      await document.exitFullscreen();
                    else await document.documentElement.requestFullscreen();
                  } catch {
                    /* Browser may not support element fullscreen. */
                  }
                }}
              >
                {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
              </button>
            </footer>
          </section>
        )}
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
      </div>

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="ld-modal">
          <DialogTitle>
            {dialog === "rules"
              ? "How to play Ludo Live"
              : dialog === "settings"
                ? "Game settings"
                : dialog === "history"
                  ? "Your recent matches"
                  : "Leave this match?"}
          </DialogTitle>
          <DialogDescription>
            {dialog === "rules"
              ? "Classic rules for every human and Computer player."
              : dialog === "settings"
                ? "Make the table feel like yours."
                : dialog === "history"
                  ? "Entries, results and wallet payouts."
                  : "Leaving after a match starts forfeits your entry fee. Refreshing or closing this page keeps your seat."}
          </DialogDescription>
          {dialog === "settings" ? (
            <div className="ld-settings">
              <div>
                <strong>Sound</strong>
                <button
                  aria-label="Sound"
                  aria-pressed={audio.sound}
                  onClick={audio.toggleSound}
                >
                  {audio.sound ? "ON" : "OFF"}
                </button>
              </div>
              <div>
                <strong>Music</strong>
                <button
                  aria-label="Music"
                  aria-pressed={audio.music}
                  onClick={audio.toggleMusic}
                >
                  {audio.music ? "ON" : "OFF"}
                </button>
              </div>
              <div className="ld-settings-links">
                <button onClick={() => setDialog("rules")}>How to play</button>
                <button onClick={() => setDialog("history")}>My matches</button>
              </div>
            </div>
          ) : dialog === "rules" ? (
            <div className="ld-rules">
              <ol>
                <li>
                  Roll a 6 to move a token out of its yard. The first seat
                  starts; turns move clockwise. Two-player games use opposite
                  corners. Your chosen colour changes only your personal board
                  view.
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
                Choose Computer from the main menu to start immediately against
                Computer opponents. The same entry fees, prize pool and rules
                apply.
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
                  game.act("leave", undefined, true);
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
