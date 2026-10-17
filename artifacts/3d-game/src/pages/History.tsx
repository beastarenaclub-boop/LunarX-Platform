import { SiteLayout } from "@/components/site/SiteLayout";
import { Link } from "wouter";
import {
  useListMyBets,
  useListWalletTransactions,
  useGetKycHistory,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatRupees } from "@/lib/format";

export default function History() {
  const bets = useListMyBets();
  const tx = useListWalletTransactions();
  const kyc = useGetKycHistory();

  return (
    <SiteLayout
      title="Activity & history"
      description="Keep track of your bets, wallet transactions and verification updates."
    >
      <div className="site-stack">
        <Tabs defaultValue="bets">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="bets" data-testid="tab-history-bets">
              Bets
            </TabsTrigger>
            <TabsTrigger value="wallet" data-testid="tab-history-wallet">
              Wallet
            </TabsTrigger>
            <TabsTrigger value="kyc" data-testid="tab-history-kyc">
              KYC
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bets" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Recent bets</CardTitle>
              </CardHeader>
              <CardContent>
                {(bets.data?.entries ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bets yet.</p>
                ) : (
                  <div className="space-y-2" data-testid="list-bets">
                    {bets.data!.entries.map((b) => {
                      const won =
                        b.status === "cashed_out" || b.status === "won";
                      const voucherReward =
                        b.gameCode === "prize-lotto" &&
                        won &&
                        b.payoutAmount === "0";
                      return (
                        <div
                          key={b.id}
                          className="flex items-center justify-between rounded-md border border-card-border bg-muted/20 p-2 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="font-mono">
                              <span className="text-muted-foreground">
                                Stake
                              </span>{" "}
                              ₹{formatRupees(b.stakeAmount)}
                              {b.multiplier ? (
                                <span className="ml-2">
                                  @ {Number(b.multiplier).toFixed(2)}×
                                </span>
                              ) : null}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(b.placedAt).toLocaleString()}
                            </div>
                          </div>
                          <div className="text-right">
                            <div
                              className={`font-mono font-bold ${won ? "text-emerald-700" : "text-muted-foreground"}`}
                            >
                              {voucherReward ? (
                                <Link href="/prize-lotto" className="underline">
                                  Voucher ₹
                                  {formatRupees(
                                    (BigInt(b.stakeAmount) * 10n).toString(),
                                  )}
                                </Link>
                              ) : won ? (
                                `+₹${formatRupees(b.payoutAmount)}`
                              ) : (
                                "—"
                              )}
                            </div>
                            <Badge variant="outline" className="text-[10px]">
                              {b.status}
                            </Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="wallet" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Wallet ledger</CardTitle>
              </CardHeader>
              <CardContent>
                {(tx.data?.entries ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No transactions yet.
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="list-wallet">
                    {tx.data!.entries.map((e) => {
                      const credit = !String(e.amount).startsWith("-");
                      return (
                        <div
                          key={e.id}
                          className="flex items-center justify-between rounded-md border border-card-border bg-muted/20 p-2 text-sm"
                        >
                          <div>
                            <div className="font-medium capitalize">
                              {e.type}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {new Date(e.createdAt).toLocaleString()}
                              {e.memo ? ` • ${e.memo}` : ""}
                            </div>
                          </div>
                          <div
                            className={`font-mono ${credit ? "text-emerald-700" : "text-destructive"}`}
                          >
                            {credit ? "+" : ""}₹
                            {formatRupees(String(e.amount).replace(/^-/, ""))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="kyc" className="mt-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">KYC submissions</CardTitle>
              </CardHeader>
              <CardContent>
                {(kyc.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No KYC submissions yet.
                  </p>
                ) : (
                  <div className="space-y-2" data-testid="list-kyc">
                    {kyc.data!.map((k) => (
                      <div
                        key={k.id}
                        className="flex items-center justify-between rounded-md border border-card-border bg-muted/20 p-2 text-sm"
                      >
                        <div>
                          <div className="font-medium">{k.fullName}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(k.submittedAt).toLocaleString()} •{" "}
                            {k.documentType.replace("_", " ")}
                          </div>
                          {k.rejectionReason && (
                            <div className="text-xs text-destructive">
                              Reason: {k.rejectionReason}
                            </div>
                          )}
                        </div>
                        <Badge variant="outline" className="capitalize">
                          {k.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </SiteLayout>
  );
}
