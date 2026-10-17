import { useState } from "react";
import { useAdminListAudit } from "@workspace/api-client-react";
import type { AuditLogEntry } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fmtDate } from "@/lib/format";
import { Download, Eye } from "lucide-react";

const BASE = import.meta.env.VITE_API_URL || "/api";

export default function AuditPage() {
  const [actorId, setActorId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [detailEntry, setDetailEntry] = useState<AuditLogEntry | null>(null);

  const { data, isLoading } = useAdminListAudit({
    actorId: actorId || undefined,
    targetId: targetId || undefined,
    action: action || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(to).toISOString() : undefined,
    limit: 200,
  });

  const handleExport = () => {
    const params = new URLSearchParams();
    if (actorId) params.set("actorId", actorId);
    if (targetId) params.set("targetId", targetId);
    if (action) params.set("action", action);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    window.open(`${BASE}/admin/audit/csv?${params.toString()}`, "_blank");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Audit log</h1>
          <p className="text-sm text-slate-500">
            All operator and platform actions
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Input
          className="w-56"
          placeholder="Actor ID"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
          data-testid="input-actor"
        />
        <Input
          className="w-56"
          placeholder="Target ID"
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          data-testid="input-target"
        />
        <Input
          className="w-56"
          placeholder="Action (e.g. wallet.adjust)"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          data-testid="input-action"
        />
        <Input
          className="w-44"
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          title="From"
        />
        <Input
          className="w-44"
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          title="To"
        />
      </div>
      <div className="border rounded bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>IP</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  Loading\u2026
                </TableCell>
              </TableRow>
            )}
            {data?.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmtDate(a.createdAt)}
                </TableCell>
                <TableCell>{a.action}</TableCell>
                <TableCell className="font-mono text-xs">
                  {a.actorId ?? "\u2014"}
                  {a.actorRole ? ` (${a.actorRole})` : ""}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {a.targetType
                    ? `${a.targetType}:${a.targetId ?? "\u2014"}`
                    : "\u2014"}
                </TableCell>
                <TableCell>{a.ip ?? "\u2014"}</TableCell>
                <TableCell>
                  {(a.before !== undefined || a.after !== undefined) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setDetailEntry(a)
                      }
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  No entries
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={!!detailEntry}
        onOpenChange={() => setDetailEntry(null)}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Audit Entry Detail</DialogTitle>
          </DialogHeader>
          {detailEntry && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-medium text-slate-500">Action</p>
                  <p>{String(detailEntry.action)}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">When</p>
                  <p>{fmtDate(String(detailEntry.createdAt))}</p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Actor</p>
                  <p className="font-mono text-xs">
                    {String(detailEntry.actorId ?? "\u2014")}
                    {detailEntry.actorRole
                      ? ` (${String(detailEntry.actorRole)})`
                      : ""}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Target</p>
                  <p className="font-mono text-xs">
                    {detailEntry.targetType
                      ? `${String(detailEntry.targetType)}:${String(detailEntry.targetId ?? "\u2014")}`
                      : "\u2014"}
                  </p>
                </div>
              </div>
              {detailEntry.before != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">
                    Before
                  </p>
                  <pre className="bg-slate-100 rounded p-3 text-xs overflow-auto max-h-40">
                    {JSON.stringify(detailEntry.before, null, 2)}
                  </pre>
                </div>
              )}
              {detailEntry.after != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 mb-1">
                    After
                  </p>
                  <pre className="bg-slate-100 rounded p-3 text-xs overflow-auto max-h-40">
                    {JSON.stringify(detailEntry.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
