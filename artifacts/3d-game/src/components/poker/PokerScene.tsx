import { Trophy } from "lucide-react";
import {
  HAND_NAMES,
  playerName,
  type PokerGame,
  type PokerPublicRound,
  type PokerSlip,
} from "@workspace/api-zod/poker";
import { Cards } from "./PokerCards";

const steps = ["betting", "deal", "flop", "turn", "river", "result"];
export function PokerScene({
  game,
  round,
  slips,
}: {
  game: PokerGame;
  round?: PokerPublicRound;
  slips: PokerSlip[];
}) {
  const six = game === "poker-six-players";
  const winners = round?.outcome?.winners ?? [];
  const phase = round?.phase;
  const settled =
    slips.length > 0 && slips.every((s) => s.payoutPaise !== null);
  const returned = slips.reduce(
    (sum, slip) => sum + Number(slip.payoutPaise ?? 0),
    0,
  );
  return (
    <div className={`pk-scene ${six ? "pk-scene-six" : "pk-scene-duel"}`}>
      <div className="pk-table-arena" key={round?.id}>
        <div className="pk-felt">
          <span>TEXAS HOLD’EM</span>
        </div>
        <div className="pk-table-seats">
          {Array.from({ length: six ? 6 : 2 }, (_, p) => (
            <div
              key={p}
              data-testid={`seat-${p}`}
              className={`pk-seat pk-seat-${p} ${winners.includes(p) ? "pk-seat-winner" : ""}`}
            >
              <div className="pk-seat-name">
                {winners.includes(p) && <Trophy size={12} />}
                {playerName(game, p)}
              </div>
              <Cards values={round?.hands[p] ?? [null, null]} />
              <small>
                {round?.outcome
                  ? HAND_NAMES[round.outcome.categories[p]]
                  : phase === "betting"
                    ? six
                      ? "Starting hand"
                      : "Ready to deal"
                    : "In play"}
              </small>
            </div>
          ))}
        </div>
        <div className="pk-community" data-testid="poker-board">
          <span>
            {phase === "betting"
              ? "Waiting for bets"
              : phase === "deal"
                ? "Dealing hands"
                : "Community cards"}
          </span>
          <Cards values={round?.board ?? [null, null, null, null, null]} />
          <div className="pk-dealer-button" aria-label="Dealer">
            D
          </div>
        </div>
      </div>
      <div className="pk-round-caption" role="status">
        {phase === "result" ? (
          <div className="pk-result" data-testid="poker-result">
            <Trophy size={18} />
            <strong>
              {winners.map((p) => playerName(game, p)).join(" & ")}
              {winners.length > 1 ? " · Tie" : " wins"}
            </strong>
            <small>
              {settled
                ? `Returned ₹${(returned / 100).toLocaleString("en-IN")} · Next round shortly`
                : "Next round starts automatically"}
            </small>
          </div>
        ) : (
          <span>
            {phase === "betting"
              ? "Choose your player below and confirm your bet"
              : "Bets locked · Watch the cards reveal"}
          </span>
        )}
      </div>
      <ol className="pk-round-steps" aria-label="Round progress">
        {steps.map((step, index) => (
          <li
            key={step}
            className={
              step === phase
                ? "pk-step-current"
                : index < steps.indexOf(phase ?? "")
                  ? "pk-step-done"
                  : ""
            }
            aria-current={step === phase ? "step" : undefined}
          >
            {step === "betting" ? "Bet · 20s" : step}
          </li>
        ))}
      </ol>
    </div>
  );
}
