// Standalone, browser-only demonstration. No real identities, banks, wallets,
// gameplay, network requests or persistence. Never use as server authorization.
export const ACTORS = [
  {
    id: "demo-admin",
    role: "admin",
    name: "Demo admin",
    masterId: null,
    agentId: null,
  },
  {
    id: "demo-master-east",
    role: "master",
    name: "East master",
    masterId: "demo-master-east",
    agentId: null,
  },
  {
    id: "demo-master-west",
    role: "master",
    name: "West master",
    masterId: "demo-master-west",
    agentId: null,
  },
  {
    id: "demo-agent-alpha",
    role: "agent",
    name: "Alpha agent",
    masterId: "demo-master-east",
    agentId: "demo-agent-alpha",
  },
  {
    id: "demo-agent-beta",
    role: "agent",
    name: "Beta agent",
    masterId: "demo-master-east",
    agentId: "demo-agent-beta",
  },
  {
    id: "demo-agent-gamma",
    role: "agent",
    name: "Gamma agent",
    masterId: "demo-master-west",
    agentId: "demo-agent-gamma",
  },
  {
    id: "demo-user-asha",
    role: "customer",
    name: "Asha (test customer)",
    masterId: "demo-master-east",
    agentId: "demo-agent-alpha",
  },
  {
    id: "demo-user-ravi",
    role: "customer",
    name: "Ravi (test customer)",
    masterId: "demo-master-east",
    agentId: "demo-agent-beta",
  },
  {
    id: "demo-user-neha",
    role: "customer",
    name: "Neha (test customer)",
    masterId: "demo-master-west",
    agentId: "demo-agent-gamma",
  },
] as const;
export type Actor = (typeof ACTORS)[number];
export type ActorId = Actor["id"];
export type RequestStatus = "pending" | "approved" | "rejected" | "cancelled";
export type DemoRequest = {
  id: string;
  customer: ActorId;
  master: ActorId;
  agent: ActorId;
  collector: ActorId;
  account: string | null;
  kind: "deposit" | "withdrawal";
  amount: number;
  status: RequestStatus;
  createdAt: string;
  reviewedBy?: ActorId;
  reviewedAt?: string;
};
export type DemoAccount = {
  id: string;
  owner: ActorId;
  slot: "A" | "B";
  active: boolean;
};
export type DemoState = {
  clock: string;
  sequence: number;
  masterModes: Record<string, "admin" | "master">;
  agentModes: Record<string, "master" | "agent">;
  teamActive: Record<string, boolean>;
  accounts: DemoAccount[];
  requests: DemoRequest[];
  balances: Record<string, number>;
  statements: {
    master: ActorId;
    income: number;
    rateBps: number;
    due: number;
    paid: number;
    dueAt: string;
  }[];
  settlements: {
    id: string;
    master: ActorId;
    amount: number;
    status: "pending" | "confirmed" | "rejected";
    createdAt: string;
    reviewedAt?: string;
  }[];
  audit: {
    id: string;
    actor: ActorId;
    action: string;
    detail: string;
    at: string;
  }[];
};
export const DEMO_CLOCKS = {
  monday: "2026-10-19T06:30:00.000Z",
  tuesday: "2026-10-19T18:30:00.000Z",
  wednesday: "2026-10-20T18:30:00.000Z",
} as const;
export function actor(id: string): Actor {
  const found = ACTORS.find((a) => a.id === id);
  if (!found) throw Error("Unknown demo identity");
  return found;
}
export const label = (id: string) => actor(id).name;
export function initialDemo(): DemoState {
  return {
    clock: DEMO_CLOCKS.monday,
    sequence: 1,
    masterModes: { "demo-master-east": "admin", "demo-master-west": "admin" },
    agentModes: Object.fromEntries(
      ACTORS.filter((a) => a.role === "agent").map((a) => [a.id, "master"]),
    ),
    teamActive: Object.fromEntries(
      ACTORS.filter((a) => a.role === "agent").map((a) => [a.id, true]),
    ),
    accounts: [
      {
        id: "demo-account-admin",
        owner: "demo-admin",
        slot: "A",
        active: true,
      },
    ],
    requests: [],
    balances: {},
    settlements: [],
    audit: [],
    statements: ACTORS.filter((a) => a.role === "master").map((a) => ({
      master: a.id,
      income: 1000,
      rateBps: 1000,
      due: 100,
      paid: 0,
      // Previous sample week: 12–19 Oct. Monday's 24-hour grace ends Tuesday 00:00 IST.
      dueAt: DEMO_CLOCKS.tuesday,
    })),
  };
}
export function inScope(viewer: Actor, customerOrNode: Actor): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.role === "master")
    return viewer.masterId === customerOrNode.masterId;
  if (viewer.role === "agent") return viewer.agentId === customerOrNode.agentId;
  return viewer.id === customerOrNode.id;
}
export function collectorFor(s: DemoState, customer: Actor): ActorId {
  if (customer.role !== "customer") throw Error("Choose a test customer");
  if (s.masterModes[customer.masterId] !== "master") return "demo-admin";
  return s.agentModes[customer.agentId] === "agent"
    ? customer.agentId
    : customer.masterId;
}
export function available(s: DemoState, customer: ActorId): number {
  return (
    (s.balances[customer] ?? 0) -
    s.requests
      .filter(
        (r) =>
          r.customer === customer &&
          r.kind === "withdrawal" &&
          r.status === "pending",
      )
      .reduce((sum, r) => sum + r.amount, 0)
  );
}
export function weeklyLocked(s: DemoState, master: ActorId): boolean {
  return (
    s.masterModes[master] === "master" &&
    s.statements.some(
      (x) =>
        x.master === master &&
        x.paid < x.due &&
        Date.parse(s.clock) >= Date.parse(x.dueAt),
    )
  );
}
export function canManageAccounts(s: DemoState, who: Actor): boolean {
  return (
    who.role === "admin" ||
    (who.role === "master" && s.masterModes[who.id] === "master") ||
    (who.role === "agent" &&
      s.masterModes[who.masterId] === "master" &&
      s.agentModes[who.id] === "agent")
  );
}
function requireCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw Error(message);
}
function amount(value: number) {
  requireCondition(
    Number.isSafeInteger(value) && value > 0 && value <= 1_000_000,
    "Use a whole number from 1 to 1,000,000 test credits",
  );
}
function clearForRoutingChange(s: DemoState, matches: (a: Actor) => boolean) {
  requireCondition(
    !ACTORS.some(
      (a) =>
        a.role === "customer" &&
        matches(a) &&
        ((s.balances[a.id] ?? 0) > 0 ||
          s.requests.some(
            (r) => r.customer === a.id && r.status === "pending",
          )),
    ),
    "Resolve pending requests and clear affected test balances before changing collection owner",
  );
}
export type DemoAction =
  | { type: "master-mode"; master: ActorId; mode: "admin" | "master" }
  | { type: "agent-mode"; agent: ActorId; mode: "master" | "agent" }
  | { type: "team-status"; agent: ActorId; active: boolean }
  | { type: "add-account"; slot: "A" | "B" }
  | { type: "account-status"; id: string; active: boolean }
  | {
      type: "request";
      kind: "deposit" | "withdrawal";
      amount: number;
      account?: string;
    }
  | { type: "review"; id: string; decision: "approved" | "rejected" }
  | { type: "cancel"; id: string }
  | { type: "submit-settlement"; amount: number }
  | {
      type: "review-settlement";
      id: string;
      decision: "confirmed" | "rejected";
    };

export function applyDemo(
  state: DemoState,
  actorId: ActorId,
  action: DemoAction,
): DemoState {
  const who = actor(actorId),
    s = structuredClone(state);
  const id = () => `demo-${s.sequence++}`;
  let detail = "";
  switch (action.type) {
    case "master-mode": {
      requireCondition(
        who.role === "admin",
        "Only the demo admin can assign master collection",
      );
      requireCondition(
        actor(action.master).role === "master",
        "Choose a master",
      );
      requireCondition(
        ["admin", "master"].includes(action.mode),
        "Invalid collection mode",
      );
      if (s.masterModes[action.master] === action.mode) return state;
      requireCondition(
        !weeklyLocked(s, action.master),
        "Resolve overdue sample commission before changing this branch's mode",
      );
      requireCondition(
        !s.settlements.some(
          (x) => x.master === action.master && x.status !== "rejected",
        ),
        "Reset the fictional scenario before changing a branch with pending or confirmed weekly receipts",
      );
      clearForRoutingChange(s, (a) => a.masterId === action.master);
      s.masterModes[action.master] = action.mode;
      // Returning to admin collection revokes previous agent delegations too.
      for (const a of ACTORS.filter(
        (a) => a.role === "agent" && a.masterId === action.master,
      ))
        s.agentModes[a.id] = "master";
      detail = `${label(action.master)}: ${action.mode} collection; agent delegations reset`;
      break;
    }
    case "agent-mode": {
      const agent = actor(action.agent);
      requireCondition(agent.role === "agent", "Choose an agent");
      requireCondition(
        who.role === "master" && who.id === agent.masterId,
        "Only this agent's master can delegate collection",
      );
      requireCondition(
        s.masterModes[who.id] === "master",
        "The admin must assign master collection first",
      );
      requireCondition(
        ["master", "agent"].includes(action.mode),
        "Invalid collection mode",
      );
      if (s.agentModes[agent.id] === action.mode) return state;
      clearForRoutingChange(s, (a) => a.agentId === agent.id);
      s.agentModes[agent.id] = action.mode;
      detail = `${agent.name}: ${action.mode} collection`;
      break;
    }
    case "team-status": {
      const agent = actor(action.agent);
      requireCondition(
        agent.role === "agent" &&
          (who.role === "admin" ||
            (who.role === "master" && who.id === agent.masterId)),
        "You can only manage your own demo team",
      );
      s.teamActive[agent.id] = action.active;
      detail = `${agent.name}: ${action.active ? "active" : "paused for new deposits"}`;
      break;
    }
    case "add-account": {
      requireCondition(
        canManageAccounts(s, who),
        "Collection permission is required to add a demo account",
      );
      requireCondition(
        ["A", "B"].includes(action.slot),
        "Choose a fictional account slot",
      );
      requireCondition(
        !s.accounts.some((a) => a.owner === who.id && a.slot === action.slot),
        "This demo account already exists; enable it instead",
      );
      s.accounts.push({
        id: id(),
        owner: who.id,
        slot: action.slot,
        active: true,
      });
      detail = `Added fictional account ${action.slot}`;
      break;
    }
    case "account-status": {
      const account = s.accounts.find((a) => a.id === action.id);
      requireCondition(
        account?.owner === who.id && canManageAccounts(s, who),
        "Only the assigned collector can manage this demo account",
      );
      requireCondition(
        action.active ||
          !s.requests.some(
            (r) => r.account === account.id && r.status === "pending",
          ),
        "Resolve pending deposits before disabling this demo account",
      );
      account.active = action.active;
      detail = `Fictional account ${account.slot}: ${action.active ? "enabled" : "disabled"}`;
      break;
    }
    case "request": {
      requireCondition(
        who.role === "customer",
        "Switch to a test customer to create a request",
      );
      amount(action.amount);
      requireCondition(
        ["deposit", "withdrawal"].includes(action.kind),
        "Invalid request kind",
      );
      const collector = collectorFor(s, who);
      if (action.kind === "deposit") {
        requireCondition(
          s.teamActive[who.agentId],
          "The demo agent is paused; new deposits are unavailable",
        );
        requireCondition(
          !weeklyLocked(s, who.masterId),
          "Demo branch locked after Monday grace; settle its sample weekly commission first",
        );
        requireCondition(
          s.accounts.some(
            (a) => a.id === action.account && a.owner === collector && a.active,
          ),
          "Choose an active demo account belonging to the assigned collector",
        );
      } else
        requireCondition(
          available(s, who.id) >= action.amount,
          "Not enough available test credits; pending withdrawals are reserved",
        );
      s.requests.push({
        id: id(),
        customer: who.id,
        master: who.masterId,
        agent: who.agentId,
        collector,
        account: action.kind === "deposit" ? action.account! : null,
        kind: action.kind,
        amount: action.amount,
        status: "pending",
        createdAt: s.clock,
      });
      detail = `${action.kind}: ${action.amount} test credits; assigned to ${label(collector)}`;
      break;
    }
    case "review": {
      const r = s.requests.find((r) => r.id === action.id);
      requireCondition(
        r && r.collector === who.id && who.role !== "customer",
        "Only the assigned collector can review this request",
      );
      requireCondition(
        r.status === "pending",
        "This request has already been processed",
      );
      requireCondition(
        ["approved", "rejected"].includes(action.decision),
        "Invalid review decision",
      );
      if (action.decision === "approved") {
        if (r.kind === "deposit") {
          requireCondition(
            s.teamActive[r.agent] && !weeklyLocked(s, r.master),
            "New deposit credits are paused for this branch; reject or resolve its lock first",
          );
          requireCondition(
            Number.isSafeInteger((s.balances[r.customer] ?? 0) + r.amount),
            "Test balance limit exceeded",
          );
          s.balances[r.customer] = (s.balances[r.customer] ?? 0) + r.amount;
        } else {
          requireCondition(
            (s.balances[r.customer] ?? 0) >= r.amount,
            "Insufficient test balance",
          );
          s.balances[r.customer] -= r.amount;
        }
      }
      r.status = action.decision;
      r.reviewedBy = who.id;
      r.reviewedAt = s.clock;
      detail = `${r.id}: ${action.decision}; ${r.kind} ${r.amount} test credits`;
      break;
    }
    case "cancel": {
      const r = s.requests.find((r) => r.id === action.id);
      requireCondition(
        r && r.customer === who.id && r.status === "pending",
        "Only your own pending requests can be cancelled",
      );
      r.status = "cancelled";
      r.reviewedBy = who.id;
      r.reviewedAt = s.clock;
      detail = `Cancelled ${r.id}; any reservation released`;
      break;
    }
    case "submit-settlement": {
      requireCondition(
        who.role === "master",
        "Only a master can submit its demo commission receipt",
      );
      requireCondition(
        s.masterModes[who.id] === "master",
        "In admin collection mode, the admin already retains the sample platform share",
      );
      amount(action.amount);
      const statement = s.statements.find((x) => x.master === who.id)!;
      const pending = s.settlements
        .filter((x) => x.master === who.id && x.status === "pending")
        .reduce((n, x) => n + x.amount, 0);
      requireCondition(
        action.amount <= statement.due - statement.paid - pending,
        "Amount exceeds outstanding sample commission after pending receipts",
      );
      s.settlements.push({
        id: id(),
        master: who.id,
        amount: action.amount,
        status: "pending",
        createdAt: s.clock,
      });
      detail = `Submitted fictional weekly receipt: ${action.amount} test credits; awaiting demo admin`;
      break;
    }
    case "review-settlement": {
      requireCondition(
        who.role === "admin",
        "Only the demo admin can confirm a weekly receipt",
      );
      const receipt = s.settlements.find((x) => x.id === action.id);
      requireCondition(
        receipt?.status === "pending",
        "This receipt has already been processed or does not exist",
      );
      requireCondition(
        ["confirmed", "rejected"].includes(action.decision),
        "Invalid receipt decision",
      );
      if (action.decision === "confirmed") {
        const statement = s.statements.find(
          (x) => x.master === receipt.master,
        )!;
        requireCondition(
          receipt.amount <= statement.due - statement.paid,
          "Receipt exceeds outstanding commission",
        );
        statement.paid += receipt.amount;
      }
      receipt.status = action.decision;
      receipt.reviewedAt = s.clock;
      detail = `${receipt.id}: ${action.decision}; ${receipt.amount} test credits`;
      break;
    }
    default:
      throw Error("Unknown demo action");
  }
  s.audit.unshift({
    id: id(),
    actor: who.id,
    action: action.type,
    detail,
    at: s.clock,
  });
  return s;
}

export type Period =
  | "all"
  | "today"
  | "yesterday"
  | "weekly"
  | "monthly"
  | "custom";
export function istDay(time: string): string {
  return new Date(Date.parse(time) + 330 * 60_000).toISOString().slice(0, 10);
}
export function dateRange(clock: string, period: Period, from = "", to = "") {
  const today = istDay(clock),
    d = new Date(today + "T00:00:00Z");
  if (period === "all") return { from: "", to: "" };
  if (period === "custom") {
    requireCondition(
      !from || /^\d{4}-\d{2}-\d{2}$/.test(from),
      "Choose a valid start date",
    );
    requireCondition(
      !to || /^\d{4}-\d{2}-\d{2}$/.test(to),
      "Choose a valid end date",
    );
    requireCondition(
      !from || !to || from <= to,
      "Start date must precede end date",
    );
    return { from, to };
  }
  if (period === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  if (period === "weekly")
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  if (period === "monthly") d.setUTCDate(1);
  const start = d.toISOString().slice(0, 10);
  return { from: start, to: period === "yesterday" ? start : today };
}
export function visibleRequests(s: DemoState, who: Actor) {
  return s.requests.filter((r) => inScope(who, actor(r.customer)));
}
