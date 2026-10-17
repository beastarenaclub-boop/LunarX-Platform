import { env } from "cloudflare:workers";
import { memberPerformance } from "../src/live/performance";
import type { CommissionRun } from "../src/live/commissions";
import type { Entry, LiveMember, LiveTask } from "../src/live/types";

export async function performanceReport(
  selected: LiveMember,
  viewer: LiveMember,
  members: LiveMember[],
  range: { from: string; to: string },
) {
  const query = async <T>(sql: string, ...values: string[]) =>
    (
      await env
        .DB!.prepare(sql)
        .bind(...values)
        .all<T>()
    ).results;
  const [entries, storedRuns, tasks] = await Promise.all([
    query<Entry>(
      "SELECT * FROM entries WHERE date>=? AND date<=?",
      range.from,
      range.to,
    ),
    query<Omit<CommissionRun, "allocations"> & { allocations: string }>(
      "SELECT * FROM commission_runs WHERE date>=? AND date<=?",
      range.from,
      range.to,
    ),
    query<LiveTask>("SELECT * FROM tasks WHERE assignee=?", selected.id),
  ]);
  const runs = storedRuns.map((run) => ({
    ...run,
    allocations: JSON.parse(run.allocations),
  })) as CommissionRun[];
  return memberPerformance(
    selected,
    viewer,
    members,
    entries,
    runs,
    tasks,
    range,
  );
}
