export type AccessRole = "admin" | "agent" | "user";
export type ReviewStatus =
  | "Draft"
  | "In review"
  | "Approved"
  | "Changes requested";
export type BankAccount = {
  id: string;
  bank: string;
  type: "Current" | "Savings";
  last4: string;
  holder: string;
  contact: number;
  requestedLimit: number;
  approvedLimit: number;
  status: "Pending" | "Approved";
  owned: boolean;
};
export type Profile = {
  firm?: string;
  gst?: string;
  plan?: string;
  contacts?: { label: string; last4: string }[];
  accounts?: BankAccount[];
  ownership?: boolean;
  consent?: boolean;
  reviewNote?: string;
  bankPreferences?: string[];
};
export type LiveMember = {
  id: string;
  name: string;
  email?: string;
  city: string;
  ref: string;
  parent: string | null;
  sponsor?: { id: string; name: string; ref: string } | null;
  position: "left" | "right";
  role: AccessRole;
  status: ReviewStatus;
  profile: Profile;
  revision: number;
  created_at: string;
  documentCount?: number;
  accountCount?: number;
  onboardingPercent?: number;
};
export type LiveTask = {
  completed_at?: string | null;
  id: string;
  title: string;
  description: string;
  assignee: string;
  assigned_by: string;
  due: string;
  status: "To do" | "In progress" | "In review" | "Complete";
  created_at: string;
};
export type EntryKind = "Turnover" | "Income" | "Expense";
export type Entry = {
  id: string;
  member_id: string;
  account_id: string | null;
  kind: EntryKind;
  amount_paise: number;
  reference: string;
  description: string;
  date: string;
  status: "Pending" | "Approved" | "Rejected";
  source: "Manual" | "API" | "Allowance";
  created_by: string;
  reviewed_by: string | null;
  created_at: string;
};
export type DocumentRecord = {
  id: string;
  member_id: string;
  kind: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
};
export type AuditRecord = {
  id: string;
  actor: string;
  action: string;
  subject: string;
  detail: string;
  ip: string;
  country: string | null;
  city: string | null;
  location: string | null;
  user_agent: string;
  created_at: string;
};
export type Snapshot = {
  registrations?: {
    id: string;
    name: string;
    email: string;
    created_at: string;
  }[];
  rewards?: import("./commissions").RewardState;
  identity: {
    name: string;
    email: string;
    passwordLogin?: boolean;
    signupPortal?: import("./portals").Portal;
  };
  me: LiveMember | null;
  setupRequired: boolean;
  members: LiveMember[];
  documents: DocumentRecord[];
  tasks: LiveTask[];
  entries: Entry[];
  audit: AuditRecord[];
  tokens: {
    id: string;
    name: string;
    created_at: string;
    revoked_at: string | null;
  }[];
  settings: {
    company: string;
    business: string;
    license: string;
  };
  serverTime: string;
};
export const DOCUMENT_KINDS = [
  "Shop proof",
  "Firm registration",
  "Rent agreement",
  "Electricity bill",
  "Identity proof",
  "GST document",
  "Video KYC",
] as const;
export const PLAN = "Merchant onboarding";
export function accountProofKind(a: BankAccount) {
  return `Account proof:${JSON.stringify([a.id, a.bank, a.type, a.last4, a.holder])}`;
}
export function documentLabel(d: DocumentRecord, p: Profile) {
  if (d.kind.startsWith("Expense receipt:")) return "Expense receipt";
  const a = p.accounts?.find((a) => accountProofKind(a) === d.kind);
  return a
    ? `${a.bank} · ${a.type} · •••• ${a.last4} · Bank proof`
    : d.kind.startsWith("Account proof:")
      ? "Previous account proof (account details changed)"
      : d.kind;
}
export function accountSummary(m: LiveMember, documents: DocumentRecord[]) {
  const accounts = m.profile.accounts || [];
  const ownDocs = documents.filter((d) => d.member_id === m.id);
  return {
    total: accounts.length,
    current: accounts.filter((a) => a.type === "Current").length,
    savings: accounts.filter((a) => a.type === "Savings").length,
    approved: accounts.filter((a) => a.status === "Approved").length,
    proofs: accounts.filter((a) =>
      ownDocs.some((d) => d.kind === accountProofKind(a)),
    ).length,
    documents: DOCUMENT_KINDS.filter((kind) =>
      ownDocs.some((d) => d.kind === kind),
    ).length,
  };
}
export function progress(m: LiveMember, documents: DocumentRecord[]) {
  const p = m.profile;
  const docs = documents.filter((d) => d.member_id === m.id);
  const checks = [
    {
      label: "Registered firm and valid-format GSTIN",
      done:
        !!p.firm?.trim() &&
        /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(p.gst || ""),
    },
    {
      label: "Two registered contact references",
      done:
        p.contacts?.length === 2 &&
        p.contacts.every((c) => /^\d{4}$/.test(c.last4)),
    },
    {
      label: "Five business current account references",
      done: p.accounts?.filter((a) => a.type === "Current").length === 5,
    },
    {
      label: "Two savings account references",
      done: p.accounts?.filter((a) => a.type === "Savings").length === 2,
    },
    {
      label: "Bank proof for each of the seven accounts",
      done: accountSummary(m, documents).proofs === 7,
    },
    ...DOCUMENT_KINDS.map((kind) => ({
      label: kind,
      done: docs.some((d) => d.kind === kind),
    })),
    {
      label: "Ownership and review consent",
      done: !!p.ownership && !!p.consent,
    },
  ];
  return {
    checks,
    percent: Math.round(
      (checks.filter((c) => c.done).length / checks.length) * 100,
    ),
    complete: checks.every((c) => c.done),
  };
}
export const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(paise / 100);
export const dayIST = (date: Date | string = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export function isDate(s: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !isNaN(Date.parse(s)) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s
  );
}
export const amountPaise = (value: unknown) => {
  const s = String(value);
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s))
    throw new Error("Enter a positive amount with at most two decimal places.");
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new Error("Amount must be greater than zero.");
  return n;
};
