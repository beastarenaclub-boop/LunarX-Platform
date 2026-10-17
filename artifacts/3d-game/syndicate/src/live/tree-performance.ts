import type { CommissionRun } from "./commissions";
import type { Entry, LiveMember } from "./types";

const empty = () => ({
  members: 0,
  approved: 0,
  eligibleAgents: 0,
  turnover: 0,
  settledTurnover: 0,
  transactions: 0,
  self: 0,
  direct: 0,
  indirect: 0,
  commissionToSelected: 0,
  viewerCommission: 0,
});

// Actual booked allocations, never projections under the latest rates.
// One ancestry index and one pass over each record; no per-level rescans.
export function treePerformance(
  selected: string,
  viewer: string,
  members: LiveMember[],
  entries: Entry[],
  runs: CommissionRun[],
  canExploreTeam: boolean,
) {
  const children = new Map<string, LiveMember[]>();
  const byId = new Map(members.map((m) => [m.id, m]));
  for (const member of members)
    if (member.parent) {
      const list = children.get(member.parent) || [];
      list.push(member);
      children.set(member.parent, list);
    }
  const levels = new Map<number, ReturnType<typeof empty>>();
  const branches = { left: empty(), right: empty() };
  const positions = new Map<
    string,
    { depth: number; side: "left" | "right" | null }
  >();
  const queue = [
    { id: selected, depth: 0, side: null as "left" | "right" | null },
  ];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    if (positions.has(node.id)) continue;
    const member = byId.get(node.id);
    if (!member) continue;
    positions.set(node.id, node);
    const level = levels.get(node.depth) || empty();
    levels.set(node.depth, level);
    const groups = node.side ? [level, branches[node.side]] : [level];
    for (const group of groups) {
      group.members++;
      if (member.status === "Approved") group.approved++;
      if (
        member.role !== "admin" &&
        member.status === "Approved" &&
        (children.get(member.id) || []).filter((m) => m.status === "Approved")
          .length === 2
      )
        group.eligibleAgents++;
    }
    if (canExploreTeam)
      for (const child of children.get(node.id) || [])
        queue.push({
          id: child.id,
          depth: node.depth + 1,
          side: node.side || child.position,
        });
  }
  const groupsFor = (id: string) => {
    const node = positions.get(id);
    if (!node) return [];
    const level = levels.get(node.depth)!;
    return node.side ? [level, branches[node.side]] : [level];
  };
  for (const entry of entries)
    if (entry.kind === "Turnover" && entry.status === "Approved")
      for (const group of groupsFor(entry.member_id))
        group.turnover += entry.amount_paise;
  for (const run of runs)
    if (run.status === "Posted") {
      const groups = groupsFor(run.member_id);
      if (!groups.length) continue;
      const amounts = {
        self: 0,
        direct: 0,
        indirect: 0,
        selected: 0,
        viewer: 0,
      };
      for (const allocation of run.allocations) {
        if (allocation.member === selected) {
          amounts.selected += allocation.amount;
          if (allocation.type === "Self") amounts.self += allocation.amount;
          if (allocation.type === "Direct") amounts.direct += allocation.amount;
          if (allocation.type === "Indirect")
            amounts.indirect += allocation.amount;
        }
        if (allocation.member === viewer) amounts.viewer += allocation.amount;
      }
      for (const group of groups) {
        group.settledTurnover += run.turnover;
        group.transactions += run.transactions;
        group.self += amounts.self;
        group.direct += amounts.direct;
        group.indirect += amounts.indirect;
        group.commissionToSelected += amounts.selected;
        group.viewerCommission += amounts.viewer;
      }
    }
  return {
    levels: [...levels]
      .sort(([a], [b]) => a - b)
      .map(([depth, values]) => ({ depth, ...values })),
    branches: canExploreTeam
      ? (["left", "right"] as const).map((side) => ({
          side,
          ...branches[side],
        }))
      : [],
  };
}
