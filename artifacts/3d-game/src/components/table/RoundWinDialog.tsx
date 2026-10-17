import { useEffect, useRef, useState } from "react";
import type { MyBet } from "./useTableRound";
import type { Win } from "./RoundWinPopup";
import { sfx } from "@/game/audio";
import { store } from "@/game/store";
export { default, formatWinAmount, winAmount, type Win } from "./RoundWinPopup";

function remembered(key: string): string[] {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((v) => typeof v === "string").slice(-100)
      : [];
  } catch {
    return [];
  }
}
export function useRoundWin({
  game,
  userId,
  roundId,
  eligible,
  bets,
  unit = "rupees",
}: {
  game: string;
  userId?: string;
  roundId: string | null;
  eligible: boolean;
  bets: Pick<MyBet, "status" | "payoutAmount" | "totalStake">[];
  unit?: "rupees" | "chips";
}) {
  const scope = `table-wins:v1:${game}:${userId ?? "guest"}`;
  const seen = useRef(new Set<string>());
  const [wins, setWins] = useState<Win[]>([]);
  useEffect(() => {
    if (
      !userId ||
      !roundId ||
      !eligible ||
      !bets.length ||
      bets.some((b) => b.status !== "settled" && b.status !== "refunded")
    )
      return;
    const id = `${scope}:${roundId}`;
    if (seen.current.has(id)) return;
    const rounds = remembered(scope);
    if (rounds.includes(roundId)) return;
    const settled = bets.filter((b) => b.status === "settled");
    const payout = settled.reduce(
      (total, b) => total + BigInt(b.payoutAmount || "0"),
      0n,
    );
    const stake = settled.reduce(
      (total, b) => total + BigInt(b.totalStake || "0"),
      0n,
    );
    // Each instant tap creates its own slip. A winning slip still deserves a
    // receipt when another wager loses; report the full round's net honestly.
    // Equal returns (pushes) and refunds alone are not winning bets.
    const hasWinningSlip = settled.some(
      (b) => BigInt(b.payoutAmount || "0") > BigInt(b.totalStake || "0"),
    );
    if (payout <= stake && !hasWinningSlip) return;
    seen.current.add(id);
    try {
      sessionStorage.setItem(
        scope,
        JSON.stringify([...rounds, roundId].slice(-100)),
      );
    } catch {
      /* In-memory deduplication still applies. */
    }
    setWins(previous => [...previous.filter(win => win.scope === scope),
      { scope, game, roundId, profit: payout - stake, payout, unit }]);
    window.dispatchEvent(new Event("table-round-win"));
    if (store.getState().settings.sound) sfx.winCelebration(game);
  }, [scope, game, userId, roundId, eligible, bets, unit]);
  return {
    // A new betting window must not discard an unread winning receipt.
    win: wins.find(win => win.scope === scope) ?? null,
    dismiss: () => setWins(previous => previous.filter(win => win.scope === scope).slice(1)),
  };
}
