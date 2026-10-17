import vaultArtwork from "@/assets/lobby/event-vault.png";
import type { CSSProperties } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  customFetch,
  useRealtimeTopic,
  useRealtimeResync,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Copy, Gift, Share2, Sparkles, Trophy, Users } from "lucide-react";
import { toast } from "sonner";

interface DepositTier {
  minPaise: string;
  maxPaise: string | null;
  bonusPaise: string;
}
interface ReferralRow {
  refereeId: string;
  refereeEmail: string;
  status: "signed_up" | "qualified";
  rewardPaise: string;
  createdAt: string;
  qualifiedAt: string | null;
}
interface PromotionsMe {
  balance: string;
  wagering: {
    requiredPaise: string;
    completedPaise: string;
    remainingPaise: string;
    multiplier: number;
  };
  referrals: {
    referralCode: string | null;
    totalReferred: number;
    qualifiedCount: number;
    totalEarnedPaise: string;
    recent: ReferralRow[];
  };
  eligibleGames: string[];
  settings: {
    signupBonusPaise: string;
    depositTiers: DepositTier[];
    referrerRewardPaise: string;
    referrerMinDepositPaise: string;
    wageringMultiplier: number;
  };
}

interface BonusTxn {
  id: string;
  type: string;
  amount: string;
  balanceAfter: string;
  refType: string | null;
  refId: string | null;
  memo: string | null;
  createdAt: string;
}

function rupees(paise: string | bigint | number): string {
  const n =
    typeof paise === "bigint"
      ? Number(paise)
      : typeof paise === "number"
        ? paise
        : Number(paise || 0);
  return `₹${(n / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function Promotions() {
  useEffect(() => {
    document.title = "Promotions — Lunar Play";
  }, []);

  const { user } = useAuth();
  const qc = useQueryClient();

  const me = useQuery<PromotionsMe>({
    queryKey: ["promotions.me"],
    queryFn: () =>
      customFetch<PromotionsMe>("/api/promotions/me", {
        method: "GET",
        credentials: "include",
      }),
  });

  const txns = useQuery<{ entries: BonusTxn[]; nextCursor: string | null }>({
    queryKey: ["promotions.transactions"],
    queryFn: () =>
      customFetch("/api/promotions/transactions?limit=20", {
        method: "GET",
        credentials: "include",
      }),
  });

  // Live: server publishes bonus:{userId} on every bonus ledger change.
  // Refetch wallet + history on each push so the user sees grants, bets,
  // wins, conversions and revocations without waiting for a poll.
  useRealtimeTopic<{ type: string; balance: string }>(
    user ? `bonus:${user.id}` : null,
    () => {
      void qc.invalidateQueries({ queryKey: ["promotions.me"] });
      void qc.invalidateQueries({ queryKey: ["promotions.transactions"] });
    },
  );
  useRealtimeResync(() => {
    if (!user) return;
    void qc.invalidateQueries({ queryKey: ["promotions.me"] });
    void qc.invalidateQueries({ queryKey: ["promotions.transactions"] });
  });

  const refLink = useMemo(() => {
    const code = me.data?.referrals.referralCode;
    if (!code) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/signup?ref=${encodeURIComponent(code)}`;
  }, [me.data?.referrals.referralCode]);

  const copy = (text: string, label = "Copied") => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success(label))
      .catch(() => toast.error("Could not copy"));
  };

  const share = async () => {
    if (!refLink) return;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Join me on Lunar Casino",
          text: "Sign up with my link and we both get a bonus.",
          url: refLink,
        });
      } else {
        copy(refLink, "Referral link copied");
      }
    } catch {
      /* user dismissed */
    }
  };

  return (
    <SiteLayout
      title="Promotions"
      description="Explore your bonuses, invite friends and follow your rewards."
    >
      <section
        className="site-promo-banner"
        style={{ "--promo-art": `url(${vaultArtwork})` } as CSSProperties}
      >
        <p className="site-eyebrow">THE EXTRA SIDE OF PLAY</p>
        <h2>
          More to discover.
          <br />
          More to enjoy.
        </h2>
        <p>Your available rewards and referral offers live here.</p>
      </section>
      <div className="site-promo-grid">
        {/* Bonus wallet */}
        <Card data-testid="card-bonus-wallet">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-accent/15 text-accent p-2">
                <Gift className="w-4 h-4" />
              </div>
              <CardTitle className="text-base">Bonus wallet</CardTitle>
            </div>
            <Badge variant="outline" className="uppercase">
              {me.data?.eligibleGames.join(" · ") ?? ""}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            <div
              className="text-3xl font-extrabold font-mono"
              data-testid="text-bonus-balance"
            >
              {me.isLoading
                ? "…"
                : me.isError
                  ? "—"
                  : rupees(me.data?.balance ?? "0")}
            </div>
            {me.isError && (
              <div
                className="text-xs text-rose-700 flex items-center gap-2"
                data-testid="text-bonus-error"
              >
                <span>
                  Couldn't load your bonus wallet
                  {me.error instanceof Error ? `: ${me.error.message}` : ""}.
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() => me.refetch()}
                  data-testid="btn-retry-bonus"
                >
                  Retry
                </button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Spendable only on Lunar, Mines, Plinko and Dice. Toggle “Use bonus
              wallet” inside any game to spend your bonus.
            </p>
            <Link href="/wallet?tab=deposit">
              <Button
                className="w-full sm:w-auto"
                data-testid="btn-claim-welcome"
              >
                <Sparkles className="w-4 h-4 mr-1" />
                Claim welcome bonus
              </Button>
            </Link>
            {me.data && <WageringBar w={me.data.wagering} />}
          </CardContent>
        </Card>

        {/* Refer & Earn */}
        <Card data-testid="card-refer-earn">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-pink-500/15 text-pink-700 p-2">
                <Users className="w-4 h-4" />
              </div>
              <CardTitle className="text-base">Refer &amp; Earn</CardTitle>
            </div>
            {me.data && (
              <Badge variant="outline" className="uppercase">
                {rupees(me.data.settings.referrerRewardPaise)} per friend
              </Badge>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Invite a friend. When they recharge{" "}
              <span className="font-semibold text-foreground">
                {me.data
                  ? rupees(me.data.settings.referrerMinDepositPaise)
                  : "₹5,000"}
              </span>{" "}
              or more, you get{" "}
              <span className="font-semibold text-foreground">
                {me.data
                  ? rupees(me.data.settings.referrerRewardPaise)
                  : "₹500"}
              </span>{" "}
              bonus credited instantly.
            </p>
            {me.data?.referrals.referralCode ? (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    readOnly
                    value={refLink ?? ""}
                    className="font-mono text-xs"
                    data-testid="input-referral-link"
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => refLink && copy(refLink, "Link copied")}
                      data-testid="btn-copy-link"
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Copy
                    </Button>
                    <Button onClick={share} data-testid="btn-share-link">
                      <Share2 className="w-4 h-4 mr-1" />
                      Share
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Stat
                    label="Friends"
                    value={String(me.data.referrals.totalReferred)}
                  />
                  <Stat
                    label="Qualified"
                    value={String(me.data.referrals.qualifiedCount)}
                  />
                  <Stat
                    label="Earned"
                    value={rupees(me.data.referrals.totalEarnedPaise)}
                  />
                </div>
                {me.data.referrals.recent.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-xs uppercase font-semibold text-muted-foreground">
                      Recent referrals
                    </div>
                    <div className="rounded-md border border-card-border divide-y divide-card-border">
                      {me.data.referrals.recent.map((r) => (
                        <div
                          key={r.refereeId}
                          className="flex items-center justify-between px-3 py-2 text-sm"
                          data-testid={`row-referral-${r.refereeId}`}
                        >
                          <span className="font-mono truncate">
                            {r.refereeEmail || r.refereeId.slice(0, 8)}
                          </span>
                          <Badge
                            variant={
                              r.status === "qualified" ? "default" : "outline"
                            }
                            className="uppercase text-[10px]"
                          >
                            {r.status === "qualified"
                              ? `+${rupees(r.rewardPaise)}`
                              : "signed up"}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Your referral code will appear here once your account is fully
                set up.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Bonus tiers */}
        {me.data && (
          <Card data-testid="card-deposit-tiers">
            <CardHeader className="flex-row items-center gap-2 space-y-0">
              <div className="rounded-md bg-emerald-500/15 text-emerald-700 p-2">
                <Sparkles className="w-4 h-4" />
              </div>
              <CardTitle className="text-base">Recharge bonus tiers</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Get bonus credit on every recharge. Higher recharge, bigger
                bonus.
              </p>
              <div className="rounded-md border border-card-border divide-y divide-card-border">
                {me.data.settings.depositTiers.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    data-testid={`row-tier-${i}`}
                  >
                    <span>
                      {rupees(t.minPaise)}
                      {t.maxPaise === null
                        ? " and above"
                        : ` – ${rupees(t.maxPaise)}`}
                    </span>
                    <Badge variant="outline" className="font-mono">
                      +{rupees(t.bonusPaise)}
                    </Badge>
                  </div>
                ))}
                {me.data.settings.depositTiers.length === 0 && (
                  <div className="px-3 py-3 text-sm text-muted-foreground text-center">
                    No active recharge bonuses right now.
                  </div>
                )}
              </div>
              <div className="flex justify-end pt-2">
                <Link href="/wallet">
                  <Button data-testid="btn-deposit">
                    <Trophy className="w-4 h-4 mr-1" />
                    Recharge to claim
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Bonus history */}
        <Card data-testid="card-bonus-history">
          <CardHeader>
            <CardTitle className="text-base">Bonus history</CardTitle>
          </CardHeader>
          <CardContent>
            {txns.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : txns.isError ? (
              <div
                className="text-sm text-rose-700 flex items-center gap-2"
                data-testid="text-bonus-history-error"
              >
                <span>
                  Couldn't load bonus history
                  {txns.error instanceof Error ? `: ${txns.error.message}` : ""}
                  .
                </span>
                <button
                  type="button"
                  className="underline"
                  onClick={() => txns.refetch()}
                  data-testid="btn-retry-bonus-history"
                >
                  Retry
                </button>
              </div>
            ) : txns.data && txns.data.entries.length > 0 ? (
              <div className="rounded-md border border-card-border divide-y divide-card-border">
                {txns.data.entries.map((e) => (
                  <div
                    key={e.id}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    data-testid={`row-bonus-${e.id}`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {e.memo ?? e.type}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <span
                      className={`font-mono text-sm font-bold ${BigInt(e.amount) >= 0n ? "text-emerald-700" : "text-rose-700"}`}
                    >
                      {BigInt(e.amount) >= 0n ? "+" : ""}
                      {rupees(e.amount)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No bonus activity yet. Sign-up bonus, recharges and referrals
                will show up here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </SiteLayout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/40 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-bold font-mono">{value}</div>
    </div>
  );
}

function WageringBar({ w }: { w: PromotionsMe["wagering"] }) {
  const required = Number(w.requiredPaise);
  const completed = Number(w.completedPaise);
  const pct =
    required > 0
      ? Math.min(100, Math.round((completed / required) * 100))
      : 100;
  if (required <= 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Wagering progress ({w.multiplier}× required)</span>
        <span className="font-mono">
          {rupees(completed)} / {rupees(required)}
        </span>
      </div>
      <Progress value={pct} data-testid="progress-wagering" />
      <div className="text-[11px] text-muted-foreground">
        {pct >= 100
          ? "Wagering complete — bonus winnings will convert to cash."
          : `Wager ${rupees(w.remainingPaise)} more to unlock conversion.`}
      </div>
    </div>
  );
}
