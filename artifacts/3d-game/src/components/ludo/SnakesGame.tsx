import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import {
  advanceSnake,
  newSnakeGame,
  validSnakeState,
  snakeCell,
  snakeCurve,
  SNAKE_COLORS,
  type SnakeRoom,
  type SnakeState,
  type SnakeTheme,
} from "@workspace/api-zod/snakes";
import {
  ArrowLeft,
  Copy,
  Check,
  Volume2,
  VolumeX,
  Music,
  HelpCircle,
  Palette,
  RotateCcw,
  Trophy,
  Users,
  Settings,
} from "lucide-react";
import { LudoDice } from "./LudoDice";
import type { LudoRoll } from "./useLudoRoll";
import { LudoArtwork } from "./LudoArtwork";
import { RoyalBadge } from "./LudoVideoArtwork";
import { SnakeBoard, SnakeLogo, type SnakeVisual } from "./SnakeBoard";
import { useLudoAudio } from "./useLudoAudio";
import { LudoCommunity } from "./LudoCommunity";
import { LudoDailyReward } from "./LudoDailyReward";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import "./snakes.css";
import "./snakes-refined.css";
import "./ludo-generated-art.css";
type Mode = "computer" | "local" | "online" | "private";
type Screen =
  | "home"
  | "setup"
  | "game"
  | "themes"
  | "social"
  | "history"
  | "daily";
type Table = { room: SnakeRoom | null; serverNow: number };
type Saved = { id: string; state: SnakeState };
type Result = { id: string; winner: string; turns: number; at: number };
function stored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
function readSaved(userId: string, name: string): Saved | null {
  const saved = stored<Saved | null>(`ludo-snakes-v2:${userId}`, null);
  if (saved && typeof saved.id === "string" && validSnakeState(saved.state))
    return saved;
  const legacy = stored<any>(`ludo-snakes:${userId}`, null);
  if (
    legacy &&
    Array.isArray(legacy.positions) &&
    legacy.positions.length === 2 &&
    legacy.positions.every(
      (n: unknown) =>
        typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100,
    ) &&
    [0, 1].includes(legacy.turn) &&
    [null, 0, 1].includes(legacy.winner)
  ) {
    const state = newSnakeGame([
      { id: "local-0", name, kind: "human" },
      {
        id: "local-1",
        name: legacy.computer ? "Computer" : "Player 2",
        kind: legacy.computer ? "computer" : "human",
      },
    ]);
    state.players.forEach((p, i) => (p.position = legacy.positions[i]));
    state.turn = legacy.turn;
    state.winner = legacy.winner;
    state.dice =
      Number.isInteger(legacy.dice) && legacy.dice >= 1 && legacy.dice <= 6
        ? legacy.dice
        : null;
    return validSnakeState(state) ? { id: crypto.randomUUID(), state } : null;
  }
  return null;
}
function randomDie() {
  const b = new Uint8Array(1);
  do {
    crypto.getRandomValues(b);
  } while (b[0] >= 252);
  return (b[0] % 6) + 1;
}
const themes: SnakeTheme[] = ["classic", "nature", "disco"];
export function SnakesGame({
  userId,
  name,
  onBack,
  balance,
  demo = false,
}: {
  userId: string;
  name: string;
  onBack: () => void;
  balance?: string;
  demo?: boolean;
}) {
  const key = `ludo-snakes-v2:${userId}`;
  const [screen, setScreen] = useState<Screen>("home"),
    [mode, setMode] = useState<Mode>("computer"),
    [capacity, setCapacity] = useState<2 | 3 | 4>(2),
    [names, setNames] = useState([name, "Player 2", "Player 3", "Player 4"]);
  const [saved, setSaved] = useState<Saved | null>(() =>
      readSaved(userId, name),
    ),
    [network, setNetwork] = useState(false),
    [theme, setTheme] = useState<SnakeTheme>(() => {
      const t = stored<SnakeTheme>(`ludo-snakes-theme:${userId}`, "classic");
      return themes.includes(t) ? t : "classic";
    }),
    [previewTheme, setPreviewTheme] = useState<SnakeTheme>(theme);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [roll, setRoll] = useState<LudoRoll | null>(null),
    [present, setPresent] = useState<SnakeState | null>(null),
    [visual, setVisual] = useState<SnakeVisual | null>(null),
    [rules, setRules] = useState(false),
    [settings, setSettings] = useState(false),
    [wheel, setWheel] = useState(false),
    [confirm, setConfirm] = useState<"restart" | "leave" | null>(null),
    [roomCode, setRoomCode] = useState(""),
    [copied, setCopied] = useState(false),
    [history, setHistory] = useState<Result[]>(() => {
      const value = stored<unknown>(`ludo-snakes-history:${userId}`, []);
      return Array.isArray(value)
        ? value
            .filter(
              (h) =>
                h &&
                typeof h.id === "string" &&
                typeof h.winner === "string" &&
                Number.isFinite(h.at) &&
                Number.isInteger(h.turns),
            )
            .slice(0, 20)
        : [];
    }),
    [returnScreen, setReturnScreen] = useState<Screen>("home");
  const qc = useQueryClient(),
    audio = useLudoAudio(`${userId}:snakes`),
    alive = useRef(true),
    lock = useRef(false),
    timers = useRef<ReturnType<typeof setTimeout>[]>([]),
    seen = useRef(""),
    restored = useRef(false),
    pending = useRef<{ payload: string; id: string } | null>(null);
  const table = useQuery({
    queryKey: ["snakes", userId],
    queryFn: ({ signal }) =>
      customFetch<Table>("/api/ludo/snakes/state", { signal }),
    structuralSharing: (previous, received) => {
      const old = previous as Table | undefined,
        next = received as Table;
      // A poll started before a roll must not rewind its acknowledged board.
      return old?.room &&
        next.room &&
        old.room.id === next.room.id &&
        old.room.version > next.room.version
        ? old
        : next;
    },
    refetchInterval: (q) =>
      ["playing", "waiting"].includes(q.state.data?.room?.status ?? "")
        ? 1500
        : 10000,
    refetchIntervalInBackground: false,
  });
  const room = table.data?.room,
    canonical = network ? room?.state : saved?.state,
    state = present ?? canonical;
  const current = useRef({ saved, room, network, canonical });
  current.current = { saved, room, network, canonical };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      timers.current.forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    try {
      if (saved) localStorage.setItem(key, JSON.stringify(saved));
      else localStorage.removeItem(key);
      localStorage.removeItem(`ludo-snakes:${userId}`);
    } catch {}
  }, [key, saved, userId]);
  useEffect(() => {
    try {
      localStorage.setItem(
        `ludo-snakes-theme:${userId}`,
        JSON.stringify(theme),
      );
    } catch {}
  }, [theme, userId]);
  useEffect(() => {
    if (table.data && !restored.current) {
      restored.current = true;
      if (
        room &&
        ["playing", "waiting"].includes(room.status) &&
        !room.state.players[room.you]?.left
      ) {
        seen.current = `${room.id}:${room.state.sequence}`;
        setNetwork(true);
        setMode(room.mode);
        setScreen("game");
      }
    }
  }, [table.data]);
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms));
    });
  const requestId = (payload: string) => {
    if (pending.current?.payload !== payload)
      pending.current = { payload, id: crypto.randomUUID() };
    return pending.current.id;
  };
  const animate = async (
    before: SnakeState,
    next: SnakeState,
    id: string,
    alreadyRolling = false,
  ) => {
    const move = next.last;
    if (!move) {
      setBusy(false);
      lock.current = false;
      return;
    }
    seen.current = `${id}:${next.sequence}`;
    lock.current = true;
    setBusy(true);
    setPresent(before);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches,
      rollKey = crypto.randomUUID();
    if (!alreadyRolling) {
      audio.roll();
      setRoll({
        key: rollKey,
        seat: move.seat,
        phase: "rolling",
        at: Date.now(),
      });
      await sleep(reduced ? 20 : 430);
    }
    if (!alive.current) return;
    audio.land(move.roll);
    setRoll({
      key: rollKey,
      seat: move.seat,
      phase: "landing",
      value: move.roll,
      at: Date.now(),
    });
    await sleep(reduced ? 20 : 260);
    if (!alive.current) return;
    setRoll(null);
    if (move.kind !== "overshoot") {
      for (let cell = move.from + 1; cell <= move.land; cell++) {
        if (!alive.current) return;
        const [x, y] = snakeCell(cell);
        setVisual({ seat: move.seat, x, y, kind: "step" });
        audio.step(cell - move.from);
        await sleep(reduced ? 0 : 125);
      }
      if (move.to !== move.land) {
        const start = performance.now(),
          duration = reduced ? 0 : move.kind === "snake" ? 1100 : 850;
        await new Promise<void>((resolve) => {
          const frame = (now: number) => {
            if (!alive.current) {
              resolve();
              return;
            }
            const t = duration ? Math.min(1, (now - start) / duration) : 1,
              eased = t * t * (3 - 2 * t),
              a = snakeCell(move.land),
              b = snakeCell(move.to),
              [x, y] =
                move.kind === "snake"
                  ? snakeCurve(move.land, move.to, eased)
                  : [
                      a[0] + (b[0] - a[0]) * eased,
                      a[1] + (b[1] - a[1]) * eased,
                    ];
            setVisual({
              seat: move.seat,
              x,
              y,
              kind: move.kind === "snake" ? "snake" : "ladder",
            });
            if (t < 1) requestAnimationFrame(frame);
            else resolve();
          };
          requestAnimationFrame(frame);
        });
        audio.moveEnd(move.kind === "snake" ? 1 : 0, move.kind === "ladder");
      }
    }
    if (!alive.current) return;
    audio.moveEnd(0, next.winner !== null);
    setPresent(null);
    setVisual(null);
    setBusy(false);
    lock.current = false;
  };
  useEffect(() => {
    if (!network || !room || busy || screen !== "game") return;
    const token = `${room.id}:${room.state.sequence}`;
    if (seen.current !== token) {
      const last = room.state.last;
      if (last) {
        const before = {
          ...room.state,
          winner: null,
          turn: last.seat,
          players: room.state.players.map((p, i) => ({
            ...p,
            position: i === last.seat ? last.from : p.position,
          })),
        };
        void animate(before, room.state, room.id);
      } else seen.current = token;
    }
  }, [room?.id, room?.version, busy, network, screen]);
  useEffect(() => {
    if (!saved || saved.state.winner === null) return;
    setHistory((old) => {
      if (old.some((h) => h.id === saved.id)) return old;
      const next = [
        {
          id: saved.id,
          winner: saved.state.players[saved.state.winner!].name,
          turns: saved.state.sequence,
          at: Date.now(),
        },
        ...old,
      ].slice(0, 20);
      try {
        localStorage.setItem(
          `ludo-snakes-history:${userId}`,
          JSON.stringify(next),
        );
      } catch {}
      return next;
    });
  }, [saved, userId]);
  const play = async () => {
    const {
      canonical: g,
      saved: local,
      network: isNetwork,
      room: r,
    } = current.current;
    if (lock.current || !g || g.winner !== null) return;
    if (
      isNetwork &&
      (!r ||
        r.status !== "playing" ||
        r.you !== g.turn ||
        g.players[r.you].left)
    )
      return;
    audio.unlock();
    lock.current = true;
    setBusy(true);
    setError("");
    if (!isNetwork && local) {
      const next = advanceSnake(g, randomDie());
      setSaved({ ...local, state: next });
      await animate(g, next, local.id);
      return;
    }
    if (!r) return;
    const payload = JSON.stringify({
      id: r.id,
      type: "roll",
      version: r.version,
    });
    const started = performance.now();
    audio.roll();
    setRoll({
      key: crypto.randomUUID(),
      seat: g.turn,
      phase: "rolling",
      at: Date.now(),
    });
    try {
      const next = await customFetch<Table>(`/api/ludo/snakes/${r.id}/action`, {
        method: "POST",
        body: JSON.stringify({
          type: "roll",
          version: r.version,
          requestId: requestId(payload),
        }),
      });
      pending.current = null;
      await sleep(
        matchMedia("(prefers-reduced-motion: reduce)").matches
          ? 0
          : Math.max(0, 430 - (performance.now() - started)),
      );
      if (!alive.current) return;
      await qc.cancelQueries({ queryKey: ["snakes", userId], exact: true });
      qc.setQueryData(["snakes", userId], next);
      if (next.room) await animate(g, next.room.state, r.id, true);
    } catch (e) {
      if (alive.current) {
        setError(
          e instanceof Error
            ? e.message
            : "Connection lost. Retry the same roll.",
        );
        setRoll(null);
        setBusy(false);
        lock.current = false;
        void table.refetch();
      }
    }
  };
  useEffect(() => {
    if (
      screen === "game" &&
      !network &&
      state?.winner === null &&
      state.players[state.turn].kind === "computer" &&
      !busy
    ) {
      const t = setTimeout(() => void play(), 850);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [screen, network, state?.turn, state?.sequence, busy]);
  const choose = (next: Mode) => {
    setMode(next);
    setNetwork(next === "online" || next === "private");
    setCapacity(2);
    setRoomCode("");
    setError("");
    setScreen("setup");
  };
  const start = () => {
    const next = newSnakeGame(
      Array.from({ length: capacity }, (_, i) => ({
        id: `local-${i}`,
        name:
          i > 0 && mode === "computer"
            ? `Computer ${i}`
            : names[i].trim().slice(0, 24) || `Player ${i + 1}`,
        kind:
          i > 0 && mode === "computer"
            ? ("computer" as const)
            : ("human" as const),
      })),
    );
    setSaved({ id: crypto.randomUUID(), state: next });
    setPresent(null);
    setVisual(null);
    setNetwork(false);
    setScreen("game");
  };
  const join = async (code?: string) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const input = {
      mode: mode === "private" ? "private" : "online",
      capacity: capacity === 4 ? 4 : 2,
      ...(code ? { code } : {}),
    };
    try {
      const next = await customFetch<Table>("/api/ludo/snakes/join", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          requestId: requestId(JSON.stringify(input)),
        }),
      });
      pending.current = null;
      await qc.cancelQueries({ queryKey: ["snakes", userId], exact: true });
      qc.setQueryData(["snakes", userId], next);
      seen.current = `${next.room?.id}:${next.room?.state.sequence}`;
      setNetwork(true);
      setScreen("game");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not join room");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  };
  const leave = async () => {
    if (!room) return;
    setBusy(true);
    setError("");
    try {
      const input = { type: "leave", version: room.version };
      const next = await customFetch<Table>(
        `/api/ludo/snakes/${room.id}/action`,
        {
          method: "POST",
          body: JSON.stringify({
            ...input,
            requestId: requestId(JSON.stringify({ id: room.id, ...input })),
          }),
        },
      );
      pending.current = null;
      await qc.cancelQueries({ queryKey: ["snakes", userId], exact: true });
      qc.setQueryData(["snakes", userId], next);
      setConfirm(null);
      setNetwork(false);
      setScreen("home");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave");
    } finally {
      setBusy(false);
    }
  };
  const back = () => {
    if (busy) return;
    if (
      screen === "game" &&
      network &&
      room &&
      ["playing", "waiting"].includes(room.status) &&
      !room.state.players[room.you]?.left
    )
      setConfirm("leave");
    else if (screen === "home") onBack();
    else setScreen("home");
  };
  const openThemes = () => {
    setReturnScreen(screen);
    setPreviewTheme(theme);
    setScreen("themes");
  };
  const message = state?.last
    ? state.last.kind === "overshoot"
      ? `${state.players[state.last.seat].name} needs an exact roll to reach 100`
      : state.last.kind === "ladder"
        ? `Ladder! ${state.last.land} → ${state.last.to}`
        : state.last.kind === "snake"
          ? `Snake! ${state.last.land} → ${state.last.to}`
          : `${state.players[state.last.seat].name} rolled ${state.last.roll}${state.last.roll === 6 ? " · another turn" : ""}`
    : "Roll the dice to begin";
  if (screen === "daily")
    return (
      <LudoDailyReward
        userId={userId}
        demo={demo}
        onBack={() => setScreen("home")}
      />
    );
  if (screen === "social")
    return (
      <div className="sn-app">
        <LudoCommunity userId={userId} onBack={() => setScreen("home")} />
      </div>
    );
  return (
    <section
      className={`sn-app sn-${screen} sn-theme-${theme}`}
      aria-label="Snakes and Ladders"
      onPointerDownCapture={audio.unlock}
    >
      <div className="sn-pattern" aria-hidden="true" />
      {screen === "home" && (
        <header className="sn-account">
          <button
            className="sn-account-avatar"
            onClick={() => setScreen("social")}
            aria-label="My Snake profile and friends"
          >
            <LudoArtwork kind="profile" />
            <strong title={name}>{name}</strong>
          </button>
          <Link
            href="/wallet"
            className="sn-account-wallet"
            aria-label="Your wallet"
          >
            <LudoArtwork kind="coins" />
            <strong>
              {demo
                ? "DEMO"
                : balance === undefined
                  ? "—"
                  : `₹${(Number(balance) / 100).toLocaleString("en-IN")}`}
            </strong>
            <b>+</b>
          </Link>
          <button
            className="sn-account-wins"
            onClick={() => setScreen("history")}
            aria-label="Local game results"
          >
            <span>
              {history.filter((h) => h.winner === name).length}
              <small>WINS</small>
            </span>
            <LudoArtwork kind="results" />
          </button>
          <Link
            href="/wallet"
            className="sn-account-shop"
            aria-label="Open wallet"
          >
            <LudoArtwork kind="shop" />
          </Link>
        </header>
      )}
      <header className="sn-toolbar">
        <button
          aria-label={
            screen === "home" ? "Back to Ludo" : "Back to Snakes menu"
          }
          onClick={back}
          disabled={busy}
        >
          <ArrowLeft />
        </button>
        <div>
          <strong>
            {screen === "home"
              ? "SNAKES & LADDERS"
              : screen === "themes"
                ? "CHOOSE THEME"
                : screen === "setup"
                  ? "SELECT PLAYERS"
                  : screen === "history"
                    ? "YOUR RESULTS"
                    : "RACE TO 100"}
          </strong>
          <small>Free play · no entry fee</small>
        </div>
        <button
          onClick={audio.toggleSound}
          aria-label={audio.sound ? "Mute sound" : "Enable sound"}
        >
          {audio.sound ? <Volume2 /> : <VolumeX />}
        </button>
        <button aria-label="Game rules" onClick={() => setRules(true)}>
          <HelpCircle />
        </button>
      </header>
      {screen === "home" && (
        <>
          <div className="sn-home-hero">
            <RoyalBadge label="Snakes club" />
            <SnakeLogo />
          </div>
          <div className="sn-home-modes">
            {(["online", "private", "computer", "local"] as Mode[]).map(
              (m, i) => (
                <button
                  className="sn-mode"
                  key={m}
                  onClick={() => choose(m)}
                  aria-label={
                    [
                      "Play Online",
                      "Play with Friends",
                      "Computer",
                      "Pass n Play",
                    ][i]
                  }
                >
                  <LudoArtwork
                    kind={
                      ["online", "friends", "computer", "pass"][i] as "online"
                    }
                  />
                  <strong>
                    {
                      [
                        "PLAY ONLINE",
                        "PLAY WITH FRIENDS",
                        "COMPUTER",
                        "PASS N PLAY",
                      ][i]
                    }
                  </strong>
                </button>
              ),
            )}
          </div>
          <div className="sn-home-options">
            <button onClick={() => setScreen("history")}>
              <LudoArtwork kind="results" />
              <span>Results</span>
            </button>
            <button
              onClick={() => setSettings(true)}
              aria-label="Snake settings"
            >
              <LudoArtwork kind="settings" />
              <span>Settings</span>
            </button>
            <button onClick={openThemes} aria-label="Choose theme">
              <LudoArtwork kind="themes" />
              <span>Themes</span>
            </button>
          </div>
          {saved && saved.state.winner === null && (
            <button
              className="sn-resume"
              onClick={() => {
                setNetwork(false);
                setScreen("game");
              }}
            >
              Resume local game{" "}
              <span>
                {saved.state.players[saved.state.turn].name} · square{" "}
                {saved.state.players[saved.state.turn].position}
              </span>
            </button>
          )}
          <button
            className="sn-to-ludo"
            aria-label="Back to Ludo"
            onClick={onBack}
          >
            <LudoArtwork kind="home" />
            <span>LUDO</span>
          </button>
          <button
            className="sn-daily"
            aria-label="Daily reward"
            onClick={() => setScreen("daily")}
          >
            <LudoArtwork kind="gift" />
            <span>₹100 DAILY</span>
          </button>
          <button
            className="sn-wheel"
            aria-label="Prize wheel"
            onClick={() => setWheel(true)}
          >
            <LudoArtwork kind="wheel" />
          </button>
          <nav className="sn-bottom">
            <button
              className="active"
              onClick={onBack}
              aria-label="Back to Ludo home"
            >
              <LudoArtwork kind="home" />
              HOME
            </button>
            <button onClick={() => setScreen("social")}>
              <LudoArtwork kind="friends" />
              FRIENDS
            </button>
            <button onClick={() => setScreen("social")}>
              <LudoArtwork kind="chat" />
              SOCIAL
            </button>
            <button onClick={openThemes}>
              <LudoArtwork kind="inventory" />
              INVENTORY
            </button>
            <Link href="/wallet">
              <LudoArtwork kind="shop" />
              STORE
            </Link>
          </nav>
        </>
      )}
      {screen === "setup" && (
        <div className="sn-scroll">
          <SnakeLogo />
          <div className="sn-panel">
            <h2>
              {mode === "private"
                ? "FRIENDS ROOM"
                : mode === "online"
                  ? "ONLINE MULTIPLAYER"
                  : mode === "computer"
                    ? "PLAY AGAINST COMPUTER"
                    : "PASS N PLAY"}
            </h2>
            <p>
              {network
                ? "Real players · free game · no wallet charges"
                : "One device · your game saves automatically"}
            </p>
            <div className="sn-choices">
              {(network ? [2, 4] : [2, 3, 4]).map((n) => (
                <button
                  key={n}
                  aria-pressed={capacity === n}
                  onClick={() => setCapacity(n as 2 | 3 | 4)}
                >
                  {n} players
                </button>
              ))}
            </div>
            {!network && (
              <div className="sn-names">
                {Array.from(
                  { length: mode === "computer" ? 1 : capacity },
                  (_, i) => (
                    <label key={i}>
                      Player {i + 1}
                      <input
                        aria-label={`Player ${i + 1} name`}
                        maxLength={24}
                        value={names[i]}
                        onChange={(e) =>
                          setNames((old) =>
                            old.map((n, j) => (i === j ? e.target.value : n)),
                          )
                        }
                      />
                    </label>
                  ),
                )}
              </div>
            )}
            <button
              className="sn-primary"
              disabled={busy}
              onClick={() =>
                network
                  ? void join()
                  : saved && saved.state.winner === null
                    ? setConfirm("restart")
                    : start()
              }
            >
              {busy
                ? "Connecting…"
                : mode === "online"
                  ? "Find a free match"
                  : mode === "private"
                    ? "Create room"
                    : "Start game"}
            </button>
            {mode === "private" && (
              <div className="sn-join">
                <label>
                  Join a friend's room
                  <input
                    aria-label="Snakes room code"
                    inputMode="numeric"
                    maxLength={8}
                    value={roomCode}
                    onChange={(e) =>
                      setRoomCode(e.target.value.replace(/\D/g, ""))
                    }
                  />
                </label>
                <button
                  className="sn-primary"
                  disabled={busy || roomCode.length !== 8}
                  onClick={() => void join(roomCode)}
                >
                  Join room
                </button>
                <small>Choose the same player count as the host.</small>
              </div>
            )}
          </div>
        </div>
      )}
      {screen === "themes" && (
        <div className="sn-theme-picker">
          <h1>{previewTheme[0].toUpperCase() + previewTheme.slice(1)}</h1>
          <SnakeBoard
            state={newSnakeGame([
              { id: "preview-1", name: "You", kind: "human" },
              { id: "preview-2", name: "Friend", kind: "human" },
            ])}
            theme={previewTheme}
            preview
          />
          <div className="sn-theme-buttons">
            <button
              aria-label="Previous theme"
              onClick={() =>
                setPreviewTheme(themes[(themes.indexOf(previewTheme) + 2) % 3])
              }
            >
              ◀
            </button>
            <button
              className="sn-primary"
              onClick={() => {
                setTheme(previewTheme);
                setScreen(returnScreen);
              }}
            >
              {previewTheme === theme ? "Use theme" : "Try now"}
            </button>
            <button
              aria-label="Next theme"
              onClick={() =>
                setPreviewTheme(themes[(themes.indexOf(previewTheme) + 1) % 3])
              }
            >
              ▶
            </button>
          </div>
        </div>
      )}
      {screen === "history" && (
        <div className="sn-scroll">
          <h1>Local game results</h1>
          {history.length ? (
            history.map((h) => (
              <div className="sn-result-row" key={h.id}>
                <Trophy />
                <span>
                  <strong>{h.winner} won</strong>
                  <small>
                    {h.turns} rolls · {new Date(h.at).toLocaleDateString()}
                  </small>
                </span>
              </div>
            ))
          ) : (
            <p>Finish a local game to save your first result.</p>
          )}
        </div>
      )}
      {screen === "game" && network && room?.status === "waiting" && (
        <div className="sn-waiting">
          <SnakeLogo />
          <h1>{room.code ? "Your friends room" : "Finding real players"}</h1>
          {room.code && (
            <button
              className="sn-code"
              aria-label="Copy Snakes room code"
              onClick={() => {
                void navigator.clipboard
                  .writeText(room.code!)
                  .then(() => setCopied(true))
                  .catch(() => setError("Copy the room code shown below"));
              }}
            >
              {room.code}
              {copied ? <Check /> : <Copy />}
            </button>
          )}
          <p>
            {room.state.players.length} / {room.capacity} players ·{" "}
            {room.capacity}-player game
          </p>
          <div className="sn-wait-seats">
            {Array.from({ length: room.capacity }, (_, i) => (
              <div key={i}>
                <LudoArtwork kind="profile" />
                <span>{room.state.players[i]?.name ?? "Waiting…"}</span>
              </div>
            ))}
          </div>
          <p>
            {room.code
              ? "Share this code. Friends select the same player count and join."
              : "The game starts when all seats are filled. No computers are added."}
          </p>
          <button className="sn-primary" onClick={() => setConfirm("leave")}>
            Cancel room
          </button>
        </div>
      )}
      {screen === "game" &&
        state &&
        (!network || room?.status !== "waiting") && (
          <div className="sn-match">
            <div className="sn-players">
              {state.players.map((p, i) => (
                <div
                  key={p.id}
                  className={`${state.turn === i && state.winner === null ? "active" : ""} ${p.left ? "left" : ""}`}
                  style={{ "--player": SNAKE_COLORS[i] } as CSSProperties}
                >
                  <i>{i + 1}</i>
                  <span>
                    <strong>
                      {p.name}
                      {network && room?.you === i ? " (you)" : ""}
                    </strong>
                    <small>
                      {p.left
                        ? "Left game"
                        : p.kind === "computer"
                          ? "Computer"
                          : network
                            ? "Online player"
                            : "Player"}{" "}
                      · {p.position}/100
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <div className="sn-board-wrap">
              <SnakeBoard state={state} theme={theme} visual={visual} />
            </div>
            <div className="sn-controls">
              <p role="status" className={`sn-status ${visual?.kind ?? ""}`}>
                {state.winner !== null
                  ? `${state.players[state.winner].name} wins!`
                  : network && room?.status === "cancelled"
                    ? "Room closed. Start a new free game."
                    : message}
              </p>
              {state.winner === null &&
              (!network || room?.status === "playing") ? (
                <button
                  className="sn-roll"
                  aria-label="Roll dice"
                  onClick={() => void play()}
                  disabled={
                    busy ||
                    !!(network
                      ? room?.you !== state.turn ||
                        state.players[room!.you]?.left
                      : state.players[state.turn].kind === "computer")
                  }
                  style={
                    { "--die-color": SNAKE_COLORS[state.turn] } as CSSProperties
                  }
                >
                  <LudoDice value={state.dice ?? 6} roll={roll} />
                  <span>
                    {busy
                      ? visual?.kind === "snake"
                        ? "Sliding down…"
                        : visual?.kind === "ladder"
                          ? "Climbing up…"
                          : "Rolling…"
                      : `${state.players[state.turn].name}'s turn`}
                    <small>
                      {network
                        ? "30 seconds per turn · automatic roll if missed"
                        : "Tap the dice to roll"}
                    </small>
                  </span>
                </button>
              ) : (
                <div className="sn-winner">
                  <Trophy />
                  <button
                    className="sn-primary"
                    onClick={() => {
                      setScreen("setup");
                      setNetwork(false);
                      setMode(
                        network && room
                          ? room.mode
                          : state.players.some((p) => p.kind === "computer")
                            ? "computer"
                            : "local",
                      );
                      setCapacity(state.players.length as 2 | 3 | 4);
                    }}
                  >
                    Play again
                  </button>
                  <button onClick={() => setScreen("home")}>
                    Back to menu
                  </button>
                </div>
              )}
              <div className="sn-match-tools">
                <button onClick={openThemes} disabled={busy}>
                  <Palette />
                  Theme
                </button>
                <button onClick={audio.toggleMusic} aria-pressed={audio.music}>
                  <Music />
                  Music
                </button>
                <button
                  onClick={() => setConfirm(network ? "leave" : "restart")}
                  disabled={busy}
                >
                  <RotateCcw />
                  {network ? "Leave" : "New game"}
                </button>
              </div>
            </div>
          </div>
        )}
      {network && table.isError && (
        <p className="sn-error" role="status">
          Reconnecting to your room… Your last confirmed move is saved.
        </p>
      )}
      {error && (
        <p className="sn-error" role="alert">
          {error}
        </p>
      )}
      <Dialog open={settings} onOpenChange={setSettings}>
        <DialogContent className="sn-dialog">
          <DialogTitle>Snake settings</DialogTitle>
          <DialogDescription>
            Sound and music preferences save on this device.
          </DialogDescription>
          <button
            className="sn-primary"
            aria-pressed={audio.sound}
            onClick={audio.toggleSound}
          >
            Sound {audio.sound ? "on" : "off"}
          </button>
          <button
            className="sn-primary"
            aria-pressed={audio.music}
            onClick={audio.toggleMusic}
          >
            Music {audio.music ? "on" : "off"}
          </button>
          <button
            className="sn-primary"
            onClick={() => {
              setSettings(false);
              setRules(true);
            }}
          >
            How to play
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={wheel} onOpenChange={setWheel}>
        <DialogContent className="sn-dialog">
          <DialogTitle>Prize wheel</DialogTitle>
          <DialogDescription>
            Prize and spin rules have not been published yet. Spins are not
            available.
          </DialogDescription>
          <button
            className="sn-primary"
            onClick={() => {
              setWheel(false);
              setScreen("daily");
            }}
          >
            View daily reward
          </button>
        </DialogContent>
      </Dialog>
      <Dialog open={rules} onOpenChange={setRules}>
        <DialogContent className="sn-dialog">
          <DialogTitle>Snakes & Ladders rules</DialogTitle>
          <DialogDescription>
            Reach square 100 before the other players.
          </DialogDescription>
          <ol>
            <li>All tokens begin at START. Any roll enters the board.</li>
            <li>
              Climb a ladder when you land on its bottom. A snake's head sends
              you down to its tail.
            </li>
            <li>
              A six gives another turn. You need an exact roll to finish at 100;
              an overshoot stays in place.
            </li>
            <li>Tokens can share a square. There is no capture.</li>
            <li>
              Online turns last 30 seconds. A missed turn rolls automatically.
              Empty rooms expire in 5 minutes; games close after one hour.
            </li>
            <li>
              These games are free. They do not debit or award wallet money.
            </li>
          </ol>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!confirm}
        onOpenChange={(open) => {
          if (!busy && !open) setConfirm(null);
        }}
      >
        <DialogContent className="sn-dialog">
          <DialogTitle>
            {confirm === "leave"
              ? "Leave this room?"
              : "Start a new local game?"}
          </DialogTitle>
          <DialogDescription>
            {confirm === "leave"
              ? "Leaving a waiting room closes it for everyone. Leaving a started game removes your seat; remaining players continue. No wallet charge applies."
              : "This replaces the saved local board. Your current progress will be lost."}
          </DialogDescription>
          <button
            className="sn-primary"
            disabled={busy}
            onClick={() => {
              if (confirm === "leave") void leave();
              else {
                setConfirm(null);
                if (screen === "setup") start();
                else {
                  setSaved(null);
                  setScreen("setup");
                  setNetwork(false);
                  setMode(
                    saved?.state.players.some((p) => p.kind === "computer")
                      ? "computer"
                      : "local",
                  );
                }
              }
            }}
          >
            {confirm === "leave" ? "Leave room" : "Start new game"}
          </button>
          <button disabled={busy} onClick={() => setConfirm(null)}>
            Keep playing
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
