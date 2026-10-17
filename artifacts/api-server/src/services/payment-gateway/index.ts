import type { PaymentProvider } from "./types";
import { StubProvider } from "./stub-provider";
import { CashfreeProvider } from "./cashfree-provider";
import { logger } from "../../lib/logger";

export type { PaymentProvider } from "./types";
export type {
  DepositOrder,
  PayoutResult,
  WebhookPayload,
  GatewayTransaction,
} from "./types";

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const name = (process.env.PAYMENT_PROVIDER ?? "stub").toLowerCase();

  switch (name) {
    case "cashfree": {
      _provider = new CashfreeProvider();
      break;
    }
    case "stub":
    default: {
      _provider = new StubProvider();
      break;
    }
  }

  logger.info({ provider: _provider.name }, "Payment provider initialized");
  return _provider;
}

export function isGatewayEnabled(): boolean {
  const name = (process.env.PAYMENT_PROVIDER ?? "stub").toLowerCase();
  return name !== "stub" && name !== "";
}
