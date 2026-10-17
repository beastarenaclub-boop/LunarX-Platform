import { useState } from "react";
import { useRealtimeTopic } from "@workspace/api-client-react";
import type { BetsGlobalEvent } from "@workspace/api-zod";
import RoundWinDialog, { useRoundWin } from "./table/RoundWinDialog";

export default function CrashWinReceipt({ game, userId }: { game: string; userId: string }) {
  const [result, setResult] = useState<Extract<BetsGlobalEvent, { type: "settled" }> | null>(null);
  useRealtimeTopic<BetsGlobalEvent>("bets:global", event => {
    if (event.type === "settled" && event.gameCode === game && event.userId === userId && event.status === "cashed_out") setResult(event);
  });
  const receipt = useRoundWin({ game, userId, roundId: result?.id ?? null, eligible: !!result,
    bets: result ? [{ status: "settled", totalStake: result.stakeAmount, payoutAmount: result.payoutAmount }] : [] });
  return <RoundWinDialog win={receipt.win} onClose={receipt.dismiss} />;
}
