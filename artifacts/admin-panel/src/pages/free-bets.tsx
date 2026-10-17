import { useState } from "react";
import {
  useAdminGrantFreeBets,
  useAdminListFreeBets,
  useAdminCreateRain,
  getAdminListFreeBetsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { paiseToINR } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

export default function FreeBetsPage() {
  const { user } = useAuth();
  const canManage = hasRole(user, "admin", "super_admin");
  const qc = useQueryClient();

  const [userId, setUserId] = useState("");
  const [amount, setAmount] = useState("");
  const [count, setCount] = useState("3");
  const [expiresHours, setExpiresHours] = useState("");

  const [rainAmount, setRainAmount] = useState("");
  const [rainMaxClaims, setRainMaxClaims] = useState("5");
  const [rainMessage, setRainMessage] = useState("");
  const [rainTtl, setRainTtl] = useState("120");

  const grant = useAdminGrantFreeBets();
  const createRain = useAdminCreateRain();
  const list = useAdminListFreeBets({ limit: 50 });

  if (!canManage) {
    return (
      <p className="text-sm text-slate-500">
        Only admins can manage free bets.
      </p>
    );
  }

  const refreshList = () =>
    qc.invalidateQueries({ queryKey: getAdminListFreeBetsQueryKey({ limit: 50 }) });

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Free bets &amp; rain</h1>
        <p className="text-sm text-slate-500">
          Grant promotional free bets to players and trigger rain drops in chat.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grant free bets</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="fb-uid">User ID</Label>
              <Input
                id="fb-uid"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                data-testid="input-freebet-user"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fb-amt">Stake per bet (paise)</Label>
              <Input
                id="fb-amt"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 5000 = ₹50.00"
                data-testid="input-freebet-amount"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fb-count">Number of bets</Label>
              <Input
                id="fb-count"
                value={count}
                onChange={(e) => setCount(e.target.value)}
                data-testid="input-freebet-count"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fb-exp">Expires in hours (optional)</Label>
              <Input
                id="fb-exp"
                value={expiresHours}
                onChange={(e) => setExpiresHours(e.target.value)}
                placeholder="e.g. 72"
                data-testid="input-freebet-expiry"
              />
            </div>
            <Button
              disabled={
                grant.isPending || !userId || !amount || !Number(count)
              }
              data-testid="button-grant-freebets"
              onClick={() =>
                grant.mutate(
                  {
                    data: {
                      userId,
                      amountPaise: amount,
                      count: Number(count),
                      ...(Number(expiresHours)
                        ? { expiresInHours: Number(expiresHours) }
                        : {}),
                    },
                  },
                  { onSuccess: () => void refreshList() },
                )
              }
            >
              {grant.isPending ? "Granting…" : "Grant free bets"}
            </Button>
            {grant.isSuccess && grant.data && (
              <p className="text-sm text-emerald-700" data-testid="text-grant-result">
                Granted {grant.data.totalCount} × {paiseToINR(grant.data.amountPaise)}.
              </p>
            )}
            {grant.isError && (
              <p className="text-sm text-red-600">
                {(grant.error as Error)?.message ?? "Failed to grant"}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trigger rain in chat</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="rain-amt">Free-bet stake per claimer (paise)</Label>
              <Input
                id="rain-amt"
                value={rainAmount}
                onChange={(e) => setRainAmount(e.target.value)}
                placeholder="e.g. 5000 = ₹50.00"
                data-testid="input-rain-amount"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rain-max">Max claims</Label>
              <Input
                id="rain-max"
                value={rainMaxClaims}
                onChange={(e) => setRainMaxClaims(e.target.value)}
                data-testid="input-rain-maxclaims"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rain-msg">Message (optional)</Label>
              <Input
                id="rain-msg"
                value={rainMessage}
                onChange={(e) => setRainMessage(e.target.value)}
                placeholder="e.g. Happy weekend!"
                data-testid="input-rain-message"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rain-ttl">Claim window (seconds)</Label>
              <Input
                id="rain-ttl"
                value={rainTtl}
                onChange={(e) => setRainTtl(e.target.value)}
                data-testid="input-rain-ttl"
              />
            </div>
            <Button
              disabled={
                createRain.isPending || !rainAmount || !Number(rainMaxClaims)
              }
              data-testid="button-create-rain"
              onClick={() =>
                createRain.mutate({
                  data: {
                    amountPaise: rainAmount,
                    maxClaims: Number(rainMaxClaims),
                    ...(rainMessage ? { message: rainMessage } : {}),
                    ...(Number(rainTtl) ? { ttlSeconds: Number(rainTtl) } : {}),
                  },
                })
              }
            >
              {createRain.isPending ? "Raining…" : "Make it rain"}
            </Button>
            {createRain.isSuccess && createRain.data && (
              <p className="text-sm text-emerald-700" data-testid="text-rain-result">
                Rain live: {createRain.data.maxClaims} claims ×{" "}
                {paiseToINR(createRain.data.amountPaise)}.
              </p>
            )}
            {createRain.isError && (
              <p className="text-sm text-red-600">
                {(createRain.error as Error)?.message ?? "Failed to create rain"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent grants</CardTitle>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : !list.data || list.data.entries.length === 0 ? (
            <p className="text-sm text-slate-500">No grants yet.</p>
          ) : (
            <Table data-testid="table-freebet-grants">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Game</TableHead>
                  <TableHead>Stake</TableHead>
                  <TableHead>Remaining</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.data.entries.map((g) => (
                  <TableRow key={g.id} data-testid={`row-grant-${g.id}`}>
                    <TableCell className="font-mono text-xs">{g.userId}</TableCell>
                    <TableCell>{g.gameCode}</TableCell>
                    <TableCell>{paiseToINR(g.amountPaise)}</TableCell>
                    <TableCell>
                      {g.remainingCount}/{g.totalCount}
                    </TableCell>
                    <TableCell>{g.source}</TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {g.expiresAt
                        ? new Date(g.expiresAt).toLocaleString()
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
