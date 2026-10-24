import { LockKeyhole } from "lucide-react";
import {
  BACCARAT_SCORE_BETS,
  baccaratWinningScoreBet,
  type BaccaratBetType,
} from "@workspace/api-zod/baccarat-game";
import { CoinFace } from "@/components/table/chips";
import { cn } from "@/lib/utils";
import type { StudioDeal } from "./studioTimeline";

interface Props {
  editable: boolean;
  result: StudioDeal | null;
  payouts?: Partial<Record<BaccaratBetType, number>>;
  amount: (spot: BaccaratBetType) => number;
  onBet: (spot: BaccaratBetType) => void;
}

export default function BaccaratScoreboard(p: Props) {
  const winningScore = p.result ? baccaratWinningScoreBet(p.result) : null;
  return (
    <section className="bc-scoreboard" aria-label="Winning score bets" data-testid="baccarat-scoreboard">
      <div className="bc-score-row">
        {BACCARAT_SCORE_BETS.map(({ type, label }) => {
          const totalReturn = p.payouts?.[type];
          const supported = totalReturn != null && Number.isFinite(totalReturn);
          const locked = !p.editable || !supported;
          const amount = p.amount(type);
          const won = winningScore === type;
          const odds = supported ? `${Number((totalReturn - 1).toFixed(2))}:1` : "—";
          return (
            <button
              key={type}
              type="button"
              className={cn("bc-score-spot", amount > 0 && "bc-score-selected", won && "bc-score-won")}
              data-game-bet
              data-testid={`spot-${type}`}
              data-winning={won}
              disabled={locked}
              aria-label={`Bet on ${label}`}
              title={`${label}: ${odds} profit. Winning hand's final score; ties lose. Winning stake is returned.`}
              onClick={() => p.onBet(type)}
            >
              {locked && <LockKeyhole className="bc-score-lock" size={11} aria-hidden="true" />}
              <span className="bc-score-label">{label}</span>
              <span className="bc-score-odds">{odds}</span>
              {amount > 0 && (
                <span className="bc-score-chip" data-testid={`chipstack-${type}`}>
                  <CoinFace value={amount} sizeClass="w-5 h-5" textClass="text-[8px]" />
                  <span className="sr-only">₹{amount}</span>
                </span>
              )}
              {won && <span className="bc-score-win">WIN</span>}
            </button>
          );
        })}
      </div>
      <div className="bc-score-caption">
        <span>Winning score · Tie loses</span>
        <span role="status" data-testid="baccarat-score-result">
          {p.result
            ? p.result.winner === "tie"
              ? "Tie · No score winner"
              : `${p.result.winner === "player" ? "Player" : "Banker"} · Score ${p.result.winner === "player" ? p.result.playerTotal : p.result.bankerTotal}`
            : "Odds pay profit + stake"}
        </span>
      </div>
    </section>
  );
}
