import { useState } from "react";
import {
  useAdminListReconciliation,
  useAdminRunReconciliation,
  useAdminResolveReconciliation,
  getAdminListReconciliationQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
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
import { paiseToINR, fmtDate } from "@/lib/format";
import { toast } from "@/hooks/use-toast";

function statusColor(status: string) {
  switch (status) {
    case "matched":
      return "default";
    case "mismatch_amount":
    case "status_mismatch":
      return "destructive";
    case "missing_in_gateway":
    case "missing_in_ledger":
      return "secondary";
    default:
      return "secondary";
  }
}

export default function ReconciliationPage() {
  const [status, setStatus] = useState<string>("all");
  const [runDate, setRunDate] = useState("");
  const qc = useQueryClient();

  const params =
    status === "all" ? undefined : { status: status as never };
  const { data, isLoading } = useAdminListReconciliation(params);

  const runRecon = useAdminRunReconciliation({
    mutation: {
      onSuccess: (result) => {
        toast({
          title: "Reconciliation complete",
          description: `${result.total} entries checked, ${result.mismatches} mismatches found`,
        });
        void qc.invalidateQueries({
          queryKey: getAdminListReconciliationQueryKey(params),
        });
      },
      onError: () => {
        toast({ title: "Reconciliation failed", variant: "destructive" });
      },
    },
  });

  const resolve = useAdminResolveReconciliation({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminListReconciliationQueryKey(params),
        });
      },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Reconciliation</h1>
        <p className="text-sm text-slate-500">
          Compare gateway transactions against the ledger
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Run Reconciliation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs text-slate-500">
                Date (defaults to yesterday)
              </label>
              <Input
                type="date"
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className="w-48"
                data-testid="input-recon-date"
              />
            </div>
            <Button
              disabled={runRecon.isPending}
              data-testid="btn-run-recon"
              onClick={() =>
                runRecon.mutate({
                  data: runDate ? { date: runDate } : {},
                })
              }
            >
              {runRecon.isPending ? "Running..." : "Run"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-56" data-testid="select-recon-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All</SelectItem>
          <SelectItem value="matched">Matched</SelectItem>
          <SelectItem value="mismatch_amount">Amount Mismatch</SelectItem>
          <SelectItem value="missing_in_gateway">Missing in Gateway</SelectItem>
          <SelectItem value="missing_in_ledger">Missing in Ledger</SelectItem>
          <SelectItem value="status_mismatch">Status Mismatch</SelectItem>
        </SelectContent>
      </Select>

      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run Date</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Gateway Order</TableHead>
              <TableHead>Gateway Amt</TableHead>
              <TableHead>Ledger Amt</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Resolved</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  Loading...
                </TableCell>
              </TableRow>
            )}
            {data?.map((r) => (
              <TableRow key={r.id} data-testid={`row-recon-${r.id}`}>
                <TableCell>{fmtDate(r.runDate)}</TableCell>
                <TableCell className="capitalize">{r.direction}</TableCell>
                <TableCell className="font-mono text-xs">
                  {r.gatewayOrderId ?? "—"}
                </TableCell>
                <TableCell>
                  {r.gatewayAmount ? paiseToINR(r.gatewayAmount) : "—"}
                </TableCell>
                <TableCell>
                  {r.ledgerAmount ? paiseToINR(r.ledgerAmount) : "—"}
                </TableCell>
                <TableCell>
                  <Badge variant={statusColor(r.status) as never}>
                    {r.status.replace(/_/g, " ")}
                  </Badge>
                </TableCell>
                <TableCell>
                  {r.resolvedAt ? (
                    <span className="text-xs text-green-600">
                      {fmtDate(r.resolvedAt)}
                    </span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  {!r.resolvedAt && r.status !== "matched" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={resolve.isPending}
                      data-testid={`btn-resolve-${r.id}`}
                      onClick={() => resolve.mutate({ id: r.id })}
                    >
                      Resolve
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-slate-500">
                  No reconciliation entries
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
