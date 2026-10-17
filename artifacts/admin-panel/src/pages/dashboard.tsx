import { useEffect, useRef } from "react";
import {
  useAdminDashboard,
  getAdminDashboardQueryKey,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { paiseToINR } from "@/lib/format";

const BASE = import.meta.env.VITE_API_URL || "/api";

interface GameMetric {
  gameCode: string;
  title: string;
  enabled: boolean;
  targetRtp: number;
  configuredHouseEdge: number;
  rounds: number;
  players: number;
  stake: string;
  payout: string;
  ggr: string;
  realizedRtp: number | null;
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: string | number;
  testId?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold" data-testid={testId}>
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useAdminDashboard({
    query: {
      queryKey: getAdminDashboardQueryKey(),
      refetchInterval: 300_000,
    },
  });

  // Live counters: each `admin:metrics` "bump" is a "something happened"
  // signal. We re-fetch the authoritative dashboard rather than patching
  // local deltas, which would drift from the dashboard's own aggregation.
  // Bumps are debounced so a burst of bets doesn't hammer the endpoint.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
  const scheduleRefetch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void qc.invalidateQueries({ queryKey: getAdminDashboardQueryKey() });
    }, 750);
  };
  useRealtimeTopic<{ type: string }>("admin:metrics", (ev) => {
    if (!ev) return;
    scheduleRefetch();
    void qc.invalidateQueries({ queryKey: ["admin-games-metrics"] });
  });
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: getAdminDashboardQueryKey() });
    void qc.invalidateQueries({ queryKey: ["admin-games-metrics"] });
  });

  // Per-game KPIs for "today". Streams via the same admin:metrics bumps
  // (debounced above). Uses raw fetch to stay consistent with rtp-config.
  const { data: gameMetrics } = useQuery<GameMetric[]>({
    queryKey: ["admin-games-metrics"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(`${BASE}/admin/games/metrics`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch game metrics");
      return res.json();
    },
  });

  if (isLoading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (error)
    return (
      <p className="text-sm text-red-600" data-testid="text-error">
        Failed to load dashboard
      </p>
    );
  if (!data) return null;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-slate-500">Operator overview</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Users total" value={data.usersTotal} testId="stat-users-total" />
        <Stat label="Users active" value={data.usersActive} testId="stat-users-active" />
        <Stat label="Users suspended" value={data.usersSuspended ?? 0} />
        <Stat label="KYC pending" value={data.kycPending} testId="stat-kyc-pending" />
        <Stat
          label="Deposits pending"
          value={data.depositsPending ?? 0}
          testId="stat-deposits-pending"
        />
        <Stat
          label="Withdrawals pending"
          value={data.withdrawalsPending}
          testId="stat-withdrawals-pending"
        />
        <Stat label="Open fraud flags" value={data.openFlags} testId="stat-open-flags" />
        <Stat label="Bets today" value={data.betsToday} testId="stat-bets-today" />
        <Stat
          label="Stake today"
          value={paiseToINR(data.stakeToday ?? "0")}
          testId="stat-stake-today"
        />
        <Stat
          label="Payout today"
          value={paiseToINR(data.payoutToday ?? "0")}
          testId="stat-payout-today"
        />
      </div>

      {/* Per-game KPIs (today, UTC). Updates live via admin:metrics bumps. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Today by game</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="table-game-metrics">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-2">Game</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2 text-right">Rounds</th>
                  <th className="px-4 py-2 text-right">Players</th>
                  <th className="px-4 py-2 text-right">Stake</th>
                  <th className="px-4 py-2 text-right">Payout</th>
                  <th className="px-4 py-2 text-right">GGR</th>
                  <th className="px-4 py-2 text-right">Realized RTP</th>
                  <th className="px-4 py-2 text-right">Target RTP</th>
                </tr>
              </thead>
              <tbody>
                {(gameMetrics ?? []).map((g) => (
                  <tr
                    key={g.gameCode}
                    className="border-t"
                    data-testid={`row-game-${g.gameCode}`}
                  >
                    <td className="px-4 py-2 font-medium">
                      {g.title}{" "}
                      <span className="text-[11px] text-slate-400 font-mono">
                        {g.gameCode}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        className={
                          g.enabled
                            ? "bg-emerald-600 hover:bg-emerald-600 text-[10px]"
                            : "bg-slate-300 text-slate-700 hover:bg-slate-300 text-[10px]"
                        }
                      >
                        {g.enabled ? "LIVE" : "OFF"}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {g.rounds.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {g.players.toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {paiseToINR(g.stake)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {paiseToINR(g.payout)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {paiseToINR(g.ggr)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {g.realizedRtp === null
                        ? "—"
                        : `${g.realizedRtp.toFixed(2)}%`}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {g.targetRtp.toFixed(1)}%
                    </td>
                  </tr>
                ))}
                {(gameMetrics?.length ?? 0) === 0 && (
                  <tr>
                    <td
                      colSpan={9}
                      className="px-4 py-6 text-center text-slate-500"
                    >
                      No game activity yet today.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
