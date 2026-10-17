export interface DepositOrder {
  gatewayOrderId: string;
  amount: bigint;
  currency: string;
  upiDeepLink?: string | null;
  qrData?: string | null;
  status: "created" | "paid" | "failed" | "expired";
}

export interface PayoutResult {
  gatewayPayoutId: string;
  status: "pending" | "processing" | "completed" | "failed" | "reversed";
  utr?: string | null;
  failureReason?: string | null;
}

export interface WebhookPayload {
  type: "deposit" | "payout";
  gatewayOrderId: string;
  status: string;
  amount: bigint;
  currency: string;
  utr?: string | null;
  raw: Record<string, unknown>;
}

export interface GatewayTransaction {
  gatewayOrderId: string;
  type: "deposit" | "payout";
  amount: bigint;
  currency: string;
  status: string;
  utr?: string | null;
  settledAt?: Date | null;
}

export interface PaymentProvider {
  readonly name: string;

  createDepositOrder(params: {
    orderId: string;
    amount: bigint;
    currency: string;
    customerEmail?: string;
    customerPhone?: string;
    returnUrl?: string;
    /** Per-game wallet the deposit credits (coin packs are game-scoped). */
    game?: string;
    /** Coin-pack SKU from the server catalog, when the player bought a pack. */
    packageSku?: string | null;
    /** Coins granted by that SKU (server-derived, never client-supplied). */
    coinQuantity?: number | null;
  }): Promise<DepositOrder>;

  verifyWebhook(params: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }): Promise<WebhookPayload>;

  createPayout(params: {
    payoutId: string;
    amount: bigint;
    currency: string;
    upiId: string;
    purpose?: string;
  }): Promise<PayoutResult>;

  getPayoutStatus(gatewayPayoutId: string): Promise<PayoutResult>;

  listSettlements(params: {
    from: Date;
    to: Date;
  }): Promise<GatewayTransaction[]>;
}
