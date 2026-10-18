import { useState } from "react";
import {
  useAdminDecideDeposit,
  getAdminListDepositsQueryKey,
  useAdminListUpiAccounts,
  useAdminCreateUpiAccount,
  useAdminUpdateUpiAccount,
  useAdminDeleteUpiAccount,
  getAdminListUpiAccountsQueryKey,
  useAdminGetDepositSettings,
  useAdminUpdateDepositSettings,
  getAdminGetDepositSettingsQueryKey,
  TransactionFilters,TransactionPagination,useTransactionFilters,customFetch,type TransactionPageInfo,type PaymentRequest,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import type {
  AdminListDepositsParams,
  AdminListDepositsStatus,
  AdminListDepositsMethod,
} from "@workspace/api-client-react";
import { useQuery,useQueryClient } from "@tanstack/react-query";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { paiseToINR, fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

export default function DepositsPage() {
  const [status, setStatus] = useState<string>("pending");
  const [method, setMethod] = useState<string>("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const { user } = useAuth();
  const canDecide = hasRole(user, "admin", "super_admin");
  const filters=useTransactionFilters();

  const params: AdminListDepositsParams & Record<string,unknown> = {...filters.query,limit:50,offset:filters.offset};
  if (status !== "all") params.status = status as AdminListDepositsStatus;
  if (method !== "all") params.method = method as AdminListDepositsMethod;

  const { data, isLoading,error } = useQuery({queryKey:getAdminListDepositsQueryKey(params),queryFn:({signal})=>customFetch<TransactionPageInfo&{deposits:PaymentRequest[]}>(`/api/admin/deposits?${new URLSearchParams(Object.entries(params).map(([key,value])=>[key,String(value)]))}`,{signal})});
  const decide = useAdminDecideDeposit({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminListDepositsQueryKey(params),
        });
      },
    },
  });

  const deposits = data?.deposits ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Deposits</h1>
        <p className="text-sm text-slate-500">
          Manual UPI is the only deposit method. Manage UPI QR codes below.
        </p>
      </div>

      {canDecide && <DepositMethodsSection />}
      {canDecide && <DepositLimitsSection />}
      {canDecide && <UpiAccountsSection />}

      <TransactionFilters state={filters} direction={false}/>
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={value=>{setStatus(value);filters.setOffset(0);}}>
          <SelectTrigger className="w-48" data-testid="select-dep-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="gateway_pending">Gateway Pending</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={method} onValueChange={value=>{setMethod(value);filters.setOffset(0);}}>
          <SelectTrigger className="w-48" data-testid="select-dep-method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Methods</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
            <SelectItem value="auto">Auto</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error&&<p role="alert" className="text-red-600">Could not load deposits. Please retry.</p>}
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Pack</TableHead>
              <TableHead>UTR / Ref</TableHead>
              <TableHead>Status</TableHead>
              {canDecide && status === "pending" && (
                <TableHead>Actions</TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-slate-500"
                >
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {deposits.map((d) => (
              <TableRow
                key={d.id}
                data-testid={`row-dep-${d.id}`}
              >
                <TableCell>{fmtDate(d.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">
                  {d.userId}
                </TableCell>
                <TableCell>{paiseToINR(d.amount)}</TableCell>
                <TableCell>
                  <Badge
                    variant={
                      d.method === "auto" ? "secondary" : "outline"
                    }
                  >
                    {d.method}
                  </Badge>
                </TableCell>
                {/* Legacy deposits predate coin packs and show a dash. */}
                <TableCell className="text-xs">
                  {d.packageSku ? (
                    <>
                      <div className="font-mono">{d.packageSku}</div>
                      {d.coinQuantity != null && (
                        <div className="text-slate-500">
                          {d.coinQuantity.toLocaleString("en-IN")} coins
                        </div>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {d.upiRef || "—"}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      d.status === "approved"
                        ? "default"
                        : d.status === "rejected"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {d.status}
                  </Badge>
                </TableCell>
                {canDecide && status === "pending" && (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Reason"
                        value={reasons[d.id] ?? ""}
                        onChange={(e) =>
                          setReasons((r) => ({
                            ...r,
                            [d.id]: e.target.value,
                          }))
                        }
                        className="w-40"
                        data-testid={`input-dep-reason-${d.id}`}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={decide.isPending}
                        data-testid={`button-dep-approve-${d.id}`}
                        onClick={() =>
                          decide.mutate({
                            id: d.id,
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
                        data-testid={`button-dep-reject-${d.id}`}
                        onClick={() =>
                          decide.mutate({
                            id: d.id,
                            data: {
                              decision: "reject",
                              reason:
                                reasons[d.id] ||
                                "Rejected by operator",
                            },
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && !error && deposits.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-slate-500"
                >
                  No deposits
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <TransactionPagination state={filters} data={data} signed={false} loading={isLoading}/>
    </div>
  );
}

function DepositMethodsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useAdminGetDepositSettings();

  const updateMut = useAdminUpdateDepositSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminGetDepositSettingsQueryKey(),
        });
        toast({ title: "Deposit methods updated" });
      },
      onError: (err) =>
        toast({
          title: "Failed to update",
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    },
  });

  function toggle(field: "manualEnabled" | "autoEnabled", next: boolean) {
    if (!settings) return;
    const otherOn =
      field === "manualEnabled" ? settings.autoEnabled : settings.manualEnabled;
    if (!next && !otherOn) {
      toast({
        title: "At least one method must be enabled",
        variant: "destructive",
      });
      return;
    }
    updateMut.mutate({ data: { [field]: next } });
  }

  const manualOn = settings?.manualEnabled ?? true;
  const autoOn = settings?.autoEnabled ?? false;
  const manualLast = manualOn && !autoOn;
  const autoLast = autoOn && !manualOn;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Deposit Methods</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <div className="space-y-3" data-testid="deposit-methods">
            <div className="flex items-center justify-between gap-4 border rounded p-3">
              <div>
                <div className="font-medium">Manual UPI (VPA QR)</div>
                <div className="text-xs text-slate-500">
                  Players scan an admin VPA QR and submit a UTR for review.
                </div>
                {manualLast && (
                  <div className="text-xs text-amber-600 mt-1">
                    At least one method must be enabled.
                  </div>
                )}
              </div>
              <Switch
                checked={manualOn}
                disabled={updateMut.isPending || manualLast}
                onCheckedChange={(v) => toggle("manualEnabled", v)}
                data-testid="switch-manual-enabled"
              />
            </div>
            <div className="flex items-center justify-between gap-4 border rounded p-3">
              <div>
                <div className="font-medium">Auto Gateway</div>
                <div className="text-xs text-slate-500">
                  Players pay through the configured payment gateway and the
                  webhook auto-credits their wallet.
                </div>
                {autoLast && (
                  <div className="text-xs text-amber-600 mt-1">
                    At least one method must be enabled.
                  </div>
                )}
              </div>
              <Switch
                checked={autoOn}
                disabled={updateMut.isPending || autoLast}
                onCheckedChange={(v) => toggle("autoEnabled", v)}
                data-testid="switch-auto-enabled"
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DepositLimitsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: settings, isLoading } = useAdminGetDepositSettings();
  const [minRupees, setMinRupees] = useState("");
  const [maxRupees, setMaxRupees] = useState("");
  const [hydrated, setHydrated] = useState(false);

  if (settings && !hydrated) {
    setMinRupees((Number(settings.minAmountPaise) / 100).toString());
    setMaxRupees((Number(settings.maxAmountPaise) / 100).toString());
    setHydrated(true);
  }

  const updateMut = useAdminUpdateDepositSettings({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminGetDepositSettingsQueryKey(),
        });
        toast({ title: "Deposit limits updated" });
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
    updateMut.mutate({
      data: {
        minAmountPaise: Math.round(minR * 100).toString(),
        maxAmountPaise: Math.round(maxR * 100).toString(),
      },
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Deposit Limits</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : (
          <form
            onSubmit={handleSave}
            className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
            data-testid="form-deposit-limits"
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
                data-testid="input-deposit-min"
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
                data-testid="input-deposit-max"
              />
            </div>
            <Button
              type="submit"
              disabled={updateMut.isPending}
              data-testid="btn-deposit-limits-save"
            >
              {updateMut.isPending ? "Saving…" : "Save limits"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function UpiAccountsSection() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: accounts, isLoading } = useAdminListUpiAccounts();

  const [label, setLabel] = useState("");
  const [upiId, setUpiId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: getAdminListUpiAccountsQueryKey() });

  const createMut = useAdminCreateUpiAccount({
    mutation: { onSuccess: () => void invalidate() },
  });
  const updateMut = useAdminUpdateUpiAccount({
    mutation: { onSuccess: () => void invalidate() },
  });
  const deleteMut = useAdminDeleteUpiAccount({
    mutation: { onSuccess: () => void invalidate() },
  });

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !upiId.trim()) {
      toast({
        title: "Missing fields",
        description: "Label and UPI ID are required",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      await createMut.mutateAsync({
        data: {
          label: label.trim(),
          upiId: upiId.trim(),
          active: true,
          sortOrder: (accounts?.length ?? 0) * 10,
        },
      });
      setLabel("");
      setUpiId("");
      toast({ title: "UPI account added" });
    } catch (err) {
      toast({
        title: "Failed to add",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">UPI Accounts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          onSubmit={handleAdd}
          className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end"
          data-testid="form-upi-create"
        >
          <div>
            <label className="text-xs text-slate-500">Label</label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Primary UPI"
              data-testid="input-upi-label"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500">UPI ID</label>
            <Input
              value={upiId}
              onChange={(e) => setUpiId(e.target.value)}
              placeholder="merchant@bank"
              data-testid="input-upi-id"
            />
          </div>
          <Button
            type="submit"
            disabled={submitting}
            data-testid="btn-upi-create"
          >
            {submitting ? "Saving…" : "Add UPI account"}
          </Button>
        </form>
        <p className="text-xs text-slate-500">
          The QR code is generated automatically from the UPI ID on the player
          wallet — no image upload is needed.
        </p>

        {isLoading ? (
          <div className="text-sm text-slate-500">Loading…</div>
        ) : !accounts || accounts.length === 0 ? (
          <div className="text-sm text-slate-500">
            No UPI accounts configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {accounts.map((a) => (
              <div
                key={a.id}
                className="border rounded p-3 flex gap-3"
                data-testid={`row-upi-${a.id}`}
              >
                {a.qrUrl ? (
                  <img
                    src={a.qrUrl}
                    alt={a.label}
                    className="w-24 h-24 object-contain border bg-white rounded"
                  />
                ) : (
                  <div className="w-24 h-24 flex items-center justify-center text-[10px] text-slate-400 border bg-slate-50 rounded text-center px-1">
                    Auto QR
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium">{a.label}</div>
                  <div className="text-xs text-slate-500 font-mono break-all">
                    {a.upiId}
                  </div>
                  <div className="mt-1 text-xs">
                    <Badge variant={a.active ? "default" : "secondary"}>
                      {a.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`btn-upi-toggle-${a.id}`}
                      onClick={() =>
                        updateMut.mutate({
                          id: a.id,
                          data: { active: !a.active },
                        })
                      }
                    >
                      {a.active ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      data-testid={`btn-upi-delete-${a.id}`}
                      onClick={() => {
                        if (
                          window.confirm(`Delete UPI account "${a.label}"?`)
                        ) {
                          deleteMut.mutate({ id: a.id });
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
