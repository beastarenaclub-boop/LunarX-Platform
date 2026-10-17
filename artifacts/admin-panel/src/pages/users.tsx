import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getAdminListDemoCleanupHistoryQueryKey,
  getAdminListUsersQueryKey,
  useAdminCleanupDemoAccounts,
  useAdminListDemoCleanupHistory,
  useAdminListUsers,
} from "@workspace/api-client-react";

import { Input } from "@/components/ui/input";
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

const ALL = "__all";

export default function UsersPage() {
  const [q, setQ] = useState("");
  const [role, setRole] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);
  const [page, setPage] = useState(0);
  const [includeDemo, setIncludeDemo] = useState(false);
  const [cleanupHours, setCleanupHours] = useState("24");
  const [cleanupMessage, setCleanupMessage] = useState<string | null>(null);
  const limit = 25;

  const qc = useQueryClient();
  const { data, isLoading } = useAdminListUsers({
    q: q || undefined,
    role: role !== ALL ? (role as never) : undefined,
    status: status !== ALL ? (status as never) : undefined,
    includeDemo: includeDemo || undefined,
    limit,
    offset: page * limit,
  });

  const cleanupHistory = useAdminListDemoCleanupHistory({ limit: 10 });

  const cleanup = useAdminCleanupDemoAccounts({
    mutation: {
      onSuccess: (res) => {
        setCleanupMessage(
          `Removed ${res.deleted} demo account${res.deleted === 1 ? "" : "s"} (idle ≥ ${res.thresholdHours}h).`,
        );
        qc.invalidateQueries({
          queryKey: [getAdminListUsersQueryKey()[0]],
        });
        qc.invalidateQueries({
          queryKey: [getAdminListDemoCleanupHistoryQueryKey()[0]],
        });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Cleanup failed";
        setCleanupMessage(msg);
      },
    },
  });

  const onCleanup = () => {
    const n = parseInt(cleanupHours, 10);
    if (Number.isNaN(n) || n < 0 || n > 8760) {
      setCleanupMessage("Threshold must be between 0 and 8760 hours.");
      return;
    }
    const warning =
      n === 0
        ? "Delete ALL demo player accounts immediately?"
        : `Delete demo player accounts idle for at least ${n} hour${n === 1 ? "" : "s"}?`;
    if (!window.confirm(warning)) return;
    setCleanupMessage(null);
    cleanup.mutate({ data: { thresholdHours: n } });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-sm text-slate-500">Search and inspect player accounts</p>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <div className="w-72">
          <Input
            placeholder="Email, display name, or user ID"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
            data-testid="input-user-search"
          />
        </div>
        <Select
          value={role}
          onValueChange={(v) => {
            setRole(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40" data-testid="select-role">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All roles</SelectItem>
            <SelectItem value="player">Player</SelectItem>
            <SelectItem value="agent">Agent</SelectItem>
            <SelectItem value="support">Support</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="super_admin">Super admin</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40" data-testid="select-status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
            <SelectItem value="banned">Banned</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm text-slate-700 select-none">
          <input
            type="checkbox"
            checked={includeDemo}
            onChange={(e) => {
              setIncludeDemo(e.target.checked);
              setPage(0);
            }}
            data-testid="checkbox-include-demo"
          />
          Show demo accounts
        </label>
        {includeDemo && (
          <div className="flex items-end gap-2 ml-auto">
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Idle hours
              </label>
              <Input
                type="number"
                min={0}
                max={8760}
                className="w-24"
                value={cleanupHours}
                onChange={(e) => setCleanupHours(e.target.value)}
                data-testid="input-demo-cleanup-hours"
              />
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={onCleanup}
              disabled={cleanup.isPending}
              data-testid="button-demo-cleanup"
            >
              {cleanup.isPending ? "Cleaning…" : "Clean up demo accounts"}
            </Button>
          </div>
        )}
      </div>
      {includeDemo && cleanupMessage && (
        <div
          className="text-sm text-slate-700 bg-slate-100 border rounded px-3 py-2"
          data-testid="text-demo-cleanup-result"
        >
          {cleanupMessage}
        </div>
      )}
      <div
        className="border rounded bg-white"
        data-testid="panel-demo-cleanup-history"
      >
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Recent demo cleanups</h2>
              <p className="text-xs text-slate-500">
                Last 10 manual or scheduled runs.
              </p>
            </div>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Triggered by</TableHead>
                <TableHead>Threshold</TableHead>
                <TableHead className="text-right">Deleted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cleanupHistory.isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-slate-500">
                    Loading…
                  </TableCell>
                </TableRow>
              )}
              {!cleanupHistory.isLoading &&
                (cleanupHistory.data?.length ?? 0) === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-slate-500"
                    >
                      No cleanup runs yet
                    </TableCell>
                  </TableRow>
                )}
              {cleanupHistory.data?.map((h) => (
                <TableRow
                  key={h.id}
                  data-testid={`row-demo-cleanup-${h.id}`}
                >
                  <TableCell>{fmtDate(h.createdAt)}</TableCell>
                  <TableCell>
                    {h.actorEmail ? (
                      h.actorEmail
                    ) : (
                      <Badge variant="secondary">Scheduler</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {h.thresholdHours === 0
                      ? "All demo accounts"
                      : `≥ ${h.thresholdHours}h idle`}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {h.deleted}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Display</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  Loading…
                </TableCell>
              </TableRow>
            )}
            {data?.users.map((u) => (
              <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                <TableCell className="font-medium">{u.email}</TableCell>
                <TableCell>{u.displayName ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{u.role}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.status === "active" ? "default" : "destructive"}
                  >
                    {u.status}
                  </Badge>
                </TableCell>
                <TableCell>{fmtDate(u.createdAt)}</TableCell>
                <TableCell className="text-right">
                  <Link href={`/users/${u.id}`}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-open-${u.id}`}
                    >
                      Open
                    </Button>
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.users.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  No users found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between text-sm text-slate-600">
        <span data-testid="text-total">{data ? `${data.total} total` : ""}</span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!data || (page + 1) * limit >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
