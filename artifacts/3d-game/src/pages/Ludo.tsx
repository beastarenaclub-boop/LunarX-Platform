import {
  useEffect,
  useMemo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  Crown,
  Info,
  ShieldCheck,
  Settings,
  Trophy,
  Users,
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
} from "@workspace/api-zod/ludo";
import { useAuth } from "@/lib/auth";
import { useLudo } from "@/components/ludo/useLudo";
import { LudoBoard, COLORS } from "@/components/ludo/LudoBoard";
import {
  LudoHome,
  LudoMatchmaking,
  LudoSoundControls,
} from "@/components/ludo/LudoLobby";
import { useLudoAudio } from "@/components/ludo/useLudoAudio";
import { useLudoPresentation } from "@/components/ludo/useLudoPresentation";
import { LudoMatchPlayer } from "@/components/ludo/LudoMatchPlayer";
import { LudoChat } from "@/components/ludo/LudoChat";
import { useLudoAutoMove } from "@/components/ludo/useLudoMovement";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "@/components/ludo/ludo.css";
import "@/components/ludo/ludo-lobby.css";
import "@/components/ludo/ludo-home.css";
import "@/components/ludo/ludo-effects.css";
import "@/components/ludo/ludo-mobile.css";
import "@/components/ludo/ludo-landscape.css";
import "@/components/ludo/ludo-classic-home.css";
import "@/components/ludo/ludo-social.css";
import "@/components/ludo/ludo-reference-match.css";
import "@/components/ludo/ludo-video-menu.css";
import "@/components/ludo/ludo-reference-home.css";
import "@/components/ludo/ludo-crafted.css";
import { LudoCommunity } from "@/components/ludo/LudoCommunity";
import {
  LudoSetup,
  LudoThemePicker,
  LUDO_THEMES,
  TOKEN_STYLES,
  type LudoTheme,
} from "@/components/ludo/LudoSetup";
import {
  LudoTokenStyleContext,
  type LudoTokenStyle,
} from "@/components/ludo/LudoPin";
import {
  LUDO_VARIANTS,
  type LudoMode,
  type LudoVariant,
} from "@workspace/api-zod/ludo";
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
  const audio = useLudoAudio(userId, data?.match, game.time);
  const presentation = useLudoPresentation(
    data?.match,
    game.updates,
    !busy && !!(game.error || offline),
    audio,
  );
  const { dice: diceRoll, movement } = presentation;
  const onMove = useCallback(
    (token: number) => game.act("move", token),
    [game.act],
  );
  const [menu, setMenu] = useState<{
    screen: "home" | "setup";
    mode: LudoMode;
  }>(() => {
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`ludo-menu:${userId}`) || "null",
      );
      return {
        screen: saved?.screen === "setup" ? "setup" : "home",
        mode:
          saved?.mode === "private"
            ? "private"
            : saved?.mode === "computer"
              ? "computer"
              : "online",
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
      "rules" | "history" | "leave" | "settings" | "themes" | null
    >(null),
    [dismissed, setDismissed] = useState<string | null>(null),
    [proof, setProof] = useState("");
  const [variant, setVariant] = useState<LudoVariant>("classic");
  const [tokenStyle, setTokenStyle] = useState<LudoTokenStyle>(() => {
    try {
      const value = localStorage.getItem(
        `ludo-token:${userId}`,
      ) as LudoTokenStyle;
      if (TOKEN_STYLES.includes(value)) return value;
    } catch {}
    return "pin";
  });
  const [theme, setTheme] = useState<LudoTheme>(() => {
    try {
      const value = localStorage.getItem(`ludo-theme:${userId}`) as LudoTheme;
      if (LUDO_THEMES.includes(value)) return value;
    } catch {}
    return "classic";
  });
  useEffect(() => {
    try {
      localStorage.setItem(`ludo-token:${userId}`, tokenStyle);
      localStorage.setItem(`ludo-theme:${userId}`, theme);
    } catch {}
  }, [tokenStyle, theme, userId]);
  const [chatRequest, setChatRequest] = useState(0);
  const [communityOpen, setCommunityOpen] = useState(false);
  const [closedResult, setClosedResult] = useState<string | null>(null);
  const m = data?.match,
    live =
      m &&
      (m.status === "waiting" || m.status === "playing") &&
      !m.state.players[m.you]?.forfeited;
  useEffect(() => {
    if (live && m) seenActive.current = m.id;
  }, [live, m?.id]);
  useEffect(() => {
    if (m?.status === "playing") setCommunityOpen(false);
  }, [m?.status]);
  const show =
      m && (live || (seenActive.current === m.id && dismissed !== m.id)),
    canonical = show
      ? (movement?.state ?? presentation.match?.state ?? m.state)
      : preview;
  // Presentation-only cyclic palette: seat IDs, dice, progress and moves stay canonical.
  const shift =
    (LUDO_COLORS.indexOf(colour) -
      LUDO_COLORS.indexOf(show ? ludoColors(m.capacity)[m.you] : "red") +
      4) %
    4;
  const displayColour = (color: LudoColor) =>
    LUDO_COLORS[(LUDO_COLORS.indexOf(color) + shift) % 4];
  const s: LudoState = useMemo(
    () => ({
      ...canonical,
      players: canonical.players.map((p) =>
        p ? { ...p, color: displayColour(p.color) } : null,
      ),
    }),
    [canonical, shift],
  );
  const waiting = show && m.status === "waiting",
    forfeited = !!show && !!m.state.players[m.you]?.forfeited,
    playing = show && m.status === "playing" && !forfeited,
    ended =
      show &&
      !waiting &&
      !playing &&
      !movement?.busy &&
      !presentation.catchingUp;
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
  const matchSeconds = m?.startedAt
    ? Math.max(
        0,
        Math.ceil(
          ((m.endsAt ?? m.startedAt + LUDO.maxMatchMs) - game.time) / 1000,
        ),
      )
    : 600;
  const matchClock = `${Math.floor(matchSeconds / 60)}:${String(matchSeconds % 60).padStart(2, "0")}`;
  const winners =
    m?.state.winners ?? (m?.state.winner != null ? [m.state.winner] : []);
  const youWon = !!m && winners.includes(m.you) && !forfeited;
  const teamWin = m?.state.variant === "team" && winners.length === 2;
  const shared = winners.length > 1 && !teamWin;
  const payout = m?.payoutPaise ?? (youWon ? (m?.prizePaise ?? "0") : "0");
  const resultOpen =
    !!ended && m?.status !== "cancelled" && closedResult !== m?.id;
  useEffect(() => {
    if (resultOpen) setDialog(null);
  }, [resultOpen]);
  const winner =
    show && m.state.winner !== null ? m.state.players[m.state.winner] : null;
  const seats = show ? m.capacity : capacity;
  const entries = data?.entries ?? [...LUDO.entries];
  const locked =
    busy ||
    offline ||
    game.retry ||
    !!diceRoll.roll ||
    !!movement?.busy ||
    presentation.catchingUp ||
    !playing ||
    remaining === 0;
  const autoToken = useLudoAutoMove(
    m,
    locked || !!game.error,
    (token, expected) => game.act("move", token, false, expected),
  );
  const renderPlayer = (color: LudoColor, dockSide?: "left" | "right") => {
    const i = ludoColors(seats).findIndex((c) => displayColour(c) === color);
    if (i < 0)
      return <div className="ld-empty-seat" key={color} aria-hidden="true" />;
    const p = s.players[i];
    const active =
      !!playing &&
      (diceRoll.roll
        ? diceRoll.roll.seat === i
        : (movement?.moving?.seat ?? s.turn) === i);
    return (
      <LudoMatchPlayer
        key={color}
        color={color}
        dockSide={dockSide}
        team={s.variant === "team" ? i % 2 : undefined}
        onEmojis={() => setChatRequest((v) => v + 1)}
        p={p}
        active={active}
        you={!!show && m.you === i}
        dice={
          diceRoll.values[i] ?? (s.last?.seat === i ? s.last.dice : undefined)
        }
        remaining={remaining}
        disabled={locked || !yours || s.phase !== "roll"}
        roll={diceRoll.roll?.seat === i ? diceRoll.roll : null}
        onRoll={() => {
          if (!locked && yours && s.phase === "roll" && diceRoll.begin())
            game.act("roll");
        }}
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
          : youWon
            ? teamWin
              ? "Your team wins!"
              : shared
                ? "You share the prize!"
                : "You take the crown!"
            : shared
              ? "Match tied · prize shared"
              : teamWin
                ? `Team ${(winners[0] % 2) + 1} wins!`
                : winner
                  ? `${winner.name} wins!`
                  : "Match ended"
      : movement?.busy
        ? "Moving token…"
        : playing
          ? diceRoll.roll
            ? diceRoll.roll.seat === m.you
              ? "Rolling your dice…"
              : `${s.players[diceRoll.roll.seat]?.name} is rolling…`
            : yours
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
    <LudoTokenStyleContext.Provider value={tokenStyle}>
      <main
        ref={app}
        onPointerDownCapture={audio.unlock}
        onKeyDownCapture={audio.unlock}
        className={
          `ld-app ld-theme-${theme} ` +
          (home
            ? "ld-in-home"
            : waiting
              ? "ld-in-search"
              : show
                ? `ld-in-match ld-match-${m.capacity}`
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
                  {demo ? "∞" : data ? money(data.balancePaise) : "—"}
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
        <div className="ld-main" aria-hidden={resultOpen || undefined}>
          {home ? (
            <LudoHome
              userId={userId}
              tokenStyle={tokenStyle}
              onTokenStyle={setTokenStyle}
              name={name}
              balance={data?.balancePaise}
              demo={demo}
              offline={offline}
              onChoose={(mode, selected = "classic") => {
                setMenu({ screen: "setup", mode });
                setVariant(selected);
                if (selected === "team") setCapacity(4);
              }}
              onThemes={() => setDialog("themes")}
              onSettings={() => setDialog("settings")}
              onHistory={() => setDialog("history")}
              onRules={() => setDialog("rules")}
              fullscreen={fullscreen}
              onFullscreen={() => void toggleFullscreen()}
            />
          ) : !show ? (
            <LudoSetup
              key={menu.mode}
              mode={menu.mode}
              variant={variant}
              onVariant={(v) => {
                setVariant(v);
                if (v === "team") setCapacity(4);
              }}
              capacity={capacity}
              onCapacity={setCapacity}
              colour={colour}
              onColour={(c) => {
                setColour(c);
                try {
                  localStorage.setItem(`ludo-colour:${userId}`, c);
                } catch {}
              }}
              tokenStyle={tokenStyle}
              onTokenStyle={setTokenStyle}
              entry={entry}
              onEntry={setEntry}
              entries={entries}
              balance={data?.balancePaise}
              enabled={!!data?.enabled}
              busy={busy || game.retry}
              offline={offline}
              onPlay={(n, e, v, code) => {
                setDismissed(null);
                setProof("");
                game.join(n, e, menu.mode, v, code);
              }}
              onRules={() => setDialog("rules")}
              onHistory={() => setDialog("history")}
              onThemes={() => setDialog("themes")}
            />
          ) : waiting ? (
            <LudoMatchmaking
              match={m}
              state={s}
              remaining={
                m.mode === "private" ? remaining : Math.min(20, remaining)
              }
              offline={offline}
              busy={busy || game.retry}
              audio={audio}
              onCancel={() => game.act("leave")}
              onSocial={() => setCommunityOpen(true)}
            />
          ) : (
            <section className="ld-arena">
              <header className="ld-mobile-match-header">
                <button
                  className="ld-menu-icon"
                  aria-label={playing ? "Leave match" : "Back to main menu"}
                  disabled={busy || game.retry}
                  onClick={() => {
                    if (playing) setDialog("leave");
                    else {
                      setDismissed(m.id);
                      setMenu((v) => ({ ...v, screen: "home" }));
                    }
                  }}
                >
                  <ArrowLeft />
                </button>
                <div className="ld-mobile-match-info">
                  <div>
                    <strong>{offline ? "Reconnecting…" : "LUDO LIVE"}</strong>
                    <b
                      className="ld-match-timer"
                      role="timer"
                      aria-label={`Match time remaining ${matchClock}`}
                    >
                      {matchClock}
                    </b>
                    <span title={data ? money(data.balancePaise) : undefined}>
                      <Coins size={13} />{" "}
                      {demo ? "∞" : data ? money(data.balancePaise) : "—"}
                    </span>
                  </div>
                  <small>
                    {LUDO_VARIANTS[m.state.variant ?? "classic"].name} ·{" "}
                    {m.capacity} players · Entry {money(m.entryPaise)} ·{" "}
                    <b>Win {money(m.prizePaise)}</b>
                  </small>
                </div>
                <div className="ld-landscape-sound">
                  <LudoSoundControls audio={audio} />
                </div>
                <button
                  className="ld-menu-icon"
                  aria-label="Game settings"
                  onClick={() => setDialog("settings")}
                >
                  <Settings />
                </button>
              </header>
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
                  {offline
                    ? "Reconnecting…"
                    : demo
                      ? "DEMO TABLE"
                      : "LIVE TABLE"}
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
                <div className="ld-playfield">
                  <div className="ld-players ld-players-top">
                    {m.capacity === 4 &&
                      (["red", "green"] as const).map((c) => renderPlayer(c))}
                  </div>
                  <div className="ld-board-wrap">
                    <LudoBoard
                      key={m.id}
                      state={s}
                      you={m.you}
                      legal={m.legalTokens}
                      disabled={locked}
                      moving={movement?.moving}
                      onMove={onMove}
                    />
                    {waiting && (
                      <div className="ld-search-overlay">
                        <span className="ld-search-spinner">
                          <Users size={22} />
                        </span>
                        <strong>
                          {s.players.filter(Boolean).length} / {m.capacity}{" "}
                          joined
                        </strong>
                        <span>Computer joins in {remaining}s</span>
                      </div>
                    )}
                  </div>
                  <div className="ld-players ld-players-bottom">
                    {m.capacity === 2
                      ? [m.you, (m.you + 1) % 2].map((seat, i) =>
                          renderPlayer(
                            displayColour(ludoColors(m.capacity)[seat]),
                            i === 0 ? "left" : "right",
                          ),
                        )
                      : (["blue", "yellow"] as const).map((c) =>
                          renderPlayer(c),
                        )}
                  </div>
                </div>
                <div className="ld-action-dock">
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
                              (youWon
                                ? money(payout) + " credited to your wallet"
                                : "Ready for another game?")
                            : diceRoll.roll
                              ? "Let the dice land…"
                              : movement?.busy
                                ? "Moving token…"
                                : yours
                                  ? s.phase === "move"
                                    ? autoToken !== null && !game.error
                                      ? "Moving your only token automatically…"
                                      : "Tap a glowing token or choose below"
                                    : m.capacity === 2
                                      ? "Tap the dice in the centre"
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
                  {yours &&
                    s.phase === "move" &&
                    !diceRoll.roll &&
                    !movement?.busy && (
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
                    {diceRoll.roll
                      ? "Dice in motion…"
                      : s.last?.text === "Match started · Red rolls first"
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
              </div>
              <footer className="ld-arena-footer">
                <LudoChat
                  key={m.id}
                  match={m}
                  userId={userId}
                  openRequest={chatRequest}
                  onWalletChange={() => void game.sync()}
                />
                <button onClick={() => setDialog("rules")}>
                  How to play <Info size={14} />
                </button>
                <LudoSoundControls audio={audio} />
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
          open={resultOpen}
          onOpenChange={(open) => !open && m && setClosedResult(m.id)}
        >
          <DialogContent className="ld-modal ld-result-modal">
            <Crown className="ld-result-crown" aria-hidden="true" />
            <DialogTitle>
              {forfeited && m?.state.players[m.you]?.exitReason === "inactive"
                ? "Removed for inactivity"
                : heading}
            </DialogTitle>
            <DialogDescription>
              {youWon
                ? teamWin
                  ? "Your team's prize is split equally. Your share is credited to your wallet."
                  : shared
                    ? "A tied finish! Your share is credited to your wallet."
                    : "Your prize is credited to your wallet."
                : forfeited
                  ? "Your entry was forfeited. Join a new table when you are ready."
                  : "The final table result is in."}
            </DialogDescription>
            {youWon && (
              <strong className="ld-result-prize">{money(payout)}</strong>
            )}
            <div className="ld-result-players">
              {m?.state.players.filter(Boolean).map(
                (p) =>
                  p && (
                    <div
                      key={p.seat}
                      className={
                        winners.includes(p.seat) ? "ld-result-winner" : ""
                      }
                    >
                      <span>
                        {winners.includes(p.seat) ? "🏆 " : ""}
                        {p.name}
                        {p.seat === m.you ? " (YOU)" : ""}
                      </span>
                      <b>
                        {p.forfeited
                          ? "Left"
                          : `${p.tokens.filter((t) => t === 56).length}/4 home`}
                      </b>
                    </div>
                  ),
              )}
            </div>
            <p>
              {forfeited && m?.state.players[m.you]?.exitReason === "inactive"
                ? "Five automatic dice rolls were used. Roll manually before the next timeout to stay in a match."
                : m?.reason ||
                  LUDO_VARIANTS[m?.state.variant ?? "classic"].description}
            </p>
            <button
              className="ld-primary"
              onClick={() => m && setClosedResult(m.id)}
            >
              View board
            </button>
          </DialogContent>
        </Dialog>
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
                  : dialog === "themes"
                    ? "Choose Theme"
                    : dialog === "history"
                      ? "Your recent matches"
                      : "Leave this match?"}
            </DialogTitle>
            <DialogDescription>
              {dialog === "rules"
                ? "Game modes, entries and fair play."
                : dialog === "settings"
                  ? "Make the table feel like yours."
                  : dialog === "history"
                    ? "Entries, results and wallet payouts."
                    : dialog === "themes"
                      ? "Pick your personal table style."
                      : m?.state.variant === "team"
                        ? "Leaving forfeits your whole team and both entries. Refreshing keeps your seat."
                        : "Leaving after a match starts forfeits your entry fee. Refreshing or closing this page keeps your seat."}
            </DialogDescription>
            {dialog === "themes" ? (
              <LudoThemePicker
                theme={theme}
                preview={preview}
                onSelect={(t) => {
                  setTheme(t);
                  setDialog(null);
                }}
              />
            ) : dialog === "settings" ? (
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
                  <button onClick={() => setDialog("themes")}>Themes</button>
                  <button onClick={() => setDialog("rules")}>
                    How to play
                  </button>
                  <button onClick={() => setDialog("history")}>
                    My matches
                  </button>
                  <button onClick={() => void toggleFullscreen()}>
                    {fullscreen ? "Exit fullscreen" : "Fullscreen"}
                  </button>
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
                    reaching home earns another roll. Three consecutive sixes
                    end the turn.
                  </li>
                  <li>
                    Land on an opponent to send their tokens back. Star squares
                    are safe. Tokens may share a square; stacks do not block
                    movement.
                  </li>
                  <li>
                    Use an exact roll to reach home. First to get all four
                    tokens home wins the match.
                  </li>
                  <li>
                    Each roll or move has 10 seconds. Five consecutive automatic
                    dice rolls are allowed. If you miss the next roll too, you
                    leave the match and lose your entry. Rolling manually resets
                    this count; moving your only token automatically does not
                    count as a missed roll.
                  </li>
                </ol>
                <h3>Game modes</h3>
                <p>
                  <b>Quick:</b> One token starts on the board. Bring any one
                  token home with an exact roll to win.
                </p>
                <p>
                  <b>Team Up:</b> Four seats, two teams. Opposite seats are
                  partners and cannot capture each other. Bring all eight team
                  tokens home to win. Finished partners skip their turns. At ten
                  minutes, combined home tokens decide the winning team. The
                  prize is split equally between winning partners; tied teams
                  share it. Leaving or missing six rolls forfeits your whole
                  team and both entries.
                </p>
                <p>
                  <b>Friends:</b> Create a room and share its eight-digit code.
                  Joining shows the real entry and prize before charging. All
                  seats must fill within five minutes. No bots join private
                  rooms. Expiry or the host cancelling refunds everyone; a guest
                  cancelling refunds only that guest.
                </p>
                <h3>Entry & prize</h3>
                <p>
                  Entry is deducted from your shared wallet when you join. The
                  winner receives 90% of the total seat pool; the platform keeps
                  10%. No extra charge at settlement.
                </p>
                <p>
                  Empty seats fill with labelled Computer players after 20
                  seconds. The platform funds their share of the advertised
                  pool. If Computer wins, no human player receives the prize.
                  Computer uses the same dice and rules.
                </p>
                <p>
                  Choose Computer from the main menu to start immediately
                  against Computer opponents. The same entry fees, prize pool
                  and rules apply.
                </p>
                <p>
                  Cancel before the match starts for a full refund. Leaving
                  after start forfeits your entry. Matches end within 10
                  minutes. The player with the most tokens home wins; tied
                  players split the prize after the 10% commission. Distance
                  travelled does not break a tie. A server restart preserves
                  your match; a long interruption resets the turn timer.
                </p>
                <p>
                  Each match commits to a secret seed before the first roll.
                  After completion you can download the seed, rolls and action
                  record.
                </p>
                <p>
                  Match chat is private to this table. Text messages are free.
                  Sending any emoji from the tray costs ₹5 from your wallet,
                  separately from the entry and prize.
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
                <button
                  className="ld-secondary"
                  onClick={() => setDialog(null)}
                >
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
        <Dialog open={communityOpen} onOpenChange={setCommunityOpen}>
          <DialogContent
            className="ld-community-modal"
            aria-describedby={undefined}
          >
            <DialogTitle className="sr-only">
              Friends and room invitations
            </DialogTitle>
            <LudoCommunity
              userId={userId}
              roomCode={m?.state.roomCode}
              onBack={() => setCommunityOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </main>
    </LudoTokenStyleContext.Provider>
  );
}
