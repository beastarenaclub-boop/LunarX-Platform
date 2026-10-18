import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";
import { transactionMoney } from "./transaction-filters";
import type { NetworkNode } from "./network-panel";

type Collections = {
  total: number;
  agent: { id: string; name: string };
  range: { from: string; to: string };
  totals: { total: string; manual: string; auto: string };
  items: { id: string; customer: string; amount: string; method: string; reference: string | null; upiId: string | null; approvedAt: string; legacyAttribution: boolean }[];
};
function monday() {
  const date = new Date(Date.now() + 330 * 60000);
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
  return date.toISOString().slice(0, 10);
}
export function NetworkCollections({ role, nodes }: { role: "admin" | "master" | "agent"; nodes: NetworkNode[] }) {
  const [agentId, setAgentId] = useState("");
  const [week, setWeek] = useState(monday);
  const [method, setMethod] = useState("all");
  const [offset, setOffset] = useState(0);
  const [instance] = useState(() => crypto.randomUUID());
  const enabled = role === "agent" || !!agentId;
  const params = new URLSearchParams({ week, method, offset: String(offset), limit: "25", ...(agentId ? { agentId } : {}) });
  const report = useQuery({ queryKey: ["network", "collections", instance, params.toString()], queryFn: ({ signal }) => customFetch<Collections>(`/api/network/collections?${params}`, { signal }), enabled, retry: false, gcTime: 0, refetchInterval: 30000 });
  function shift(days: number) {
    setWeek(new Date(Date.parse(`${week}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10));
    setOffset(0);
  }
  return <section className="net-card" aria-label="Agent collection report">
    <h2>Collection report</h2>
    <p>Separate collection account for each agent. Approved deposits are counted from Monday 00:00 to the next Monday 00:00 IST. Game commission and weekly company settlements remain in their existing reports.</p>
    <div className="net-actions" style={{ margin: "16px 0", alignItems: "end" }}>
      {role !== "agent" && <label className="net-field"><span>Collection agent</span><select value={agentId} onChange={e => { setAgentId(e.target.value); setOffset(0); }}><option value="">Choose an agent</option>{nodes.filter(n => n.kind === "agent").map(n => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>}
      <label className="net-field"><span>Week starting Monday</span><input type="date" value={week} onChange={e => { if (!e.target.value) return; const d = new Date(`${e.target.value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); setWeek(d.toISOString().slice(0, 10)); setOffset(0); }} /></label>
      <label className="net-field"><span>Deposit method</span><select value={method} onChange={e => { setMethod(e.target.value); setOffset(0); }}><option value="all">Manual + Automatic</option><option value="manual">Manual</option><option value="auto">Automatic</option></select></label>
      <button onClick={() => shift(-7)}>Previous week</button><button onClick={() => shift(7)}>Next week</button>
      <button disabled={!enabled} onClick={() => void report.refetch()}>Refresh report</button>
    </div>
    {!enabled ? <p>Choose an agent to view their separate collection report.</p> : report.isPending ? <p>Loading collections...</p> : report.isError ? <p role="alert">{report.error.message}</p> : <>
      <h3>{report.data.agent.name}: {report.data.range.from} 00:00 to {report.data.range.to} 00:00 IST (end excluded)</h3>
      <div className="net-directory-counts" aria-label="Collection totals">{[["Total collection", report.data.totals.total], ["Manual", report.data.totals.manual], ["Automatic", report.data.totals.auto]].map(([label, amount]) => <div key={label} className="net-fund-summary"><p>{label}</p><strong>{transactionMoney(amount!)}</strong></div>)}</div>
      <div style={{ overflowX: "auto" }}><table><thead><tr>{["Approved (IST)", "Customer", "Amount", "Method", "Reference", "Received at"].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{report.data.items.map(row => <tr key={row.id}><td>{new Date(row.approvedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{row.customer}</td><td>{transactionMoney(row.amount)}</td><td>{row.method === "auto" ? "Automatic" : "Manual"}</td><td>{row.reference ?? "—"}</td><td>{row.upiId ?? "—"}</td></tr>)}</tbody></table></div>
      {!report.data.items.length && <p>No approved deposits for this week and filter.</p>}
      {report.data.items.some(r => r.legacyAttribution) && <p>Older records without a saved funding agent use the customer's current agent.</p>}
      <div className="net-actions"><button disabled={!offset} onClick={() => setOffset(offset - 25)}>Previous page</button><span>{report.data.total} deposits · Page {offset / 25 + 1}</span><button disabled={offset + 25 >= report.data.total} onClick={() => setOffset(offset + 25)}>Next page</button></div>
    </>}
  </section>;
}
