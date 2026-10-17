import { useState } from "react";
import {
  useAdminListKyc,
  useAdminReviewKyc,
  getAdminListKycQueryKey,
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
import { fmtDate } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";

export default function KycPage() {
  const [status, setStatus] = useState<string>("pending");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const qc = useQueryClient();
  const { user } = useAuth();
  const canReview = hasRole(user, "admin", "super_admin");
  const params =
    status === "all" ? undefined : { status: status as never };
  const { data, isLoading } = useAdminListKyc(params);
  const review = useAdminReviewKyc({
    mutation: {
      onSuccess: () => {
        void qc.invalidateQueries({ queryKey: getAdminListKycQueryKey(params) });
      },
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">KYC submissions</h1>
        <p className="text-sm text-slate-500">Approve or reject pending verifications</p>
      </div>
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger className="w-48" data-testid="select-kyc-status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pending">Pending</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
          <SelectItem value="all">All</SelectItem>
        </SelectContent>
      </Select>
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submitted</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Document</TableHead>
              <TableHead>Status</TableHead>
              {canReview && status === "pending" && <TableHead>Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data?.map((k) => (
              <TableRow key={k.id} data-testid={`row-kyc-${k.id}`}>
                <TableCell>{fmtDate(k.submittedAt)}</TableCell>
                <TableCell>{k.fullName}</TableCell>
                <TableCell>
                  {k.documentType} · {k.documentNumber}
                </TableCell>
                <TableCell>
                  <Badge>{k.status}</Badge>
                </TableCell>
                {canReview && status === "pending" && (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Rejection reason"
                        value={reasons[k.id] ?? ""}
                        onChange={(e) =>
                          setReasons((r) => ({ ...r, [k.id]: e.target.value }))
                        }
                        className="w-48"
                        data-testid={`input-reason-${k.id}`}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={review.isPending}
                        data-testid={`button-approve-${k.id}`}
                        onClick={() =>
                          review.mutate({
                            id: k.id,
                            data: { decision: "approve" },
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={review.isPending}
                        data-testid={`button-reject-${k.id}`}
                        onClick={() =>
                          review.mutate({
                            id: k.id,
                            data: {
                              decision: "reject",
                              reason: reasons[k.id] || "Insufficient documentation",
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
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500">
                  No submissions
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
