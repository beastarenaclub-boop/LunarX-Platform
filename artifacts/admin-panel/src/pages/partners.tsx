import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
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
import { Plus, Building2 } from "lucide-react";

function api<T>(url: string, options?: RequestInit): Promise<T> {
  return customFetch<T>(url, { ...options, credentials: "include" });
}

type Partner = {
  id: string;
  displayName: string;
  contactEmail: string | null;
  status: string;
  walletMode: string;
  allowedGames: string[];
  webhookUrl: string | null;
  createdAt: string;
};

export default function PartnersPage() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [walletMode, setWalletMode] = useState("local-credits");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [status, setStatus] = useState("active");
  const [allowedGames, setAllowedGames] = useState("");
  const [allowedOrigins, setAllowedOrigins] = useState("");
  const [rtpOverridesText, setRtpOverridesText] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-partners"],
    queryFn: () => api<{ partners: Partner[] }>("/api/admin/partners"),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<{ id: string; webhookSecret: string }>("/api/admin/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["admin-partners"] });
      setCreatedSecret(res.webhookSecret);
      setName("");
      setEmail("");
      setWebhookUrl("");
      setAllowedGames("");
      setAllowedOrigins("");
      setRtpOverridesText("");
      setStatus("active");
      setErr("");
    },
    onError: (e: Error) => setErr(e.message ?? "Failed"),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Building2 className="h-6 w-6" />
            Partners
          </h1>
          <p className="text-sm text-slate-500">
            B2B operators integrating via REST + webhooks.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="btn-new-partner">
              <Plus className="h-4 w-4 mr-1" />
              New partner
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create partner</DialogTitle>
            </DialogHeader>
            {createdSecret ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Webhook signing secret (shown once — store it now):
                </p>
                <pre className="p-3 rounded bg-slate-900 text-emerald-300 text-xs break-all whitespace-pre-wrap">
                  {createdSecret}
                </pre>
                <Button
                  onClick={() => {
                    setCreatedSecret(null);
                    setOpen(false);
                  }}
                >
                  Done
                </Button>
              </div>
            ) : (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const rtpOverrides: Record<string, number> = {};
                  for (const part of rtpOverridesText.split(",")) {
                    const [k, v] = part.split("=").map((s) => s.trim());
                    if (!k || !v) continue;
                    const n = Number(v);
                    if (Number.isFinite(n) && n >= 0 && n <= 1)
                      rtpOverrides[k] = n;
                  }
                  create.mutate({
                    displayName: name,
                    contactEmail: email || undefined,
                    walletMode,
                    status,
                    webhookUrl: webhookUrl || undefined,
                    allowedGames: allowedGames
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    allowedOrigins: allowedOrigins
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                    rtpOverrides: Object.keys(rtpOverrides).length
                      ? rtpOverrides
                      : undefined,
                  });
                }}
              >
                <Input
                  placeholder="Display name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Input
                  placeholder="Contact email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                />
                <select
                  value={walletMode}
                  onChange={(e) => setWalletMode(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                >
                  <option value="local-credits">local-credits</option>
                  <option value="remote-wallet">remote-wallet</option>
                </select>
                <Input
                  placeholder="Webhook URL (optional)"
                  value={webhookUrl}
                  onChange={(e) => setWebhookUrl(e.target.value)}
                />
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full border rounded px-3 py-2 text-sm"
                  data-testid="select-status"
                >
                  <option value="active">active</option>
                  <option value="suspended">suspended</option>
                  <option value="disabled">disabled</option>
                </select>
                <Input
                  placeholder="Allowed games (comma sep, blank = all)"
                  value={allowedGames}
                  onChange={(e) => setAllowedGames(e.target.value)}
                  data-testid="input-allowed-games"
                />
                <Input
                  placeholder="Allowed origins (comma sep, e.g. https://acme.com)"
                  value={allowedOrigins}
                  onChange={(e) => setAllowedOrigins(e.target.value)}
                  data-testid="input-allowed-origins"
                />
                <Input
                  placeholder='RTP overrides (e.g. "lunar=0.97,mines=0.99")'
                  value={rtpOverridesText}
                  onChange={(e) => setRtpOverridesText(e.target.value)}
                  data-testid="input-rtp-overrides"
                />
                {err && (
                  <p className="text-xs text-red-600" role="alert">
                    {err}
                  </p>
                )}
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Creating…" : "Create"}
                </Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All partners</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Wallet mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Webhook</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data?.partners ?? []).map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>
                      <div className="font-medium">{p.displayName}</div>
                      <div className="text-xs text-slate-500">
                        {p.contactEmail ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{p.walletMode}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={p.status === "active" ? "default" : "secondary"}
                      >
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs max-w-[260px] truncate">
                      {p.webhookUrl ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Link href={`/partners/${p.id}`}>
                        <Button size="sm" variant="outline">
                          Manage
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
                {(data?.partners ?? []).length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-slate-500 py-6"
                    >
                      No partners yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
