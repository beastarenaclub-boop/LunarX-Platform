import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { Download } from "lucide-react";

const ALL = "__all";
const BASE = import.meta.env.VITE_API_URL || "/api";

interface AppLogEntry {
  id: string;
  level: string;
  kind: string;
  message: string;
  actorId: string | null;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}

export default function LogsPage() {
  const [kind, setKind] = useState<string>(ALL);
  const [level, setLevel] = useState<string>(ALL);
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = new URLSearchParams();
  if (kind !== ALL) params.set("kind", kind);
  if (level !== ALL) params.set("level", level);
  if (actorId) params.set("actorId", actorId);
  if (from) params.set("from", new Date(from).toISOString());
  if (to) params.set("to", new Date(to).toISOString());
  params.set("limit", "200");

  const { data, isLoading } = useQuery<AppLogEntry[]>({
    queryKey: ["admin-logs", kind, level, actorId, from, to],
    queryFn: async () => {
      const res = await fetch(`${BASE}/admin/logs?${params.toString()}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch logs");
      return res.json();
    },
  });

  const handleExport = () => {
    const csvParams = new URLSearchParams();
    if (kind !== ALL) csvParams.set("kind", kind);
    if (level !== ALL) csvParams.set("level", level);
    if (from) csvParams.set("from", new Date(from).toISOString());
    if (to) csvParams.set("to", new Date(to).toISOString());
    window.open(`${BASE}/admin/logs/csv?${csvParams.toString()}`, "_blank");
  };

  const levelBadge = (l: string) => {
    switch (l) {
      case "error":
        return <Badge variant="destructive">error</Badge>;
      case "warn":
        return <Badge className="bg-amber-500 text-white hover:bg-amber-600">warn</Badge>;
      default:
        return <Badge variant="secondary">info</Badge>;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Application Logs</h1>
          <p className="text-sm text-slate-500">
            Auth, payment, admin actions, and error logs
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Kind" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All kinds</SelectItem>
            <SelectItem value="auth">Auth</SelectItem>
            <SelectItem value="payment">Payment</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="fraud">Fraud</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Level" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All levels</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <Input
          className="w-56"
          placeholder="Actor ID"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
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
              <TableHead>Level</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  Loading...
                </TableCell>
              </TableRow>
            )}
            {data?.map((log) => (
              <TableRow key={log.id}>
                <TableCell className="whitespace-nowrap text-xs">
                  {fmtDate(log.createdAt)}
                </TableCell>
                <TableCell>{levelBadge(log.level)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{log.kind}</Badge>
                </TableCell>
                <TableCell className="max-w-md truncate text-sm">
                  {log.message}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {log.actorId ?? "\u2014"}
                </TableCell>
                <TableCell className="text-xs">{log.ip ?? "\u2014"}</TableCell>
              </TableRow>
            ))}
            {!isLoading && (data?.length ?? 0) === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500">
                  No logs found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
