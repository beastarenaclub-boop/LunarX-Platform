import {
  ArrowLeft,
  Bot,
  Music,
  Timer,
  Users,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  LUDO_VARIANTS,
  type LudoMatch,
  type LudoState,
} from "@workspace/api-zod/ludo";
import { LudoEmblem } from "./LudoEmblem";
import { PrivateRoomCode } from "./LudoSetup";
import { COLORS } from "./LudoBoard";

type SoundControls = {
  sound: boolean;
  music: boolean;
  toggleSound: () => void;
  toggleMusic: () => void;
};
export function LudoSoundControls({ audio }: { audio: SoundControls }) {
  return (
    <div className="ld-sound-controls">
      <button
        aria-label={audio.sound ? "Mute sound" : "Enable sound"}
        aria-pressed={audio.sound}
        onClick={audio.toggleSound}
      >
        {audio.sound ? <Volume2 /> : <VolumeX />}
      </button>
      <button
        className={audio.music ? "" : "ld-muted-music"}
        aria-label={audio.music ? "Mute music" : "Enable music"}
        aria-pressed={audio.music}
        onClick={audio.toggleMusic}
      >
        <Music />
        {!audio.music && <i />}
      </button>
    </div>
  );
}
const money = (value: string | number) =>
  `₹${(Number(value) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export { LudoReferenceHome as LudoHome } from "./LudoReferenceHome";

export function LudoMatchmaking({
  match,
  state,
  remaining,
  offline,
  busy,
  audio,
  onCancel,
}: {
  match: LudoMatch;
  state: LudoState;
  remaining: number;
  offline: boolean;
  busy: boolean;
  audio: SoundControls;
  onCancel: () => void;
}) {
  const order = [
    match.you,
    ...Array.from({ length: match.capacity }, (_, i) => i).filter(
      (i) => i !== match.you,
    ),
  ];
  const joined = state.players.filter(Boolean).length;
  return (
    <section
      className={`ld-search-screen${match.mode === "private" ? " ld-private-search" : ""}`}
      aria-label="Searching for players"
    >
      <div className="ld-search-top">
        <button
          className="ld-menu-icon"
          aria-label="Cancel search and refund entry"
          disabled={busy}
          onClick={onCancel}
        >
          <ArrowLeft />
        </button>
        <strong className="ld-landscape-title">LUDO LIVE</strong>
        <LudoSoundControls audio={audio} />
      </div>
      <LudoEmblem compact />
      <div className="ld-multiplayer-ribbon">
        {match.mode === "private" ? "PRIVATE ROOM" : "REAL-TIME MULTIPLAYER"}
      </div>
      <p className="ld-search-stake">
        {LUDO_VARIANTS[state.variant ?? "classic"].name} <span>›</span>{" "}
        {match.capacity} players <span>›</span> Entry {money(match.entryPaise)}
      </p>
      {state.roomCode && <PrivateRoomCode code={state.roomCode} />}
      <div className={"ld-versus-grid ld-versus-" + match.capacity}>
        {order.map((seat, index) => {
          const p = state.players[seat];
          return (
            <div
              key={seat}
              className={
                "ld-versus-seat" +
                (p ? " ld-seat-connected" : " ld-seat-searching")
              }
            >
              <div
                className="ld-versus-avatar"
                style={p ? { backgroundColor: COLORS[p.color] } : undefined}
              >
                {p ? (
                  p.kind === "computer" ? (
                    <Bot />
                  ) : (
                    <span>{p.name.slice(0, 1).toUpperCase()}</span>
                  )
                ) : (
                  <div className="ld-search-silhouette">
                    <UserRound />
                    <Users />
                    <UserRound />
                  </div>
                )}
                <i>{p ? "✓" : "?"}</i>
              </div>
              <strong className="ld-versus-name" title={p?.name}>
                {p?.name ||
                  (match.mode === "private"
                    ? "Waiting for friend…"
                    : "Searching…")}
              </strong>
              <small>
                {seat === match.you
                  ? "YOU"
                  : p
                    ? p.kind === "computer"
                      ? "COMPUTER"
                      : "CONNECTED"
                    : "OPEN SEAT"}
              </small>
              {index === 0 && (
                <span className="ld-vs-badge" aria-hidden="true">
                  VS
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="ld-search-countdown"
        role="timer"
        aria-label={`${remaining} seconds ${match.mode === "private" ? "until room expires" : "until Computer joins"}`}
      >
        <Timer />
        <span>
          {String(Math.floor(remaining / 60)).padStart(2, "0")}:
          {String(remaining % 60).padStart(2, "0")}
        </span>
      </div>
      <p className="ld-search-progress">
        {joined} of {match.capacity} players connected
      </p>
      <div className="ld-search-bottom">
        <h2>
          {match.mode === "private"
            ? "Waiting for your friends"
            : "Finding your opponents"}
          <span className="ld-search-dots" aria-hidden="true">
            …
          </span>
        </h2>
        <p>
          {offline
            ? "Reconnecting. Your seat is saved."
            : match.mode === "private"
              ? "All seats must fill to start."
              : "Searching for players…"}
        </p>
        <small>
          {match.mode === "private"
            ? "No Computer fill-ins. Unfilled rooms expire with a full refund."
            : "Empty seats get Computer players when the timer ends."}
        </small>
      </div>
      <div className="ld-search-details">
        <span className={"ld-connection" + (offline ? " ld-offline" : "")}>
          <i />
          {offline ? "Reconnecting…" : "LIVE MATCHMAKING"}
        </span>
        <span>
          Winner takes <b>{money(match.prizePaise)}</b>
        </span>
      </div>
      <div className="ld-match-id">
        MATCH {match.id.slice(0, 8).toUpperCase()}
      </div>
      <button className="ld-search-cancel" disabled={busy} onClick={onCancel}>
        Cancel &amp; refund entry
      </button>
    </section>
  );
}
