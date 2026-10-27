import { useState, type CSSProperties } from "react";
import { Link } from "wouter";
import type { LudoMode, LudoVariant } from "@workspace/api-zod/ludo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

const artwork = import.meta.env.BASE_URL + "media/ludo/home-reference-v2.png";
type Rect = [number, number, number, number];
const position = ([x, y, width, height]: Rect): CSSProperties => ({
  left: `${(x / 392) * 100}%`,
  top: `${(y / 850) * 100}%`,
  width: `${(width / 392) * 100}%`,
  height: `${(height / 850) * 100}%`,
});

function MenuButton({
  rect,
  label,
  onClick,
  className = "",
  caption,
}: {
  rect: Rect;
  label: string;
  onClick: () => void;
  className?: string;
  caption?: string;
}) {
  return (
    <button
      className={`ld-reference-button ${className}`}
      style={position(rect)}
      aria-label={label}
      onClick={onClick}
    >
      <svg
        className="ld-reference-sprite"
        viewBox={rect.join(" ")}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <image href={artwork} width="392" height="850" />
      </svg>
      {caption && <span className="ld-reference-caption">{caption}</span>}
    </button>
  );
}

export function LudoReferenceHome({
  name,
  balance,
  demo,
  offline,
  onChoose,
  onSettings,
  onHistory,
  onRules,
  onThemes,
}: {
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
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const money =
    balance == null
      ? "—"
      : `₹${(Number(balance) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  return (
    <section
      className="ld-home-screen ld-reference-home"
      aria-label="Ludo main menu"
    >
      <img
        className="ld-reference-artwork"
        src={artwork}
        alt=""
        draggable={false}
        fetchPriority="high"
        width="392"
        height="850"
      />
      <header className="ld-reference-header">
        <span className="ld-reference-name" title={name}>
          {name}
        </span>
        <span className="ld-reference-level" aria-hidden="true">
          ★
        </span>
        <MenuButton
          rect={[46, 32, 44, 44]}
          label="Game settings"
          onClick={onSettings}
          className="ld-reference-settings"
        />
        <MenuButton
          rect={[90, 32, 34, 44]}
          label="My matches"
          onClick={onHistory}
          className="ld-reference-history"
        />
        <Link
          href="/wallet"
          className="ld-reference-wallet"
          aria-label={`Your wallet: ${demo ? "Demo balance" : money}`}
          style={position([223, 37, 169, 39])}
        >
          <strong>{demo ? "DEMO" : money}</strong>
        </Link>
      </header>
      <div className="ld-home-content ld-reference-content">
        <div className="ld-reference-logo" aria-label="Ludo King">
          <svg viewBox="85 140 224 184" aria-hidden="true">
            <image href={artwork} width="392" height="850" />
          </svg>
        </div>
        <MenuButton
          rect={[34, 346, 105, 93]}
          label="Online multiplayer"
          onClick={() => onChoose("online", "classic")}
          className="ld-reference-online ld-reference-mode"
          caption="2 / 4 players"
        />
        <MenuButton
          rect={[144, 346, 106, 93]}
          label="Team Up"
          onClick={() => onChoose("online", "team")}
          className="ld-reference-team ld-reference-mode"
          caption="2 vs 2"
        />
        <MenuButton
          rect={[254, 341, 111, 98]}
          label="Play with Friends"
          onClick={() => onChoose("private", "classic")}
          className="ld-reference-friends ld-reference-mode"
          caption="Private room"
        />
        <MenuButton
          rect={[80, 462, 109, 87]}
          label="Play against Computer"
          onClick={() => onChoose("computer", "classic")}
          className="ld-reference-computer ld-reference-mode"
        />
        <MenuButton
          rect={[206, 462, 109, 87]}
          label="Pass n Play — coming soon"
          onClick={() => setNotice("Pass n Play")}
          className="ld-reference-pass ld-reference-mode"
        />
        <MenuButton
          rect={[0, 94, 45, 43]}
          label="Offers — coming soon"
          onClick={() => setNotice("Offers")}
        />
        <MenuButton
          rect={[0, 142, 45, 46]}
          label="Membership — coming soon"
          onClick={() => setNotice("Membership")}
        />
        <MenuButton
          rect={[0, 194, 45, 46]}
          label="Live multiplayer"
          onClick={() => onChoose("online", "classic")}
        />
        <MenuButton
          rect={[340, 87, 52, 51]}
          label="Rewards — coming soon"
          onClick={() => setNotice("Rewards")}
        />
        <MenuButton
          rect={[341, 143, 51, 45]}
          label="Quick game"
          onClick={() => onChoose("online", "quick")}
        />
        <MenuButton
          rect={[335, 198, 57, 60]}
          label="Choose token style"
          onClick={onThemes}
        />
        <MenuButton
          rect={[343, 263, 49, 44]}
          label="How to play"
          onClick={onRules}
          className="ld-reference-help"
        />
        <MenuButton
          rect={[47, 589, 61, 60]}
          label="Events — coming soon"
          onClick={() => setNotice("Events")}
        />
        <MenuButton
          rect={[139, 574, 120, 76]}
          label="Tournament — coming soon"
          onClick={() => setNotice("Tournament")}
        />
        <MenuButton
          rect={[288, 589, 64, 60]}
          label="Board themes"
          onClick={onThemes}
        />
        <MenuButton
          rect={[122, 656, 150, 53]}
          label="Season — coming soon"
          onClick={() => setNotice("Season")}
        />
        <MenuButton
          rect={[11, 701, 58, 75]}
          label="Daily rewards — coming soon"
          onClick={() => setNotice("Daily rewards")}
        />
        <MenuButton
          rect={[323, 711, 58, 66]}
          label="Prize wheel — coming soon"
          onClick={() => setNotice("Prize wheel")}
        />
        <span
          className="ld-reference-soon ld-reference-soon-top"
          aria-hidden="true"
        >
          SOON
        </span>
        <span
          className="ld-reference-soon ld-reference-soon-bottom"
          aria-hidden="true"
        >
          SOON
        </span>
      </div>
      <nav className="ld-reference-nav" aria-label="Ludo navigation">
        <Link
          href="/"
          className="ld-reference-button ld-reference-back"
          style={position([0, 789, 94, 61])}
          aria-label="Back to lobby"
        >
          <span className="ld-reference-landscape-label">HOME</span>
        </Link>
        <MenuButton
          rect={[94, 789, 72, 61]}
          label="Event — coming soon"
          onClick={() => setNotice("Events")}
        />
        <MenuButton
          rect={[166, 780, 74, 70]}
          label="Adda — coming soon"
          onClick={() => setNotice("Adda voice chat")}
        />
        <MenuButton
          rect={[240, 789, 72, 61]}
          label="Choose theme"
          onClick={onThemes}
        />
        <MenuButton
          rect={[312, 789, 80, 61]}
          label="Social — play with friends"
          onClick={() => onChoose("private", "classic")}
        />
      </nav>
      {offline && (
        <p className="ld-reference-offline" role="status">
          Reconnecting…
        </p>
      )}
      <Dialog
        open={notice !== null}
        onOpenChange={(open) => {
          if (!open) setNotice(null);
        }}
      >
        <DialogContent className="ld-modal ld-reference-notice">
          <DialogTitle>{notice}</DialogTitle>
          <DialogDescription>
            This feature is coming soon. You can play Classic, Quick, Team Up or
            a private Friends room now.
          </DialogDescription>
          <button
            className="ld-gold-button"
            onClick={() => {
              setNotice(null);
              onChoose("online", "classic");
            }}
          >
            Play Online
          </button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
