import { useState } from "react";
import { Link, useRoute } from "wouter";
import {
  useAdminGetUser,
  useAdminSetUserStatus,
  useAdminFreezeWallet,
  useAdminAdjustWallet,
  useAdminGetUserAudit,
  getAdminGetUserQueryKey,
  getAdminGetUserAuditQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { paiseToINR, fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

const GAME_SCOPES = ["lunar"] as const;
type GameScope = (typeof GAME_SCOPES)[number];
const GAME_LABELS: Record<GameScope, string> = { lunar: "Shared wallet" };

export default function UserDetail() {
  const [, params] = useRoute("/users/:id");
  const userId = params?.id ?? "";
  const qc = useQueryClient();
  const { user: actor } = useAuth();
  const canWrite = hasRole(actor, "admin", "super_admin");

  const { data, isLoading, error } = useAdminGetUser(userId);
  const audit = useAdminGetUserAudit(userId);

  const setStatus = useAdminSetUserStatus({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAdminGetUserQueryKey(userId) });
        void qc.invalidateQueries({
          queryKey: getAdminGetUserAuditQueryKey(userId),
        });
      },
    },
  });
  const freeze = useAdminFreezeWallet({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAdminGetUserQueryKey(userId) });
      },
    },
  });
  const adjust = useAdminAdjustWallet({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAdminGetUserQueryKey(userId) });
      },
    },
  });

  const [adjAmount, setAdjAmount] = useState("");
  const [adjMemo, setAdjMemo] = useState("");
  const [adjGame, setAdjGame] = useState<GameScope>("lunar");
  const [reason, setReason] = useState("");

  if (isLoading) return <p className="text-slate-500 text-sm">Loading…</p>;
  if (error)
    return (
      <p className="text-red-600 text-sm" data-testid="text-error">
        Failed to load user
      </p>
    );
  if (!data) return null;

  const { user, kyc, walletStatus, wallet } = data;
  const gameBalances = data.balances?.balances ?? null;
  const recentBets = data.recentBets ?? [];
  const recentLedger = data.recentLedger ?? [];
  const flags = data.flags ?? [];
  const isFrozen = walletStatus?.status === "frozen";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/users" className="text-sm text-slate-500 hover:underline">
            ← Back to users
          </Link>
          <h1 className="text-2xl font-semibold mt-1" data-testid="text-user-email">
            {user.email}
          </h1>
          <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
            <span className="font-mono text-xs">{user.id}</span>
            <Badge variant="secondary">{user.role}</Badge>
            <Badge variant={user.status === "active" ? "default" : "destructive"}>
              {user.status}
            </Badge>
            {isFrozen && <Badge variant="destructive">wallet frozen</Badge>}
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Shared wallet</CardTitle>
          </CardHeader>
          <CardContent>
            {gameBalances ? (
              <div className="space-y-1">
                {GAME_SCOPES.map((g) => (
                  <div
                    key={g}
                    className="flex items-center justify-between text-sm"
                    data-testid={`row-balance-${g}`}
                  >
                    <span className="text-slate-500">{GAME_LABELS[g]}</span>
                    <span className="font-semibold" data-testid={`text-balance-${g}`}>
                      {paiseToINR(gameBalances[g])}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-2xl font-semibold" data-testid="text-balance">
                {wallet ? paiseToINR(wallet.balance) : "—"}
              </div>
            )}
            <div className="text-xs text-slate-500 mt-2">
              {wallet?.currency ?? "INR"} · one balance across every game
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">KYC</CardTitle>
          </CardHeader>
          <CardContent>
            <Badge>{kyc?.status ?? "not submitted"}</Badge>
            {kyc?.fullName && (
              <div className="text-xs text-slate-500 mt-1">{kyc.fullName}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Open flags</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">
              {flags.filter((f) => !f.resolved).length}
            </div>
          </CardContent>
        </Card>
      </div>

      {canWrite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                variant={user.status === "suspended" ? "default" : "outline"}
                size="sm"
                disabled={setStatus.isPending}
                data-testid="button-suspend"
                onClick={() =>
                  setStatus.mutate({
                    userId,
                    data: {
                      status:
                        user.status === "suspended" ? "active" : "suspended",
                      reason: reason || undefined,
                    },
                  })
                }
              >
                {user.status === "suspended" ? "Reactivate user" : "Suspend user"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={setStatus.isPending || user.status === "banned"}
                data-testid="button-ban"
                onClick={() =>
                  setStatus.mutate({
                    userId,
                    data: { status: "banned", reason: reason || undefined },
                  })
                }
              >
                Ban user
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={freeze.isPending}
                data-testid="button-freeze"
                onClick={() =>
                  freeze.mutate({
                    userId,
                    data: {
                      status: isFrozen ? "active" : "frozen",
                      reason: reason || undefined,
                    },
                  })
                }
              >
                {isFrozen ? "Unfreeze wallet" : "Freeze wallet"}
              </Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Documented reason for the action"
                data-testid="input-reason"
              />
            </div>
            <div className="border-t pt-4">
              <h3 className="font-medium text-sm mb-2">Manual wallet adjustment</h3>
              <div className="flex gap-2 items-end flex-wrap">
                <div className="space-y-1 w-32">
                  <Label htmlFor="adjgame">Game</Label>
                  <select
                    id="adjgame"
                    value={adjGame}
                    onChange={(e) => setAdjGame(e.target.value as GameScope)}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                    data-testid="select-adjust-game"
                  >
                    {GAME_SCOPES.map((g) => (
                      <option key={g} value={g}>
                        {GAME_LABELS[g]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1 w-44">
                  <Label htmlFor="amt">Amount (paise)</Label>
                  <Input
                    id="amt"
                    value={adjAmount}
                    onChange={(e) => setAdjAmount(e.target.value)}
                    placeholder="e.g. 10000 or -2500"
                    data-testid="input-amount"
                  />
                </div>
                <div className="space-y-1 flex-1 min-w-[12rem]">
                  <Label htmlFor="memo">Memo</Label>
                  <Input
                    id="memo"
                    value={adjMemo}
                    onChange={(e) => setAdjMemo(e.target.value)}
                    placeholder="Reason / reference"
                    data-testid="input-memo"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={adjust.isPending || !adjAmount || !adjMemo}
                  data-testid="button-adjust"
                  onClick={() =>
                    adjust.mutate({
                      data: {
                        userId,
                        amount: adjAmount,
                        memo: adjMemo,
                        game: adjGame,
                        type: "adjustment",
                      },
                    })
                  }
                >
                  Post
                </Button>
              </div>
              {adjust.isError && (
                <p className="text-xs text-red-600 mt-1">
                  {(adjust.error as Error)?.message ?? "Failed"}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger" data-testid="tab-ledger">
            Recent ledger
          </TabsTrigger>
          <TabsTrigger value="bets" data-testid="tab-bets">
            Recent bets
          </TabsTrigger>
          <TabsTrigger value="flags" data-testid="tab-flags">
            Flags
          </TabsTrigger>
          <TabsTrigger value="audit" data-testid="tab-audit">
            Audit
          </TabsTrigger>
        </TabsList>
        <TabsContent value="ledger">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Balance after</TableHead>
                <TableHead>Memo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentLedger.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{fmtDate(e.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{e.type}</Badge>
                  </TableCell>
                  <TableCell>{paiseToINR(e.amount)}</TableCell>
                  <TableCell>{paiseToINR(e.balanceAfter)}</TableCell>
                  <TableCell>{e.memo ?? "—"}</TableCell>
                </TableRow>
              ))}
              {recentLedger.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    No transactions
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="bets">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Game</TableHead>
                <TableHead>Stake</TableHead>
                <TableHead>Payout</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentBets.map((b) => (
                <TableRow key={b.id}>
                  <TableCell>{fmtDate(b.placedAt)}</TableCell>
                  <TableCell>{b.gameCode}</TableCell>
                  <TableCell>{paiseToINR(b.stakeAmount)}</TableCell>
                  <TableCell>{paiseToINR(b.payoutAmount)}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{b.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {recentBets.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    No bets
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="flags">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Rule</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Resolved</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((f) => (
                <TableRow key={f.id}>
                  <TableCell>{fmtDate(f.createdAt)}</TableCell>
                  <TableCell>{f.rule}</TableCell>
                  <TableCell>
                    <Badge variant="destructive">{f.severity}</Badge>
                  </TableCell>
                  <TableCell>{f.resolved ? "Yes" : "No"}</TableCell>
                  <TableCell>{f.description ?? "—"}</TableCell>
                </TableRow>
              ))}
              {flags.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-slate-500">
                    No flags
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
        <TabsContent value="audit">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(audit.data ?? []).map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{fmtDate(a.createdAt)}</TableCell>
                  <TableCell>{a.action}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {a.actorId ?? "—"}
                  </TableCell>
                  <TableCell>{a.ip ?? "—"}</TableCell>
                </TableRow>
              ))}
              {(audit.data ?? []).length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    No audit entries
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TabsContent>
      </Tabs>
    </div>
  );
}
