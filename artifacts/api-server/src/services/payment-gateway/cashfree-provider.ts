import crypto from "crypto";
import type {
  PaymentProvider,
  DepositOrder,
  PayoutResult,
  WebhookPayload,
  GatewayTransaction,
} from "./types";
import { logger } from "../../lib/logger";

function env(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var ${key}`);
  return v;
}

function baseUrl(): string {
  const mode = process.env.CASHFREE_MODE ?? "sandbox";
  return mode === "production"
    ? "https://api.cashfree.com"
    : "https://sandbox.cashfree.com";
}

async function cfFetch<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const url = `${baseUrl()}${path}`;
  const headers: Record<string, string> = {
    "x-client-id": env("CASHFREE_APP_ID"),
    "x-client-secret": env("CASHFREE_SECRET_KEY"),
    "x-api-version": "2023-08-01",
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  const body = init.json ? JSON.stringify(init.json) : init.body;
  const res = await fetch(url, {
    ...init,
    headers,
    body: body as string | undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    logger.error({ status: res.status, body: text, path }, "Cashfree API error");
    throw new Error(`Cashfree ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : ({} as T);
}

export class CashfreeProvider implements PaymentProvider {
  readonly name = "cashfree";

  async createDepositOrder(params: {
    orderId: string;
    amount: bigint;
    currency: string;
    customerEmail?: string;
    customerPhone?: string;
    returnUrl?: string;
    game?: string;
    packageSku?: string | null;
    coinQuantity?: number | null;
  }): Promise<DepositOrder> {
    const amountRupees = Number(params.amount) / 100;
    // Carry the coin-pack identity to the gateway so a settlement report can be
    // reconciled back to exactly what was purchased, for which game wallet.
    const tags: Record<string, string> = {};
    if (params.game) tags.game = params.game;
    if (params.packageSku) tags.package_sku = params.packageSku;
    if (params.coinQuantity != null) {
      tags.coin_quantity = String(params.coinQuantity);
    }
    const payload: Record<string, unknown> = {
      order_id: params.orderId,
      order_amount: amountRupees,
      order_currency: params.currency,
      customer_details: {
        customer_id: params.orderId,
        customer_email: params.customerEmail ?? "player@example.com",
        customer_phone: params.customerPhone ?? "9999999999",
      },
      order_meta: {
        return_url: params.returnUrl ?? undefined,
        payment_methods: "upi",
      },
      ...(Object.keys(tags).length > 0 ? { order_tags: tags } : {}),
    };
    const data = await cfFetch<{
      cf_order_id: string;
      order_id: string;
      order_status: string;
      payment_session_id?: string;
    }>("/pg/orders", { method: "POST", json: payload });

    return {
      gatewayOrderId: data.cf_order_id ?? data.order_id,
      amount: params.amount,
      currency: params.currency,
      upiDeepLink: null,
      qrData: data.payment_session_id ?? null,
      status: "created",
    };
  }

  async verifyWebhook(params: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }): Promise<WebhookPayload> {
    const sig =
      params.headers["x-cashfree-signature"] ??
      params.headers["X-Cashfree-Signature"];
    const ts =
      params.headers["x-cashfree-timestamp"] ??
      params.headers["X-Cashfree-Timestamp"];

    const sigStr = Array.isArray(sig) ? sig[0] : sig;
    const tsStr = Array.isArray(ts) ? ts[0] : ts;

    if (!sigStr || !tsStr) {
      throw new Error("Missing required webhook signature headers");
    }

    const secret = env("CASHFREE_SECRET_KEY");
    const rawPayload = tsStr + params.body;
    const expected = crypto
      .createHmac("sha256", secret)
      .update(rawPayload)
      .digest("base64");
    const sigBuf = Buffer.from(sigStr);
    const expectedBuf = Buffer.from(expected);
    if (
      sigBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(sigBuf, expectedBuf)
    ) {
      throw new Error("Invalid webhook signature");
    }

    const data = JSON.parse(params.body);
    const eventType: string = data.type ?? "";
    const txData = data.data?.payment ?? data.data?.payout ?? data.data ?? {};

    const isDeposit = eventType.startsWith("PAYMENT") || eventType.startsWith("ORDER");
    const isPayout = eventType.startsWith("PAYOUT") || eventType.startsWith("TRANSFER");

    const statusMap: Record<string, string> = {
      SUCCESS: "paid",
      FAILED: "failed",
      USER_DROPPED: "failed",
      CANCELLED: "failed",
      VOID: "failed",
      EXPIRED: "expired",
      REVERSED: "reversed",
      PROCESSED: "completed",
      REJECTED: "failed",
      PENDING: "pending",
    };

    const rawStatus: string = txData.payment_status ?? txData.transfer_status ?? txData.status ?? "";
    const normalizedStatus = statusMap[rawStatus] ?? rawStatus.toLowerCase();

    const rawAmount = txData.payment_amount ?? txData.transfer_amount ?? txData.order_amount ?? 0;

    return {
      type: isPayout ? "payout" : "deposit",
      gatewayOrderId:
        txData.cf_order_id ??
        txData.order_id ??
        txData.cf_transfer_id ??
        txData.transfer_id ??
        "",
      status: normalizedStatus,
      amount: BigInt(Math.round(Number(rawAmount) * 100)),
      currency: txData.payment_currency ?? txData.transfer_currency ?? "INR",
      utr: txData.bank_reference ?? txData.utr ?? null,
      raw: data,
    };
  }

  async createPayout(params: {
    payoutId: string;
    amount: bigint;
    currency: string;
    upiId: string;
    purpose?: string;
  }): Promise<PayoutResult> {
    const amountRupees = Number(params.amount) / 100;
    const payload = {
      transfer_id: params.payoutId,
      transfer_amount: amountRupees,
      transfer_currency: params.currency,
      transfer_mode: "upi",
      beneficiary_details: {
        beneficiary_id: params.payoutId,
        beneficiary_name: "Player",
        beneficiary_vpa: params.upiId,
      },
      transfer_remarks: params.purpose ?? "Withdrawal payout",
    };
    const data = await cfFetch<{
      cf_transfer_id?: string;
      transfer_id?: string;
      status?: string;
      status_code?: string;
      utr?: string;
      message?: string;
    }>("/payout/v1/authorize", { method: "POST", json: payload }).catch(
      () => null,
    );

    if (!data) {
      return {
        gatewayPayoutId: params.payoutId,
        status: "failed",
        utr: null,
        failureReason: "Gateway request failed",
      };
    }

    const statusMap: Record<string, PayoutResult["status"]> = {
      SUCCESS: "completed",
      PENDING: "pending",
      PROCESSING: "processing",
      FAILED: "failed",
      REJECTED: "failed",
      REVERSED: "reversed",
    };

    return {
      gatewayPayoutId: data.cf_transfer_id ?? data.transfer_id ?? params.payoutId,
      status: statusMap[data.status ?? ""] ?? "pending",
      utr: data.utr ?? null,
      failureReason: data.status === "FAILED" ? (data.message ?? null) : null,
    };
  }

  async getPayoutStatus(gatewayPayoutId: string): Promise<PayoutResult> {
    const data = await cfFetch<{
      cf_transfer_id?: string;
      transfer_id?: string;
      status?: string;
      utr?: string;
      message?: string;
    }>(`/payout/v1/getTransferStatus?transferId=${encodeURIComponent(gatewayPayoutId)}`);

    const statusMap: Record<string, PayoutResult["status"]> = {
      SUCCESS: "completed",
      PENDING: "pending",
      PROCESSING: "processing",
      FAILED: "failed",
      REJECTED: "failed",
      REVERSED: "reversed",
    };

    return {
      gatewayPayoutId: data.cf_transfer_id ?? data.transfer_id ?? gatewayPayoutId,
      status: statusMap[data.status ?? ""] ?? "pending",
      utr: data.utr ?? null,
      failureReason: data.status === "FAILED" ? (data.message ?? null) : null,
    };
  }

  async listSettlements(params: {
    from: Date;
    to: Date;
  }): Promise<GatewayTransaction[]> {
    const fromStr = params.from.toISOString().split("T")[0];
    const toStr = params.to.toISOString().split("T")[0];

    const [depositTxns, payoutTxns] = await Promise.all([
      this.fetchDepositSettlements(fromStr, toStr),
      this.fetchPayoutSettlements(fromStr, toStr),
    ]);

    return [...depositTxns, ...payoutTxns];
  }

  private async fetchDepositSettlements(
    fromStr: string,
    toStr: string,
  ): Promise<GatewayTransaction[]> {
    try {
      const data = await cfFetch<{
        settlements?: Array<{
          cf_order_id?: string;
          order_id?: string;
          order_amount?: number;
          payment_amount?: number;
          order_currency?: string;
          order_status?: string;
          bank_reference?: string;
          payment_time?: string;
        }>;
      }>(
        `/pg/orders?order_status=PAID&start_date=${fromStr}&end_date=${toStr}`,
      );
      return (data.settlements ?? []).map((s) => ({
        gatewayOrderId: s.cf_order_id ?? s.order_id ?? "",
        type: "deposit" as const,
        amount: BigInt(Math.round((s.payment_amount ?? s.order_amount ?? 0) * 100)),
        currency: s.order_currency ?? "INR",
        status: (s.order_status ?? "").toLowerCase(),
        utr: s.bank_reference ?? null,
        settledAt: s.payment_time ? new Date(s.payment_time) : null,
      }));
    } catch (err) {
      logger.error({ err }, "Failed to list gateway deposit settlements");
      return [];
    }
  }

  private async fetchPayoutSettlements(
    fromStr: string,
    toStr: string,
  ): Promise<GatewayTransaction[]> {
    try {
      const data = await cfFetch<{
        transfers?: Array<{
          cf_transfer_id?: string;
          transfer_id?: string;
          transfer_amount?: number;
          transfer_currency?: string;
          status?: string;
          utr?: string;
          processed_on?: string;
        }>;
      }>(
        `/payout/v1/getTransfers?startDate=${fromStr}&endDate=${toStr}`,
      );
      const statusMap: Record<string, string> = {
        SUCCESS: "completed",
        PENDING: "pending",
        PROCESSING: "processing",
        FAILED: "failed",
        REJECTED: "failed",
        REVERSED: "reversed",
      };
      return (data.transfers ?? []).map((t) => ({
        gatewayOrderId: t.cf_transfer_id ?? t.transfer_id ?? "",
        type: "payout" as const,
        amount: BigInt(Math.round((t.transfer_amount ?? 0) * 100)),
        currency: t.transfer_currency ?? "INR",
        status: statusMap[t.status ?? ""] ?? (t.status ?? "").toLowerCase(),
        utr: t.utr ?? null,
        settledAt: t.processed_on ? new Date(t.processed_on) : null,
      }));
    } catch (err) {
      logger.error({ err }, "Failed to list gateway payout settlements");
      return [];
    }
  }
}
