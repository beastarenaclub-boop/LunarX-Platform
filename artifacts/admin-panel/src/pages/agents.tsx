import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Users, Pencil, Check, X, Trophy } from "lucide-react";

function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return customFetch<T>(url, { ...options, credentials: "include" });
}

function formatPaise(paise: string | number): string {
  const val = typeof paise === "string" ? parseInt(paise, 10) : paise;
  if (isNaN(val)) return "0.00";
  return (val / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type Agent = {
  id: string;
  userId: string;
  email: string;
  displayName: string | null;
  referralCode: string | null;
  commissionRate: number;
  upiId: string | null;
  status: string;
  userStatus: string;
  totalEarned: string;
  playerCount: number;
  createdAt: string;
};

function AgentsList() {
  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [sortBy, setSortBy] = useState("created");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [commissionRate, setCommissionRate] = useState("10");
  const [upiId, setUpiId] = useState("");
  const [createError, setCreateError] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-agents", sortBy],
    queryFn: () =>
      apiFetch<{ agents: Agent[]; total: number }>(
        `/api/admin/agents?limit=100&sortBy=${sortBy}`,
      ),
  });

  const createAgent = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/api/admin/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      setCreateOpen(false);
      setEmail("");
      setPassword("");
      setDisplayName("");
      setCommissionRate("10");
      setUpiId("");
      setCreateError("");
    },
    onError: (err: Error) => {
      setCreateError(err.message ?? "Failed to create agent");
    },
  });

  const updateAgent = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: Record<string, unknown>;
    }) =>
      apiFetch(`/api/admin/agents/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
      setEditingId(null);
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError("");
    createAgent.mutate({
      email,
      password,
      displayName: displayName || undefined,
      commissionRate: parseInt(commissionRate, 10),
      upiId: upiId || undefined,
    });
  };

  const startEdit = (agent: Agent) => {
    setEditingId(agent.id);
    setEditRate(agent.commissionRate.toString());
    setEditStatus(agent.status);
  };

  const saveEdit = (id: string) => {
    updateAgent.mutate({
      id,
      body: {
        commissionRate: parseInt(editRate, 10),
        status: editStatus,
      },
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          <h2 className="text-lg font-semibold">
            All Agents ({data?.total ?? 0})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created">Newest First</SelectItem>
              <SelectItem value="earnings">
                <span className="flex items-center gap-1">
                  <Trophy className="h-3 w-3" /> Top Earners
                </span>
              </SelectItem>
              <SelectItem value="players">Most Players</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" /> Create Agent
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Agent</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-3">
                {createError && (
                  <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                    {createError}
                  </div>
                )}
                <Input
                  placeholder="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  placeholder="Password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Input
                  placeholder="Display name (optional)"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">
                      Commission %
                    </label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={commissionRate}
                      onChange={(e) => setCommissionRate(e.target.value)}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">
                      UPI ID (optional)
                    </label>
                    <Input
                      placeholder="name@upi"
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                    />
                  </div>
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={createAgent.isPending}
                >
                  {createAgent.isPending ? "Creating..." : "Create Agent"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Referral Code</TableHead>
                <TableHead>Players</TableHead>
                <TableHead className="text-right">Total Earned</TableHead>
                <TableHead>Commission %</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : !data?.agents.length ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No agents yet
                  </TableCell>
                </TableRow>
              ) : (
                data.agents.map((a, idx) => (
                  <TableRow key={a.id}>
                    <TableCell className="text-muted-foreground text-sm">
                      {idx + 1}
                    </TableCell>
                    <TableCell className="font-medium">
                      {a.email}
                      {a.displayName && (
                        <span className="text-muted-foreground text-xs block">
                          {a.displayName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-sm">
                      {a.referralCode ?? "-"}
                    </TableCell>
                    <TableCell>{a.playerCount}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatPaise(a.totalEarned)}
                    </TableCell>
                    <TableCell>
                      {editingId === a.id ? (
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          step="1"
                          className="w-20 h-8"
                          value={editRate}
                          onChange={(e) => setEditRate(e.target.value)}
                        />
                      ) : (
                        `${a.commissionRate}%`
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === a.id ? (
                        <Select value={editStatus} onValueChange={setEditStatus}>
                          <SelectTrigger className="w-24 h-8">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="active">Active</SelectItem>
                            <SelectItem value="inactive">Inactive</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge
                          variant={
                            a.status === "active" ? "default" : "destructive"
                          }
                        >
                          {a.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === a.id ? (
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => saveEdit(a.id)}
                            disabled={updateAgent.isPending}
                          >
                            <Check className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(a)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ComputeCommissions() {
  const [date, setDate] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const compute = useMutation({
    mutationFn: (dateStr: string) =>
      apiFetch<{ date: string; commissionsCreated: number }>(
        "/api/admin/agents/compute-commissions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ date: dateStr || undefined }),
        },
      ),
    onSuccess: (data) => {
      setResult(
        `Computed ${data.commissionsCreated} commission entries for ${data.date}`,
      );
    },
    onError: (err: Error) => {
      setResult(`Error: ${err.message}`);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Compute Daily Commissions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3 items-end">
          <div>
            <label className="text-sm text-muted-foreground">
              Date (defaults to yesterday)
            </label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-44"
            />
          </div>
          <Button
            onClick={() => compute.mutate(date)}
            disabled={compute.isPending}
          >
            {compute.isPending ? "Computing..." : "Run Computation"}
          </Button>
        </div>
        {result && (
          <p className="text-sm mt-3 text-muted-foreground">{result}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function AgentsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Agent Management</h1>
        <p className="text-muted-foreground">
          Create agents, set commission rates, and view top performers.
          Agent payout requests appear in the Withdrawals queue.
        </p>
      </div>

      <ComputeCommissions />
      <AgentsList />
    </div>
  );
}
