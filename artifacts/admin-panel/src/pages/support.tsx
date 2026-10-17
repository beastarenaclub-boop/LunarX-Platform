import { useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MessageSquare,
  ArrowLeft,
  User,
  Wallet,
  Clock,
  Send,
  UserCheck,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { fmtDate } from "@/lib/format";

type Ticket = {
  id: string;
  userId: string;
  category: string;
  subject: string;
  status: string;
  assigneeId: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketMessage = {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: string;
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
};

type TicketDetail = {
  ticket: Ticket;
  messages: TicketMessage[];
  context: {
    user: { id: string; email: string; displayName: string | null; status: string; role: string } | null;
    wallet: { id: string; currency: string } | null;
    recentWithdrawals: { id: string; amount: string; status: string; requestedAt: string }[];
  };
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800",
  awaiting_reply: "bg-yellow-100 text-yellow-800",
  resolved: "bg-green-100 text-green-800",
  closed: "bg-slate-100 text-slate-600",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  awaiting_reply: "Awaiting Reply",
  resolved: "Resolved",
  closed: "Closed",
};

export default function SupportPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (selectedId) {
    return <TicketDetailView id={selectedId} onBack={() => setSelectedId(null)} />;
  }
  return <TicketQueue onSelect={setSelectedId} />;
}

function TicketQueue({ onSelect }: { onSelect: (id: string) => void }) {
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const params = new URLSearchParams();
  if (statusFilter) params.set("status", statusFilter);
  if (categoryFilter) params.set("category", categoryFilter);

  const query = useQuery({
    queryKey: ["support-tickets", statusFilter, categoryFilter],
    queryFn: () =>
      customFetch<{ tickets: Ticket[]; total: number }>(
        `/api/tickets/queue?${params.toString()}`,
        { method: "GET", credentials: "include" },
      ),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Support Queue</h1>
        <p className="text-sm text-slate-500">
          Manage player support tickets
        </p>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Select value={statusFilter || "_all"} onValueChange={(v) => setStatusFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-[180px]" data-testid="filter-status">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="awaiting_reply">Awaiting Reply</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={categoryFilter || "_all"} onValueChange={(v) => setCategoryFilter(v === "_all" ? "" : v)}>
          <SelectTrigger className="w-[180px]" data-testid="filter-category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">All categories</SelectItem>
            <SelectItem value="deposit">Deposit</SelectItem>
            <SelectItem value="withdrawal">Withdrawal</SelectItem>
            <SelectItem value="kyc">KYC</SelectItem>
            <SelectItem value="game">Game</SelectItem>
            <SelectItem value="account">Account</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 font-medium">Subject</th>
                  <th className="text-left p-3 font-medium">Category</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">User</th>
                  <th className="text-left p-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => onSelect(t.id)}
                    data-testid={`ticket-row-${t.id}`}
                  >
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="font-medium truncate max-w-[300px]">
                          {t.subject}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 capitalize">{t.category}</td>
                    <td className="p-3">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] ?? ""}`}
                      >
                        {STATUS_LABELS[t.status] ?? t.status}
                      </span>
                    </td>
                    <td className="p-3 font-mono text-xs">{t.userId.slice(0, 8)}…</td>
                    <td className="p-3 text-slate-500">{fmtDate(t.updatedAt)}</td>
                  </tr>
                ))}
                {query.data?.tickets.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-slate-400">
                      No tickets found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      {query.data && (
        <p className="text-xs text-slate-500">
          {query.data.total} ticket(s) total
        </p>
      )}
    </div>
  );
}

function TicketDetailView({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const [reply, setReply] = useState("");

  const query = useQuery({
    queryKey: ["support-ticket", id],
    queryFn: () =>
      customFetch<TicketDetail>(`/api/tickets/queue/${id}`, {
        method: "GET",
        credentials: "include",
      }),
  });

  const sendReply = useMutation({
    mutationFn: () =>
      customFetch(`/api/tickets/queue/${id}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: reply }),
      }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["support-ticket", id] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      customFetch(`/api/tickets/queue/${id}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-ticket", id] });
      qc.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });

  const assignToMe = useMutation({
    mutationFn: () =>
      customFetch(`/api/tickets/queue/${id}/assign`, {
        method: "POST",
        credentials: "include",
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["support-ticket", id] });
    },
  });

  const detail = query.data;
  if (!detail) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400">
        {query.isLoading ? "Loading…" : "Ticket not found"}
      </div>
    );
  }

  const { ticket, messages, context } = detail;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} data-testid="btn-back">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to queue
      </Button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-lg">{ticket.subject}</CardTitle>
                  <p className="text-sm text-slate-500 mt-1">
                    #{ticket.id.slice(0, 8)} · {ticket.category} · {fmtDate(ticket.createdAt)}
                  </p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${STATUS_COLORS[ticket.status] ?? ""}`}
                >
                  {STATUS_LABELS[ticket.status] ?? ticket.status}
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {ticket.assigneeId !== me?.id && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => assignToMe.mutate()}
                    disabled={assignToMe.isPending}
                    data-testid="btn-assign"
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" /> Assign to me
                  </Button>
                )}
                {ticket.status !== "resolved" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => changeStatus.mutate("resolved")}
                    disabled={changeStatus.isPending}
                    data-testid="btn-resolve"
                  >
                    Resolve
                  </Button>
                )}
                {ticket.status !== "closed" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => changeStatus.mutate("closed")}
                    disabled={changeStatus.isPending}
                    data-testid="btn-close"
                  >
                    Close
                  </Button>
                )}
                {(ticket.status === "resolved" || ticket.status === "closed") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => changeStatus.mutate("open")}
                    disabled={changeStatus.isPending}
                    data-testid="btn-reopen"
                  >
                    Reopen
                  </Button>
                )}
              </div>

              <div className="space-y-3">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg p-3 text-sm ${
                      m.senderRole === "player"
                        ? "bg-slate-100"
                        : "bg-emerald-50 border border-emerald-200"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-xs">
                        {m.senderRole === "player" ? "Player" : `Staff (${m.senderRole})`}
                      </span>
                      <span className="text-xs text-slate-400">{fmtDate(m.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap">{m.body}</p>
                    {m.attachmentUrl && (
                      <a
                        href={m.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 underline mt-1 inline-block"
                      >
                        View attachment
                      </a>
                    )}
                  </div>
                ))}
              </div>

              {ticket.status !== "closed" && (
                <div className="flex gap-2">
                  <Textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    placeholder="Type a reply…"
                    className="flex-1"
                    data-testid="input-reply"
                  />
                  <Button
                    size="sm"
                    className="self-end"
                    disabled={!reply.trim() || sendReply.isPending}
                    onClick={() => sendReply.mutate()}
                    data-testid="btn-send-reply"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {context.user && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <User className="h-4 w-4" /> Player
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><strong>ID:</strong> {context.user.id}</p>
                <p><strong>Email:</strong> {context.user.email}</p>
                {context.user.displayName && (
                  <p><strong>Name:</strong> {context.user.displayName}</p>
                )}
                <p><strong>Status:</strong> {context.user.status}</p>
              </CardContent>
            </Card>
          )}

          {context.wallet && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Wallet className="h-4 w-4" /> Wallet
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                <p><strong>ID:</strong> {context.wallet.id}</p>
                <p><strong>Currency:</strong> {context.wallet.currency}</p>
              </CardContent>
            </Card>
          )}

          {context.recentWithdrawals.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1.5">
                  <Clock className="h-4 w-4" /> Recent Withdrawals
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-2">
                {context.recentWithdrawals.map((w) => (
                  <div key={w.id} className="flex justify-between text-xs">
                    <span className="font-mono">{w.amount}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {w.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
