import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { useRoute, Link } from "wouter";
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
import { ArrowLeft, KeyRound, Webhook, ScrollText, Settings } from "lucide-react";

function api<T>(url: string, options?: RequestInit): Promise<T> {
  return customFetch<T>(url, { ...options, credentials: "include" });
}

type Tab = "keys" | "webhooks" | "logs" | "settings";

type Detail = {
  partner: {
    id: string;
    displayName: string;
    contactEmail: string | null;
    status: string;
    walletMode: string;
    allowedGames: string[];
    allowedOrigins: string[];
    webhookUrl: string | null;
    walletCallbackUrl: string | null;
    rtpOverrides: Record<string, number> | null;
  };
  walletBalance: string;
  totalBets: number;
};

export default function PartnerDetailPage() {
  const [, params] = useRoute("/partners/:id");
  const id = params?.id ?? "";
  const [tab, setTab] = useState<Tab>("keys");

  const { data } = useQuery({
    queryKey: ["partner", id],
    queryFn: () => api<Detail>(`/api/admin/partners/${id}`),
    enabled: !!id,
  });

  if (!id) return null;

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link href="/partners">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>{data?.partner.displayName ?? "Partner"}</span>
            {data && (
              <Badge
                variant={
                  data.partner.status === "active" ? "default" : "secondary"
                }
              >
                {data.partner.status}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-slate-500 text-xs">Wallet mode</div>
            <div>{data?.partner.walletMode}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Float balance (paise)</div>
            <div className="font-mono">{data?.walletBalance ?? "0"}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Total bets</div>
            <div>{data?.totalBets ?? 0}</div>
          </div>
          <div>
            <div className="text-slate-500 text-xs">Allowed games</div>
            <div>
              {data?.partner.allowedGames?.length
                ? data.partner.allowedGames.join(", ")
                : "all"}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 border-b">
        {(
          [
            ["keys", "API Keys", KeyRound],
            ["webhooks", "Webhooks", Webhook],
            ["logs", "Logs", ScrollText],
            ["settings", "Settings", Settings],
          ] as [Tab, string, typeof KeyRound][]
        ).map(([k, label, Icon]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm flex items-center gap-1 border-b-2 -mb-px ${
              tab === k
                ? "border-emerald-600 text-emerald-700 font-medium"
                : "border-transparent text-slate-500"
            }`}
            data-testid={`tab-${k}`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === "keys" && <ApiKeysTab partnerId={id} />}
      {tab === "webhooks" && <WebhooksTab partnerId={id} />}
      {tab === "logs" && <LogsTab partnerId={id} />}
      {tab === "settings" && data && (
        <SettingsTab partnerId={id} partner={data.partner} />
      )}
    </div>
  );
}

type ApiKey = {
  id: string;
  keyId: string;
  label: string | null;
  status: string;
  createdAt: string;
  lastUsedAt: string | null;
};

function ApiKeysTab({ partnerId }: { partnerId: string }) {
  const [label, setLabel] = useState("");
  const [issued, setIssued] = useState<{ keyId: string; secret: string } | null>(
    null,
  );
  const { data, refetch } = useQuery({
    queryKey: ["partner-keys", partnerId],
    queryFn: () =>
      api<{ keys: ApiKey[] }>(`/api/admin/partners/${partnerId}/api-keys`),
  });
  const issueKey = useMutation({
    mutationFn: () =>
      api<{ keyId: string; secret: string }>(
        `/api/admin/partners/${partnerId}/api-keys`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ label }),
        },
      ),
    onSuccess: (res) => {
      setIssued(res);
      setLabel("");
      refetch();
    },
  });
  const revokeKey = useMutation({
    mutationFn: (keyId: string) =>
      api(
        `/api/admin/partners/${partnerId}/api-keys/${keyId}/revoke`,
        { method: "POST" },
      ),
    onSuccess: () => refetch(),
  });
  const rotateKey = useMutation({
    mutationFn: (keyId: string) =>
      api<{ keyId: string; secret: string }>(
        `/api/admin/partners/${partnerId}/api-keys/${keyId}/rotate`,
        { method: "POST" },
      ),
    onSuccess: (res) => {
      setIssued(res);
      refetch();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">API keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {issued && (
          <div className="p-3 border border-emerald-300 bg-emerald-50 rounded text-xs space-y-1">
            <div>
              <strong>Key ID:</strong> <span className="font-mono">{issued.keyId}</span>
            </div>
            <div>
              <strong>Secret (shown once):</strong>
            </div>
            <pre className="bg-slate-900 text-emerald-300 p-2 rounded break-all whitespace-pre-wrap">
              {issued.secret}
            </pre>
            <Button size="sm" onClick={() => setIssued(null)}>
              Dismiss
            </Button>
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="Label (e.g. prod)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <Button
            onClick={() => issueKey.mutate()}
            disabled={issueKey.isPending}
          >
            Issue key
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key ID</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.keys ?? []).map((k) => (
              <TableRow key={k.id}>
                <TableCell className="font-mono text-xs">{k.keyId}</TableCell>
                <TableCell>{k.label ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={k.status === "active" ? "default" : "secondary"}>
                    {k.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs">
                  {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}
                </TableCell>
                <TableCell className="space-x-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => rotateKey.mutate(k.id)}
                    disabled={k.status !== "active"}
                  >
                    Rotate
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => revokeKey.mutate(k.id)}
                    disabled={k.status !== "active"}
                  >
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

type Delivery = {
  id: string;
  eventId: string;
  eventType: string;
  status: string;
  attempts: number;
  lastResponseStatus: number | null;
  nextAttemptAt: string;
  createdAt: string;
};

type AttemptDetail = {
  delivery: Delivery & { payload: unknown; lastResponseBody: string | null };
  attempts: Array<{
    id: string;
    attemptNumber: number;
    statusCode: number;
    responseBody: string | null;
    requestHeaders: Record<string, string> | null;
    requestBody: string | null;
    errorMessage: string | null;
    durationMs: number;
    createdAt: string;
  }>;
};

function WebhooksTab({ partnerId }: { partnerId: string }) {
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const [inspect, setInspect] = useState<string | null>(null);
  const qs = new URLSearchParams();
  if (eventType) qs.set("eventType", eventType);
  if (status) qs.set("status", status);
  const { data, refetch } = useQuery({
    queryKey: ["partner-webhooks", partnerId, eventType, status],
    queryFn: () =>
      api<{ deliveries: Delivery[] }>(
        `/api/admin/partners/${partnerId}/webhooks${qs.toString() ? `?${qs}` : ""}`,
      ),
  });
  const detail = useQuery({
    queryKey: ["partner-webhook-detail", partnerId, inspect],
    queryFn: () =>
      api<AttemptDetail>(
        `/api/admin/partners/${partnerId}/webhooks/${inspect}`,
      ),
    enabled: !!inspect,
  });
  const replay = useMutation({
    mutationFn: (deliveryId: string) =>
      api(
        `/api/admin/partners/${partnerId}/webhooks/${deliveryId}/replay`,
        { method: "POST" },
      ),
    onSuccess: () => refetch(),
  });
  const test = useMutation({
    mutationFn: () =>
      api(`/api/admin/partners/${partnerId}/webhooks/test`, {
        method: "POST",
      }),
    onSuccess: () => refetch(),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center justify-between">
          Webhook deliveries
          <Button size="sm" onClick={() => test.mutate()}>
            Send test event
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 text-xs">
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="border rounded px-2 py-1"
            data-testid="filter-event-type"
          >
            <option value="">All events</option>
            <option value="bet.placed">bet.placed</option>
            <option value="bet.settled">bet.settled</option>
            <option value="round.completed">round.completed</option>
            <option value="partner.suspended">partner.suspended</option>
          </select>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="border rounded px-2 py-1"
            data-testid="filter-status"
          >
            <option value="">Any status</option>
            <option value="pending">pending</option>
            <option value="delivering">delivering</option>
            <option value="delivered">delivered</option>
            <option value="failed">failed</option>
          </select>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Attempts</TableHead>
              <TableHead>Last HTTP</TableHead>
              <TableHead>Next try</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.deliveries ?? []).map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  <div className="text-xs font-mono">{d.eventType}</div>
                  <div className="text-xs text-slate-500">{d.eventId}</div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      d.status === "delivered"
                        ? "default"
                        : d.status === "failed"
                          ? "destructive"
                          : "secondary"
                    }
                  >
                    {d.status}
                  </Badge>
                </TableCell>
                <TableCell>{d.attempts}</TableCell>
                <TableCell>{d.lastResponseStatus ?? "—"}</TableCell>
                <TableCell className="text-xs">
                  {new Date(d.nextAttemptAt).toLocaleString()}
                </TableCell>
                <TableCell className="space-x-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setInspect(d.id)}
                  >
                    Inspect
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => replay.mutate(d.id)}
                  >
                    Replay
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {inspect && (
          <div className="border rounded p-3 bg-slate-50 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <strong>Delivery {inspect.slice(0, 8)} — attempt history</strong>
              <Button size="sm" variant="ghost" onClick={() => setInspect(null)}>
                Close
              </Button>
            </div>
            {detail.data?.delivery && (
              <div>
                <div className="font-mono">
                  payload:
                </div>
                <pre className="bg-white border rounded p-2 overflow-x-auto">
                  {JSON.stringify(detail.data.delivery.payload, null, 2)}
                </pre>
              </div>
            )}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>HTTP</TableHead>
                  <TableHead>ms</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead>Body / error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(detail.data?.attempts ?? []).map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.attemptNumber}</TableCell>
                    <TableCell>{a.statusCode}</TableCell>
                    <TableCell>{a.durationMs}</TableCell>
                    <TableCell>
                      {new Date(a.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="max-w-md break-all">
                      {a.errorMessage ?? a.responseBody ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Log = {
  id: string;
  requestId: string | null;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  ip: string | null;
  errorCode: string | null;
  createdAt: string;
};

function LogsTab({ partnerId }: { partnerId: string }) {
  const { data } = useQuery({
    queryKey: ["partner-logs", partnerId],
    queryFn: () =>
      api<{ logs: Log[] }>(`/api/admin/partners/${partnerId}/logs`),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Request logs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Request ID</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Path</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>IP</TableHead>
              <TableHead>Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data?.logs ?? []).map((l) => (
              <TableRow key={l.id}>
                <TableCell className="text-xs">
                  {new Date(l.createdAt).toLocaleString()}
                </TableCell>
                <TableCell className="text-xs font-mono">
                  {l.requestId ?? "—"}
                </TableCell>
                <TableCell className="text-xs font-mono">{l.method}</TableCell>
                <TableCell className="text-xs font-mono">{l.path}</TableCell>
                <TableCell>{l.statusCode}</TableCell>
                <TableCell>{l.latencyMs}ms</TableCell>
                <TableCell className="text-xs">{l.ip ?? "—"}</TableCell>
                <TableCell className="text-xs">{l.errorCode ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function SettingsTab({
  partnerId,
  partner,
}: {
  partnerId: string;
  partner: Detail["partner"];
}) {
  const [status, setStatus] = useState(partner.status);
  const [webhookUrl, setWebhookUrl] = useState(partner.webhookUrl ?? "");
  const [walletCallbackUrl, setWalletCallbackUrl] = useState(
    partner.walletCallbackUrl ?? "",
  );
  const [allowedGames, setAllowedGames] = useState(
    partner.allowedGames.join(","),
  );
  const [allowedOrigins, setAllowedOrigins] = useState(
    (partner.allowedOrigins ?? []).join(","),
  );
  // Per-game RTP override map serialized as one row per game in the form
  // "lunar=0.97,mines=0.99". Empty value clears overrides for that game.
  const [rtpOverridesText, setRtpOverridesText] = useState(
    Object.entries(partner.rtpOverrides ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join(","),
  );
  const [topup, setTopup] = useState("");
  const [msg, setMsg] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const rtpOverrides: Record<string, number> = {};
      for (const part of rtpOverridesText.split(",")) {
        const [k, v] = part.split("=").map((s) => s.trim());
        if (!k || !v) continue;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 1) rtpOverrides[k] = n;
      }
      return api(`/api/admin/partners/${partnerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status,
          webhookUrl: webhookUrl || null,
          walletCallbackUrl: walletCallbackUrl || null,
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
            : null,
        }),
      });
    },
    onSuccess: () => {
      setMsg("Saved.");
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  const topupMut = useMutation({
    mutationFn: () =>
      api(`/api/admin/partners/${partnerId}/topup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountPaise: topup }),
      }),
    onSuccess: () => {
      setTopup("");
      setMsg("Float adjusted.");
      queryClient.invalidateQueries({ queryKey: ["partner", partnerId] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-w-xl">
        <label className="block text-xs text-slate-500">Status</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="w-full border rounded px-3 py-2 text-sm"
        >
          <option value="active">active</option>
          <option value="suspended">suspended</option>
          <option value="disabled">disabled</option>
        </select>
        <label className="block text-xs text-slate-500">Webhook URL</label>
        <Input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
        <label className="block text-xs text-slate-500">
          Wallet callback URL (remote-wallet mode)
        </label>
        <Input
          value={walletCallbackUrl}
          onChange={(e) => setWalletCallbackUrl(e.target.value)}
        />
        <label className="block text-xs text-slate-500">
          Allowed games (comma sep, blank = all)
        </label>
        <Input
          value={allowedGames}
          onChange={(e) => setAllowedGames(e.target.value)}
          data-testid="input-allowed-games"
        />
        <label className="block text-xs text-slate-500">
          Allowed origins (comma sep, e.g. https://acme.com)
        </label>
        <Input
          value={allowedOrigins}
          onChange={(e) => setAllowedOrigins(e.target.value)}
          data-testid="input-allowed-origins"
        />
        <label className="block text-xs text-slate-500">
          RTP overrides (per game, e.g. "lunar=0.97,mines=0.99")
        </label>
        <Input
          value={rtpOverridesText}
          onChange={(e) => setRtpOverridesText(e.target.value)}
          data-testid="input-rtp-overrides"
        />
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save settings
        </Button>

        <hr />
        <label className="block text-xs text-slate-500">
          Adjust float balance (paise; negative to deduct)
        </label>
        <div className="flex gap-2">
          <Input
            value={topup}
            onChange={(e) => setTopup(e.target.value)}
            placeholder="e.g. 100000"
          />
          <Button onClick={() => topupMut.mutate()} disabled={!topup}>
            Apply
          </Button>
        </div>
        {msg && <p className="text-xs text-emerald-700">{msg}</p>}
      </CardContent>
    </Card>
  );
}
