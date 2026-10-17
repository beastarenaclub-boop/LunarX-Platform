import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiFetch, formatPaise } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Commission = {
  id: string;
  agentId: string;
  playerId: string;
  playerEmail: string;
  periodDate: string;
  grossStake: string;
  grossPayout: string;
  netRevenue: string;
  commissionRate: number;
  commissionAmount: string;
  status: string;
  createdAt: string;
};

export default function CommissionsPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { user } = useAuth();
  const qc = useQueryClient();

  const params = new URLSearchParams();
  params.set("limit", "100");
  if (from) params.set("from", from);
  if (to) params.set("to", to);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent-commissions", from, to],
    queryFn: () =>
      apiFetch<{ commissions: Commission[]; total: number }>(
        `/api/agent/commissions?${params.toString()}`,
      ),
  });

  // Live: server publishes `agent:{userId}` "commission" events whenever
  // a new commission row is accrued for one of this agent's players.
  useRealtimeTopic<{ type: string }>(
    user ? `agent:${user.id}` : null,
    (ev) => {
      if (!ev) return;
      if (ev.type === "commission") {
        void qc.invalidateQueries({ queryKey: ["agent-commissions"] });
      }
    },
  );
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["agent-commissions"] });
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Commissions</h1>
        <p className="text-muted-foreground">
          Daily commission breakdown per player ({data?.total ?? 0} entries)
        </p>
      </div>

      <div className="flex gap-3 items-end">
        <div>
          <label className="text-sm text-muted-foreground">From</label>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-40"
          />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">To</label>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-40"
          />
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-right">Gross Stake</TableHead>
                <TableHead className="text-right">Gross Payout</TableHead>
                <TableHead className="text-right">Net Revenue</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Loading...
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <div className="text-sm text-destructive">
                      Failed to load commissions
                      {error instanceof Error ? `: ${error.message}` : ""}
                    </div>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-2 text-xs underline text-muted-foreground"
                      data-testid="btn-retry-commissions"
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : !data?.commissions.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No commission data yet
                  </TableCell>
                </TableRow>
              ) : (
                data.commissions.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">
                      {new Date(c.periodDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm">{c.playerEmail}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(c.grossStake)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(c.grossPayout)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(c.netRevenue)}
                    </TableCell>
                    <TableCell className="text-right text-sm">{c.commissionRate}%</TableCell>
                    <TableCell className="text-right font-mono text-sm font-medium text-emerald-600">
                      {formatPaise(c.commissionAmount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
