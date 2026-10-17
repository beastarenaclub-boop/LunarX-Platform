import { useState } from "react";
import {
  useAdminListFraudFlags,
  useAdminResolveFraudFlag,
  getAdminListFraudFlagsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
import { fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

const ALL = "__all";

export default function FraudPage() {
  const [resolved, setResolved] = useState<string>("false");
  const [severity, setSeverity] = useState<string>(ALL);
  const qc = useQueryClient();
  const { user } = useAuth();
  const canResolve = hasRole(user, "admin", "super_admin");
  const params = {
    resolved: resolved === ALL ? undefined : resolved === "true",
    severity: severity !== ALL ? (severity as never) : undefined,
  };
  const { data, isLoading } = useAdminListFraudFlags(params);
  const resolve = useAdminResolveFraudFlag({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({
          queryKey: getAdminListFraudFlagsQueryKey(params),
        });
      },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Fraud flags</h1>
        <p className="text-sm text-slate-500">
          Review automated detections and operator-raised concerns
        </p>
      </div>
      <div className="flex gap-3">
        <Select value={resolved} onValueChange={setResolved}>
          <SelectTrigger className="w-44" data-testid="select-resolved">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Open</SelectItem>
            <SelectItem value="true">Resolved</SelectItem>
            <SelectItem value={ALL}>All</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-44" data-testid="select-severity">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any severity</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Detected</TableHead>
              <TableHead>User</TableHead>
              <TableHead>Rule</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Status</TableHead>
              {canResolve && <TableHead></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data?.map((f) => (
              <TableRow key={f.id} data-testid={`row-flag-${f.id}`}>
                <TableCell>{fmtDate(f.createdAt)}</TableCell>
                <TableCell className="font-mono text-xs">{f.userId}</TableCell>
                <TableCell>{f.rule}</TableCell>
                <TableCell>
                  <Badge variant="destructive">{f.severity}</Badge>
                </TableCell>
                <TableCell>{f.description ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={f.resolved ? "default" : "secondary"}>
                    {f.resolved ? "resolved" : "open"}
                  </Badge>
                </TableCell>
                {canResolve && (
                  <TableCell className="text-right">
                    {!f.resolved && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resolve.isPending}
                        data-testid={`button-resolve-${f.id}`}
                        onClick={() => resolve.mutate({ id: f.id })}
                      >
                        Resolve
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-slate-500">
                  No flags
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
