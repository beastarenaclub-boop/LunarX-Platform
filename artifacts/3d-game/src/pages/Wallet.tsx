import { SiteLayout } from "@/components/site/SiteLayout";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useGetWalletBalance,
  useListMyDeposits,
  useListMyWithdrawals,
  useCreateDepositRequest,
  useCreateAutoDepositRequest,
  useCancelMyDeposit,
  useCancelMyWithdrawal,
  useCreateWithdrawRequest,
  useGetMyKyc,
  useListActiveUpiAccounts,
  useGetDepositLimits,
  useGetDepositSettingsPublic,
  useListCoinPacks,
  useGetWithdrawLimits,
  getListMyDepositsQueryKey,
  getListMyWithdrawalsQueryKey,
  getGetWalletBalanceQueryKey,
  PaymentHistory,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Wallet as WalletIcon,
  Copy,
  ShieldCheck,
  Clock3,
  ReceiptText,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { formatRupees, paiseToRupees, rupeesToPaise } from "@/lib/format";
import { CoinFace, formatChip } from "@/components/table/chips";
import { cn } from "@/lib/utils";

function buildUpiDeepLink(opts: {
  upiId: string;
  label: string;
  amountRupees?: number | null;
}): string {
  const params = new URLSearchParams();
  params.set("pa", opts.upiId);
  params.set("pn", opts.label);
  if (
    opts.amountRupees !== null &&
    opts.amountRupees !== undefined &&
    Number.isFinite(opts.amountRupees) &&
    opts.amountRupees > 0
  ) {
    params.set("am", opts.amountRupees.toFixed(2));
  }
  params.set("cu", "INR");
  return `upi://pay?${params.toString()}`;
}

function StatusBadge({ status }: { status: string }) {
  const variant: Record<string, string> = {
    pending: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    approved: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    gateway_pending: "bg-blue-500/15 text-blue-700 border-blue-500/30",
    rejected: "bg-destructive/20 text-destructive border-destructive/30",
    cancelled: "bg-muted text-muted-foreground border-card-border",
  };
  return (
    <Badge variant="outline" className={variant[status] ?? ""}>
      {status === "gateway_pending" ? "processing" : status}
    </Badge>
  );
}

export default function WalletPage() {
  // Lobby action bar deep-links: /wallet?tab=withdraw opens the withdraw tab.
  const [tab, setTab] = useState<string>(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      return t === "withdraw" || t === "history" ? t : "deposit";
    } catch {
      return "deposit";
    }
  });
  const depGame = "lunar" as const;
  // Deposits and withdrawals use the shared wallet.
  const balance = useGetWalletBalance(
    { game: depGame },
    { query: { queryKey: getGetWalletBalanceQueryKey({ game: depGame }) } },
  );
  const deposits = useListMyDeposits();
  const withdrawals = useListMyWithdrawals();
  const kyc = useGetMyKyc();
  const upiAccounts = useListActiveUpiAccounts();
  const depositLimits = useGetDepositLimits();
  const depositSettings = useGetDepositSettingsPublic();
  const manualEnabled = depositSettings.data?.manualEnabled ?? true;
  const autoEnabled = depositSettings.data?.autoEnabled ?? false;
  const withdrawLimits = useGetWithdrawLimits();
  const qc = useQueryClient();

  const minRupees = paiseToRupees(depositLimits.data?.minAmountPaise);
  const maxRupees = paiseToRupees(depositLimits.data?.maxAmountPaise);
  const limitsHelp = depositLimits.data
    ? `Allowed range: ₹${minRupees.toLocaleString("en-IN")} – ₹${maxRupees.toLocaleString("en-IN")}`
    : "";
  const wMinRupees = paiseToRupees(withdrawLimits.data?.minAmountPaise);
  const wMaxRupees = paiseToRupees(withdrawLimits.data?.maxAmountPaise);
  const withdrawLimitsHelp = withdrawLimits.data
    ? `Allowed range: ₹${wMinRupees.toLocaleString("en-IN")} – ₹${wMaxRupees.toLocaleString("en-IN")}`
    : "";

  const [depAmount, setDepAmount] = useState("500");
  // SKU of the coin pack the player picked, or null for a custom amount.
  const [depSku, setDepSku] = useState<string | null>(null);
  const [depUpiRef, setDepUpiRef] = useState("");
  const [wAmount, setWAmount] = useState("500");
  const [wUpiId, setWUpiId] = useState("");
  const [selectedUpiId, setSelectedUpiId] = useState<string | null>(null);
  const [gatewayResult, setGatewayResult] = useState<{
    upiDeepLink?: string | null;
    qrData?: string | null;
  } | null>(null);

  // Ten packs, priced by the server for the selected game's wallet. The
  // client never invents a price — it echoes the SKU and the server re-derives
  // the amount from its own catalog.
  const coinPacks = useListCoinPacks({ game: depGame });
  const packs = coinPacks.data ?? [];
  const selectedPack = packs.find((p) => p.sku === depSku) ?? null;
  const packInLimits = (amountPaise: string) => {
    if (!depositLimits.data) return true;
    const paise = BigInt(amountPaise);
    return (
      paise >= BigInt(depositLimits.data.minAmountPaise) &&
      paise <= BigInt(depositLimits.data.maxAmountPaise)
    );
  };

  function pickPack(sku: string) {
    const pack = packs.find((p) => p.sku === sku);
    if (!pack) return;
    setDepSku(pack.sku);
    setDepAmount(String(paiseToRupees(pack.amount)));
    setGatewayResult(null);
  }

  // Typing an amount by hand drops the pack — unless the typed amount happens
  // to be exactly a pack price, in which case the pack stays selected so the
  // purchase is still traceable to a SKU.
  function onAmountChange(next: string) {
    setDepAmount(next);
    const paise = rupeesToPaise(Number(next));
    const match = packs.find((p) => p.amount === paise);
    setDepSku(match ? match.sku : null);
  }

  const accounts = upiAccounts.data ?? [];
  const selectedAccount =
    accounts.find((a) => a.id === selectedUpiId) ?? accounts[0] ?? null;

  const createManualDeposit = useCreateDepositRequest({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListMyDepositsQueryKey() });
        await qc.invalidateQueries({
          queryKey: getGetWalletBalanceQueryKey({ game: depGame }),
        });
        setDepUpiRef("");
        setGatewayResult(null);
        toast.success("Deposit request submitted for review");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const createAutoDeposit = useCreateAutoDepositRequest({
    mutation: {
      onSuccess: async (data) => {
        await qc.invalidateQueries({ queryKey: getListMyDepositsQueryKey() });
        await qc.invalidateQueries({
          queryKey: getGetWalletBalanceQueryKey({ game: depGame }),
        });
        setGatewayResult({
          upiDeepLink: data.upiDeepLink ?? null,
          qrData: data.qrData ?? null,
        });
        toast.success("Payment initiated — complete it in your UPI app");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const cancelDeposit = useCancelMyDeposit({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({ queryKey: getListMyDepositsQueryKey() });
        toast.success("Deposit request cancelled");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const cancelWithdrawal = useCancelMyWithdrawal({
    mutation: {
      onSuccess: async () => {
        await qc.invalidateQueries({
          queryKey: getListMyWithdrawalsQueryKey(),
        });
        toast.success("Withdrawal request cancelled");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  const createWithdraw = useCreateWithdrawRequest({
    mutation: {
      onSuccess: async () => {
        toast.success("Withdrawal request submitted");
        await qc.invalidateQueries({
          queryKey: getListMyWithdrawalsQueryKey(),
        });
        setWUpiId("");
      },
      onError: (err: Error) => toast.error(err.message),
    },
  });

  function validateDepositAmount(rupees: number): boolean {
    if (!rupees || rupees <= 0) {
      toast.error("Enter a valid amount");
      return false;
    }
    if (depositLimits.data) {
      if (rupees < minRupees) {
        toast.error(`Minimum deposit is ₹${minRupees.toLocaleString("en-IN")}`);
        return false;
      }
      if (rupees > maxRupees) {
        toast.error(`Maximum deposit is ₹${maxRupees.toLocaleString("en-IN")}`);
        return false;
      }
    }
    return true;
  }

  function onDeposit(e: FormEvent) {
    e.preventDefault();
    const rupees = Number(depAmount);
    if (!validateDepositAmount(rupees)) return;
    if (!depUpiRef || depUpiRef.length < 4) {
      toast.error("Enter the 12-digit UTR / UPI reference from your payment");
      return;
    }
    createManualDeposit.mutate({
      data: {
        amount: rupeesToPaise(rupees),
        game: depGame,
        upiRef: depUpiRef,
        ...(selectedPack
          ? { packageSku: selectedPack.sku, coinQuantity: selectedPack.coins }
          : {}),
      },
    });
  }

  function onAutoDeposit() {
    const rupees = Number(depAmount);
    if (!validateDepositAmount(rupees)) return;
    setGatewayResult(null);
    createAutoDeposit.mutate({
      data: {
        amount: rupeesToPaise(rupees),
        game: depGame,
        ...(selectedPack
          ? { packageSku: selectedPack.sku, coinQuantity: selectedPack.coins }
          : {}),
      },
    });
  }

  function onWithdraw(e: FormEvent) {
    e.preventDefault();
    const rupees = Number(wAmount);
    if (!rupees || rupees <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    if (withdrawLimits.data) {
      if (rupees < wMinRupees) {
        toast.error(
          `Minimum withdrawal is ₹${wMinRupees.toLocaleString("en-IN")}`,
        );
        return;
      }
      if (rupees > wMaxRupees) {
        toast.error(
          `Maximum withdrawal is ₹${wMaxRupees.toLocaleString("en-IN")}`,
        );
        return;
      }
    }
    createWithdraw.mutate({
      data: { amount: rupeesToPaise(rupees), upiId: wUpiId },
    });
  }

  function copyUpiId() {
    if (!selectedAccount) return;
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(selectedAccount.upiId);
      toast.success("UPI ID copied");
    }
  }

  const [, navigate] = useLocation();
  const search = useSearch();
  useEffect(() => {
    const selected=new URLSearchParams(search).get('tab');
    setTab(selected==='withdraw'||selected==='history'?selected:'deposit');
  }, [search]);

  const kycApproved = kyc.data?.status === "approved";

  return (
    <SiteLayout
      title="My wallet"
      description="One balance for all your games. Manage your deposits and withdrawals here."
      className="wallet-page"
    >
      <section className="wallet-overview" aria-label="Wallet overview">
        <div className="wallet-balance-main">
          <div className="wallet-balance-label">
            <WalletIcon /> Available balance
          </div>
          <div
            className="wallet-balance-amount"
            data-testid="text-wallet-balance"
          >
            {balance.isError
              ? "Unavailable"
              : balance.isLoading
                ? "…"
                : "₹" + formatRupees(balance.data?.balance ?? "0")}
          </div>
          <p data-testid="text-selected-game-balance">
            One wallet for every game on Lunar Play.
          </p>
        </div>
        <div className="wallet-balance-meta">
          <div className="wallet-meta-item">
            <ShieldCheck />
            <div>
              <span>IDENTITY VERIFICATION</span>
              <strong>
                {kyc.isLoading ? (
                  "Loading…"
                ) : kyc.isError ? (
                  "Unavailable"
                ) : kycApproved ? (
                  "KYC verified"
                ) : (
                  <Link
                    href="/profile"
                    className="underline underline-offset-4"
                  >
                    {kyc.data?.status === "pending"
                      ? "Under review"
                      : "Complete your KYC"}
                  </Link>
                )}
              </strong>
            </div>
          </div>
          <div className="wallet-meta-item">
            <Clock3 />
            <div>
              <span>PENDING REQUESTS</span>
              <strong>
                {deposits.isLoading || withdrawals.isLoading
                  ? "…"
                  : deposits.isError || withdrawals.isError
                    ? "Unavailable"
                    : [
                        ...(deposits.data ?? []),
                        ...(withdrawals.data ?? []),
                      ].filter((r) =>
                        ["pending", "gateway_pending"].includes(r.status),
                      ).length}{" "}
                <span className="sr-only">requests</span>
              </strong>
            </div>
          </div>
        </div>
      </section>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value);
          navigate(`/wallet?tab=${value}`, { replace: true });
        }}
      >
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="deposit" data-testid="tab-deposit">
            <ArrowDownToLine className="w-4 h-4 mr-2" />
            Deposit
          </TabsTrigger>
          <TabsTrigger value="withdraw" data-testid="tab-withdraw">
            <ArrowUpFromLine className="w-4 h-4 mr-2" />
            Withdraw
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-payment-history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="deposit" className="wallet-panel">
          {!manualEnabled && !autoEnabled && (
            <div
              className="wallet-full rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"
              data-testid="banner-deposits-unavailable"
            >
              Deposits are temporarily unavailable. Please contact support.
            </div>
          )}

          {(manualEnabled || autoEnabled) && (
            <Card className="wallet-full">
              <CardHeader>
                <CardTitle className="text-base">
                  <span className="wallet-step">01</span> Choose a coin pack
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Coins credit your shared wallet at ₹1 per coin. Every pack is
                  ten bets at its matching chip.
                </p>
                {coinPacks.isLoading ? (
                  <p
                    className="text-sm text-muted-foreground"
                    data-testid="text-coin-packs-loading"
                  >
                    Loading coin packs…
                  </p>
                ) : coinPacks.isError ? (
                  <div
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"
                    data-testid="banner-coin-packs-error"
                  >
                    Could not load coin packs. You can still enter an amount
                    below.
                  </div>
                ) : (
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2"
                    data-testid="coin-pack-grid"
                  >
                    {packs.map((pack) => {
                      const rupees = paiseToRupees(pack.amount);
                      const allowed = packInLimits(pack.amount);
                      const selected = depSku === pack.sku;
                      return (
                        <button
                          key={pack.sku}
                          type="button"
                          disabled={!allowed}
                          aria-pressed={selected}
                          onClick={() => pickPack(pack.sku)}
                          title={
                            allowed
                              ? pack.sku
                              : `${pack.sku} is outside the allowed deposit range`
                          }
                          className={cn(
                            "flex min-w-0 flex-col items-center gap-1 rounded-xl border p-2 text-center transition-colors",
                            selected
                              ? "border-accent bg-accent/10 ring-2 ring-accent"
                              : "border-card-border bg-muted/20 hover:bg-muted/40",
                            !allowed && "opacity-40 cursor-not-allowed",
                          )}
                          data-testid={`btn-coin-pack-${pack.sku}`}
                        >
                          {/* Chip colour comes from the matching stake tier;
                              the face reads the coins you actually get. */}
                          <CoinFace
                            value={pack.chipValue}
                            label={formatChip(pack.coins)}
                            sizeClass="w-10 h-10"
                          />
                          <span className="text-xs font-bold leading-tight">
                            {pack.coins.toLocaleString("en-IN")} coins
                          </span>
                          <span className="font-mono text-sm font-black tabular-nums">
                            ₹{rupees.toLocaleString("en-IN")}
                          </span>
                          <span className="w-full truncate font-mono text-[9px] text-muted-foreground">
                            {pack.sku}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                <p className="text-xs" data-testid="text-selected-pack">
                  {selectedPack
                    ? `Selected: ${selectedPack.coins.toLocaleString("en-IN")} coins for ₹${paiseToRupees(selectedPack.amount).toLocaleString("en-IN")} (${selectedPack.sku})`
                    : "No pack selected — a custom amount will be submitted."}
                </p>
              </CardContent>
            </Card>
          )}
          {manualEnabled && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="wallet-step">02</span> Pay via UPI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {upiAccounts.isLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Loading UPI options…
                  </p>
                ) : accounts.length === 0 ? (
                  <div
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"
                    data-testid="banner-no-upi"
                  >
                    No UPI accounts are currently configured. Please contact
                    support.
                  </div>
                ) : (
                  <>
                    {accounts.length > 1 && (
                      <div
                        className="flex flex-wrap gap-2"
                        data-testid="upi-selector"
                      >
                        {accounts.map((a) => (
                          <Button
                            key={a.id}
                            type="button"
                            size="sm"
                            variant={
                              (selectedAccount?.id ?? "") === a.id
                                ? "default"
                                : "outline"
                            }
                            onClick={() => setSelectedUpiId(a.id)}
                            data-testid={`btn-upi-pick-${a.id}`}
                          >
                            {a.label}
                          </Button>
                        ))}
                      </div>
                    )}
                    {selectedAccount &&
                      (() => {
                        const amountRupees = Number(depAmount);
                        const upiLink = buildUpiDeepLink({
                          upiId: selectedAccount.upiId,
                          label: selectedAccount.label,
                          amountRupees: Number.isFinite(amountRupees)
                            ? amountRupees
                            : null,
                        });
                        return (
                          <div
                            className="wallet-upi-details"
                            data-testid={`upi-card-${selectedAccount.id}`}
                          >
                            <div className="wallet-qr">
                              <QRCodeSVG
                                value={upiLink}
                                size={200}
                                level="M"
                                marginSize={1}
                                data-testid="img-upi-qr"
                              />
                            </div>
                            <div className="flex-1 space-y-2 text-sm">
                              <div className="font-semibold">
                                {selectedAccount.label}
                              </div>
                              <div>
                                <div className="text-xs text-muted-foreground">
                                  UPI ID
                                </div>
                                <div className="flex items-center gap-2">
                                  <code
                                    className="font-mono text-sm break-all"
                                    data-testid="text-upi-id"
                                  >
                                    {selectedAccount.upiId}
                                  </code>
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="ghost"
                                    onClick={copyUpiId}
                                    data-testid="btn-copy-upi"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </Button>
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Choose a pack or enter an amount before scanning
                                the QR. You can also copy the UPI ID. After
                                paying, enter your 12-digit UTR to confirm the
                                payment.
                              </p>
                            </div>
                          </div>
                        );
                      })()}
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {manualEnabled && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="wallet-step">03</span> Confirm your payment
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={onDeposit} className="wallet-submit-form">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="depAmount">Amount (₹)</Label>
                      <Input
                        id="depAmount"
                        type="number"
                        inputMode="numeric"
                        min={depositLimits.data ? minRupees : 1}
                        max={depositLimits.data ? maxRupees : undefined}
                        step="1"
                        required
                        value={depAmount}
                        onChange={(e) => onAmountChange(e.target.value)}
                        data-testid="input-deposit-amount"
                      />
                      {limitsHelp && (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid="text-deposit-limits"
                        >
                          {limitsHelp}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="depUpiRef">UPI / UTR Reference</Label>
                      <Input
                        id="depUpiRef"
                        required
                        minLength={4}
                        maxLength={64}
                        placeholder="12-digit UTR"
                        value={depUpiRef}
                        onChange={(e) => setDepUpiRef(e.target.value)}
                        data-testid="input-deposit-ref"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      disabled={
                        createManualDeposit.isPending || accounts.length === 0
                      }
                      data-testid="btn-deposit-submit"
                    >
                      {createManualDeposit.isPending
                        ? "Submitting…"
                        : "Submit deposit"}
                    </Button>
                    {autoEnabled && (
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={createAutoDeposit.isPending}
                        onClick={onAutoDeposit}
                        data-testid="btn-deposit-auto"
                      >
                        {createAutoDeposit.isPending
                          ? "Starting…"
                          : "Pay automatically (gateway)"}
                      </Button>
                    )}
                  </div>
                </form>

                {gatewayResult && (
                  <div
                    className="mt-4 space-y-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3"
                    data-testid="gateway-result"
                  >
                    <p className="text-sm font-semibold text-blue-700">
                      Complete your payment
                    </p>
                    {gatewayResult.upiDeepLink && (
                      <a
                        href={gatewayResult.upiDeepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                        data-testid="link-upi-deeplink"
                      >
                        <Button variant="secondary" size="sm">
                          Open UPI App
                        </Button>
                      </a>
                    )}
                    {gatewayResult.qrData && (
                      <div className="space-y-1" data-testid="qr-container">
                        <p className="text-xs text-muted-foreground">
                          Or copy this UPI payment string into your app:
                        </p>
                        <code className="block break-all rounded bg-muted/40 p-2 text-xs font-mono">
                          {gatewayResult.qrData}
                        </code>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Your balance will be credited automatically once payment
                      is confirmed.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {!manualEnabled && autoEnabled && (
            <Card className="wallet-full">
              <CardHeader>
                <CardTitle>Pay via gateway</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="depAmountAuto">Amount (₹)</Label>
                  <Input
                    id="depAmountAuto"
                    type="number"
                    inputMode="numeric"
                    min={depositLimits.data ? minRupees : 1}
                    max={depositLimits.data ? maxRupees : undefined}
                    step="1"
                    required
                    value={depAmount}
                    onChange={(e) => onAmountChange(e.target.value)}
                    data-testid="input-deposit-amount-auto"
                  />
                  {limitsHelp && (
                    <p className="text-xs text-muted-foreground">
                      {limitsHelp}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  disabled={createAutoDeposit.isPending}
                  onClick={onAutoDeposit}
                  data-testid="btn-deposit-auto"
                >
                  {createAutoDeposit.isPending
                    ? "Starting…"
                    : "Pay automatically (gateway)"}
                </Button>
                {gatewayResult && (
                  <div
                    className="mt-2 space-y-3 rounded-md border border-blue-500/40 bg-blue-500/10 p-3"
                    data-testid="gateway-result"
                  >
                    <p className="text-sm font-semibold text-blue-700">
                      Complete your payment
                    </p>
                    {gatewayResult.upiDeepLink && (
                      <a
                        href={gatewayResult.upiDeepLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block"
                      >
                        <Button variant="secondary" size="sm">
                          Open UPI App
                        </Button>
                      </a>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <RequestList
            title="Deposit history"
            rows={deposits.data ?? []}
            emptyText="No deposit requests yet."
            testId="list-deposits"
            onCancel={(id) => cancelDeposit.mutate({ id })}
            cancellingId={
              cancelDeposit.isPending
                ? (cancelDeposit.variables?.id ?? null)
                : null
            }
          />
        </TabsContent>

        <TabsContent value="withdraw" className="wallet-panel">
          <Card className="wallet-full">
            <CardHeader>
              <CardTitle>Request a withdrawal</CardTitle>
            </CardHeader>
            <CardContent>
              {!kycApproved ? (
                <div
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700"
                  data-testid="banner-kyc-required"
                >
                  Withdrawals are blocked until your KYC is approved.{" "}
                  <Link href="/profile" className="underline">
                    Complete KYC
                  </Link>
                  .
                </div>
              ) : (
                <form onSubmit={onWithdraw} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="wAmount">Amount (₹)</Label>
                      <Input
                        id="wAmount"
                        type="number"
                        inputMode="numeric"
                        min={withdrawLimits.data ? wMinRupees : 1}
                        max={withdrawLimits.data ? wMaxRupees : undefined}
                        step="1"
                        required
                        value={wAmount}
                        onChange={(e) => setWAmount(e.target.value)}
                        data-testid="input-withdraw-amount"
                      />
                      {withdrawLimitsHelp && (
                        <p
                          className="text-xs text-muted-foreground"
                          data-testid="text-withdraw-limits"
                        >
                          {withdrawLimitsHelp}
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="wUpiId">Your UPI ID</Label>
                      <Input
                        id="wUpiId"
                        required
                        minLength={4}
                        placeholder="name@bank"
                        value={wUpiId}
                        onChange={(e) => setWUpiId(e.target.value)}
                        data-testid="input-withdraw-upi"
                      />
                    </div>
                  </div>
                  <Button
                    type="submit"
                    disabled={createWithdraw.isPending}
                    data-testid="btn-withdraw-submit"
                  >
                    {createWithdraw.isPending
                      ? "Submitting…"
                      : "Submit withdrawal"}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <RequestList
            title="Withdrawal history"
            rows={withdrawals.data ?? []}
            emptyText="No withdrawal requests yet."
            testId="list-withdrawals"
            onCancel={(id) => cancelWithdrawal.mutate({ id })}
            cancellingId={
              cancelWithdrawal.isPending
                ? (cancelWithdrawal.variables?.id ?? null)
                : null
            }
          />
        </TabsContent>
        <TabsContent value="history"><PaymentHistory /></TabsContent>
      </Tabs>
    </SiteLayout>
  );
}

function RequestList({
  title,
  rows,
  emptyText,
  testId,
  onCancel,
  cancellingId,
}: {
  title: string;
  rows: Array<{
    id: string;
    amount: string;
    status: string;
    createdAt: string | Date;
    upiRef?: string | null;
    upiId?: string | null;
    rejectionReason?: string | null;
    game?: string;
    packageSku?: string | null;
    coinQuantity?: number | null;
  }>;
  emptyText: string;
  testId: string;
  onCancel?: (id: string) => void;
  cancellingId?: string | null;
}) {
  return (
    <Card className="wallet-full">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="wallet-empty">
            <ReceiptText />
            <p>{emptyText}</p>
          </div>
        ) : (
          <div className="space-y-2" data-testid={testId}>
            {rows.map((r) => {
              const cancellable =
                onCancel &&
                (r.status === "pending" || r.status === "gateway_pending");
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-card-border bg-muted/20 p-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-bold">
                      ₹{formatRupees(r.amount)}
                    </div>
                    {/* Legacy rows have no SKU — they simply omit this line. */}
                    {r.packageSku && (
                      <div
                        className="text-xs text-muted-foreground truncate"
                        data-testid={`text-deposit-pack-${r.id}`}
                      >
                        {r.coinQuantity
                          ? `${r.coinQuantity.toLocaleString("en-IN")} coins • `
                          : ""}
                        <span className="font-mono">{r.packageSku}</span>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground truncate">
                      {new Date(r.createdAt).toLocaleString()}
                      {r.upiRef ? ` • ref ${r.upiRef}` : ""}
                      {r.upiId ? ` • ${r.upiId}` : ""}
                    </div>
                    {r.rejectionReason && (
                      <div className="text-xs text-destructive">
                        Rejected: {r.rejectionReason}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.status} />
                    {cancellable && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onCancel?.(r.id)}
                        disabled={cancellingId === r.id}
                        data-testid={`btn-cancel-${r.id}`}
                      >
                        {cancellingId === r.id ? "Cancelling…" : "Cancel"}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
