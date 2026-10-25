import { Link } from "wouter";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Coins,
  Crown,
  Globe2,
  History,
  Maximize,
  Minimize,
  Music,
  Settings,
  Smartphone,
  Timer,
  Users,
  UserRound,
  Volume2,
  VolumeX,
} from "lucide-react";
import type { LudoMatch, LudoState } from "@workspace/api-zod/ludo";
import { LudoEmblem } from "./LudoEmblem";
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

export function LudoHome({
  name,
  balance,
  demo,
  offline,
  onChoose,
  onSettings,
  onHistory,
  fullscreen,
  onFullscreen,
}: {
  name: string;
  balance?: string;
  demo: boolean;
  offline: boolean;
  onChoose: (mode: "online" | "computer") => void;
  onSettings: () => void;
  onHistory: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
}) {
  return (
    <section className="ld-home-screen" aria-label="Ludo main menu">
      <header className="ld-profile-header">
        <span className="ld-profile-avatar">
          {name.slice(0, 1).toUpperCase()}
          <i className={offline ? "ld-profile-offline" : ""} />
        </span>
        <div className="ld-profile-name">
          <strong title={name}>{name}</strong>
          <small>
            {offline
              ? "Reconnecting…"
              : demo
                ? "DEMO PLAYER"
                : "LUDO LIVE PLAYER"}
          </small>
        </div>
        <Link
          className="ld-profile-wallet"
          href="/wallet"
          aria-label="Your wallet"
        >
          <Coins />
          <strong title={balance ? money(balance) : undefined}>
            {demo ? "∞" : balance ? money(balance) : "—"}
          </strong>
          <small>{demo ? "Practice coins" : "Your wallet"}</small>
        </Link>
        <button
          className="ld-menu-icon ld-mobile-settings"
          aria-label="Game settings"
          onClick={onSettings}
        >
          <Settings />
        </button>
      </header>
      <div className="ld-home-tools">
        <button
          className="ld-menu-icon"
          aria-label="Game settings"
          onClick={onSettings}
        >
          <Settings />
        </button>
        <Link className="ld-add-money" href="/wallet">
          <Coins size={18} />
          {demo ? "YOUR WALLET" : "ADD MONEY"}
        </Link>
      </div>
      <div className="ld-home-content">
        <LudoEmblem />
        <div className="ld-home-play">
          <div className="ld-play-heading">
            <span>LET'S PLAY</span>
            <h1>Your board. Your crown.</h1>
            <p>Pick a mode and make your next move.</p>
          </div>
          <div className="ld-mode-tiles">
            <button
              className="ld-mode-tile"
              aria-label="Online multiplayer"
              onClick={() => onChoose("online")}
            >
              <span className="ld-mode-badge">
                <i /> MULTIPLAYER
              </span>
              <span className="ld-tile-art ld-online-art" aria-hidden="true">
                <Smartphone />
                <i />
                <Globe2 />
                <i />
                <Smartphone />
              </span>
              <strong>Play online</strong>
              <span className="ld-tile-caption">2 or 4 players</span>
              <span className="ld-tile-action">
                LET'S GO <ArrowRight size={17} />
              </span>
            </button>
            <button
              className="ld-mode-tile ld-computer-tile"
              aria-label="Play against Computer"
              onClick={() => onChoose("computer")}
            >
              <span className="ld-mode-badge">INSTANT PLAY</span>
              <span className="ld-tile-art ld-computer-art" aria-hidden="true">
                <Bot />
                <b>VS</b>
                <UserRound />
              </span>
              <strong>Computer</strong>
              <span className="ld-tile-caption">Ready when you are</span>
              <span className="ld-tile-action">
                PLAY NOW <ArrowRight size={17} />
              </span>
            </button>
          </div>
          <p className="ld-home-note">
            <Crown size={16} /> A classic game. A new rivalry.
          </p>
        </div>
      </div>
      <footer className="ld-home-footer">
        <Link className="ld-menu-icon" href="/" aria-label="Back to lobby">
          <ArrowLeft />
        </Link>
        <button className="ld-menu-history" onClick={onHistory}>
          <History size={18} /> My matches
        </button>
        <button
          className="ld-menu-icon"
          aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={onFullscreen}
        >
          {fullscreen ? <Minimize /> : <Maximize />}
        </button>
      </footer>
    </section>
  );
}

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
    <section className="ld-search-screen" aria-label="Searching for players">
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
      <div className="ld-multiplayer-ribbon">REAL-TIME MULTIPLAYER</div>
      <p className="ld-search-stake">
        Classic <span>›</span> {match.capacity} players <span>›</span> Entry{" "}
        {money(match.entryPaise)}
      </p>
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
                {p?.name || "Searching…"}
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
        aria-label={`${remaining} seconds until Computer joins`}
      >
        <Timer />
        <span>00:{String(remaining).padStart(2, "0")}</span>
      </div>
      <p className="ld-search-progress">
        {joined} of {match.capacity} players connected
      </p>
      <div className="ld-search-bottom">
        <h2>
          Finding your opponents
          <span className="ld-search-dots" aria-hidden="true">
            …
          </span>
        </h2>
        <p>
          {offline
            ? "Reconnecting. Your seat is saved."
            : "Searching for players…"}
        </p>
        <small>Empty seats get Computer players when the timer ends.</small>
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
