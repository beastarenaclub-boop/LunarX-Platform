import type {
  User,
  WalletLedgerEntry,
  KycSubmission,
  PaymentRequest,
  Bet,
  UpiAccount,
} from "@workspace/db";

export const DEMO_EMAIL_PREFIX = "demo_";
export const DEMO_EMAIL_DOMAIN = "@demo.lunar.local";

export function isDemoUser(u: Pick<User, "email" | "role">): boolean {
  return (
    u.role === "player" &&
    u.email.startsWith(DEMO_EMAIL_PREFIX) &&
    u.email.endsWith(DEMO_EMAIL_DOMAIN)
  );
}

function upiQrUrl(key: string | null): string | null {
  if (!key) return null;
  return `/api/payments/upi-accounts/qr/${key}`;
}

export function upiAccount(a: UpiAccount) {
  return {
    id: a.id,
    label: a.label,
    upiId: a.upiId,
    qrUrl: upiQrUrl(a.qrObjectKey),
    active: a.active,
    sortOrder: a.sortOrder,
    createdBy: a.createdBy,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

export function publicUpiAccount(a: UpiAccount) {
  return {
    id: a.id,
    label: a.label,
    upiId: a.upiId,
    qrUrl: upiQrUrl(a.qrObjectKey),
  };
}

export function publicUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    status: u.status,
    displayName: u.displayName,
    referralCode: u.referralCode,
    channel: u.channel,
    isDemo: isDemoUser(u),
    createdAt: u.createdAt.toISOString(),
  };
}

export function ledgerEntry(e: WalletLedgerEntry) {
  return {
    id: e.id,
    walletId: e.walletId,
    userId: e.userId,
    type: e.type,
    amount: e.amount.toString(),
    balanceAfter: e.balanceAfter.toString(),
    refType: e.refType,
    refId: e.refId,
    memo: e.memo,
    createdAt: e.createdAt.toISOString(),
  };
}

export function paymentRequest(p: PaymentRequest) {
  return {
    id: p.id,
    userId: p.userId,
    kind: p.kind,
    method: p.method,
    amount: p.amount.toString(),
    currency: p.currency,
    // Which per-game wallet the request targets, plus the coin-pack identity
    // when the deposit came from the catalog. Legacy rows (and custom amounts)
    // carry null SKU/coin values and must keep rendering normally.
    game: p.game,
    packageSku: p.packageSku ?? null,
    coinQuantity: p.coinQuantity ?? null,
    status: p.status,
    upiRef: p.upiRef,
    upiId: p.upiId,
    notes: p.notes,
    rejectionReason: p.rejectionReason,
    processedBy: p.processedBy,
    gatewayOrderId: p.gatewayOrderId ?? null,
    gatewayStatus: p.gatewayStatus ?? null,
    processedAt: p.processedAt ? p.processedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function bet(b: Bet) {
  return {
    id: b.id,
    userId: b.userId,
    gameCode: b.gameCode,
    roundId: b.roundId,
    stakeAmount: b.stakeAmount.toString(),
    payoutAmount: b.payoutAmount.toString(),
    multiplier: b.multiplier,
    status: b.status,
    placedAt: b.placedAt.toISOString(),
    settledAt: b.settledAt ? b.settledAt.toISOString() : null,
  };
}

export function kycSubmission(k: KycSubmission) {
  return {
    id: k.id,
    userId: k.userId,
    fullName: k.fullName,
    documentType: k.documentType,
    documentNumber: k.documentNumber,
    idDocumentKey: k.idDocumentKey,
    selfieKey: k.selfieKey,
    status: k.status,
    rejectionReason: k.rejectionReason,
    reviewedBy: k.reviewedBy,
    reviewedAt: k.reviewedAt ? k.reviewedAt.toISOString() : null,
    submittedAt: k.submittedAt.toISOString(),
  };
}
