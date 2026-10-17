export type Role = "admin" | "agent" | "user";
export type Review =
  | "Not started"
  | "In review"
  | "Verified"
  | "Changes requested";
export type Member = {
  id: string;
  name: string;
  city: string;
  ref: string;
  parent: string | null;
  side: "left" | "right";
  kyc: Review;
  joined: string;
  documents: Record<string, string>;
  accounts: string[];
  video: boolean;
  consent: boolean;
};
export type Task = {
  id: string;
  title: string;
  description: string;
  assignee: string;
  by: string;
  due: string;
  priority: string;
  status: "To do" | "In progress" | "In review" | "Complete";
};
export type Expense = {
  id: string;
  member: string;
  title: string;
  category: string;
  amount: number;
  receipt: string;
  status: "Pending" | "Approved" | "Rejected";
  note: string;
  date: string;
};
export type Activity = {
  id: string;
  title: string;
  detail: string;
  time: string;
  member: string;
  kind: string;
};
export type Ledger = {
  id: string;
  member: string;
  title: string;
  amount: number;
  type: "Pay in" | "Pay out";
  status: "Pending" | "Approved";
  date: string;
};
export type Data = {
  version: number;
  members: Member[];
  tasks: Task[];
  expenses: Expense[];
  activity: Activity[];
  ledger: Ledger[];
};
export const requiredDocs = [
  "Find a shop",
  "Firm registration",
  "Rent agreement",
  "Electricity bill",
  "Identity proof",
];
const docs = Object.fromEntries(
  requiredDocs.map((d, i) => [d, `demo-document-${i + 1}.pdf`]),
);
const accounts = ["1204", "5678", "9032", "4410", "7651"];
const member = (
  id: string,
  name: string,
  city: string,
  ref: string,
  parent: string | null,
  side: "left" | "right",
  kyc: Review,
): Member => ({
  id,
  name,
  city,
  ref,
  parent,
  side,
  kyc,
  joined: "2026-10-08",
  documents: kyc === "Not started" ? {} : { ...docs },
  accounts: kyc === "Not started" ? [] : [...accounts],
  video: kyc !== "Not started",
  consent: kyc !== "Not started",
});
export const seed: Data = {
  version: 1,
  members: [
    member(
      "m1",
      "Aarav Sharma",
      "New Delhi",
      "SYN-AARAV",
      null,
      "left",
      "Verified",
    ),
    member("m2", "Riya Mehta", "Jaipur", "SYN-RIYA", "m1", "left", "Verified"),
    member(
      "m3",
      "Kabir Verma",
      "Lucknow",
      "SYN-KABIR",
      "m1",
      "right",
      "Verified",
    ),
    member("m4", "Neha Kapoor", "Jaipur", "SYN-NEHA", "m2", "left", "Verified"),
    member(
      "m5",
      "Arjun Singh",
      "Ajmer",
      "SYN-ARJUN",
      "m2",
      "right",
      "Verified",
    ),
    member("m6", "Zoya Khan", "Kanpur", "SYN-ZOYA", "m3", "left", "In review"),
  ],
  tasks: [
    {
      id: "t1",
      title: "Verify the new shop location",
      description:
        "Review the shop checklist and confirm the location details with your upline.",
      assignee: "m3",
      by: "m1",
      due: "2026-10-12",
      priority: "High",
      status: "In progress",
    },
    {
      id: "t2",
      title: "Upload this month’s electricity bill",
      description:
        "Add a sample bill to the KYC checklist, then submit this task for review.",
      assignee: "m3",
      by: "m1",
      due: "2026-10-14",
      priority: "Normal",
      status: "To do",
    },
    {
      id: "t3",
      title: "Review the Jaipur office setup",
      description: "Confirm the desk and signage installation checklist.",
      assignee: "m2",
      by: "m1",
      due: "2026-10-11",
      priority: "High",
      status: "In review",
    },
    {
      id: "t4",
      title: "Complete firm documentation",
      description: "Confirm all demo documents are present.",
      assignee: "m4",
      by: "m2",
      due: "2026-10-09",
      priority: "Normal",
      status: "Complete",
    },
  ],
  expenses: [
    {
      id: "e1",
      member: "m2",
      title: "Office signage & installation",
      category: "Office setup",
      amount: 2450,
      receipt: "signage-demo.pdf",
      status: "Pending",
      note: "",
      date: "2026-10-10",
    },
    {
      id: "e2",
      member: "m1",
      title: "Shop site visit",
      category: "Travel",
      amount: 850,
      receipt: "travel-demo.pdf",
      status: "Approved",
      note: "Site visit approved.",
      date: "2026-10-09",
    },
    {
      id: "e3",
      member: "m2",
      title: "October workspace rent",
      category: "Rent",
      amount: 8000,
      receipt: "rent-demo.pdf",
      status: "Pending",
      note: "",
      date: "2026-10-10",
    },
  ],
  activity: [
    {
      id: "a1",
      title: "KYC submitted for review",
      detail: "Zoya Khan completed the onboarding checklist.",
      time: "2026-10-10T10:42:00+05:30",
      member: "m6",
      kind: "kyc",
    },
    {
      id: "a2",
      title: "New expense request",
      detail: "Riya Mehta · Office signage · ₹2,450",
      time: "2026-10-10T10:15:00+05:30",
      member: "m2",
      kind: "expense",
    },
    {
      id: "a3",
      title: "Task ready for review",
      detail: "Jaipur office setup has been submitted.",
      time: "2026-10-10T09:30:00+05:30",
      member: "m2",
      kind: "task",
    },
    {
      id: "a4",
      title: "Travel expense approved",
      detail: "Shop site visit · ₹850",
      time: "2026-10-09T16:20:00+05:30",
      member: "m1",
      kind: "expense",
    },
  ],
  ledger: [
    {
      id: "l1",
      member: "m1",
      title: "October operating allowance",
      amount: 15000,
      type: "Pay in",
      status: "Approved",
      date: "2026-10-08",
    },
    {
      id: "l2",
      member: "m1",
      title: "Shop site visit reimbursement",
      amount: 850,
      type: "Pay out",
      status: "Approved",
      date: "2026-10-09",
    },
    {
      id: "l3",
      member: "m2",
      title: "Office setup allowance",
      amount: 10000,
      type: "Pay in",
      status: "Pending",
      date: "2026-10-10",
    },
  ],
};
export const STORAGE = "syndicate-demo-v1";
export const cloneSeed = (): Data => JSON.parse(JSON.stringify(seed));
export function readData(): Data {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE) || "null");
    return d?.version === 1 &&
      Array.isArray(d.members) &&
      d.members.length &&
      Array.isArray(d.tasks) &&
      Array.isArray(d.expenses) &&
      Array.isArray(d.activity) &&
      Array.isArray(d.ledger)
      ? d
      : cloneSeed();
  } catch {
    return cloneSeed();
  }
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(n);
export const initials = (s: string) =>
  s
    .split(" ")
    .map((v) => v[0])
    .slice(0, 2)
    .join("");
export const direct = (d: Data, id: string) =>
  d.members.filter((m) => m.parent === id);
export const isAgent = (d: Data, id: string) =>
  d.members.find((m) => m.id === id)?.kyc === "Verified" &&
  direct(d, id).filter((m) => m.kyc === "Verified").length === 2;
export function descendants(d: Data, id: string): Member[] {
  const children = direct(d, id);
  return children.flatMap((m) => [m, ...descendants(d, m.id)]);
}
export function log(
  d: Data,
  title: string,
  detail: string,
  member: string,
  kind: string,
) {
  d.activity.unshift({
    id: crypto.randomUUID(),
    title,
    detail,
    member,
    kind,
    time: new Date().toISOString(),
  });
}
export const dateLabel = (date: string) =>
  new Date(date).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  });
export function onboardingComplete(m: Member) {
  return (
    requiredDocs.every((key) => m.documents[key]) &&
    m.accounts.length === 5 &&
    m.accounts.every((a) => /^\d{4}$/.test(a)) &&
    m.video &&
    m.consent
  );
}
