import { SiteLayout } from "@/components/site/SiteLayout";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Send, MessageSquare } from "lucide-react";

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

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-500/20 text-blue-700 border-blue-500/30",
  awaiting_reply: "bg-amber-500/20 text-amber-700 border-amber-500/30",
  resolved: "bg-emerald-500/20 text-emerald-700 border-emerald-500/30",
  closed: "bg-slate-500/20 text-slate-600 border-slate-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  awaiting_reply: "Awaiting Reply",
  resolved: "Resolved",
  closed: "Closed",
};

export default function Help() {
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return <HelpContent userId={user.id} />;
}

function HelpContent({ userId }: { userId: string }) {
  const [view, setView] = useState<"list" | "create" | string>("list");

  if (view === "create") {
    return (
      <PageShell>
        <CreateTicket
          onBack={() => setView("list")}
          onCreated={(id) => setView(id)}
        />
      </PageShell>
    );
  }

  if (view !== "list") {
    return (
      <PageShell>
        <TicketThread
          id={view}
          userId={userId}
          onBack={() => setView("list")}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <TicketList onSelect={setView} onCreate={() => setView("create")} />
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <SiteLayout
      title="Help & support"
      description="A little help, whenever you need it. Create a ticket or follow an existing conversation."
    >
      <div className="site-support-panel">{children}</div>
    </SiteLayout>
  );
}

function TicketList({
  onSelect,
  onCreate,
}: {
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const query = useQuery({
    queryKey: ["my-tickets"],
    queryFn: () =>
      customFetch<Ticket[]>("/api/tickets/my", {
        method: "GET",
        credentials: "include",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">My Tickets</h2>
        <Button size="sm" onClick={onCreate} data-testid="btn-new-ticket">
          <Plus className="h-4 w-4 mr-1" /> New ticket
        </Button>
      </div>

      {query.isLoading && (
        <p className="text-sm text-muted-foreground text-center py-8">
          Loading…
        </p>
      )}

      {query.data?.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No tickets yet</p>
          <p className="text-xs text-muted-foreground/60">
            Create a ticket if you need help
          </p>
        </div>
      )}

      <div className="space-y-2">
        {query.data?.map((t) => (
          <button
            key={t.id}
            onClick={() => onSelect(t.id)}
            className="w-full text-left bg-card border border-card-border rounded-lg p-3 hover:bg-card/80 transition"
            data-testid={`ticket-${t.id}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{t.subject}</p>
                <p className="text-xs text-muted-foreground mt-0.5 capitalize">
                  {t.category} · {new Date(t.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <Badge
                variant="outline"
                className={`shrink-0 text-[10px] ${STATUS_COLORS[t.status] ?? ""}`}
              >
                {STATUS_LABELS[t.status] ?? t.status}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CreateTicket({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const qc = useQueryClient();
  const [category, setCategory] = useState("other");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const create = useMutation({
    mutationFn: () =>
      customFetch<Ticket>("/api/tickets", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ category, subject, message }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["my-tickets"] });
      onCreated(data.id);
    },
  });

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>
      <h2 className="text-lg font-semibold">New Ticket</h2>

      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-sm font-medium">Category</label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger data-testid="select-category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="deposit">Deposit</SelectItem>
              <SelectItem value="withdrawal">Withdrawal</SelectItem>
              <SelectItem value="kyc">KYC</SelectItem>
              <SelectItem value="game">Game</SelectItem>
              <SelectItem value="account">Account</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Subject</label>
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Brief description of your issue"
            data-testid="input-subject"
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Message</label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Describe your issue in detail…"
            rows={5}
            data-testid="input-message"
          />
        </div>

        <Button
          className="w-full"
          disabled={!subject || !message || create.isPending}
          onClick={() => create.mutate()}
          data-testid="btn-submit-ticket"
        >
          {create.isPending ? "Submitting…" : "Submit ticket"}
        </Button>

        {create.isError && (
          <p className="text-sm text-red-700">
            {(create.error as Error)?.message ?? "Failed to create ticket"}
          </p>
        )}
      </div>
    </div>
  );
}

function TicketThread({
  id,
  userId,
  onBack,
}: {
  id: string;
  userId: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const [reply, setReply] = useState("");

  const query = useQuery({
    queryKey: ["my-ticket", id],
    queryFn: () =>
      customFetch<{ ticket: Ticket; messages: TicketMessage[] }>(
        `/api/tickets/my/${id}`,
        { method: "GET", credentials: "include" },
      ),
  });

  const sendReply = useMutation({
    mutationFn: () =>
      customFetch(`/api/tickets/my/${id}/reply`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: reply }),
      }),
    onSuccess: () => {
      setReply("");
      qc.invalidateQueries({ queryKey: ["my-ticket", id] });
      qc.invalidateQueries({ queryKey: ["my-tickets"] });
    },
  });

  if (query.isLoading) {
    return <p className="text-center text-muted-foreground py-8">Loading…</p>;
  }

  const data = query.data;
  if (!data) {
    return (
      <p className="text-center text-muted-foreground py-8">Ticket not found</p>
    );
  }

  const { ticket, messages } = data;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Button>

      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">{ticket.subject}</h2>
          <p className="text-xs text-muted-foreground capitalize">
            {ticket.category} ·{" "}
            {new Date(ticket.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Badge
          variant="outline"
          className={`${STATUS_COLORS[ticket.status] ?? ""}`}
        >
          {STATUS_LABELS[ticket.status] ?? ticket.status}
        </Badge>
      </div>

      <div className="space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`rounded-lg p-3 text-sm ${
              m.senderId === userId
                ? "bg-primary/10 border border-primary/20 ml-4"
                : "bg-card border border-card-border mr-4"
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-muted-foreground">
                {m.senderId === userId ? "You" : "Support"}
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                {new Date(m.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </div>
        ))}
      </div>

      {ticket.status !== "closed" && (
        <div className="flex gap-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Type your reply…"
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

      {ticket.status === "closed" && (
        <p className="text-center text-xs text-muted-foreground py-2">
          This ticket is closed.
        </p>
      )}
    </div>
  );
}
