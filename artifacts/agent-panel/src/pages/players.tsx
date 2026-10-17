import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { apiFetch, formatPaise } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Player = {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  kycStatus: string;
  lifetimeDeposits: string;
  lifetimeBets: string;
  lifetimeNet: string;
  signupDate: string;
};

export default function PlayersPage() {
  const [search, setSearch] = useState("");
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["agent-players", search],
    queryFn: () =>
      apiFetch<{ players: Player[]; total: number }>(
        `/api/agent/players?limit=50&q=${encodeURIComponent(search)}`,
      ),
  });

  // Live: server publishes `agent:{userId}` "player_added" when a new
  // signup uses this agent's referral code, and "commission" when a
  // player's bet generates net revenue. Refetch the player list on
  // either since lifetime stats and player count both move.
  useRealtimeTopic<{ type: string }>(
    user ? `agent:${user.id}` : null,
    (ev) => {
      if (!ev) return;
      if (ev.type === "player_added" || ev.type === "commission") {
        void qc.invalidateQueries({ queryKey: ["agent-players"] });
      }
    },
  );
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["agent-players"] });
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">My Users</h1>
        <p className="text-muted-foreground">
          Players who signed up with your referral link ({data?.total ?? 0} total)
        </p>
      </div>

      <div className="flex gap-3">
        <Input
          placeholder="Search by email..."
          className="max-w-xs"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>KYC</TableHead>
                <TableHead className="text-right">Deposits</TableHead>
                <TableHead className="text-right">Bets</TableHead>
                <TableHead className="text-right">Net Revenue</TableHead>
                <TableHead>Signup</TableHead>
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
                      Failed to load players
                      {error instanceof Error ? `: ${error.message}` : ""}
                    </div>
                    <button
                      type="button"
                      onClick={() => refetch()}
                      className="mt-2 text-xs underline text-muted-foreground"
                      data-testid="btn-retry-players"
                    >
                      Retry
                    </button>
                  </TableCell>
                </TableRow>
              ) : !data?.players.length ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No referred players yet
                  </TableCell>
                </TableRow>
              ) : (
                data.players.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">
                      {p.email}
                      {p.displayName && (
                        <span className="text-muted-foreground text-xs block">
                          {p.displayName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={p.status === "active" ? "default" : "destructive"}
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          p.kycStatus === "approved"
                            ? "default"
                            : p.kycStatus === "pending"
                              ? "secondary"
                              : "outline"
                        }
                      >
                        {p.kycStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(p.lifetimeDeposits)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(p.lifetimeBets)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(p.lifetimeNet)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(p.signupDate).toLocaleDateString()}
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
