import {
  calculate,
  commissionAmount,
  type CommissionPlan,
} from "./commissions";
import type { LiveMember } from "./types";

export type TreeScenario = {
  depth: number;
  turnover: number; // integer paise, per member for the illustrated period
  transactions: number;
  above: number;
};

// One representative source per level has the same ancestry as every source
// at that level in a complete, eligible binary tree. Never materialize 2^depth nodes.
export function projectTree(plan: CommissionPlan, scenario: TreeScenario) {
  const { depth, turnover, transactions, above } = scenario;
  if (
    !Number.isInteger(depth) ||
    depth < 1 ||
    depth > 20 ||
    !Number.isInteger(above) ||
    above < 0 ||
    above > 1000 ||
    !Number.isSafeInteger(turnover) ||
    turnover < 100 ||
    turnover > 1000000000 ||
    !Number.isInteger(transactions) ||
    transactions < 1 ||
    transactions > 1000000
  )
    throw Error(
      "Use 1–20 levels, 0–1,000 upper agents, ₹1–₹1 crore turnover and 1–10 lakh transactions per member.",
    );
  if (plan.basis === "pending")
    throw Error("Choose a confirmed plan basis first.");
  const fee = commissionAmount(plan.basis, plan.gross, transactions, turnover);
  if (fee < 1)
    throw Error(
      "This activity generates less than one paisa of fee; increase the example amount.",
    );
  const levels = Array.from({ length: depth + 1 }, (_, level) => {
    const ancestors = level + above;
    const members: LiveMember[] = Array.from(
      { length: ancestors + 1 },
      (_, index) => ({
        id: `u${index}`,
        name:
          index === level
            ? "Aap / selected agent"
            : index === 0
              ? `Level ${level} source member`
              : `Source se ${index} level upar`,
        parent: index < ancestors ? `u${index + 1}` : null,
        role: "user",
        status: "Approved",
        position: "left",
        ref: "",
        city: "",
        profile: {},
        revision: 0,
        created_at: "",
      }),
    );
    for (let i = 1; i <= ancestors; i++)
      members.push({
        ...members[0],
        id: `s${i}`,
        parent: `u${i}`,
        position: "right",
      });
    const distribution = calculate(
      plan,
      members[0],
      members,
      transactions,
      turnover,
      fee,
    );
    const count = 2 ** level;
    const own = distribution.allocations.find((a) => a.member === `u${level}`);
    const sum = (type: string) =>
      distribution.allocations
        .filter((a) => a.type === type)
        .reduce((n, a) => n + a.amount, 0);
    return {
      level,
      count,
      turnover: turnover * count,
      transactions: transactions * count,
      fee: fee * count,
      selfPaid: sum("Self") * count,
      directPaid: sum("Direct") * count,
      indirectPaid: sum("Indirect") * count,
      company: distribution.company * count,
      reserve: distribution.reserve * count,
      observerPerSource: own?.amount || 0,
      observerShare: (own?.amount || 0) * count,
      eligibleIndirect: Math.max(
        0,
        plan.mode === "pool"
          ? ancestors - 1
          : Math.min(ancestors - 1, plan.levels),
      ),
      distribution,
    };
  });
  const total = levels.reduce(
    (sum, row) => ({
      members: sum.members + row.count,
      turnover: sum.turnover + row.turnover,
      fee: sum.fee + row.fee,
      selfPaid: sum.selfPaid + row.selfPaid,
      directPaid: sum.directPaid + row.directPaid,
      indirectPaid: sum.indirectPaid + row.indirectPaid,
      company: sum.company + row.company,
      reserve: sum.reserve + row.reserve,
      observerShare: sum.observerShare + row.observerShare,
    }),
    {
      members: 0,
      turnover: 0,
      fee: 0,
      selfPaid: 0,
      directPaid: 0,
      indirectPaid: 0,
      company: 0,
      reserve: 0,
      observerShare: 0,
    },
  );
  if (!Object.values(total).every(Number.isSafeInteger))
    throw Error("Example exceeds supported amount.");
  return {
    levels,
    total,
    own: levels[0].observerShare,
    direct: levels[1].observerShare,
    indirect: levels.slice(2).reduce((n, r) => n + r.observerShare, 0),
  };
}
