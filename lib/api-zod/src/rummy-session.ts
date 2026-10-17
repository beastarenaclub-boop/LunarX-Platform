import { autoStep, beginPlay, discardCard, drawCard, dropPlayer, STAKES, startRound, type TableState } from "./rummy";
type AutoPlan = {
  remaining: number;
  startBalance: number;
  lossLimit: number;
  profitTarget: number;
  stake: number;
};
export type RummySession = {
  table: TableState;
  auto: AutoPlan | null;
  autoPlay: boolean;
  notice: string;
};
export type Action =
  | { type: "start"; stake: number }
  | {
      type: "auto-start";
      stake: number;
      rounds: number;
      lossLimit: number;
      profitTarget: number;
    }
  | { type: "auto-stop" }
  | { type: "auto-next" }
  | { type: "auto-play"; enabled: boolean }
  | { type: "dealt" | "step" | "drop" }
  | { type: "draw"; source: "stock" | "open" }
  | { type: "discard"; id: string; declare?: boolean }
  | { type: "refill" };

export function rummySessionReducer(
  s: RummySession,
  action: Action,
): RummySession {
  const t = s.table;
  const canStart = t.phase === "ready" || t.phase === "finished";
  switch (action.type) {
    case "start":
      return !canStart || s.auto
        ? s
        : { ...s, table: startRound(t, action.stake), notice: "" };
    case "auto-start": {
      if (
        !canStart ||
        s.auto ||
        !Number.isInteger(action.rounds) ||
        action.rounds < 1 ||
        action.rounds > 50 ||
        !Number.isFinite(action.lossLimit) ||
        action.lossLimit < action.stake ||
        !Number.isFinite(action.profitTarget) ||
        action.profitTarget < 1
      )
        return s;
      const table = startRound(t, action.stake);
      if (table === t) return s;
      return {
        table,
        autoPlay: true,
        notice: "",
        auto: {
          remaining: action.rounds - 1,
          startBalance: t.balance,
          lossLimit: action.lossLimit,
          profitTarget: action.profitTarget,
          stake: action.stake,
        },
      };
    }
    case "auto-stop":
      return {
        ...s,
        auto: null,
        notice: "Auto-bet stopped. The current round will finish.",
      };
    case "auto-play":
      return { ...s, autoPlay: action.enabled };
    case "auto-next": {
      if (!s.auto || t.phase !== "finished") return s;
      const plan = s.auto;
      const net = t.balance - plan.startBalance;
      const reason =
        plan.remaining <= 0
          ? "Round limit reached"
          : net >= plan.profitTarget
            ? "Profit target reached"
            : net <= -plan.lossLimit || net - plan.stake < -plan.lossLimit
              ? "Loss limit reached"
              : t.balance < plan.stake
                ? "Not enough chips"
                : "";
      if (reason)
        return { ...s, auto: null, notice: `${reason}. Auto-bet stopped.` };
      return {
        ...s,
        table: startRound(t, plan.stake),
        auto: { ...plan, remaining: plan.remaining - 1 },
      };
    }
    case "dealt":
      return { ...s, table: beginPlay(t) };
    case "step":
      return { ...s, table: autoStep(t) };
    case "drop":
      return { ...s, table: dropPlayer(t) };
    case "draw":
      return t.current !== 0 ? s : { ...s, table: drawCard(t, action.source) };
    case "discard":
      return t.current !== 0
        ? s
        : { ...s, table: discardCard(t, action.id, action.declare) };
    case "refill":
      return s;
  }
}
