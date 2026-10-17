import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { paiseToINR } from "@/lib/format";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";

const BASE = import.meta.env.VITE_API_URL || "/api";

interface SettlementRow {
  id: string;
  roundId: string;
  gameCode: string;
  totalPool: string;
  playerPool: string;
  companyProfit: string;
  winnerCount: number;
  loserCount: number;
  settledAt: string;
}

interface SettlementEntry {
  id: string;
  userId: string;
  betId: string;
  stake: string;
  cashoutMultiplier: number | null;
  payout: string;
  profit: string;
}

interface SettlementDetail extends SettlementRow {
  entries: SettlementEntry[];
}

interface SummaryWindow {
  rounds: number;
  totalPool: string;
  playerPool: string;
  companyProfit: string;
}

interface SummaryResponse {
  today: SummaryWindow;
  last7d: SummaryWindow;
  last30d: SummaryWindow;
  allTime: SummaryWindow;
}

interface DailyPoint {
  day: string;
  totalPool: string;
  playerPool: string;
  companyProfit: string;
  rounds: number;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as T;
}

function WindowCard({
  label,
  data,
  testIdPrefix,
}: {
  label: string;
  data?: SummaryWindow;
  testIdPrefix: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div>
          <div className="text-xs text-slate-500">Total wagered</div>
          <div
            className="text-lg font-semibold tabular-nums"
            data-testid={`${testIdPrefix}-wagered`}
          >
            {data ? inr(data.totalPool) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Paid to players (95%)</div>
          <div
            className="text-lg font-semibold tabular-nums text-emerald-700"
            data-testid={`${testIdPrefix}-payout`}
          >
            {data ? inr(data.playerPool) : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Company profit (5%)</div>
          <div
            className="text-lg font-semibold tabular-nums text-amber-700"
            data-testid={`${testIdPrefix}-profit`}
          >
            {data ? inr(data.companyProfit) : "—"}
          </div>
        </div>
        <div className="text-xs text-slate-500 pt-1 border-t">
          {data ? `${data.rounds} rounds` : "Loading…"}
        </div>
      </CardContent>
    </Card>
  );
}

function inr(paise: string): string {
  return paiseToINR(BigInt(paise));
}

export default function RoundProfitPage() {
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minPool, setMinPool] = useState("");
  const limit = 25;

  const summary = useQuery({
    queryKey: ["round-settlements-summary"],
    queryFn: () =>
      fetchJson<SummaryResponse>(`${BASE}/admin/round-settlements/summary`),
    refetchInterval: 60_000,
  });

  const daily = useQuery({
    queryKey: ["round-settlements-daily"],
    queryFn: () =>
      fetchJson<DailyPoint[]>(`${BASE}/admin/round-settlements/daily?days=30`),
    refetchInterval: 120_000,
  });

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("limit", String(limit));
    p.set("offset", String(page * limit));
    if (dateFrom) p.set("dateFrom", new Date(dateFrom).toISOString());
    if (dateTo) p.set("dateTo", new Date(dateTo).toISOString());
    if (minPool) {
      // user enters rupees; convert to paise (×100). Keep integer-only.
      const paise = Math.round(parseFloat(minPool) * 100);
      if (Number.isFinite(paise) && paise > 0) p.set("minPool", String(paise));
    }
    return p.toString();
  }, [page, dateFrom, dateTo, minPool]);

  const list = useQuery({
    queryKey: ["round-settlements-list", filterParams],
    queryFn: () =>
      fetchJson<{ total: number; settlements: SettlementRow[] }>(
        `${BASE}/admin/round-settlements?${filterParams}`,
      ),
    refetchInterval: 30_000,
  });

  const detail = useQuery({
    enabled: !!expanded,
    queryKey: ["round-settlement-detail", expanded],
    queryFn: () =>
      fetchJson<SettlementDetail>(
        `${BASE}/admin/round-settlements/${encodeURIComponent(expanded as string)}`,
      ),
  });

  const chartData = (daily.data ?? []).map((d) => ({
    day: d.day.slice(5), // MM-DD
    Pool: Number(BigInt(d.totalPool) / 100n),
    Payout: Number(BigInt(d.playerPool) / 100n),
    Profit: Number(BigInt(d.companyProfit) / 100n),
  }));

  return (
    <div className="space-y-6" data-testid="page-round-profit">
      <div>
        <h1 className="text-2xl font-semibold">Round Profit Split</h1>
        <p className="text-sm text-slate-500 mt-1">
          Pari-mutuel settlements: 5% of every round pool is company profit;
          the remaining 95% is split across cashed-out players proportional to
          stake × cashout multiplier.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <WindowCard label="Today (UTC)" data={summary.data?.today} testIdPrefix="stat-today" />
        <WindowCard label="Last 7 days" data={summary.data?.last7d} testIdPrefix="stat-7d" />
        <WindowCard label="Last 30 days" data={summary.data?.last30d} testIdPrefix="stat-30d" />
        <WindowCard label="All-time" data={summary.data?.allTime} testIdPrefix="stat-alltime" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Last 30 days — Pool vs Payout vs Profit</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) =>
                    new Intl.NumberFormat("en-IN").format(v) + " ₹"
                  }
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="Pool"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Payout"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="Profit"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Settlements</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setPage(0);
                  setDateFrom(e.target.value);
                }}
                className="border rounded px-2 py-1 text-sm"
                data-testid="filter-date-from"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setPage(0);
                  setDateTo(e.target.value);
                }}
                className="border rounded px-2 py-1 text-sm"
                data-testid="filter-date-to"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Min pool (₹)
              </label>
              <input
                type="number"
                value={minPool}
                onChange={(e) => {
                  setPage(0);
                  setMinPool(e.target.value);
                }}
                placeholder="0"
                className="border rounded px-2 py-1 text-sm w-28"
                data-testid="filter-min-pool"
              />
            </div>
            <div className="ml-auto text-sm text-slate-500">
              {list.data ? `${list.data.total} settlements` : "Loading…"}
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Settled</TableHead>
                <TableHead>Round</TableHead>
                <TableHead>Game</TableHead>
                <TableHead className="text-right">Pool</TableHead>
                <TableHead className="text-right">Payout</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Winners / Losers</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data?.settlements.map((s) => {
                const isOpen = expanded === s.id;
                return (
                  <Fragment key={s.id}>
                    <TableRow
                      key={s.id}
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpanded(isOpen ? null : s.id)}
                      data-testid={`row-settlement-${s.id}`}
                    >
                      <TableCell>
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(s.settledAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {s.roundId.slice(0, 12)}…
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.gameCode}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {inr(s.totalPool)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">
                        {inr(s.playerPool)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">
                        {inr(s.companyProfit)}
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {s.winnerCount} / {s.loserCount}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow key={`${s.id}-detail`}>
                        <TableCell colSpan={8} className="bg-slate-50 p-4">
                          {detail.isLoading || detail.data?.id !== s.id ? (
                            <div className="text-sm text-slate-500">
                              Loading entries…
                            </div>
                          ) : (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>User</TableHead>
                                  <TableHead className="text-right">
                                    Stake
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Cashout ×
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Payout
                                  </TableHead>
                                  <TableHead className="text-right">
                                    Profit
                                  </TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {detail.data.entries.map((e) => (
                                  <TableRow
                                    key={e.id}
                                    data-testid={`entry-${e.id}`}
                                  >
                                    <TableCell className="font-mono text-xs">
                                      {e.userId.slice(0, 12)}…
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {inr(e.stake)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {e.cashoutMultiplier
                                        ? `${e.cashoutMultiplier.toFixed(2)}×`
                                        : "—"}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums text-emerald-700">
                                      {inr(e.payout)}
                                    </TableCell>
                                    <TableCell
                                      className={`text-right tabular-nums ${
                                        BigInt(e.profit) >= 0n
                                          ? "text-emerald-700"
                                          : "text-rose-700"
                                      }`}
                                    >
                                      {inr(e.profit)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </Fragment>
                );
              })}
              {list.data && list.data.settlements.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-sm text-slate-500 py-8"
                  >
                    No settlements yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              data-testid="page-prev"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !list.data || (page + 1) * limit >= list.data.total
              }
              onClick={() => setPage((p) => p + 1)}
              data-testid="page-next"
            >
              Next
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
