import { useQuery, useMutation } from "@tanstack/react-query";
import {
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch, formatPaise } from "@/lib/api";
import { queryClient } from "@/lib/queryClient";
import { Users, Coins, Wallet, TrendingUp, Copy, Check } from "lucide-react";
import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

type AgentMe = {
  agent: {
    id: string;
    userId: string;
    commissionRate: number;
    upiId: string | null;
    status: string;
    createdAt: string;
  };
  referralCode: string | null;
  stats: {
    totalEarned: string;
    availableBalance: string;
    pendingPayout: string;
    playerCount: number;
  };
};

type CommissionSummary = {
  daily: string;
  weekly: string;
  monthly: string;
  allTime: string;
};

type Analytics = {
  rangeDays: number;
  commissionTrend: {
    date: string;
    commission: string;
    stake: string;
    payout: string;
  }[];
  playerAcquisition: { weekStart: string; count: number }[];
  topPlayers: {
    playerId: string;
    playerEmail: string;
    commission: string;
    netRevenue: string;
  }[];
  revenueBreakdown: {
    totalStake: string;
    totalPayout: string;
    netRevenue: string;
    totalCommission: string;
  };
};

const PIE_COLORS = ["#10b981", "#6366f1", "#f59e0b", "#ef4444"];

function paiseToRupees(p: string | number): number {
  const n = typeof p === "string" ? Number(p) : p;
  if (!Number.isFinite(n)) return 0;
  return n / 100;
}

function formatShortDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function Dashboard() {
  const [copied, setCopied] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["agent-me"],
    queryFn: () => apiFetch<AgentMe>("/api/agent/me"),
    refetchInterval: 300_000,
  });

  const { data: summary } = useQuery({
    queryKey: ["agent-commission-summary"],
    queryFn: () => apiFetch<CommissionSummary>("/api/agent/commissions/summary"),
    refetchInterval: 300_000,
  });

  const { data: analytics } = useQuery({
    queryKey: ["agent-analytics"],
    queryFn: () => apiFetch<Analytics>("/api/agent/analytics?days=30"),
    refetchInterval: 300_000,
  });

  // Live commission/balance updates pushed by the server when the
  // commission engine accrues a new amount for this agent.
  const agentUserId = me?.agent.userId ?? null;
  useRealtimeTopic<{ type: string }>(
    agentUserId ? `agent:${agentUserId}` : null,
    (ev) => {
      if (!ev) return;
      if (ev.type === "commission") {
        void queryClient.invalidateQueries({ queryKey: ["agent-me"] });
        void queryClient.invalidateQueries({
          queryKey: ["agent-commission-summary"],
        });
      } else if (ev.type === "player_added") {
        // Refresh the agent profile (player count + analytics) when a new
        // referred player signs up.
        void queryClient.invalidateQueries({ queryKey: ["agent-me"] });
        void queryClient.invalidateQueries({ queryKey: ["agent-analytics"] });
      }
    },
  );
  useRealtimeResync(() => {
    void queryClient.invalidateQueries({ queryKey: ["agent-me"] });
    void queryClient.invalidateQueries({
      queryKey: ["agent-commission-summary"],
    });
    void queryClient.invalidateQueries({ queryKey: ["agent-analytics"] });
  });

  const generateLink = useMutation({
    mutationFn: () =>
      apiFetch<{ referralCode: string }>("/api/agent/generate-referral-link", {
        method: "POST",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agent-me"] });
    },
  });

  const referralCode = me?.referralCode;
  const referralLink = referralCode
    ? `${window.location.origin}/?ref=${referralCode}`
    : null;

  const copyLink = () => {
    if (referralLink) {
      navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back, agent</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Players</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {me?.stats.playerCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Earned</CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPaise(me?.stats.totalEarned ?? "0")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Available Balance</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-emerald-600">
              {formatPaise(me?.stats.availableBalance ?? "0")}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Commission Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {me?.agent.commissionRate ?? 0}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Commission Earnings — Last {analytics?.rangeDays ?? 30} Days
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={(analytics?.commissionTrend ?? []).map((d) => ({
                  date: formatShortDate(d.date),
                  commission: paiseToRupees(d.commission),
                }))}
                margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `₹${v}`}
                />
                <Tooltip
                  formatter={(value: number) => [`₹${value.toFixed(2)}`, "Commission"]}
                />
                <Line
                  type="monotone"
                  dataKey="commission"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              New Players — Last 12 Weeks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={(analytics?.playerAcquisition ?? []).map((d) => ({
                    week: formatShortDate(d.weekStart),
                    count: d.count,
                  }))}
                  margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v, "Signups"]} />
                  <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revenue Breakdown (All Time)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              {analytics &&
              (Number(analytics.revenueBreakdown.totalStake) > 0 ||
                Number(analytics.revenueBreakdown.totalCommission) > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        {
                          name: "Net Revenue",
                          value: Math.max(
                            paiseToRupees(analytics.revenueBreakdown.netRevenue),
                            0,
                          ),
                        },
                        {
                          name: "Player Payouts",
                          value: paiseToRupees(
                            analytics.revenueBreakdown.totalPayout,
                          ),
                        },
                        {
                          name: "Your Commission",
                          value: paiseToRupees(
                            analytics.revenueBreakdown.totalCommission,
                          ),
                        },
                      ]}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={80}
                      label={(entry: { name?: string; value?: number }) =>
                        `${entry.name ?? ""}: ₹${(entry.value ?? 0).toFixed(0)}`
                      }
                    >
                      {PIE_COLORS.slice(0, 3).map((c, i) => (
                        <Cell key={i} fill={c} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => `₹${v.toFixed(2)}`}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  No revenue data yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Players by Commission</CardTitle>
          </CardHeader>
          <CardContent>
            {analytics && analytics.topPlayers.length > 0 ? (
              <div className="space-y-2">
                {analytics.topPlayers.map((p, i) => (
                  <div
                    key={p.playerId}
                    className="flex items-center justify-between border-b last:border-b-0 pb-2 last:pb-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-medium">
                        {i + 1}
                      </span>
                      <span className="truncate text-sm">{p.playerEmail || p.playerId}</span>
                    </div>
                    <span className="text-sm font-medium">
                      {formatPaise(p.commission)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-6 text-center">
                No commission data yet
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commission Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">Today</span>
                <span className="font-medium">{formatPaise(summary?.daily ?? "0")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">This Week</span>
                <span className="font-medium">{formatPaise(summary?.weekly ?? "0")}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-muted-foreground">This Month</span>
                <span className="font-medium">{formatPaise(summary?.monthly ?? "0")}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-sm font-medium">All Time</span>
                <span className="font-bold">{formatPaise(summary?.allTime ?? "0")}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Referral Link</CardTitle>
          </CardHeader>
          <CardContent>
            {referralCode ? (
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Your referral code</p>
                  <code className="bg-slate-100 px-3 py-1.5 rounded text-sm font-mono">
                    {referralCode}
                  </code>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">Share this link</p>
                  <div className="flex gap-2">
                    <code className="bg-slate-100 px-3 py-1.5 rounded text-xs font-mono flex-1 truncate">
                      {referralLink}
                    </code>
                    <Button size="sm" variant="outline" onClick={copyLink}>
                      {copied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-4">
                <p className="text-sm text-muted-foreground mb-3">
                  Generate your unique referral link to start earning commissions
                </p>
                <Button
                  onClick={() => generateLink.mutate()}
                  disabled={generateLink.isPending}
                >
                  {generateLink.isPending ? "Generating..." : "Generate Referral Link"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
