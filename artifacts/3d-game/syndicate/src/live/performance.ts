import { agentEligible, type CommissionRun } from "./commissions";
import { type Entry, type LiveMember, type LiveTask } from "./types";
import { treePerformance } from "./tree-performance";

export function performanceScope(members: LiveMember[], root: string) {
  const children = new Map<string, string[]>();
  for (const member of members) {
    if (member.parent)
      children.set(member.parent, [
        ...(children.get(member.parent) || []),
        member.id,
      ]);
  }
  const scope = new Set<string>();
  const queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (scope.has(id)) continue;
    scope.add(id);
    queue.push(...(children.get(id) || []));
  }
  return scope;
}

// Only aggregate business performance is returned. Raw account references,
// documents, ledger descriptions and other beneficiaries never leave this helper.
export function memberPerformance(
  selected: LiveMember,
  viewer: LiveMember,
  members: LiveMember[],
  entries: Entry[],
  runs: CommissionRun[],
  tasks: LiveTask[],
  range: { from: string; to: string },
) {
  const canExploreTeam =
    viewer.role === "admin" || agentEligible(viewer, members);
  const scope = canExploreTeam
    ? performanceScope(members, selected.id)
    : new Set([selected.id]);
  const within = (date: string) => date >= range.from && date <= range.to;
  const posted = runs.filter((r) => r.status === "Posted" && within(r.date));
  const relevant = entries.filter((e) => within(e.date));
  const owned = relevant.filter((e) => e.member_id === selected.id);
  const approved = owned.filter((e) => e.status === "Approved");
  const memberTasks = tasks.filter((t) => t.assignee === selected.id);
  const sumEntries = (items: Entry[], kind: Entry["kind"]) =>
    items
      .filter((e) => e.kind === kind)
      .reduce((n, e) => n + e.amount_paise, 0);
  const earned = (items: CommissionRun[], beneficiary: string, type?: string) =>
    items
      .flatMap((r) => r.allocations)
      .filter((a) => a.member === beneficiary && (!type || a.type === type))
      .reduce((n, a) => n + a.amount, 0);
  const transactions = (items: CommissionRun[]) =>
    items.reduce((n, r) => n + r.transactions, 0);
  const ownRuns = posted.filter((r) => r.member_id === selected.id);
  const teamRuns = posted.filter((r) => scope.has(r.member_id));
  const accountBanks = new Map(
    (selected.profile.accounts || []).map((a) => [a.id, a.bank]),
  );
  const bankFor = (e: Entry) =>
    (e.account_id && accountBanks.get(e.account_id)) ||
    "Unassigned / historical account";
  const bankNames = [...new Set(owned.map(bankFor))].sort();
  const days = [
    ...new Set([
      ...owned.map((e) => e.date),
      ...posted
        .filter(
          (r) =>
            scope.has(r.member_id) ||
            r.allocations.some((a) => a.member === selected.id),
        )
        .map((r) => r.date),
    ]),
  ]
    .sort()
    .reverse();
  const sourceSummary = (member: LiveMember) => {
    const directRuns = posted.filter((r) => r.member_id === member.id);
    return {
      id: member.id,
      name: member.name,
      ref: member.ref,
      position: member.position,
      status: member.status,
      agent: agentEligible(member, members),
      accounts: member.profile.accounts?.length || 0,
      turnover: sumEntries(
        relevant.filter(
          (e) => e.member_id === member.id && e.status === "Approved",
        ),
        "Turnover",
      ),
      transactions: transactions(directRuns),
      commissionToSelected: earned(directRuns, selected.id),
    };
  };
  return {
    canExploreTeam,
    ...treePerformance(
      selected.id,
      viewer.id,
      members,
      relevant,
      posted,
      canExploreTeam,
    ),
    member: {
      id: selected.id,
      name: selected.name,
      ref: selected.ref,
      status: selected.status,
      role:
        selected.role === "admin"
          ? "admin"
          : agentEligible(selected, members)
            ? "agent"
            : "user",
      parent: selected.parent,
      position: selected.position,
      accounts: selected.profile.accounts?.length || 0,
    },
    range,
    own: {
      turnover: sumEntries(approved, "Turnover"),
      pendingTurnover: sumEntries(
        owned.filter((e) => e.status === "Pending"),
        "Turnover",
      ),
      transactions: transactions(ownRuns),
      settledTurnover: ownRuns.reduce((n, r) => n + r.turnover, 0),
      self: earned(posted, selected.id, "Self"),
      direct: earned(posted, selected.id, "Direct"),
      indirect: earned(posted, selected.id, "Indirect"),
      commission: earned(posted, selected.id),
      income: sumEntries(approved, "Income"),
      expense: sumEntries(approved, "Expense"),
    },
    team: {
      members: scope.size - 1,
      turnover: sumEntries(
        relevant.filter(
          (e) => scope.has(e.member_id) && e.status === "Approved",
        ),
        "Turnover",
      ),
      transactions: transactions(teamRuns),
      viewerCommission: earned(teamRuns, viewer.id),
    },
    directs: canExploreTeam
      ? members.filter((m) => m.parent === selected.id).map(sourceSummary)
      : [],
    tasks: {
      total: memberTasks.length,
      todo: memberTasks.filter((t) => t.status === "To do").length,
      progress: memberTasks.filter((t) => t.status === "In progress").length,
      review: memberTasks.filter((t) => t.status === "In review").length,
      complete: memberTasks.filter((t) => t.status === "Complete").length,
    },
    banks: bankNames.map((bank) => {
      const items = owned.filter((e) => bankFor(e) === bank);
      const approvedItems = items.filter((e) => e.status === "Approved");
      const ids = new Set(items.map((e) => e.id));
      const settled = ownRuns.filter((r) => ids.has(r.entry_id));
      return {
        bank,
        turnover: sumEntries(approvedItems, "Turnover"),
        transactions: transactions(settled),
        self: earned(settled, selected.id, "Self"),
        income: sumEntries(approvedItems, "Income"),
        expense: sumEntries(approvedItems, "Expense"),
      };
    }),
    days: days.map((date) => ({
      date,
      turnover: sumEntries(
        approved.filter((e) => e.date === date),
        "Turnover",
      ),
      transactions: transactions(ownRuns.filter((r) => r.date === date)),
      commission: earned(
        posted.filter((r) => r.date === date),
        selected.id,
      ),
      viewerCommission: earned(
        teamRuns.filter((r) => r.date === date),
        viewer.id,
      ),
    })),
  };
}
export type MemberPerformance = ReturnType<typeof memberPerformance>;
