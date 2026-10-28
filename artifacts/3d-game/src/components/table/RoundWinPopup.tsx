import { useEffect, useId, useRef, type CSSProperties } from "react";
import { Trophy, Sparkles, X } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useGameScreenBounds } from "./useGameScreenBounds";
import "./round-win-dialog.css";

const Dialog = DialogPrimitive.Root;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

export type Win = { scope: string; game?: string; roundId: string; profit: bigint; payout: bigint; unit?: "rupees" | "chips" | "coins" };
export function formatWinAmount(paise: bigint) {
  const amount = paise < 0n ? -paise : paise;
  return `${(amount / 100n).toLocaleString("en-IN")}.${(amount % 100n).toString().padStart(2, "0")}`;
}
export function winAmount(amount: bigint, unit: Win["unit"] = "rupees") {
  return unit === "chips"
    ? `${(amount < 0n ? -amount : amount).toLocaleString("en-IN")} chips`
    : unit === "coins" ? `${formatWinAmount(amount)} coins` : `₹${formatWinAmount(amount)}`;
}
export default function RoundWinPopup({
  win,
  onClose,
  inline = false,
}: {
  win: Win | null;
  onClose: () => void;
  inline?: boolean;
}) {
  const confirm = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const game = win?.game ?? win?.scope.split(":")[2] ?? "game";
  const gameName = game === "wingo" ? "Colour Trading" : game.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
  const { bounds, portalContainer } = useGameScreenBounds(game, !!win && !inline, "viewport");
  useEffect(() => {
    if (inline && win) confirm.current?.focus({ preventScroll: true });
  }, [inline, win?.roundId]);
  const content = <>
        <div className="round-win-confetti" aria-hidden="true">
          {Array.from({ length: 18 }, (_, index) => (
            <i
              key={index}
              style={
                {
                  "--x": `${5 + ((index * 37) % 90)}%`,
                  "--turn": `${index % 2 ? 220 : -200}deg`,
                  "--delay": `${(index % 6) * 65}ms`,
                  "--drift": `${((index * 19) % 80) - 40}px`,
                } as CSSProperties
              }
            />
          ))}
        </div>
        <div className="round-win-emblem" aria-hidden="true">
          <Trophy />
          <Sparkles className="round-win-sparkle" />
        </div>
        <div className="round-win-heading">
          <span className="round-win-game" data-testid="round-win-game">{gameName}</span>
          <DialogTitle {...(inline ? { id: titleId } : {})}>
            {win && win.profit <= 0n ? "Winning bet!" : "You win!"}
          </DialogTitle>
          <DialogDescription {...(inline ? { id: descriptionId } : {})}>
            {win && win.profit <= 0n
              ? "Your winning bet has paid out."
              : "Your winning round is complete."}
          </DialogDescription>
        </div>
        {win && (
          <div className="round-win-amounts">
            <span className="round-win-label">
              {win.profit < 0n
                ? "Round net loss"
                : win.profit === 0n
                  ? "Round net"
                  : "Net win"}
            </span>
            <p
              className="round-win-profit"
              data-testid="round-win-profit"
              data-loss={win.profit < 0n}
            >
              {win.profit < 0n ? "−" : win.profit > 0n ? "+" : ""}
              {winAmount(win.profit, win.unit)}
            </p>
            <p className="round-win-return">
              Total returned{" "}
              <strong data-testid="round-win-payout">
                {winAmount(win.payout, win.unit)}
              </strong>
            </p>
            <span className="round-win-note">Includes your returned stake</span>
          </div>
        )}
        <button
          ref={confirm}
          type="button"
          onClick={onClose}
          data-testid="round-win-ok"
          className="round-win-confirm"
        >
          OK
        </button>
      </>;
  return (
    <Dialog open={!!win} onOpenChange={open => { if (!open) onClose(); }}>
      {inline ? win && <section className="round-win-dialog round-win-inline" data-game={game} role="dialog" aria-modal="false"
        aria-labelledby={titleId} aria-describedby={descriptionId} data-testid="round-win-dialog"
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
        {content}
      </section> : bounds && <DialogPrimitive.Portal container={portalContainer}>
        <div className="round-win-screen" data-testid="round-win-screen" data-game={game} data-size={bounds.height <= 320 ? "small" : bounds.height <= 500 ? "compact" : "regular"} style={bounds}>
          <DialogPrimitive.Overlay className="round-win-backdrop" />
          <DialogPrimitive.Content key={`${win?.scope}:${win?.roundId}`} className="round-win-dialog round-win-on-screen" data-game={game} data-testid="round-win-dialog"
            onOpenAutoFocus={event => { event.preventDefault(); confirm.current?.focus({ preventScroll: true }); }}>
            {content}
            <DialogPrimitive.Close className="round-win-close" aria-label="Close winning result"><X size={20} /></DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>}
    </Dialog>
  );
}
