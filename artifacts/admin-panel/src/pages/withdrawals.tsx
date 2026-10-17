import { useEffect, useRef, useState } from "react";
import {
  useAdminListWithdrawals,
  useAdminDecideWithdrawal,
  useAdminMarkWithdrawalPaid,
  getAdminListWithdrawalsQueryKey,
  useAdminGetWithdrawSettings,
  useAdminUpdateWithdrawSettings,
  getAdminGetWithdrawSettingsQueryKey,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { paiseToINR, fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

export default function WithdrawalsPage() {
  const [status, setStatus] = useState<string>("pending");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [utrs, setUtrs] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDecide = hasRole(user, "admin", "super_admin");
  const params =
    status === "all" ? undefined : { status: status as never };
  const { data, isLoading } = useAdminListWithdrawals(params);
  const { toast } = useToast();
  const [highlighted, setHighlighted] = useState<Set<string>>(new Set());
  const highlightTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  useEffect(() => {
    return () => {
      highlightTimers.current.forEach((t) => clearTimeout(t));
      highlightTimers.current.clear();
    };
  }, []);

  type WdEvent =
    | { type: "created"; id: string; userId: string; amount: string }
    | { type: "decided"; id: string; userId: string; amount: string; status: string };

  useRealtimeTopic<WdEvent>("withdrawals:admin", (ev) => {
    void qc.invalidateQueries({
      queryKey: getAdminListWithdrawalsQueryKey(params),
    });
    if (!ev) return;
    if (ev.type === "created") {
      // Toast the operator and briefly highlight the row once it appears.
      toast({
        title: "New withdrawal request",
        description: `User ${ev.userId.slice(-6)} • ${paiseToINR(ev.amount)}`,
      });
      setHighlighted((prev) => {
        const next = new Set(prev);
        next.add(ev.id);
        return next;
      });
      const existing = highlightTimers.current.get(ev.id);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        setHighlighted((prev) => {
          const next = new Set(prev);
          next.delete(ev.id);
          return next;
        });
        highlightTimers.current.delete(ev.id);
      }, 6000);
      highlightTimers.current.set(ev.id, timer);
    }
  });
  useRealtimeResync(() => {
    void qc.invalidateQueries({
      queryKey: getAdminListWithdrawalsQueryKey(params),
    });
  });
  const decide = useAdminDecideWithdrawal({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminListWithdrawalsQueryKey(params),
        });
      },
    },
  });
  const markPaid = useAdminMarkWithdrawalPaid({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminListWithdrawalsQueryKey(params),
        });
      },
    },
  });

  const showActions = canDecide && (status === "pending" || status === "approved");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Withdrawals</h1>
        <p className="text-sm text-slate-500">Approve, reject, or settle payouts</p>
      </div>
      {canDecide && <WithdrawLimitsSection />}
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-48" data-testid="select-wd-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requested</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Destination</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>UTR</TableHead>
              {showActions && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data?.map((w) => (
              <TableRow
                key={w.id}
                data-testid={`row-wd-${w.id}`}
                className={
                  highlighted.has(w.id)
                    ? "bg-amber-100 transition-colors duration-700 animate-pulse"
                    : "transition-colors duration-700"
                }
              >
                <TableCell>{fmtDate(w.requestedAt)}</TableCell>
                <TableCell className="font-mono text-xs">{w.userId}</TableCell>
                <TableCell>{paiseToINR(w.amount)}</TableCell>
                <TableCell>{w.method}</TableCell>
                <TableCell className="font-mono text-xs">{w.destination}</TableCell>
                <TableCell>
                  {(() => {
                    const isAgent = w.kind === "agent_commission";
                    return (
                      <Badge variant={isAgent ? "secondary" : "outline"}>
                        {isAgent ? "Agent" : "Player"}
                      </Badge>
                    );
                  })()}
                </TableCell>
                <TableCell>
                  <Badge>{w.status}</Badge>
                  {w.manualSettlement && (
                    <span className="ml-1 text-[10px] text-slate-400">manual</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {w.utr ?? "—"}
                </TableCell>
                {showActions && (
                  <TableCell>
                    {w.status === "pending" && (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="Reason"
                          value={reasons[w.id] ?? ""}
                          onChange={(e) =>
                            setReasons((r) => ({ ...r, [w.id]: e.target.value }))
                          }
                          className="w-40"
                          data-testid={`input-wd-reason-${w.id}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={decide.isPending}
                          data-testid={`button-wd-approve-${w.id}`}
                          onClick={() =>
                            decide.mutate({
                              id: w.id,
                              data: { decision: "approve" },
                            })
                          }
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={decide.isPending}
                          data-testid={`button-wd-reject-${w.id}`}
                          onClick={() =>
                            decide.mutate({
                              id: w.id,
                              data: {
                                decision: "reject",
                                reason: reasons[w.id] || "Rejected by operator",
                              },
                            })
                          }
                        >
                          Reject
                        </Button>
                      </div>
                    )}
                    {w.status === "approved" && (
                      <div className="flex items-center gap-2">
                        <Input
                          placeholder="UTR reference"
                          value={utrs[w.id] ?? ""}
                          onChange={(e) =>
                            setUtrs((r) => ({ ...r, [w.id]: e.target.value }))
                          }
                          className="w-40"
                          data-testid={`input-wd-utr-${w.id}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={markPaid.isPending || (utrs[w.id]?.length ?? 0) < 4}
                          data-testid={`button-wd-markpaid-${w.id}`}
                          onClick={() =>
                            markPaid.mutate({
                              id: w.id,
                              data: { utr: utrs[w.id]! },
                            })
                          }
                        >
                          Mark Paid
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  No withdrawals
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function WithdrawLimitsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useAdminGetWithdrawSettings();
  const [minRupees, setMinRupees] = useState("");
  const [maxRupees, setMaxRupees] = useState("");
  const [perUserDailyRupees, setPerUserDailyRupees] = useState("");
  const [platformDailyRupees, setPlatformDailyRupees] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (settings && !hydrated) {
      setMinRupees((Number(settings.minAmountPaise) / 100).toString());
      setMaxRupees((Number(settings.maxAmountPaise) / 100).toString());
      setPerUserDailyRupees(
        (Number(settings.dailyPerUserPaise) / 100).toString(),
      );
      setPlatformDailyRupees(
        (Number(settings.dailyPlatformPaise) / 100).toString(),
      );
      setHydrated(true);
    }
  }, [settings, hydrated]);

  const updateMut = useAdminUpdateWithdrawSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminGetWithdrawSettingsQueryKey(),
        });
        toast({ title: "Withdrawal limits updated" });
      },
      onError: (err) =>
        toast({
          title: "Failed to update",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const minR = Number(minRupees);
    const maxR = Number(maxRupees);
    const perUserR = Number(perUserDailyRupees);
    const platformR = Number(platformDailyRupees);
    if (!Number.isFinite(minR) || minR <= 0) {
      toast({
        title: "Invalid minimum",
        description: "Minimum must be greater than zero",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(maxR) || maxR <= 0) {
      toast({
        title: "Invalid maximum",
        description: "Maximum must be greater than zero",
        variant: "destructive",
      });
      return;
    }
    if (minR > maxR) {
      toast({
        title: "Invalid range",
        description: "Minimum cannot exceed maximum",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(perUserR) || perUserR < 0) {
      toast({
        title: "Invalid per-user daily cap",
        description: "Use 0 to disable, or a positive amount",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(platformR) || platformR < 0) {
      toast({
        title: "Invalid platform daily cap",
        description: "Use 0 to disable, or a positive amount",
        variant: "destructive",
      });
      return;
    }
    if (perUserR > 0 && perUserR < maxR) {
      toast({
        title: "Per-user daily cap too low",
        description:
          "Per-user daily cap cannot be less than the per-request maximum",
        variant: "destructive",
      });
      return;
    }
    if (platformR > 0 && perUserR > 0 && platformR < perUserR) {
      toast({
        title: "Platform daily cap too low",
        description:
          "Platform daily cap cannot be less than the per-user daily cap",
        variant: "destructive",
      });
      return;
    }
    updateMut.mutate({
      data: {
        minAmountPaise: Math.round(minR * 100).toString(),
        maxAmountPaise: Math.round(maxR * 100).toString(),
        dailyPerUserPaise: Math.round(perUserR * 100).toString(),
        dailyPlatformPaise: Math.round(platformR * 100).toString(),
      },
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Withdrawal Limits</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <form
            onSubmit={handleSave}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
            data-testid="form-withdraw-limits"
          >
            <div>
              <label className="text-xs text-slate-500">
                Minimum amount (₹)
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                value={minRupees}
                onChange={(e) => setMinRupees(e.target.value)}
                data-testid="input-withdraw-min"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Maximum amount (₹)
              </label>
              <Input
                type="number"
                min="1"
                step="1"
                value={maxRupees}
                onChange={(e) => setMaxRupees(e.target.value)}
                data-testid="input-withdraw-max"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Per-user daily cap (₹, 0 = off)
              </label>
              <Input
                type="number"
                min="0"
                step="1"
                value={perUserDailyRupees}
                onChange={(e) => setPerUserDailyRupees(e.target.value)}
                data-testid="input-withdraw-daily-per-user"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500">
                Platform daily cap (₹, 0 = off)
              </label>
              <Input
                type="number"
                min="0"
                step="1"
                value={platformDailyRupees}
                onChange={(e) => setPlatformDailyRupees(e.target.value)}
                data-testid="input-withdraw-daily-platform"
              />
            </div>
            <Button
              type="submit"
              disabled={updateMut.isPending}
              data-testid="btn-withdraw-limits-save"
            >
              {updateMut.isPending ? "Saving…" : "Save limits"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
