import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  customFetch,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { paiseToINR } from "@/lib/format";
import { useAuth, hasRole } from "@/lib/auth";
import { toast } from "sonner";

interface DepositTier {
  minPaise: string;
  maxPaise: string | null;
  bonusPaise: string;
}
interface PromotionSettings {
  enabled: boolean;
  signupBonusPaise: string;
  depositTiers: DepositTier[];
  referrerRewardPaise: string;
  referrerMinDepositPaise: string;
  wageringMultiplier: number;
  updatedAt: string;
  updatedBy: string | null;
}
interface BonusEvent {
  id: string;
  userId: string | null;
  type: string;
  amount: string;
  ip: string | null;
  metadata: unknown;
  createdAt: string;
}
interface Analytics {
  windowDays: number;
  totals: {
    signupGranted: number;
    signupBlocked: number;
    depositBonusGranted: number;
    referralQualified: number;
    bonusBets: number;
    bonusWins: number;
    converted: number;
    revoked: number;
  };
  totalIssuedPaise: string;
  totalConvertedPaise: string;
  totalRevokedPaise: string;
  issuedByType: Array<{ type: string; count: number; amountPaise: string }>;
  funnel: Array<{
    date: string;
    invited: number;
    signedUp: number;
    qualified: number;
    grantedAmountPaise: string;
    convertedAmountPaise: string;
  }>;
  topReferrers: Array<{
    referrerId: string;
    referrerEmail: string | null;
    qualifiedCount: number;
    totalRewardPaise: string;
  }>;
  tierDistribution: Array<{
    label: string;
    count: number;
    amountPaise: string;
  }>;
  recentDays: Array<{ date: string; granted: number; amountPaise: string }>;
}

function rupeeStrToPaise(s: string): string {
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return "0";
  return Math.round(n * 100).toString();
}
function paiseStrToRupeeStr(s: string): string {
  return (Number(s) / 100).toString();
}

export default function PromotionsPage() {
  const { user } = useAuth();
  const canEdit = hasRole(user, "admin", "super_admin");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Promotions</h1>
        <p className="text-sm text-slate-500">
          Refer &amp; Earn, signup bonus and deposit bonus controls.
        </p>
      </div>
      <Tabs defaultValue="settings">
        <TabsList>
          <TabsTrigger value="settings" data-testid="tab-settings">
            Settings
          </TabsTrigger>
          <TabsTrigger value="activity" data-testid="tab-activity">
            Activity
          </TabsTrigger>
          <TabsTrigger value="analytics" data-testid="tab-analytics">
            Analytics
          </TabsTrigger>
        </TabsList>
        <TabsContent value="settings">
          <SettingsTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="analytics">
          <AnalyticsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SettingsTab({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useQuery<PromotionSettings>({
    queryKey: ["admin.promotions.settings"],
    queryFn: () =>
      customFetch<PromotionSettings>("/api/admin/promotions/settings", {
        method: "GET",
        credentials: "include",
      }),
  });

  const [enabled, setEnabled] = useState(true);
  const [signupRupees, setSignupRupees] = useState("1000");
  const [refRewardRupees, setRefRewardRupees] = useState("500");
  const [refMinRupees, setRefMinRupees] = useState("5000");
  const [wagering, setWagering] = useState("1");
  const [tiers, setTiers] = useState<
    Array<{ minRupees: string; maxRupees: string; bonusRupees: string }>
  >([]);

  useEffect(() => {
    if (!q.data) return;
    setEnabled(q.data.enabled);
    setSignupRupees(paiseStrToRupeeStr(q.data.signupBonusPaise));
    setRefRewardRupees(paiseStrToRupeeStr(q.data.referrerRewardPaise));
    setRefMinRupees(paiseStrToRupeeStr(q.data.referrerMinDepositPaise));
    setWagering(String(q.data.wageringMultiplier));
    setTiers(
      q.data.depositTiers.map((t) => ({
        minRupees: paiseStrToRupeeStr(t.minPaise),
        maxRupees: t.maxPaise === null ? "" : paiseStrToRupeeStr(t.maxPaise),
        bonusRupees: paiseStrToRupeeStr(t.bonusPaise),
      })),
    );
  }, [q.data]);

  const mut = useMutation({
    mutationFn: async (body: Partial<PromotionSettings>) =>
      customFetch<PromotionSettings>("/api/admin/promotions/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Promotion settings saved");
      void qc.invalidateQueries({ queryKey: ["admin.promotions.settings"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error)?.message ?? "Failed to save");
    },
  });

  const save = () => {
    const depositTiers: DepositTier[] = tiers.map((t) => ({
      minPaise: rupeeStrToPaise(t.minRupees),
      maxPaise: t.maxRupees.trim() === "" ? null : rupeeStrToPaise(t.maxRupees),
      bonusPaise: rupeeStrToPaise(t.bonusRupees),
    }));
    mut.mutate({
      enabled,
      signupBonusPaise: rupeeStrToPaise(signupRupees),
      referrerRewardPaise: rupeeStrToPaise(refRewardRupees),
      referrerMinDepositPaise: rupeeStrToPaise(refMinRupees),
      wageringMultiplier: Math.max(1, parseInt(wagering, 10) || 1),
      depositTiers,
    });
  };

  if (q.isLoading) return <p className="text-sm text-slate-500 mt-4">Loading…</p>;
  if (q.error)
    return (
      <p className="text-sm text-red-600 mt-4">
        Failed to load settings: {(q.error as Error).message}
      </p>
    );

  return (
    <div className="space-y-4 mt-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center justify-between">
            Promotions program
            <span className="flex items-center gap-2 text-sm font-normal">
              <span className="text-slate-500">Enabled</span>
              <Switch
                checked={enabled}
                onCheckedChange={setEnabled}
                disabled={!canEdit}
                data-testid="switch-enabled"
              />
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label>Signup bonus (₹)</Label>
            <Input
              value={signupRupees}
              onChange={(e) => setSignupRupees(e.target.value)}
              disabled={!canEdit}
              data-testid="input-signup-bonus"
            />
            <p className="text-xs text-slate-500">
              Granted to new accounts on first sign-up. IP &amp; email deduped.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Wagering multiplier</Label>
            <Input
              value={wagering}
              onChange={(e) => setWagering(e.target.value)}
              type="number"
              min={1}
              max={20}
              disabled={!canEdit}
              data-testid="input-wagering"
            />
            <p className="text-xs text-slate-500">
              Required wager = issued bonus × multiplier. Default 1×.
            </p>
          </div>
          <div className="space-y-1">
            <Label>Referrer reward (₹)</Label>
            <Input
              value={refRewardRupees}
              onChange={(e) => setRefRewardRupees(e.target.value)}
              disabled={!canEdit}
              data-testid="input-referrer-reward"
            />
          </div>
          <div className="space-y-1">
            <Label>Min qualifying deposit (₹)</Label>
            <Input
              value={refMinRupees}
              onChange={(e) => setRefMinRupees(e.target.value)}
              disabled={!canEdit}
              data-testid="input-referrer-min"
            />
            <p className="text-xs text-slate-500">
              Referrer reward credits when referee deposits ≥ this amount.
            </p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deposit bonus tiers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Min ₹</TableHead>
                <TableHead>Max ₹ (blank = ∞)</TableHead>
                <TableHead>Bonus ₹</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tiers.map((t, i) => (
                <TableRow key={i} data-testid={`row-tier-${i}`}>
                  <TableCell>
                    <Input
                      value={t.minRupees}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((pp, j) =>
                            j === i ? { ...pp, minRupees: e.target.value } : pp,
                          ),
                        )
                      }
                      disabled={!canEdit}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={t.maxRupees}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((pp, j) =>
                            j === i ? { ...pp, maxRupees: e.target.value } : pp,
                          ),
                        )
                      }
                      disabled={!canEdit}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      value={t.bonusRupees}
                      onChange={(e) =>
                        setTiers((prev) =>
                          prev.map((pp, j) =>
                            j === i ? { ...pp, bonusRupees: e.target.value } : pp,
                          ),
                        )
                      }
                      disabled={!canEdit}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canEdit}
                      onClick={() =>
                        setTiers((prev) => prev.filter((_, j) => j !== i))
                      }
                      data-testid={`btn-tier-remove-${i}`}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Button
            size="sm"
            variant="secondary"
            disabled={!canEdit}
            onClick={() =>
              setTiers((prev) => [
                ...prev,
                { minRupees: "0", maxRupees: "", bonusRupees: "0" },
              ])
            }
            data-testid="btn-tier-add"
          >
            Add tier
          </Button>
        </CardContent>
      </Card>
      <div className="flex justify-end">
        <Button
          onClick={save}
          disabled={!canEdit || mut.isPending}
          data-testid="btn-save-settings"
        >
          {mut.isPending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function ActivityTab({ canEdit }: { canEdit: boolean }) {
  const [type, setType] = useState("");
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const qc = useQueryClient();
  const q = useQuery<{ entries: BonusEvent[]; hasMore: boolean }>({
    queryKey: ["admin.promotions.events", type, userId, from, to],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "100" });
      if (type) params.set("type", type);
      if (userId) params.set("userId", userId);
      if (from) params.set("from", new Date(from).toISOString());
      if (to) params.set("to", new Date(to).toISOString());
      return customFetch(`/api/admin/promotions/events?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
    },
  });
  // Live updates: refetch on any bonus event so the activity feed reflects
  // grants/blocks/reversals in real time without polling.
  useRealtimeTopic<{ type: string }>("admin:bonus-events", () => {
    void qc.invalidateQueries({ queryKey: ["admin.promotions.events"] });
  });
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["admin.promotions.events"] });
  });
  const csvUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (userId) params.set("userId", userId);
    if (from) params.set("from", new Date(from).toISOString());
    if (to) params.set("to", new Date(to).toISOString());
    const qs = params.toString();
    return `/api/admin/promotions/events.csv${qs ? `?${qs}` : ""}`;
  }, [type, userId, from, to]);

  const [revokeUid, setRevokeUid] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const revoke = useMutation({
    mutationFn: async () =>
      customFetch<{ revokedPaise: string }>(
        `/api/admin/promotions/users/${encodeURIComponent(revokeUid)}/revoke`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: revokeReason || "Admin revocation" }),
        },
      ),
    onSuccess: (data) => {
      toast.success(`Revoked ${paiseToINR(data.revokedPaise)}`);
      setRevokeUid("");
      setRevokeReason("");
      void qc.invalidateQueries({ queryKey: ["admin.promotions.events"] });
    },
    onError: (err: unknown) => {
      toast.error((err as Error)?.message ?? "Failed to revoke");
    },
  });

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label>Event type</Label>
            <Input
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="e.g. signup_granted"
              data-testid="input-filter-type"
            />
          </div>
          <div className="space-y-1">
            <Label>User ID</Label>
            <Input
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              data-testid="input-filter-user"
            />
          </div>
          <div className="space-y-1">
            <Label>From</Label>
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              data-testid="input-filter-from"
            />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              data-testid="input-filter-to"
            />
          </div>
          <div className="flex items-end">
            <a href={csvUrl} target="_blank" rel="noreferrer">
              <Button variant="secondary" data-testid="btn-export-csv">
                Export CSV
              </Button>
            </a>
          </div>
        </CardContent>
      </Card>
      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Revoke user bonus</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label>User ID</Label>
              <Input
                value={revokeUid}
                onChange={(e) => setRevokeUid(e.target.value)}
                data-testid="input-revoke-user"
              />
            </div>
            <div className="space-y-1 md:col-span-1">
              <Label>Reason</Label>
              <Input
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                data-testid="input-revoke-reason"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="destructive"
                disabled={!revokeUid || revoke.isPending}
                onClick={() => revoke.mutate()}
                data-testid="btn-revoke-bonus"
              >
                {revoke.isPending ? "Revoking…" : "Revoke bonus"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.data?.entries.map((e) => (
                    <TableRow key={e.id} data-testid={`row-event-${e.id}`}>
                      <TableCell className="whitespace-nowrap text-xs">
                        {new Date(e.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.type}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.userId ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {paiseToINR(e.amount)}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {e.ip ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                  {q.data && q.data.entries.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-slate-500">
                        No events match filters.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AnalyticsTab() {
  const [windowDays, setWindowDays] = useState<7 | 30 | 90>(30);
  const qc = useQueryClient();
  const q = useQuery<Analytics>({
    queryKey: ["admin.promotions.analytics", windowDays],
    queryFn: () =>
      customFetch<Analytics>(
        `/api/admin/promotions/analytics?windowDays=${windowDays}`,
        { method: "GET", credentials: "include" },
      ),
  });
  // Live: refresh analytics whenever an admin:bonus-metrics bump arrives.
  useRealtimeTopic<{ type: string }>("admin:bonus-metrics", () => {
    void qc.invalidateQueries({ queryKey: ["admin.promotions.analytics"] });
  });
  useRealtimeResync(() => {
    void qc.invalidateQueries({ queryKey: ["admin.promotions.analytics"] });
  });

  if (q.isLoading)
    return <p className="text-sm text-slate-500 mt-4">Loading…</p>;
  if (!q.data) return null;
  const t = q.data.totals;
  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-1" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </div>
    </div>
  );
  return (
    <div className="space-y-4 mt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          Window:&nbsp;
          <span className="font-mono">{q.data.windowDays}d</span>
        </div>
        <div className="inline-flex rounded border border-slate-200 overflow-hidden">
          {([7, 30, 90] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setWindowDays(w)}
              data-testid={`btn-window-${w}`}
              className={`px-3 py-1 text-sm ${
                windowDays === w
                  ? "bg-slate-900 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Signup granted" value={t.signupGranted} />
        <Stat label="Signup blocked" value={t.signupBlocked} />
        <Stat label="Deposit bonus granted" value={t.depositBonusGranted} />
        <Stat label="Referral qualified" value={t.referralQualified} />
        <Stat label="Bonus bets" value={t.bonusBets} />
        <Stat label="Bonus wins" value={t.bonusWins} />
        <Stat label="Converted" value={t.converted} />
        <Stat label="Revoked" value={t.revoked} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat label="Total issued" value={paiseToINR(q.data.totalIssuedPaise)} />
        <Stat label="Total converted" value={paiseToINR(q.data.totalConvertedPaise)} />
        <Stat label="Total revoked" value={paiseToINR(q.data.totalRevokedPaise)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issued vs converted (by source)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Grants</TableHead>
                <TableHead className="text-right">Issued</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.issuedByType.map((r) => (
                <TableRow key={r.type} data-testid={`row-issued-${r.type}`}>
                  <TableCell className="font-mono text-xs">{r.type}</TableCell>
                  <TableCell className="text-right">{r.count}</TableCell>
                  <TableCell className="text-right">
                    {paiseToINR(r.amountPaise)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">Converted (cash-out)</TableCell>
                <TableCell className="text-right">{t.converted}</TableCell>
                <TableCell className="text-right">
                  {paiseToINR(q.data.totalConvertedPaise)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Referral funnel</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Invited</TableHead>
                <TableHead className="text-right">Signed up</TableHead>
                <TableHead className="text-right">Qualified</TableHead>
                <TableHead className="text-right">Granted</TableHead>
                <TableHead className="text-right">Converted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data.funnel.map((d) => (
                <TableRow key={d.date} data-testid={`row-funnel-${d.date}`}>
                  <TableCell>{d.date}</TableCell>
                  <TableCell className="text-right">{d.invited}</TableCell>
                  <TableCell className="text-right">{d.signedUp}</TableCell>
                  <TableCell className="text-right">{d.qualified}</TableCell>
                  <TableCell className="text-right">
                    {paiseToINR(d.grantedAmountPaise)}
                  </TableCell>
                  <TableCell className="text-right">
                    {paiseToINR(d.convertedAmountPaise)}
                  </TableCell>
                </TableRow>
              ))}
              {q.data.funnel.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-slate-500">
                    No activity in the selected window.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top referrers</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Referrer</TableHead>
                  <TableHead className="text-right">Qualified</TableHead>
                  <TableHead className="text-right">Reward paid</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.topReferrers.map((r) => (
                  <TableRow key={r.referrerId} data-testid={`row-referrer-${r.referrerId}`}>
                    <TableCell className="text-xs">
                      {r.referrerEmail ?? r.referrerId.slice(0, 8)}
                    </TableCell>
                    <TableCell className="text-right">{r.qualifiedCount}</TableCell>
                    <TableCell className="text-right">
                      {paiseToINR(r.totalRewardPaise)}
                    </TableCell>
                  </TableRow>
                ))}
                {q.data.topReferrers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-slate-500">
                      No qualified referrals in window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recharge tier distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-right">Grants</TableHead>
                  <TableHead className="text-right">Issued</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {q.data.tierDistribution.map((r) => (
                  <TableRow key={r.label} data-testid={`row-tier-dist-${r.label}`}>
                    <TableCell className="font-mono text-xs">{r.label}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right">
                      {paiseToINR(r.amountPaise)}
                    </TableCell>
                  </TableRow>
                ))}
                {q.data.tierDistribution.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-slate-500">
                      No tier grants in window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
