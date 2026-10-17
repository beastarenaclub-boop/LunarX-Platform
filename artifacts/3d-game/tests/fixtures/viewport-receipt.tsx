import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import RoundWinDialog, { useRoundWin } from "../../src/components/table/RoundWinDialog";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../src/components/ui/dialog";

const root = createRoot(document.body.appendChild(document.createElement("div")));
function Receipt({ game, round, payout = "123466789" }: { game: string; round: string; payout?: string }) {
  const receipt = useRoundWin({ game, userId: "viewport-test", roundId: round, eligible: round.startsWith("winning-round"),
    bets: round.startsWith("winning-round") ? [{ status: "settled", totalStake: "10000", payoutAmount: payout }] : [] });
  return <RoundWinDialog win={receipt.win} onClose={receipt.dismiss} />;
}
function Settings() {
  const [open, setOpen] = useState(true);
  return <Dialog open={open} onOpenChange={setOpen}><DialogContent>
    <DialogTitle>Game settings test</DialogTitle><DialogDescription>Check all settings remain reachable.</DialogDescription>
    {Array.from({ length: 20 }, (_, i) => <p key={i}>Setting {i + 1}</p>)}
    <button onClick={() => setOpen(false)}>Save settings</button>
  </DialogContent></Dialog>;
}
Object.assign(window, {
  showViewportReceipt: (game: string, round = "winning-round", payout?: string) => root.render(<Receipt game={game} round={round} payout={payout} />),
  showViewportSettings: () => root.render(<Settings />),
});
