import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import { NetworkTree } from "./network-tree";
import { useRealtimeTopic, useRealtimeResync } from "./realtime";

const walletStyles = `
.net-available{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;padding:20px 22px;margin-bottom:20px;background:#123d36;color:white;border-radius:10px}
.net-available>div:first-child{display:grid;gap:4px;min-width:0}
.net-available span{color:#c5ded5;font-size:12px}
.net-available strong{font-size:28px;font-variant-numeric:tabular-nums}
.net-available small{color:#a6d6c4;overflow-wrap:anywhere}
.net-fund-summary{padding:12px;background:#edf8f3;border-radius:8px;margin:12px 0 18px;overflow-wrap:anywhere}
.net-fund-summary p{margin:0 0 6px;font-size:12px}
.net-directory-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.net-panel .net-directory-counts button{display:grid;gap:4px;text-align:left;padding:18px;white-space:normal;border-color:#cde0d9}
.net-directory-counts span{color:#507365;font-size:13px}
.net-directory-counts strong{color:#123d36;font-size:28px;font-variant-numeric:tabular-nums}
.net-directory-counts small{color:#71848c;font-weight:400}
.net-directory-filters{margin-top:16px}.net-directory-filters .net-field{flex:1}
@media(max-width:700px){
.net-agent-directory,.net-agent-directory tbody{display:block;width:100%}
.net-agent-directory thead{display:none}
.net-agent-directory tr{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:15px;border:1px solid #dce5e9;border-radius:9px;margin-bottom:12px;white-space:normal}
.net-panel .net-agent-directory td{display:block;min-width:0;padding:0;border:0;white-space:normal}
.net-agent-directory td:first-child,.net-agent-directory td:nth-child(2),.net-agent-directory td:last-child{grid-column:1/-1}
.net-panel .net-agent-directory td small{max-width:none;overflow-wrap:anywhere;white-space:normal}
.net-agent-directory td[data-label]:before{content:attr(data-label);display:block;color:#72858f;font-size:11px;margin-bottom:4px}
}
`;

type Role = "admin" | "master" | "agent";
export type NetworkNode = {
  id: string;
  user_id: string;
  kind: Role;
  parent_id: string | null;
  parent_name: string | null;
  name: string;
  email: string;
  status: string;
  company_fee_bps: number;
  share_bps: number;
  players: number;
  earned: string;
  settled: string;
  float_balance: string;
};
type Node = NetworkNode;
type Context = {
  role: Role;
  node: null | {
    id: string;
    userId: string;
    name: string;
    companyFeeBps: number;
    shareBps: number;
  };
};
export type NetworkPlayer = {
  id: string;
  email: string;
  display_name: string;
  status: string;
  channel: string;
  balance: string;
  net: string;
  agent: string;
  master: string;
  agent_id: string | null;
};
type Player = NetworkPlayer;
type Entry = {
  id: string;
  created_at: string;
  source: string;
  source_id: string;
  revision: number;
  game_code: string;
  player_email: string;
  account_name: string;
  account_kind: string;
  amount: string;
  gross_stake: string;
  gross_payout: string;
  terms: {
    companyFeeBps: number;
    masterShareBps: number;
    agentShareBps: number;
  };
};
type Settlement = {
  id: string;
  name: string;
  amount: string;
  reference: string;
  created_at: string;
};
const api = <T,>(path: string, body?: unknown, method = "POST") =>
  customFetch<T>(
    `/api/network${path}`,
    body === undefined
      ? {}
      : {
          method,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
const pct = (bps: number) => `${(bps / 100).toFixed(2).replace(/\.00$/, "")}%`;
function money(value: string | undefined) {
  const n = BigInt(value ?? "0"),
    abs = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}₹${(abs / 100n).toLocaleString("en-IN")}.${(abs % 100n).toString().padStart(2, "0")}`;
}
function paise(value: string) {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with at most two decimal places");
  const negative = value.startsWith("-");
  const [whole, decimal = ""] = value.replace("-", "").split(".");
  return (
    (BigInt(whole!) * 100n + BigInt(decimal.padEnd(2, "0"))) *
    (negative ? -1n : 1n)
  ).toString();
}
function date(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="net-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Pager({
  offset,
  total,
  onChange,
}: {
  offset: number;
  total: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="net-pager">
      <span>
        {total
          ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}`
          : "No records"}
      </span>
      <button disabled={!offset} onClick={() => onChange(offset - 50)}>
        Previous
      </button>
      <button
        disabled={offset + 50 >= total}
        onClick={() => onChange(offset + 50)}
      >
        Next
      </button>
    </div>
  );
}

export function NetworkPanel({
  initialTab = "Overview",
  initialAgentId = "",
  initialMasterId = "",
  onBrowse,
}: {
  initialTab?: "Overview" | "Downline" | "Agents" | "Players";
  initialAgentId?: string;
  initialMasterId?: string;
  onBrowse?: (section: "Agents" | "Players", nodeId?: string) => void;
}) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>(initialTab),
    [channel, setChannel] = useState("b2b");
  const [downlineView, setDownlineView] = useState<"tree" | "table">("tree");
  const [agentSearch, setAgentSearch] = useState("");
  const [masterFilter, setMasterFilter] = useState(initialMasterId);
  const [agentFilter, setAgentFilter] = useState(initialAgentId);
  const [search, setSearch] = useState(""),
    [playerOffset, setPlayerOffset] = useState(0),
    [ledgerOffset, setLedgerOffset] = useState(0);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [branch, setBranch] = useState("");
  const [modal, setModal] = useState<null | {
    kind: "create" | "edit" | "fund" | "settle";
    requestId?: string;
    node?: Node;
    player?: Player;
  }>(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const context = useQuery({
    queryKey: ["network", "context"],
    queryFn: () => api<Context>("/context"),
    retry: false,
  });
  const role = context.data?.role;
  const refreshBalances = () => {
    void qc.invalidateQueries({ queryKey: ["network"] });
  };
  useRealtimeTopic(
    context.data?.node ? `wallet:${context.data.node.userId}` : null,
    refreshBalances,
  );
  useRealtimeResync(refreshBalances);
  const showPlayers =
    tab === "Players" ||
    (tab === "Downline" && role === "agent" && downlineView === "table");
  const nodes = useQuery({
    queryKey: ["network", "nodes"],
    queryFn: () => api<{ nodes: Node[] }>("/nodes"),
    enabled: !!role,
    refetchInterval: 15000,
  });
  const players = useQuery({
    queryKey: [
      "network",
      "players",
      channel,
      search,
      playerOffset,
      agentFilter,
    ],
    queryFn: () =>
      api<{ players: Player[]; total: number }>(
        `/players?${new URLSearchParams({ channel, q: search, offset: String(playerOffset), ...(channel === "b2b" && agentFilter ? { agentId: agentFilter } : {}) })}`,
      ),
    enabled: !!role && showPlayers,
    refetchInterval: 15000,
  });
  const ledgerParams = new URLSearchParams({
    channel,
    offset: String(ledgerOffset),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(branch ? { nodeId: branch } : {}),
  });
  const ledger = useQuery({
    queryKey: ["network", "ledger", ledgerParams.toString()],
    queryFn: () =>
      api<{
        entries: Entry[];
        total: number;
        summary: {
          account_kind: string;
          amount: string;
          stake: string;
          payout: string;
        }[];
      }>(`/ledger?${ledgerParams}`),
    enabled: !!role,
    refetchInterval: 15000,
  });
  const settlements = useQuery({
    queryKey: ["network", "settlements"],
    queryFn: () => api<{ settlements: Settlement[] }>("/settlements"),
    enabled: !!role && tab === "Settlements",
    refetchInterval: 15000,
  });
  const wallet = useQuery({
    queryKey: ["network", "wallet", channel, branch],
    queryFn: () =>
      api<{
        entries: {
          id: string;
          created_at: string;
          email: string;
          type: string;
          amount: string;
          balance_after: string;
          memo: string;
          ref_id: string;
        }[];
      }>(
        `/wallet-ledger?${new URLSearchParams({ channel, ...(branch ? { nodeId: branch } : {}) })}`,
      ),
    enabled: !!role && tab === "Wallet ledger",
    refetchInterval: 15000,
  });
  const mutate = useMutation({
    mutationFn: ({
      path,
      body,
      method,
    }: {
      path: string;
      body: unknown;
      method?: string;
    }) => api(path, body, method),
    onSuccess: (_result, variables) => {
      setModal(null);
      setError("");
      setNotice(
        variables.path === "/transfers"
          ? "Funds transferred successfully. Balances and wallet ledger updated."
          : "Saved successfully.",
      );
      void qc.invalidateQueries({ queryKey: ["network"] });
    },
    onError: (e: Error) => setError(e.message),
  });
  function open(value: NonNullable<typeof modal>) {
    setError("");
    setNotice("");
    setModal({ ...value, requestId: crypto.randomUUID() });
  }
  function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = new FormData(e.currentTarget);
    const get = (key: string) => String(data.get(key) ?? "");
    try {
      if (modal?.kind === "create") {
        const body = {
          name: get("name"),
          email: get("email"),
          password: get("password"),
          ...(role !== "agent"
            ? {
                shareBps: Math.round(Number(get("share")) * 100),
                ...(role === "admin"
                  ? { companyFeeBps: Math.round(Number(get("fee")) * 100) }
                  : {}),
              }
            : {}),
        };
        mutate.mutate({ path: role === "agent" ? "/players" : "/nodes", body });
      } else if (modal?.kind === "edit") {
        mutate.mutate({
          path: `/nodes/${modal.node!.id}`,
          method: "PATCH",
          body: {
            name: get("name"),
            status: get("status"),
            ...(!(role === "admin" && modal.node!.kind === "agent")
              ? { shareBps: Math.round(Number(get("share")) * 100) }
              : {}),
          },
        });
      } else if (modal?.kind === "fund") {
        mutate.mutate({
          path: "/transfers",
          body: {
            targetId: modal.player?.id ?? modal.node!.user_id,
            amountPaise: paise(get("amount")),
            direction: get("direction"),
            memo: get("memo"),
            requestId: modal.requestId,
          },
        });
      } else if (modal?.kind === "settle") {
        mutate.mutate({
          path: "/settlements",
          body: {
            nodeId: modal.node!.id,
            amountPaise: paise(get("amount")),
            reference: get("memo"),
            requestId: modal.requestId,
          },
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (context.isPending)
    return <div className="p-6">Loading branch panel…</div>;
  if (context.isError)
    return (
      <div role="alert" className="p-6 text-red-700">
        {context.error.message}
      </div>
    );
  const own = nodes.data?.nodes.find((n) => n.id === context.data.node?.id);
  const agentNodes = nodes.data?.nodes.filter((n) => n.kind === "agent") ?? [];
  const totalUsers = agentNodes.reduce((sum, n) => sum + n.players, 0);
  const scopedAgents = agentNodes.filter(
    (n) => !masterFilter || n.parent_id === masterFilter,
  );
  const visibleAgents = scopedAgents.filter((n) =>
    `${n.name} ${n.email}`
      .toLowerCase()
      .includes(agentSearch.trim().toLowerCase()),
  );
  const selectedMaster = nodes.data?.nodes.find((n) => n.id === masterFilter);
  const selectedAgent = agentNodes.find((n) => n.id === agentFilter);
  function showAgents(masterId = "") {
    setMasterFilter(masterId);
    setAgentSearch("");
    setError("");
    setTab("Agents");
    onBrowse?.("Agents", masterId);
  }
  function showUsers(agentId = "") {
    setAgentFilter(agentId);
    setSearch("");
    setPlayerOffset(0);
    setError("");
    setTab("Players");
    onBrowse?.("Players", agentId);
  }
  const downstream =
    nodes.data?.nodes.filter(
      (n) => role === "admin" || n.parent_id === context.data.node?.id,
    ) ?? [];
  const totals = ledger.data?.summary ?? [];
  const company = totals.find((r) => r.account_kind === "company"),
    master = totals.find((r) => r.account_kind === "master"),
    agent = totals.find((r) => r.account_kind === "agent");
  const first = company ?? master ?? agent;
  const ownDue = own
    ? (BigInt(own.earned) - BigInt(own.settled)).toString()
    : "0";
  const title =
    role === "admin"
      ? "Business network"
      : role === "master"
        ? "Master panel"
        : "Agent panel";
  const queryError = [nodes, players, ledger, settlements, wallet].find(
    (q) => q.isError,
  )?.error;
  const nodeActions = (n: Node, includeBrowse = true) => (
    <div className="net-row-actions">
      {includeBrowse &&
        (n.kind === "master" ? (
          <button onClick={() => showAgents(n.id)}>
            Total Agents (
            {agentNodes.filter((a) => a.parent_id === n.id).length})
          </button>
        ) : (
          <button onClick={() => showUsers(n.id)}>
            Total Users ({n.players})
          </button>
        ))}
      {(role === "admin" || n.parent_id === context.data.node?.id) && (
        <>
          <button onClick={() => open({ kind: "edit", node: n })}>
            Manage
          </button>
          {(role === "admin"
            ? n.kind === "master"
            : n.parent_id === context.data.node?.id) && (
            <button onClick={() => open({ kind: "fund", node: n })}>
              Funds
            </button>
          )}
          {role === "admin" && (
            <button onClick={() => open({ kind: "settle", node: n })}>
              Settle
            </button>
          )}
        </>
      )}
    </div>
  );
  const playerActions = (player: Player) =>
    role !== "master" && (
      <div className="net-row-actions">
        {role === "agent" && (
          <button onClick={() => open({ kind: "fund", player })}>Funds</button>
        )}
        {channel === "b2b" && (
          <button
            disabled={mutate.isPending}
            onClick={() =>
              mutate.mutate({
                path: `/players/${player.id}`,
                method: "PATCH",
                body: {
                  status: player.status === "active" ? "suspended" : "active",
                },
              })
            }
          >
            {player.status === "active" ? "Suspend" : "Activate"}
          </button>
        )}
      </div>
    );
  return (
    <div className="net-panel">
      <style>{styles + walletStyles}</style>
      <header className="net-heading">
        <div>
          <div className="net-eyebrow">
            LUNAR /{" "}
            {role === "admin" ? "COMPANY CONTROL" : context.data.node?.name}
          </div>
          <h1>{title}</h1>
          <p>
            One hierarchy. Clear shares. Every profit and loss accounted for.
          </p>
        </div>
        <div className="net-actions">
          {role === "admin" && (
            <div className="net-switch">
              {["b2b", "b2c"].map((c) => (
                <button
                  key={c}
                  aria-pressed={channel === c}
                  onClick={() => {
                    setChannel(c);
                    setTab("Overview");
                    setPlayerOffset(0);
                    setLedgerOffset(0);
                    setBranch("");
                    setAgentFilter("");
                    setMasterFilter("");
                    setSearch("");
                  }}
                >
                  {c.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {channel === "b2b" && (
            <button
              className="net-primary"
              onClick={() => open({ kind: "create" })}
            >
              +{" "}
              {role === "admin"
                ? "Create master"
                : role === "master"
                  ? "Create agent"
                  : "Create user"}
            </button>
          )}
        </div>
      </header>
      {role !== "admin" && (
        <section
          className="net-available"
          aria-label="Available wallet balance"
        >
          <div>
            <span>Available to transfer</span>
            <strong>{own ? money(own.float_balance) : "Loading…"}</strong>
            <small>{own?.email}</small>
          </div>
          <div className="net-actions">
            <button onClick={refreshBalances} disabled={nodes.isFetching}>
              Refresh balance
            </button>
            <button onClick={() => setTab("Wallet ledger")}>
              View transactions
            </button>
          </div>
        </section>
      )}
      <div className="net-channel">
        <strong>
          {channel === "b2b"
            ? "B2B · Agent-created users"
            : "B2C · Direct company users"}
        </strong>
        <span>
          {channel === "b2b"
            ? "Admin → Master / Branch → Agent → User"
            : "Public signup · 100% of net game revenue belongs to the company"}
        </span>
      </div>
      {channel === "b2b" && (
        <div className="net-directory-counts" aria-label="Downline totals">
          {role !== "agent" && (
            <button onClick={() => showAgents()} disabled={!nodes.data}>
              <span>Total Agents</span>
              <strong>{nodes.data ? agentNodes.length : "…"}</strong>
              <small>
                {role === "master"
                  ? "Agents directly under your master account"
                  : "Agents across all master branches"}{" "}
                · View agents
              </small>
            </button>
          )}
          <button onClick={() => showUsers()} disabled={!nodes.data}>
            <span>Total Users</span>
            <strong>{nodes.data ? totalUsers : "…"}</strong>
            <small>
              {role === "agent"
                ? "Users directly under your agent account"
                : "Users under your agents"}{" "}
              · View users
            </small>
          </button>
        </div>
      )}
      <nav className="net-tabs" aria-label="Network sections">
        {[
          "Overview",
          ...(channel === "b2b" ? ["Downline"] : []),
          ...(channel === "b2b" && role !== "agent" ? ["Agents"] : []),
          "Players",
          "Ledger",
          "Settlements",
          "Wallet ledger",
        ].map((t) => (
          <button
            key={t}
            aria-current={t === tab ? "page" : undefined}
            onClick={() => {
              if (t === "Agents") return showAgents();
              if (t === "Players") return showUsers();
              setTab(t);
              if (t === "Downline") setAgentFilter("");
              setError("");
            }}
          >
            {t === "Agents"
              ? "Total Agents"
              : t === "Players" && channel === "b2b"
                ? "Total Users"
                : t}
          </button>
        ))}
      </nav>
      {notice && (
        <p role="status" className="net-success">
          {notice}
        </p>
      )}
      {!modal && error && (
        <p role="alert" className="net-error">
          {error}
        </p>
      )}
      {queryError && (
        <p role="alert" className="net-error">
          {queryError.message}{" "}
          <button
            onClick={() => void qc.invalidateQueries({ queryKey: ["network"] })}
          >
            Retry
          </button>
        </p>
      )}
      {(tab === "Overview" || tab === "Ledger" || tab === "Wallet ledger") && (
        <div className="net-filters">
          {role === "admin" && channel === "b2b" && (
            <Field label="Branch / agent">
              <select
                value={branch}
                onChange={(e) => {
                  setBranch(e.target.value);
                  setLedgerOffset(0);
                }}
              >
                <option value="">All branches</option>
                {nodes.data?.nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.kind} · {n.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {tab !== "Wallet ledger" && (
            <>
              <Field label="From (IST)">
                <input
                  type="date"
                  value={from}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setLedgerOffset(0);
                  }}
                />
              </Field>
              <Field label="To (IST)">
                <input
                  type="date"
                  value={to}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setLedgerOffset(0);
                  }}
                />
              </Field>
            </>
          )}
        </div>
      )}
      {tab === "Overview" && (
        <>
          <div className="net-stats">
            {[
              { label: "Settled stakes", value: first?.stake },
              { label: "Player returns", value: first?.payout },
              {
                label: role === "admin" ? "Company P&L" : "My P&L",
                value:
                  role === "admin"
                    ? company?.amount
                    : role === "master"
                      ? master?.amount
                      : agent?.amount,
              },
              ...(role === "admin" && channel === "b2b"
                ? [
                    { label: "Master P&L", value: master?.amount },
                    { label: "Agent P&L", value: agent?.amount },
                  ]
                : []),
              ...(role !== "admin"
                ? [
                    { label: "Outstanding · all time", value: ownDue },
                    { label: "Wallet float", value: own?.float_balance },
                  ]
                : []),
            ].map((s) => (
              <article key={s.label}>
                <span>{s.label}</span>
                <strong>{money(s.value)}</strong>
              </article>
            ))}
          </div>
          <div className="net-grid">
            <section className="net-card">
              <h2>How your shares work</h2>
              <div className="net-flow">
                <b>100% net revenue</b>
                <span>↓</span>
                <b>Company fee {pct(own?.company_fee_bps ?? 1000)}</b>
                <span>↓</span>
                <b>Master allocation</b>
                <span>↓</span>
                <b>Agent share of master allocation</b>
              </div>
              <p>
                Example: ₹100 net income, company 10%, master participation
                100%, agent share 50% → company ₹10, master ₹45, agent ₹45.
              </p>
              <p>
                For a ₹100 loss: company −₹10, master −₹45, agent −₹45. Paise
                rounding stays with the parent, so every entry reconciles.
              </p>
            </section>
            <section className="net-card">
              <h2>Account rules</h2>
              <ul>
                <li>
                  Admin creates master branches and fixes the company fee at
                  creation.
                </li>
                <li>
                  Master chooses each agent’s share from its own allocation.
                </li>
                <li>
                  Only agents create B2B users. Users cannot choose or change
                  their branch.
                </li>
                <li>
                  Profit and loss use the same ratio, saved when the bet is
                  accepted.
                </li>
                <li>
                  Only settled wagers appear in P&L. Voids and corrections
                  append reversing entries.
                </li>
                <li>
                  Wallet float and profit settlements are separate accounts.
                </li>
              </ul>
              <p className="net-muted">
                Reporting begins with wagers accepted after the branch system is
                enabled. Older history stays in the existing reports. External
                API partners and promotional bets are excluded.
              </p>
            </section>
          </div>
        </>
      )}
      {(tab === "Downline" || (tab === "Agents" && role !== "agent")) && (
        <section className="net-card">
          <div className="net-heading">
            <div>
              <h2>
                {tab === "Agents"
                  ? selectedMaster
                    ? `Agents under ${selectedMaster.name}`
                    : "Total Agents"
                  : "Downline hierarchy"}
              </h2>
              <p>
                {tab === "Agents"
                  ? `${scopedAgents.length} agents. Open Total Users on an agent to see its user list.`
                  : role === "agent"
                    ? "Agent → User. Your users are grouped directly under your account."
                    : "Master → Agent → User. Expand a branch to see who belongs to it."}
              </p>
            </div>
            {tab === "Downline" && (
              <div className="net-switch" aria-label="Downline view">
                <button
                  aria-pressed={downlineView === "tree"}
                  onClick={() => setDownlineView("tree")}
                >
                  Tree view
                </button>
                <button
                  aria-pressed={downlineView === "table"}
                  onClick={() => setDownlineView("table")}
                >
                  Table view
                </button>
              </div>
            )}
          </div>
          {tab === "Agents" && (
            <div className="net-filters net-directory-filters">
              <Field label="Search agents">
                <input
                  value={agentSearch}
                  maxLength={100}
                  placeholder="Search agent name or login ID"
                  onChange={(e) => setAgentSearch(e.target.value)}
                />
              </Field>
              {role === "admin" && (
                <Field label="Master branch">
                  <select
                    value={masterFilter}
                    onChange={(e) => setMasterFilter(e.target.value)}
                  >
                    <option value="">All masters</option>
                    {nodes.data?.nodes
                      .filter((n) => n.kind === "master")
                      .map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name} · {n.email}
                        </option>
                      ))}
                  </select>
                </Field>
              )}
            </div>
          )}
          {nodes.isPending ? (
            <p role="status">Loading hierarchy…</p>
          ) : tab === "Downline" && downlineView === "tree" ? (
            <NetworkTree
              nodes={nodes.data?.nodes ?? []}
              rootId={context.data.node?.id ?? null}
              renderActions={nodeActions}
              renderPlayerActions={
                role === "master" ? undefined : playerActions
              }
            />
          ) : role === "agent" ? null : (
            <>
              <div className="net-table-wrap">
                <table
                  className={
                    tab === "Agents" ? "net-agent-directory" : undefined
                  }
                >
                  <thead>
                    <tr>
                      {(tab === "Agents"
                        ? [
                            "Agent",
                            "Total Users",
                            "Wallet",
                            "Status",
                            "Actions",
                          ]
                        : [
                            "Account / branch",
                            "Role",
                            "Share of parent",
                            "Company fee",
                            "Users",
                            "P&L / outstanding",
                            "Float",
                            "Status",
                            "Manage",
                          ]
                      ).map((t) => (
                        <th key={t}>{t}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "Agents" ? visibleAgents : downstream).map(
                      (n) => (
                        <tr key={n.id}>
                          <td>
                            <strong>{n.name}</strong>
                            <small>{n.email}</small>
                            {n.parent_id && (
                              <small>
                                Under{" "}
                                {nodes.data?.nodes.find(
                                  (p) => p.id === n.parent_id,
                                )?.name ?? context.data.node?.name}
                              </small>
                            )}
                          </td>
                          {tab === "Agents" ? (
                            <>
                              <td>
                                <button onClick={() => showUsers(n.id)}>
                                  Total Users ({n.players})
                                </button>
                              </td>
                              <td data-label="Wallet">
                                {money(n.float_balance)}
                              </td>
                              <td data-label="Status">
                                <span className={`net-badge ${n.status}`}>
                                  {n.status}
                                </span>
                              </td>
                              <td>{nodeActions(n, false)}</td>
                            </>
                          ) : (
                            <>
                              <td>{n.kind}</td>
                              <td>{pct(n.share_bps)}</td>
                              <td>{pct(n.company_fee_bps)} · locked</td>
                              <td>{n.players}</td>
                              <td>
                                {money(n.earned)}
                                <small>
                                  Due{" "}
                                  {money(
                                    (
                                      BigInt(n.earned) - BigInt(n.settled)
                                    ).toString(),
                                  )}
                                </small>
                              </td>
                              <td>{money(n.float_balance)}</td>
                              <td>
                                <span className={`net-badge ${n.status}`}>
                                  {n.status}
                                </span>
                              </td>
                              <td>{nodeActions(n)}</td>
                            </>
                          )}
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              {!(tab === "Agents" ? visibleAgents : downstream).length &&
                !nodes.isPending && (
                  <p className="net-empty">
                    {tab === "Agents"
                      ? agentSearch
                        ? "No agents match your search."
                        : "No agents under this master yet."
                      : `No accounts yet. Create your first ${role === "admin" ? "master branch" : "agent"} to get started.`}
                  </p>
                )}
            </>
          )}
        </section>
      )}
      {showPlayers && (
        <section className="net-card">
          <div className="net-heading">
            <div>
              <h2>
                {selectedAgent && channel === "b2b"
                  ? `Users under ${selectedAgent.name}`
                  : `${channel.toUpperCase()} users`}
              </h2>
              <p>
                {players.data
                  ? `Total users${search ? " matching search" : ""}: ${players.data.total}`
                  : "Loading user count…"}
                {selectedAgent && channel === "b2b"
                  ? ` · ${selectedAgent.email}`
                  : ""}
              </p>
            </div>
            <input
              aria-label="Search users"
              placeholder="Search name or email"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPlayerOffset(0);
              }}
            />
          </div>
          {channel === "b2b" && role !== "agent" && (
            <div className="net-filters net-directory-filters">
              <Field label="Users under agent">
                <select
                  value={agentFilter}
                  onChange={(e) => showUsers(e.target.value)}
                >
                  <option value="">All agents</option>
                  {agentNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} · {n.email} ({n.players} users)
                    </option>
                  ))}
                </select>
              </Field>
              <button onClick={() => showAgents(masterFilter)}>
                Back to agents
              </button>
            </div>
          )}
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "User",
                    "Master / agent",
                    "Wallet",
                    "House P&L",
                    "Status",
                    "Actions",
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {players.data?.players.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <strong>{p.display_name || p.email}</strong>
                      <small>{p.email}</small>
                    </td>
                    <td>
                      {p.master || "Company"}
                      <small>{p.agent || "Direct B2C"}</small>
                    </td>
                    <td>{money(p.balance)}</td>
                    <td>{money(p.net)}</td>
                    <td>{p.status}</td>
                    <td>{playerActions(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {players.isPending && <p>Loading users…</p>}
          {players.data && !players.data.total && (
            <p className="net-empty">
              {search
                ? "No users match your search."
                : agentFilter
                  ? "No users under this agent yet."
                  : "No users yet."}
            </p>
          )}
          <Pager
            offset={playerOffset}
            total={players.data?.total ?? 0}
            onChange={setPlayerOffset}
          />
        </section>
      )}
      {tab === "Ledger" && (
        <section className="net-card">
          <h2>Commission & profit/loss ledger</h2>
          <p>
            Positive = earned; negative = loss. Each correction has a new
            revision. Amounts never overwrite prior entries.
          </p>
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  {[
                    "Time (IST) / reference",
                    "Player / game",
                    "Account",
                    "Stake / return",
                    "Share",
                    "Saved percentages",
                  ].map((t) => (
                    <th key={t}>{t}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.data?.entries.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {date(l.created_at)}
                      <small>
                        {l.source_id} · rev {l.revision}
                      </small>
                    </td>
                    <td>
                      {l.player_email}
                      <small>{l.game_code}</small>
                    </td>
                    <td>
                      {l.account_name}
                      <small>{l.account_kind}</small>
                    </td>
                    <td>
                      {money(l.gross_stake)}
                      <small>Return {money(l.gross_payout)}</small>
                    </td>
                    <td
                      className={
                        BigInt(l.amount) < 0n ? "net-negative" : "net-positive"
                      }
                    >
                      {money(l.amount)}
                    </td>
                    <td>
                      <small>Company fee {pct(l.terms.companyFeeBps)}</small>
                      <small>
                        Master {pct(l.terms.masterShareBps)} · Agent{" "}
                        {pct(l.terms.agentShareBps)}
                      </small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager
            offset={ledgerOffset}
            total={ledger.data?.total ?? 0}
            onChange={setLedgerOffset}
          />
        </section>
      )}
      {tab === "Settlements" && (
        <section className="net-card">
          <h2>Recorded company settlements</h2>
          <p>
            Positive amounts record profit paid out; negative amounts record
            losses collected. These records do not move player wallet funds.
            Latest 200 entries.
          </p>
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Account</th>
                  <th>Amount</th>
                  <th>Payment reference</th>
                </tr>
              </thead>
              <tbody>
                {settlements.data?.settlements.map((s) => (
                  <tr key={s.id}>
                    <td>{date(s.created_at)}</td>
                    <td>{s.name}</td>
                    <td>{money(s.amount)}</td>
                    <td>{s.reference}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!settlements.data?.settlements.length && (
            <p className="net-empty">No settlements recorded.</p>
          )}
        </section>
      )}
      {tab === "Wallet ledger" && (
        <section className="net-card">
          <h2>Wallet transactions</h2>
          <p>
            Deposits, game debits, returns and downline fund transfers. Latest
            200 entries in your scope.
          </p>
          <div className="net-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time (IST)</th>
                  <th>Account</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Balance after</th>
                  <th>Reference / memo</th>
                </tr>
              </thead>
              <tbody>
                {wallet.data?.entries.map((w) => (
                  <tr key={w.id}>
                    <td>{date(w.created_at)}</td>
                    <td>{w.email}</td>
                    <td>{w.type}</td>
                    <td>{money(w.amount)}</td>
                    <td>{money(w.balance_after)}</td>
                    <td>
                      {w.memo}
                      <small>{w.ref_id}</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!wallet.data?.entries.length && (
            <p className="net-empty">No wallet entries.</p>
          )}
        </section>
      )}
      {modal && (
        <div className="net-modal-backdrop">
          <section
            className="net-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="network-dialog-title"
          >
            <h2 id="network-dialog-title">
              {modal.kind === "create"
                ? `Create ${role === "admin" ? "master branch" : role === "master" ? "agent" : "B2B user"}`
                : modal.kind === "edit"
                  ? `Manage ${modal.node?.name}`
                  : modal.kind === "fund"
                    ? `Funds · ${modal.node?.name ?? modal.player?.display_name}`
                    : `Settle · ${modal.node?.name}`}
            </h2>
            <form onSubmit={save}>
              {(modal.kind === "create" || modal.kind === "edit") && (
                <Field label="Name">
                  <input
                    autoFocus
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    defaultValue={modal.node?.name}
                  />
                </Field>
              )}
              {modal.kind === "create" && (
                <>
                  <Field label="Login email">
                    <input
                      type="email"
                      name="email"
                      required
                      autoComplete="off"
                    />
                  </Field>
                  <Field label="Password (10–72 characters)">
                    <input
                      type="password"
                      name="password"
                      required
                      minLength={10}
                      maxLength={72}
                      autoComplete="new-password"
                    />
                  </Field>
                </>
              )}
              {modal.kind === "create" && role === "admin" && (
                <Field label="Permanent company fee (%)">
                  <input
                    name="fee"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue="10"
                    required
                  />
                  <small>
                    Locked for this branch after creation; applies to profit and
                    loss.
                  </small>
                </Field>
              )}
              {((modal.kind === "create" && role !== "agent") ||
                (modal.kind === "edit" &&
                  !(role === "admin" && modal.node?.kind === "agent"))) && (
                <Field
                  label={
                    role === "admin"
                      ? "Master participation in the remaining share (%)"
                      : "Agent share of my allocation (%)"
                  }
                >
                  <input
                    name="share"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={
                      modal.node
                        ? modal.node.share_bps / 100
                        : role === "admin"
                          ? 100
                          : 50
                    }
                    required
                  />
                  <small>
                    {role === "admin"
                      ? "After the company fee, the master takes this share of the remainder. The rest stays with the company."
                      : "100% means the agent receives all of your allocation for its users."}{" "}
                    Changes apply only to new bets.
                  </small>
                </Field>
              )}
              {modal.kind === "edit" && (
                <Field label="Status">
                  <select name="status" defaultValue={modal.node?.status}>
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                  </select>
                  <small>
                    Suspending a branch stops its downline from signing in or
                    placing new bets.
                  </small>
                </Field>
              )}
              {modal.kind === "fund" && (
                <div className="net-fund-summary">
                  <p>
                    Downline account:{" "}
                    <strong>{modal.node?.email ?? modal.player?.email}</strong>
                  </p>
                  {role !== "admin" && (
                    <p>
                      Your available balance:{" "}
                      <strong>
                        {own ? money(own.float_balance) : "Loading…"}
                      </strong>
                    </p>
                  )}
                </div>
              )}
              {modal.kind === "fund" && (
                <Field label="Direction">
                  <select name="direction">
                    <option value="credit">Give funds to downline</option>
                    <option value="debit">Collect funds from downline</option>
                  </select>
                </Field>
              )}
              {(modal.kind === "fund" || modal.kind === "settle") && (
                <>
                  <Field label="Amount (INR)">
                    <input
                      autoFocus
                      name="amount"
                      inputMode="decimal"
                      required
                      placeholder="1000.00"
                    />
                    <small>
                      {modal.kind === "settle"
                        ? `Outstanding: ${money((BigInt(modal.node!.earned) - BigInt(modal.node!.settled)).toString())}. Use a negative amount for loss collected.`
                        : "Fund transfers debit the sender and credit the recipient together."}
                    </small>
                  </Field>
                  <Field
                    label={
                      modal.kind === "settle"
                        ? "Payment reference"
                        : "Reason / reference"
                    }
                  >
                    <input name="memo" required minLength={3} maxLength={200} />
                  </Field>
                </>
              )}
              {error && (
                <p className="net-error" role="alert">
                  {error}
                </p>
              )}
              <div className="net-actions">
                <button
                  type="button"
                  disabled={mutate.isPending}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="net-primary" disabled={mutate.isPending}>
                  {mutate.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

const styles = `.net-panel{color:#172b38;font:14px/1.5 system-ui,sans-serif}.net-panel *{box-sizing:border-box}.net-panel h1{font-size:30px;font-weight:750;letter-spacing:-1px;margin:4px 0}.net-panel h2{font-size:18px;font-weight:700;margin:0 0 14px}.net-panel p{margin:8px 0 16px;color:#60717f}.net-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:22px}.net-eyebrow{font-size:11px;letter-spacing:2px;color:#147c6a;font-weight:750}.net-actions,.net-row-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.net-panel button{border:1px solid #d8e1e5;border-radius:7px;padding:8px 13px;background:white;cursor:pointer;white-space:nowrap;font-weight:600;font-size:13px;color:#304a58}.net-panel button:hover{border-color:#139b80;background:#f0f9f6}.net-panel button:disabled{opacity:.5;cursor:default}.net-panel .net-primary{background:#11745f;color:white;border-color:#11745f}.net-panel input,.net-panel select{border:1px solid #ccd8de;border-radius:7px;padding:10px 12px;background:white;min-width:0;font:inherit;color:#172b38;width:100%}.net-panel input:focus,.net-panel select:focus,.net-panel button:focus-visible{outline:2px solid #1ba88b;outline-offset:2px}.net-switch{display:flex;padding:3px;background:#e4eeeb;border-radius:9px}.net-switch button{border:0;background:transparent}.net-switch button[aria-pressed=true]{background:white;color:#126e5b;box-shadow:0 1px 4px #0001}.net-channel{display:flex;justify-content:space-between;gap:12px;padding:14px 18px;border:1px solid #cae3da;background:#edf8f3;border-radius:9px;margin-bottom:20px}.net-channel span{color:#507365;font-size:12px}.net-tabs{display:flex;gap:5px;overflow-x:auto;border-bottom:1px solid #dce4e8;margin-bottom:24px;padding-bottom:10px}.net-tabs button{border:0;background:transparent}.net-tabs button[aria-current=page]{background:#def0e8;color:#0d6b54}.net-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}.net-stats article{background:white;border:1px solid #dce6e5;border-radius:10px;padding:18px}.net-stats span{display:block;color:#71848c;font-size:12px}.net-stats strong{display:block;font-size:23px;letter-spacing:-.7px;margin-top:6px;font-variant-numeric:tabular-nums}.net-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.net-card{background:white;border:1px solid #dce4e8;border-radius:10px;padding:22px;margin-bottom:20px;min-width:0}.net-card ul{padding-left:18px;list-style:disc;color:#526570}.net-card li{margin:10px 0}.net-card .net-muted{font-size:12px;color:#7b8a90}.net-flow{background:#f2f7f6;border-radius:8px;padding:16px;display:flex;flex-direction:column;align-items:center;color:#185b4f;gap:5px}.net-flow b{font-weight:600}.net-filters{display:flex;align-items:end;gap:14px;flex-wrap:wrap;margin-bottom:20px}.net-field{display:flex;flex-direction:column;gap:6px;margin-bottom:14px;min-width:0}.net-field>span{font-size:12px;font-weight:650;color:#516976}.net-field small{color:#778890;font-size:11px}.net-filters .net-field{margin:0;min-width:160px}.net-table-wrap{overflow-x:auto}.net-panel table{width:100%;border-collapse:collapse;text-align:left;white-space:nowrap}.net-panel th{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#72858f;padding:12px;border-bottom:1px solid #dce5e9;background:#f7fafb}.net-panel td{padding:14px 12px;border-bottom:1px solid #edf1f3;vertical-align:top;font-size:13px}.net-panel td small{display:block;font-size:11px;color:#83939a;margin-top:3px;max-width:260px;overflow:hidden;text-overflow:ellipsis}.net-panel td strong{font-weight:600}.net-badge{font-size:11px;border-radius:5px;padding:3px 7px;background:#fff0da;color:#875b16}.net-badge.active{background:#e3f5ec;color:#237b53}.net-panel .net-positive{color:#13764d;font-weight:650}.net-panel .net-negative{color:#b64545;font-weight:650}.net-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end;padding-top:16px}.net-pager span{margin-right:auto;color:#7b8d96;font-size:12px}.net-empty{padding:28px;text-align:center}.net-success{padding:12px;background:#e2f7e9;border-radius:7px;color:#196637!important}.net-error{padding:12px;background:#fff0ef;border-radius:7px;color:#a42d2d!important}.net-modal-backdrop{position:fixed;inset:0;z-index:100;background:#122332a6;display:flex;align-items:center;justify-content:center;padding:18px}.net-modal{background:white;border-radius:14px;padding:26px;width:480px;max-width:100%;max-height:92dvh;overflow:auto;box-shadow:0 20px 80px #0004}.net-modal .net-actions{justify-content:flex-end;margin-top:22px}@media(max-width:700px){.net-grid{grid-template-columns:1fr}.net-heading{align-items:start}.net-channel{flex-direction:column}.net-card{padding:15px}.net-stats{grid-template-columns:1fr 1fr}.net-stats strong{font-size:20px}.net-heading h1{font-size:26px}.net-filters .net-field{min-width:130px;flex:1}}`;
