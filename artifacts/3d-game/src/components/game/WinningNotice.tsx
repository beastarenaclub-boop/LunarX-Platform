import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Trophy, X, ArrowUpRight } from "lucide-react";
import type { Bet } from "@workspace/api-client-react";
import { formatWinAmount } from "../table/RoundWinPopup";
import { useGameScreenBounds } from "../table/useGameScreenBounds";

/** A fresh settlement stays visible without trapping focus or stopping play. */
export default function WinningNotice({ bet, game, name, demo, onDismiss, onView }: {
  bet: Bet; game: string; name: string; demo: boolean; onDismiss: () => void; onView: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const { bounds, portalContainer } = useGameScreenBounds(game, visible, "viewport");
  useEffect(() => {
    // Existing per-game win dialogs already announce the same settlement.
    // Let those keep their timing (for example the dice/ball animation).
    const nativePopup = () => {
      if (document.querySelector('[data-testid="round-win-dialog"], .ld-result-modal[data-state="open"]')) onDismiss();
    };
    nativePopup();
    const observer = new MutationObserver(nativePopup);
    observer.observe(document.body, { childList: true, subtree: true });
    const reveal = setTimeout(() => setVisible(true), 1600);
    const timer = setTimeout(onDismiss, 10600);
    return () => { observer.disconnect(); clearTimeout(reveal); clearTimeout(timer); };
  }, [onDismiss]);
  const amount = (value: bigint) => `${demo ? "" : "₹"}${formatWinAmount(value)}${demo ? " coins" : ""}`;
  return visible && bounds && createPortal(<div className="winning-notice-frame" style={bounds}>
    <section className="winning-notice" role="status" aria-live="polite" data-testid="winning-notice">
      <button className="winning-notice-close" aria-label="Dismiss winning notification" onClick={onDismiss}><X size={18} /></button>
      <div className="winning-notice-medal"><Trophy size={34} aria-hidden="true" /></div>
      <div className="winning-notice-copy"><span>{name}{demo ? " · Demo" : ""}</span><h2>You won!</h2><strong data-testid="winning-notice-amount">{amount(BigInt(bet.payoutAmount))}</strong><small>Total return · includes your stake</small></div>
      <div className="winning-notice-footer"><span>Profit <b>+{amount(BigInt(bet.payoutAmount) - BigInt(bet.stakeAmount))}</b></span><button onClick={onView}>View result <ArrowUpRight size={16} /></button></div>
    </section>
  </div>, portalContainer ?? document.body);
}
