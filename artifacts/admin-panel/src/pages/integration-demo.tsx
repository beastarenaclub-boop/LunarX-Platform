import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

function api<T>(url: string, init?: RequestInit): Promise<T> {
  return customFetch<T>(url, { ...init, credentials: "include" });
}

interface PartnerRow {
  id: string;
  displayName: string;
  status: string;
  walletMode: string;
  allowedGames: string[];
}

interface PartnerDetailResp {
  partner: PartnerRow & { allowedOrigins: string[] };
  walletBalance: string;
  totalBets: number;
}

interface SessionResult {
  token: string;
  launchUrl: string;
  expiresAt: string;
}

interface EventLog {
  ts: number;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Admin-only end-to-end demo of the iframe launcher. Chooses a partner,
 * mints a launch session via the admin proxy (`POST /admin/partners/:id
 * /demo-session`), then embeds the resulting URL and renders a live tail
 * of `lunar:*` postMessage events emitted by the embedded game.
 */
export default function IntegrationDemoPage() {
  const partners = useQuery({
    queryKey: ["partners-list"],
    queryFn: () =>
      api<{ partners: PartnerRow[] }>("/api/admin/partners?limit=50"),
  });

  const [partnerId, setPartnerId] = useState<string>("");
  const [playerRef, setPlayerRef] = useState("demo-player-1");
  const [gameCode, setGameCode] = useState("lunar");
  const [session, setSession] = useState<SessionResult | null>(null);
  const [events, setEvents] = useState<EventLog[]>([]);
  const expectedOriginRef = useRef<string | null>(null);

  // Auto-select first partner once loaded.
  useEffect(() => {
    if (!partnerId && partners.data?.partners?.[0]?.id) {
      setPartnerId(partners.data.partners[0].id);
    }
  }, [partners.data, partnerId]);

  const partner = useQuery<PartnerDetailResp>({
    queryKey: ["partner-detail-demo", partnerId],
    queryFn: () => api(`/api/admin/partners/${partnerId}`),
    enabled: !!partnerId,
  });
  const allowedOrigins = partner.data?.partner.allowedOrigins ?? [];

  const createSession = useMutation({
    mutationFn: () =>
      api<SessionResult>(`/api/admin/partners/${partnerId}/demo-session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerRef, gameCode }),
      }),
    onSuccess: (data) => {
      try {
        expectedOriginRef.current = new URL(data.launchUrl).origin;
      } catch {
        expectedOriginRef.current = null;
      }
      setEvents([]);
      setSession(data);
    },
  });

  // Tail postMessages from the iframe — admin panel itself is the partner
  // here, so we listen on window directly. We filter by expected origin
  // and the lunar:* type prefix to ignore noise from other widgets.
  useEffect(() => {
    if (!session) return;
    function onMessage(ev: MessageEvent) {
      if (
        expectedOriginRef.current &&
        ev.origin !== expectedOriginRef.current
      ) {
        return;
      }
      const data = ev.data as { type?: string } | undefined;
      if (!data || typeof data !== "object") return;
      if (typeof data.type !== "string" || !data.type.startsWith("lunar:"))
        return;
      setEvents((prev) =>
        [
          ...prev,
          {
            ts: Date.now(),
            type: data.type as string,
            payload: data as Record<string, unknown>,
          },
        ].slice(-50),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [session]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integration Demo</h1>
        <p className="text-muted-foreground">
          End-to-end test of the iframe launcher + JS SDK against a real
          partner. Useful when onboarding a new partner or debugging the
          remote-wallet bridge.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Launch parameters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Partner</Label>
              <Select value={partnerId} onValueChange={setPartnerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a partner" />
                </SelectTrigger>
                <SelectContent>
                  {(partners.data?.partners ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.displayName} ({p.walletMode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Player ref</Label>
              <Input
                value={playerRef}
                onChange={(e) => setPlayerRef(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Game</Label>
              <Select value={gameCode} onValueChange={setGameCode}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lunar">lunar</SelectItem>
                  <SelectItem value="mines">mines</SelectItem>
                  <SelectItem value="plinko">plinko</SelectItem>
                  <SelectItem value="dice">dice</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              disabled={!partnerId || createSession.isPending}
              onClick={() => createSession.mutate()}
            >
              {createSession.isPending ? "Creating..." : "Create launch session"}
            </Button>
            {createSession.error && (
              <span className="text-sm text-red-600">
                {(createSession.error as Error).message}
              </span>
            )}
            {partner.data && (
              <span className="text-xs text-muted-foreground">
                Allowed origins:{" "}
                {allowedOrigins.length > 0
                  ? allowedOrigins.join(", ")
                  : "(none — iframe will be blocked by CSP!)"}
              </span>
            )}
          </div>
          {session && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs font-mono break-all">
              <div className="font-semibold mb-1">Launch URL</div>
              <a
                href={session.launchUrl}
                target="_blank"
                rel="noreferrer"
                className="text-blue-600 inline-flex items-center gap-1"
              >
                {session.launchUrl}
                <ExternalLink className="h-3 w-3" />
              </a>
              <div className="mt-1 text-muted-foreground">
                expires {new Date(session.expiresAt).toLocaleTimeString()}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {session && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Iframe preview</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="w-full bg-black rounded-md overflow-hidden"
                style={{ aspectRatio: "16 / 10" }}
              >
                <iframe
                  key={session.token}
                  title="lunar-game"
                  src={session.launchUrl}
                  className="w-full h-full border-0"
                  allow="autoplay; fullscreen; clipboard-write"
                  allowFullScreen
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">postMessage events</CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2 max-h-[600px] overflow-auto font-mono">
              {events.length === 0 ? (
                <div className="text-muted-foreground">
                  Waiting for events from the game...
                </div>
              ) : (
                events
                  .slice()
                  .reverse()
                  .map((e, i) => (
                    <div
                      key={`${e.ts}_${i}`}
                      className="border-b border-border/40 pb-2"
                    >
                      <div className="flex items-center justify-between">
                        <Badge variant="secondary">{e.type}</Badge>
                        <span className="text-muted-foreground">
                          {new Date(e.ts).toLocaleTimeString()}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap mt-1 text-[10px]">
                        {JSON.stringify(
                          { ...e.payload, type: undefined, source: undefined },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
