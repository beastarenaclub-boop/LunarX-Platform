import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  Heart,
  Minus,
  Palette,
  Plus,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { customFetch } from "@workspace/api-client-react";
import {
  LUDO_VARIANTS,
  type LudoColor,
  type LudoMode,
  type LudoRoomPreview,
  type LudoState,
  type LudoVariant,
} from "@workspace/api-zod/ludo";
import { COLORS, LudoBoard } from "./LudoBoard";
import { LudoPin, type LudoTokenStyle } from "./LudoPin";

export const LUDO_THEMES = ["classic", "nature", "disco"] as const;
export type LudoTheme = (typeof LUDO_THEMES)[number];
export const TOKEN_STYLES: LudoTokenStyle[] = ["pin", "ring", "gem", "crown"];
const money = (v: string | number) =>
  `₹${(Number(v) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export function LudoThemePicker({
  theme,
  onSelect,
  preview,
}: {
  theme: LudoTheme;
  onSelect: (t: LudoTheme) => void;
  preview: LudoState;
}) {
  const [index, setIndex] = useState(LUDO_THEMES.indexOf(theme));
  const current = LUDO_THEMES[index];
  return (
    <div className={`ld-theme-picker ld-theme-${current}`}>
      <h3>
        {current === "classic"
          ? "Classic"
          : current === "nature"
            ? "Nature"
            : "Disco"}
      </h3>
      <div className="ld-theme-board">
        <LudoBoard state={preview} disabled />
      </div>
      <p>
        {current === "classic"
          ? "The original blue and gold table"
          : current === "nature"
            ? "A fresh forest green table"
            : "A glowing midnight purple table"}
      </p>
      <div className="ld-theme-actions">
        <button
          aria-label="Previous theme"
          onClick={() => setIndex((index + 2) % 3)}
        >
          <ChevronLeft />
        </button>
        <button className="ld-primary" onClick={() => onSelect(current)}>
          {theme === current ? "SELECTED" : "SELECT"}
          <Check size={17} />
        </button>
        <button
          aria-label="Next theme"
          onClick={() => setIndex((index + 1) % 3)}
        >
          <ChevronRight />
        </button>
      </div>
    </div>
  );
}

export function PrivateRoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="ld-private-code">
      <label htmlFor="ludo-room-code">ROOM CODE</label>
      <div>
        <input
          ref={input}
          id="ludo-room-code"
          value={code}
          readOnly
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          aria-label="Copy room code"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
            } catch {
              input.current?.focus();
              input.current?.select();
            }
          }}
        >
          {copied ? <Check /> : <Copy />}
        </button>
      </div>
      <small role="status">
        {copied
          ? "Copied! Share this code with your friends."
          : "Share this code with your friends to join."}
      </small>
    </div>
  );
}

export function LudoSetup({
  mode,
  variant,
  onVariant,
  capacity,
  onCapacity,
  colour,
  onColour,
  tokenStyle,
  onTokenStyle,
  entry,
  onEntry,
  entries,
  balance,
  enabled,
  busy,
  offline,
  onPlay,
  onRules,
  onHistory,
  onThemes,
}: {
  mode: LudoMode;
  variant: LudoVariant;
  onVariant: (v: LudoVariant) => void;
  capacity: 2 | 4;
  onCapacity: (n: 2 | 4) => void;
  colour: LudoColor;
  onColour: (c: LudoColor) => void;
  tokenStyle: LudoTokenStyle;
  onTokenStyle: (s: LudoTokenStyle) => void;
  entry: number;
  onEntry: (n: number) => void;
  entries: number[];
  balance?: string;
  enabled: boolean;
  busy: boolean;
  offline: boolean;
  onPlay: (n: 2 | 4, e: number, v: LudoVariant, code?: string) => void;
  onRules: () => void;
  onHistory: () => void;
  onThemes: () => void;
}) {
  const [tab, setTab] = useState<"create" | "join">("create");
  const [code, setCode] = useState("");
  const [room, setRoom] = useState<LudoRoomPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const lookup = useRef(0);
  useEffect(
    () => () => {
      lookup.current++;
    },
    [],
  );
  const checkRoom = async () => {
    const request = ++lookup.current;
    setChecking(true);
    setRoom(null);
    setError("");
    try {
      const result = await customFetch<LudoRoomPreview>(
        `/api/ludo/rooms/${code}`,
      );
      if (request === lookup.current) setRoom(result);
    } catch (e) {
      if (request === lookup.current)
        setError(e instanceof Error ? e.message : "Room not found");
    } finally {
      if (request === lookup.current) setChecking(false);
    }
  };
  const changeTab = (value: "create" | "join") => {
    lookup.current++;
    setChecking(false);
    setRoom(null);
    setError("");
    setTab(value);
  };
  const joining = mode === "private" && tab === "join";
  const chosenEntry = joining && room ? Number(room.entryPaise) : entry;
  const affordable = balance !== undefined && Number(balance) >= chosenEntry;
  const canPlay =
    enabled &&
    !busy &&
    !offline &&
    affordable &&
    (joining ? !!room : entries.includes(entry));
  const entryIndex = entries.indexOf(entry);
  return (
    <section
      className="ld-lobby ld-video-setup"
      aria-label="Set up your Ludo game"
    >
      <div className="ld-setup-topline">
        <span>
          {mode === "private" ? (
            <Heart />
          ) : mode === "computer" ? (
            <Zap />
          ) : (
            <Users />
          )}
          {mode === "private"
            ? "PLAY WITH FRIENDS"
            : mode === "computer"
              ? "COMPUTER"
              : "ONLINE MULTIPLAYER"}
        </span>
        <button onClick={onHistory}>GAME HISTORY</button>
      </div>
      {mode === "private" && (
        <div className="ld-room-tabs" role="tablist" aria-label="Private room">
          <button
            role="tab"
            aria-selected={tab === "create"}
            onClick={() => changeTab("create")}
          >
            Create
          </button>
          <button
            role="tab"
            aria-selected={tab === "join"}
            onClick={() => changeTab("join")}
          >
            Join
          </button>
        </div>
      )}
      <div className="ld-room-card">
        <section className="ld-setup-section ld-token-section">
          <h2>
            SELECT TOKEN / COLOR{" "}
            <button aria-label="Choose theme" onClick={onThemes}>
              <Palette size={17} />
            </button>
          </h2>
          <div
            className="ld-token-styles"
            role="group"
            aria-label="Token style"
          >
            {TOKEN_STYLES.map((style) => (
              <button
                key={style}
                aria-label={`${style} token style`}
                aria-pressed={tokenStyle === style}
                onClick={() => onTokenStyle(style)}
              >
                <LudoPin color={COLORS[colour]} variant={style} />
                {tokenStyle === style && <Check />}
              </button>
            ))}
          </div>
          <div
            className="ld-colours"
            role="group"
            aria-label="Your token colour"
          >
            {(["blue", "red", "green", "yellow"] as const).map((c) => (
              <button
                key={c}
                aria-label={`${c} tokens`}
                aria-pressed={colour === c}
                style={{ "--seat": COLORS[c] } as CSSProperties}
                onClick={() => onColour(c)}
              >
                <span>
                  {colour === c && <Check size={20} strokeWidth={3} />}
                </span>
              </button>
            ))}
          </div>
        </section>
        {joining ? (
          <section className="ld-setup-section ld-room-join">
            <h2>ENTER PRIVATE CODE</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 8 && !checking) void checkRoom();
              }}
            >
              <input
                aria-label="Private room code"
                placeholder="8-digit room code"
                inputMode="numeric"
                autoComplete="off"
                maxLength={8}
                value={code}
                onChange={(e) => {
                  lookup.current++;
                  setChecking(false);
                  setCode(e.target.value.replace(/\D/g, ""));
                  setRoom(null);
                  setError("");
                }}
              />
              <button
                className="ld-primary"
                disabled={code.length !== 8 || checking || busy || offline}
                type="submit"
              >
                {checking ? "Checking…" : "CHECK ROOM"}
              </button>
            </form>
            {error && (
              <p className="ld-room-error" role="alert">
                {error}
              </p>
            )}
            {room && (
              <div className="ld-room-preview" role="status">
                <strong>
                  {LUDO_VARIANTS[room.variant].name} · {room.capacity} players
                </strong>
                <span>
                  {room.joined}/{room.capacity} joined
                </span>
                <b>
                  Entry {money(room.entryPaise)} · Prize{" "}
                  {money(room.prizePaise)}
                </b>
                <p>{LUDO_VARIANTS[room.variant].description}</p>
                {room.variant === "team" && (
                  <small>
                    Leaving forfeits your team. The team prize is split equally.
                  </small>
                )}
                <button
                  className="ld-primary ld-play"
                  disabled={!canPlay}
                  onClick={() =>
                    onPlay(
                      room.capacity,
                      Number(room.entryPaise),
                      room.variant,
                      room.code,
                    )
                  }
                >
                  {busy
                    ? "Joining…"
                    : affordable
                      ? "JOIN ROOM"
                      : "Insufficient balance"}
                </button>
              </div>
            )}
            <p className="ld-note">
              Check the room details before joining. Entry is deducted only when
              you join.
            </p>
          </section>
        ) : (
          <>
            <section className="ld-setup-section ld-player-section">
              <h2>SELECT PLAYERS</h2>
              <div
                className="ld-mode"
                role="group"
                aria-label="Number of players"
              >
                {([2, 4] as const).map((n) => (
                  <button
                    key={n}
                    aria-label={`${n} players ${n === 2 ? "Head to head" : "Classic battle"}`}
                    aria-pressed={capacity === n}
                    disabled={n === 2 && variant === "team"}
                    onClick={() => onCapacity(n)}
                  >
                    <span className="ld-radio">
                      {capacity === n ? <Check /> : <Users />}
                    </span>
                    <span>
                      <strong>{n} players</strong>
                      <small>
                        {n === 2
                          ? "Head to head"
                          : variant === "team"
                            ? "2 vs 2"
                            : "Classic battle"}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
            <section className="ld-setup-section ld-variant-section">
              <h2>
                SELECT GAME{" "}
                <button aria-label="Mode rules" onClick={onRules}>
                  ?
                </button>
              </h2>
              <div
                className="ld-variant-options"
                role="group"
                aria-label="Game mode"
              >
                {(["classic", "team", "quick"] as const).map((v) => (
                  <button
                    key={v}
                    className={`ld-variant-${v}`}
                    aria-pressed={variant === v}
                    onClick={() => onVariant(v)}
                  >
                    <i>{variant === v && <Check />}</i>
                    {LUDO_VARIANTS[v].name}
                  </button>
                ))}
              </div>
              <p className="ld-variant-description">
                {LUDO_VARIANTS[variant].description}
              </p>
            </section>
            <section className="ld-setup-section ld-select-game">
              <h2>SELECT LOBBY</h2>
              <div className="ld-stakes">
                <button
                  className="ld-step"
                  aria-label="Lower entry fee"
                  disabled={entryIndex <= 0}
                  onClick={() => onEntry(entries[entryIndex - 1])}
                >
                  <Minus />
                </button>
                <div className="ld-prize">
                  <span>
                    <Trophy size={18} />
                    {variant === "team" ? "TEAM PRIZE" : "WIN"}
                  </span>
                  <b>{money(entry * capacity * 0.9)}</b>
                  <small>
                    <Coins size={12} /> Entry: {money(entry)}
                  </small>
                </div>
                <button
                  className="ld-step"
                  aria-label="Higher entry fee"
                  disabled={entryIndex < 0 || entryIndex >= entries.length - 1}
                  onClick={() => onEntry(entries[entryIndex + 1])}
                >
                  <Plus />
                </button>
              </div>
              <div className="ld-entries" role="group" aria-label="Entry fee">
                {entries.map((amount) => (
                  <button
                    key={amount}
                    aria-pressed={entry === amount}
                    onClick={() => onEntry(amount)}
                  >
                    {money(amount)}
                  </button>
                ))}
              </div>
              <p className="ld-fee">
                Prize after 10% platform commission
                {variant === "team"
                  ? ` · ${money((entry * capacity * 0.9) / 2)} per winning partner`
                  : ""}
              </p>
              <button
                className="ld-primary ld-play"
                aria-label={
                  mode === "private"
                    ? "Create room"
                    : enabled && affordable
                      ? "Find a match"
                      : undefined
                }
                disabled={!canPlay}
                onClick={() => onPlay(capacity, entry, variant)}
              >
                {busy ? (
                  "Joining…"
                ) : balance === undefined ? (
                  "Connecting…"
                ) : !enabled ? (
                  "Tables paused"
                ) : !affordable ? (
                  "Insufficient balance"
                ) : (
                  <>
                    {mode === "private" ? "CREATE ROOM" : "PLAY"}
                    <ArrowRight size={20} />
                  </>
                )}
              </button>
              <p className="ld-note">
                {mode === "private"
                  ? "Invite friends with your room code. All seats must fill within 5 minutes or entries are refunded."
                  : mode === "computer"
                    ? "Computer opponents connect instantly. Entry is deducted on joining."
                    : "Entry is deducted on joining. Empty seats get Computer players after 20 seconds."}
                {variant === "team" &&
                  " Leaving or missing six rolls forfeits your whole team."}
              </p>
            </section>
          </>
        )}
      </div>
      <div className="ld-lobby-links">
        <button onClick={onThemes}>
          <Palette size={16} /> Choose theme
        </button>
        <button onClick={onRules}>How to play</button>
      </div>
    </section>
  );
}
