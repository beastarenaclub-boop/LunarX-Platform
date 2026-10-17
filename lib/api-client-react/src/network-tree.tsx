import { useId, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import type { NetworkNode, NetworkPlayer } from "./network-panel";

const percent = (bps: number) => `${Number((bps / 100).toFixed(2))}%`;
const countLabel = (count: number, label: string) =>
  `${count} ${label}${count === 1 ? "" : "s"}`;
function money(value: string) {
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "−" : ""}₹${(absolute / 100n).toLocaleString("en-IN")}.${(absolute % 100n).toString().padStart(2, "0")}`;
}

function AgentUsers({
  agent,
  search = "",
  renderActions,
}: {
  agent: NetworkNode;
  search?: string;
  renderActions?: (player: NetworkPlayer) => ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const users = useQuery({
    queryKey: ["network", "treePlayers", agent.id, offset, search],
    queryFn: () =>
      customFetch<{ players: NetworkPlayer[]; total: number }>(
        `/api/network/players?${new URLSearchParams({ channel: "b2b", agentId: agent.id, q: search, offset: String(offset), limit: "50" })}`,
      ),
    refetchInterval: 15000,
  });
  if (users.isPending)
    return (
      <p className="net-tree-empty" role="status">
        Loading users under {agent.name}…
      </p>
    );
  if (users.isError)
    return (
      <div className="net-error" role="alert">
        Could not load users under {agent.name}.{" "}
        <button onClick={() => void users.refetch()}>Retry</button>
      </div>
    );
  const total = users.data.total;
  return (
    <>
      <ul className="net-tree-children" aria-label={`Users of ${agent.name}`}>
        {users.data.players.map((player) => (
          <li key={player.id} data-player-id={player.id}>
            <article className="net-tree-person">
              <span className="net-tree-avatar user" aria-hidden="true">
                U
              </span>
              <div className="net-tree-identity">
                <span className="net-tree-kind">User</span>
                <strong>{player.display_name || player.email}</strong>
                <span>{player.email}</span>
                <small>Agent: {agent.name}</small>
              </div>
              <div className="net-tree-player-balance">
                <span className={`net-badge ${player.status}`}>
                  {player.status}
                </span>
                <small>Wallet</small>
                <strong>{money(player.balance)}</strong>
              </div>
              {renderActions && (
                <div className="net-tree-user-actions">
                  {renderActions(player)}
                </div>
              )}
            </article>
          </li>
        ))}
      </ul>
      {!total && (
        <p className="net-tree-empty">
          {search
            ? "No users match your search."
            : "No users under this agent yet."}
        </p>
      )}
      {(total > 50 || offset > 0) && (
        <div
          className="net-pager net-tree-pager"
          aria-label={`User pages for ${agent.name}`}
        >
          <span>
            {total
              ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}`
              : "No users"}
          </span>
          <button
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            Previous users
          </button>
          <button
            disabled={offset + 50 >= total}
            onClick={() => setOffset(offset + 50)}
          >
            Next users
          </button>
        </div>
      )}
    </>
  );
}

export function NetworkTree({
  nodes,
  rootId,
  renderActions,
  renderPlayerActions,
}: {
  nodes: NetworkNode[];
  rootId: string | null;
  renderActions: (node: NetworkNode) => ReactNode;
  renderPlayerActions?: (player: NetworkPlayer) => ReactNode;
}) {
  const treeId = useId();
  const [search, setSearch] = useState("");
  const [defaultExpanded, setDefaultExpanded] = useState<boolean | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const query = search.trim().toLowerCase();
  const isAgentRoot =
    nodes.find((node) => node.id === rootId)?.kind === "agent";
  const { byId, children, roots, visible } = useMemo(() => {
    const sorted = [...nodes].sort(
      (a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email),
    );
    const byId = new Map(sorted.map((node) => [node.id, node]));
    const children = new Map<string, NetworkNode[]>();
    for (const node of sorted) {
      if (node.parent_id)
        children.set(node.parent_id, [
          ...(children.get(node.parent_id) ?? []),
          node,
        ]);
    }
    const visible = new Set<string>();
    for (const node of sorted) {
      if (
        isAgentRoot ||
        !query ||
        `${node.name} ${node.email}`.toLowerCase().includes(query)
      ) {
        visible.add(node.id);
        if (node.parent_id) visible.add(node.parent_id);
        if (node.kind === "master")
          for (const child of children.get(node.id) ?? [])
            visible.add(child.id);
      }
    }
    const roots = rootId
      ? sorted.filter((node) => node.id === rootId)
      : sorted.filter((node) => node.kind === "master");
    return { byId, children, roots, visible };
  }, [nodes, rootId, query, isAgentRoot]);
  const masterCount = nodes.filter((n) => n.kind === "master").length;
  const agentCount = nodes.filter((n) => n.kind === "agent").length;
  const userCount = nodes
    .filter((n) => n.kind === "agent")
    .reduce((sum, n) => sum + n.players, 0);

  function renderNode(node: NetworkNode) {
    const isOpen =
      expanded[node.id] ??
      (query
        ? true
        : (defaultExpanded ?? (node.kind === "master" || node.id === rootId)));
    const descendants = (children.get(node.id) ?? []).filter((child) =>
      visible.has(child.id),
    );
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined;
    const label = node.kind === "master" ? "Master" : "Agent";
    const childrenId = `${treeId}-${node.id}`;
    return (
      <li key={node.id} data-node-id={node.id}>
        <article className={`net-tree-node ${node.kind}`}>
          <div className="net-tree-node-header">
            <button
              className="net-tree-toggle"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.kind} ${node.name}`}
              aria-expanded={isOpen}
              aria-controls={childrenId}
              onClick={() =>
                setExpanded((current) => ({ ...current, [node.id]: !isOpen }))
              }
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                style={{ transform: isOpen ? "rotate(90deg)" : undefined }}
              >
                <path
                  d="m7 4 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <span className={`net-tree-avatar ${node.kind}`} aria-hidden="true">
              {label[0]}
            </span>
            <div className="net-tree-identity">
              <span className="net-tree-kind">
                {label}
                {node.id === rootId ? " · Your account" : ""}
              </span>
              <strong>{node.name}</strong>
              <span>{node.email}</span>
              <small>
                Under{" "}
                {parent?.name ??
                  node.parent_name ??
                  (node.parent_id ? "Master branch" : "Company / Admin")}
              </small>
            </div>
            <span className={`net-badge ${node.status}`}>{node.status}</span>
          </div>
          <div className="net-tree-metrics">
            <div>
              <span>
                {node.kind === "master"
                  ? "Master participation"
                  : "Share of master allocation"}
              </span>
              <strong>{percent(node.share_bps)}</strong>
            </div>
            <div>
              <span>Downline</span>
              <strong>
                {node.kind === "master"
                  ? `${countLabel((children.get(node.id) ?? []).length, "agent")} · `
                  : ""}
                {countLabel(node.players, "user")}
              </strong>
            </div>
            <div>
              <span>Wallet float</span>
              <strong>{money(node.float_balance)}</strong>
            </div>
          </div>
          <div className="net-tree-node-footer">
            <small>Company fee {percent(node.company_fee_bps)} · fixed</small>
            {renderActions(node)}
          </div>
        </article>
        <div id={childrenId} hidden={!isOpen}>
          {isOpen &&
            (node.kind === "agent" ? (
              <AgentUsers
                key={`${node.id}-${isAgentRoot ? query : ""}`}
                agent={node}
                search={isAgentRoot ? query : ""}
                renderActions={renderPlayerActions}
              />
            ) : descendants.length ? (
              <ul
                className="net-tree-children"
                aria-label={`Agents of ${node.name}`}
              >
                {descendants.map(renderNode)}
              </ul>
            ) : (
              <p className="net-tree-empty">No agents under this master yet.</p>
            ))}
        </div>
      </li>
    );
  }

  return (
    <div className="net-tree">
      <style>{styles}</style>
      <div className="net-tree-toolbar">
        <label>
          <span>
            {isAgentRoot ? "Find your users" : "Find a master or agent"}
          </span>
          <input
            value={search}
            maxLength={100}
            placeholder="Search name or login ID"
            onChange={(e) => {
              setSearch(e.target.value);
              setExpanded({});
            }}
          />
        </label>
        <div className="net-actions">
          <button
            onClick={() => {
              setDefaultExpanded(true);
              setExpanded({});
            }}
          >
            Expand all
          </button>
          <button
            onClick={() => {
              setSearch("");
              setDefaultExpanded(false);
              setExpanded({});
            }}
          >
            Collapse all
          </button>
        </div>
      </div>
      <div className="net-tree-summary" aria-label="Downline totals">
        {!isAgentRoot && (
          <span>
            <b>{masterCount}</b> {masterCount === 1 ? "master" : "masters"}
          </span>
        )}
        <span>
          <b>{agentCount}</b> {agentCount === 1 ? "agent" : "agents"}
        </span>
        <span>
          <b>{userCount}</b> {userCount === 1 ? "user" : "users"}
        </span>
      </div>
      {!rootId && (
        <div className="net-tree-company">
          <span className="net-tree-avatar company" aria-hidden="true">
            C
          </span>
          <div>
            <small>B2B NETWORK ROOT</small>
            <strong>Company / Admin</strong>
            <span>All master branches report here</span>
          </div>
        </div>
      )}
      <ul
        className={
          rootId ? "net-tree-roots" : "net-tree-roots net-tree-children"
        }
        aria-label="Downline hierarchy"
      >
        {roots.filter((node) => visible.has(node.id)).map(renderNode)}
      </ul>
      {!roots.some((node) => visible.has(node.id)) && (
        <p className="net-tree-empty">
          {query
            ? "No matching master or agent found."
            : "No master branches yet. Create a master to start your downline."}
        </p>
      )}
    </div>
  );
}

const styles = `
.net-tree{min-width:0}.net-tree-toolbar{display:flex;align-items:end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px}.net-tree-toolbar label{display:grid;gap:6px;flex:1;max-width:380px;min-width:180px}.net-tree-toolbar label>span{font-size:12px;font-weight:600;color:#607782}.net-tree-summary{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}.net-tree-summary>span{padding:5px 12px;border:1px solid #dbe8e4;border-radius:20px;background:#f5faf8;font-size:12px;color:#4c6c62}.net-tree-summary b{font-size:14px;color:#125a49;margin-right:4px}.net-card .net-tree ul{list-style:none;padding:0;margin:0;color:inherit}.net-card .net-tree li{list-style:none;margin:0;padding:0;min-width:0}.net-card .net-tree .net-tree-children{margin-left:22px;padding-left:24px;border-left:2px solid #bed6cc}.net-card .net-tree li+li{margin-top:14px}.net-tree-children>li{position:relative;padding-top:14px!important}.net-tree-children>li:before{content:"";position:absolute;left:-24px;top:47px;width:24px;border-top:2px solid #bed6cc}.net-tree-children>li:last-child:after{content:"";position:absolute;left:-26px;top:49px;bottom:0;width:2px;background:white}.net-tree-node{border:1px solid #dce5e9;border-left:4px solid #3289a3;border-radius:10px;background:white;box-shadow:0 3px 10px #142f3410;padding:16px;min-width:0}.net-tree-node.master{border-left-color:#159b76;background:#f6fcf9}.net-tree-node-header{display:flex;align-items:center;gap:12px;min-width:0}.net-panel .net-tree-toggle{padding:5px;display:grid;place-items:center;width:30px;height:30px;border-radius:50%;flex-shrink:0;background:white}.net-tree-toggle svg{transition:transform .15s}.net-tree-avatar{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;font-weight:750;flex-shrink:0;background:#e1f3ea;color:#137758}.net-tree-avatar.agent{background:#e6f1fa;color:#28649d}.net-tree-avatar.user{width:30px;height:30px;font-size:12px;background:#edf0f5;color:#59677d}.net-tree-identity{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;overflow-wrap:anywhere}.net-tree-identity strong{font-size:15px;color:#173c39}.net-tree-identity>span:not(.net-tree-kind){font-size:12px;color:#536f78}.net-tree-kind{text-transform:uppercase;letter-spacing:1px;font-size:10px;font-weight:750;color:#428170}.net-tree-identity small{font-size:11px;color:#7a8a90}.net-tree-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;border-top:1px solid #e1ebe7;margin-top:14px;padding-top:12px}.net-tree-metrics>div{display:grid;gap:3px;overflow-wrap:anywhere}.net-tree-metrics span{color:#6c8289;font-size:11px}.net-tree-metrics strong{font-size:13px;font-variant-numeric:tabular-nums}.net-tree-node-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}.net-tree-node-footer>small{color:#748b82;font-size:11px}.net-tree-node-footer button{font-size:12px;padding:5px 10px}.net-tree-company{background:#123d36;color:white;border-radius:10px;padding:20px;display:flex;gap:14px;align-items:center}.net-tree-company>div{display:grid;gap:3px}.net-tree-company strong{font-size:18px}.net-tree-company small{letter-spacing:1.5px;color:#a6d6c4;font-size:10px}.net-tree-company span:not(.net-tree-avatar){font-size:12px;color:#c5ded5}.net-tree-avatar.company{background:#ffffff20;color:white}.net-tree-person{background:#f9fafc;border:1px solid #e0e7ed;border-radius:9px;padding:14px;display:flex;align-items:center;gap:12px;min-width:0}.net-tree-player-balance{display:grid;gap:3px;justify-items:end;font-variant-numeric:tabular-nums}.net-tree-player-balance small{font-size:10px;color:#74838d}.net-tree-player-balance strong{font-size:13px}.net-panel .net-tree-empty{padding:14px 20px;margin:0;font-size:12px;color:#778b85}.net-tree-pager{flex-wrap:wrap;margin-left:24px}.net-tree-pager button{font-size:11px;padding:5px 8px}@media(max-width:700px){.net-card .net-tree .net-tree-children{margin-left:10px;padding-left:12px}.net-tree-children>li:before{left:-12px;width:12px}.net-tree-children>li:last-child:after{left:-14px}.net-tree-node{padding:11px}.net-tree-node-header{gap:7px;flex-wrap:wrap}.net-tree-avatar{width:28px;height:28px;border-radius:7px;font-size:12px}.net-tree-node-header>.net-badge{margin-left:auto}.net-tree-identity strong{font-size:13px}.net-tree-identity>span:not(.net-tree-kind){font-size:11px}.net-tree-metrics{gap:8px}.net-tree-metrics strong{font-size:12px}.net-tree-toolbar label{max-width:none;flex-basis:100%}.net-tree-toolbar .net-actions{width:100%}.net-tree-person{flex-wrap:wrap;gap:8px;padding:10px}.net-tree-player-balance{display:flex;align-items:center;gap:7px;flex-basis:100%;flex-wrap:wrap}.net-tree-company{padding:15px}.net-tree-pager{margin-left:12px}}
.net-tree-person{flex-wrap:wrap}.net-tree-user-actions{flex-basis:100%;display:flex;justify-content:flex-end;border-top:1px solid #e5ebef;padding-top:10px}.net-tree-user-actions button{font-size:12px;padding:5px 10px}
`;
