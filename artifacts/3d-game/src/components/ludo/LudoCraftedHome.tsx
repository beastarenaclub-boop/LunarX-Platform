import { useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Check } from "lucide-react";
import type { LudoMode, LudoVariant } from "@workspace/api-zod/ludo";
import { LudoArtwork, LudoCraftedHero, type LudoArtKind } from "./LudoArtwork";
import { LudoLocalPlay } from "./LudoLocalPlay";
import { LudoCommunity } from "./LudoCommunity";
import { LudoDailyReward } from "./LudoDailyReward";
import { LudoSnakes } from "./LudoSnakes";
import { LudoPin, type LudoTokenStyle } from "./LudoPin";
import { TOKEN_STYLES } from "./LudoSetup";

type Feature =
  | "pass"
  | "social"
  | "daily"
  | "inventory"
  | "wheel"
  | "membership"
  | "season"
  | "tournament"
  | "events"
  | "snakes";
function ArtButton({
  kind,
  label,
  onClick,
  className = "",
  caption,
}: {
  kind: LudoArtKind;
  label: string;
  onClick: () => void;
  className?: string;
  caption?: string;
}) {
  return (
    <button
      className={`ld-crafted-art-button ${className}`}
      aria-label={label}
      onClick={onClick}
    >
      <LudoArtwork kind={kind} />
      {caption && <span>{caption}</span>}
    </button>
  );
}
export function LudoCraftedHome({
  userId,
  name,
  balance,
  demo,
  offline,
  onChoose,
  onSettings,
  onHistory,
  onRules,
  onThemes,
  tokenStyle,
  onTokenStyle,
}: {
  userId: string;
  name: string;
  balance?: string;
  demo: boolean;
  offline: boolean;
  onChoose: (mode: LudoMode, variant?: LudoVariant) => void;
  onSettings: () => void;
  onHistory: () => void;
  onRules: () => void;
  onThemes: () => void;
  fullscreen: boolean;
  onFullscreen: () => void;
  tokenStyle: LudoTokenStyle;
  onTokenStyle: (style: LudoTokenStyle) => void;
}) {
  const [feature, setFeature] = useState<Feature | null>(null);
  const back = () => setFeature(null);
  if (feature === "pass")
    return <LudoLocalPlay userId={userId} name={name} onBack={back} />;
  if (feature === "social")
    return <LudoCommunity userId={userId} onBack={back} />;
  if (feature === "daily")
    return <LudoDailyReward userId={userId} demo={demo} onBack={back} />;
  if (feature === "snakes")
    return <LudoSnakes userId={userId} name={name} onBack={back} />;
  if (feature)
    return (
      <section className="ld-feature-screen" aria-label={feature}>
        <header className="ld-feature-header">
          <button aria-label="Back to main menu" onClick={back}>
            <ArrowLeft />
          </button>
          <div>
            <strong>{feature.toUpperCase()}</strong>
            <small>
              {feature === "inventory" ? "Make the board yours" : "Ludo club"}
            </small>
          </div>
          <LudoArtwork
            kind={
              feature === "wheel"
                ? "wheel"
                : feature === "inventory"
                  ? "inventory"
                  : feature === "events"
                    ? "calendar"
                    : "crown"
            }
          />
        </header>
        <div className="ld-feature-body">
          {feature === "inventory" ? (
            <>
              <h1>Your collection</h1>
              <p>
                Choose a token. Your selection applies to all your Ludo boards.
              </p>
              <div className="ld-inventory-grid">
                {TOKEN_STYLES.map((style) => (
                  <button
                    key={style}
                    aria-label={`${style} token style`}
                    aria-pressed={style === tokenStyle}
                    onClick={() => onTokenStyle(style)}
                  >
                    <LudoPin color="#4cbaff" variant={style} />
                    <strong>{style}</strong>
                    <small>
                      {style === tokenStyle ? (
                        <>
                          <Check size={14} /> Equipped
                        </>
                      ) : (
                        "Equip"
                      )}
                    </small>
                  </button>
                ))}
              </div>
              <button className="ld-feature-primary" onClick={onThemes}>
                Choose board theme
              </button>
            </>
          ) : feature === "events" ? (
            <>
              <h1>Today's events</h1>
              <button
                className="ld-event-card"
                onClick={() => setFeature("daily")}
              >
                <LudoArtwork kind="gift" />
                <span>
                  <strong>Daily ₹100 reward</strong>
                  <small>Claim once each day · midnight IST reset</small>
                </span>
              </button>
              <button
                className="ld-event-card"
                onClick={() => {
                  back();
                  onChoose("online", "quick");
                }}
              >
                <LudoArtwork kind="target" />
                <span>
                  <strong>Quick match</strong>
                  <small>First token home takes the crown</small>
                </span>
              </button>
              <button className="ld-event-card" onClick={onHistory}>
                <LudoArtwork kind="crown" />
                <span>
                  <strong>Your match results</strong>
                  <small>Review games and actual winnings</small>
                </span>
              </button>
            </>
          ) : (
            <div className="ld-cash-feature-preview">
              <LudoArtwork kind={feature === "wheel" ? "wheel" : "crown"} />
              <h1>
                {feature === "wheel"
                  ? "Prize wheel"
                  : feature === "membership"
                    ? "Royal membership"
                    : feature === "season"
                      ? "Season rewards"
                      : "Ludo tournament"}
              </h1>
              <p>Entry and reward rules have not been published yet.</p>
              <p>
                No payment or entry is available until the rules are published.
              </p>
              <button
                className="ld-feature-primary"
                onClick={() => setFeature("daily")}
              >
                View daily ₹100 reward
              </button>
            </div>
          )}
        </div>
      </section>
    );
  const wallet = demo
    ? "DEMO"
    : balance == null
      ? "—"
      : `₹${(Number(balance) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const modes: [LudoArtKind, string, string, () => void, string?][] = [
    [
      "online",
      "ONLINE",
      "Online multiplayer",
      () => onChoose("online", "classic"),
      "2 / 4 players",
    ],
    ["team", "TEAM UP", "Team Up", () => onChoose("online", "team"), "2 vs 2"],
    [
      "friends",
      "FRIENDS",
      "Play with Friends",
      () => onChoose("private", "classic"),
      "Private room",
    ],
    [
      "computer",
      "COMPUTER",
      "Play against Computer",
      () => onChoose("computer", "classic"),
    ],
    ["pass", "PASS N PLAY", "Pass n Play", () => setFeature("pass")],
  ];
  return (
    <section
      className="ld-home-screen ld-crafted-home"
      aria-label="Ludo main menu"
    >
      <div className="ld-crafted-background" aria-hidden="true" />
      <header className="ld-crafted-header">
        <button
          className="ld-crafted-avatar"
          aria-label="My profile and friends"
          onClick={() => setFeature("social")}
        >
          <LudoArtwork kind="profile" />
          <i className={offline ? "offline" : ""} />
        </button>
        <ArtButton kind="settings" label="Game settings" onClick={onSettings} />
        <ArtButton kind="mail" label="My matches" onClick={onHistory} />
        <strong className="ld-crafted-name" title={name}>
          {name}
        </strong>
        <Link
          className="ld-crafted-wallet"
          href="/wallet"
          aria-label="Your wallet"
        >
          <LudoArtwork kind="coins" />
          <strong>{wallet}</strong>
          <b>+</b>
        </Link>
      </header>
      <div className="ld-home-content ld-crafted-content">
        <aside className="ld-crafted-left" aria-label="Ludo club">
          <ArtButton
            kind="gift"
            label="Daily ₹100 reward"
            caption="₹100"
            onClick={() => setFeature("daily")}
          />
          <ArtButton
            kind="crown"
            label="Membership"
            onClick={() => setFeature("membership")}
          />
          <ArtButton
            kind="home"
            label="Live multiplayer"
            caption="LIVE"
            onClick={() => onChoose("online", "classic")}
          />
        </aside>
        <aside className="ld-crafted-right" aria-label="Game shortcuts">
          <ArtButton
            kind="coins"
            label="Rewards"
            caption="DAILY"
            onClick={() => setFeature("daily")}
          />
          <ArtButton
            kind="target"
            label="Quick game"
            onClick={() => onChoose("online", "quick")}
          />
          <ArtButton
            kind="dice"
            label="Choose token style"
            onClick={() => setFeature("inventory")}
          />
          <ArtButton kind="help" label="How to play" onClick={onRules} />
        </aside>
        <LudoCraftedHero />
        <div className="ld-crafted-mode-grid">
          {modes.map(([kind, title, label, click, caption]) => (
            <button
              key={kind}
              className={`ld-crafted-tile ld-crafted-tile-${kind}`}
              aria-label={label}
              onClick={click}
            >
              <div className="ld-crafted-tile-scene">
                <LudoArtwork kind={kind} />
              </div>
              <strong>{title}</strong>
              {caption && <small>{caption}</small>}
              <i className="ld-tile-glint" aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="ld-crafted-extras">
          <ArtButton
            kind="gift"
            label="Events"
            onClick={() => setFeature("events")}
          />
          <button
            className="ld-crafted-tournament"
            onClick={() => setFeature("tournament")}
          >
            <LudoArtwork kind="crown" />
            <strong>TOURNAMENT</strong>
          </button>
          <ArtButton
            kind="snakes"
            label="Snakes and Ladders"
            onClick={() => setFeature("snakes")}
          />
        </div>
        <button
          className="ld-crafted-season"
          onClick={() => setFeature("season")}
        >
          <LudoArtwork kind="crown" />
          <span>
            <small>THE NEXT CHAPTER</small>
            <strong>SEASON</strong>
          </span>
          <b>›</b>
        </button>
        <ArtButton
          kind="coins"
          label="Claim daily reward"
          caption="₹100 DAILY"
          onClick={() => setFeature("daily")}
          className="ld-crafted-daily"
        />
        <ArtButton
          kind="wheel"
          label="Prize wheel"
          onClick={() => setFeature("wheel")}
          className="ld-crafted-wheel"
        />
      </div>
      <nav className="ld-crafted-nav" aria-label="Ludo navigation">
        <Link href="/" aria-label="Back to lobby" className="active">
          <LudoArtwork kind="home" />
          <span>HOME</span>
        </Link>
        <ArtButton
          kind="calendar"
          label="Events"
          caption="EVENT"
          onClick={() => setFeature("events")}
        />
        <ArtButton
          kind="chat"
          label="Adda text chat"
          caption="ADDA"
          onClick={() => setFeature("social")}
        />
        <ArtButton
          kind="inventory"
          label="Inventory"
          caption="INVENTORY"
          onClick={() => setFeature("inventory")}
        />
        <ArtButton
          kind="friends"
          label="Social"
          caption="SOCIAL"
          onClick={() => setFeature("social")}
        />
      </nav>
      {offline && (
        <p className="ld-crafted-offline" role="status">
          Reconnecting…
        </p>
      )}
      <button
        className="ld-crafted-theme-access"
        aria-label="Choose theme"
        onClick={onThemes}
      >
        Themes
      </button>
    </section>
  );
}
