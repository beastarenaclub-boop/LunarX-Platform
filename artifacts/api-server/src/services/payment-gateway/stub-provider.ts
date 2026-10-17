import { nanoid } from "nanoid";
import type {
  PaymentProvider,
  DepositOrder,
  PayoutResult,
  WebhookPayload,
  GatewayTransaction,
} from "./types";

export class StubProvider implements PaymentProvider {
  readonly name = "stub";

  private deposits = new Map<string, DepositOrder>();
  private payouts = new Map<string, PayoutResult>();

  async createDepositOrder(params: {
    orderId: string;
    amount: bigint;
    currency: string;
  }): Promise<DepositOrder> {
    const order: DepositOrder = {
      gatewayOrderId: `stub_dep_${nanoid(12)}`,
      amount: params.amount,
      currency: params.currency,
      upiDeepLink: `upi://pay?pa=merchant@upi&am=${Number(params.amount) / 100}&tr=${params.orderId}`,
      qrData: null,
      status: "created",
    };
    this.deposits.set(order.gatewayOrderId, order);
    return order;
  }

  async verifyWebhook(params: {
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }): Promise<WebhookPayload> {
    const parsed = JSON.parse(params.body);
    return {
      type: parsed.type ?? "deposit",
      gatewayOrderId: parsed.gatewayOrderId ?? parsed.gateway_order_id,
      status: parsed.status ?? "paid",
      amount: BigInt(parsed.amount ?? "0"),
      currency: parsed.currency ?? "INR",
      utr: parsed.utr ?? null,
      raw: parsed,
    };
  }

  async createPayout(params: {
    payoutId: string;
    amount: bigint;
    currency: string;
    upiId: string;
    purpose?: string;
  }): Promise<PayoutResult> {
    const result: PayoutResult = {
      gatewayPayoutId: `stub_pay_${nanoid(12)}`,
      status: "completed",
      utr: `STUB${Date.now()}`,
      failureReason: null,
    };
    this.payouts.set(result.gatewayPayoutId, result);
    return result;
  }

  async getPayoutStatus(gatewayPayoutId: string): Promise<PayoutResult> {
    const existing = this.payouts.get(gatewayPayoutId);
    if (existing) return existing;
    return {
      gatewayPayoutId,
      status: "completed",
      utr: `STUB${Date.now()}`,
      failureReason: null,
    };
  }

  async listSettlements(params: {
    from: Date;
    to: Date;
  }): Promise<GatewayTransaction[]> {
    return [];
  }
}
