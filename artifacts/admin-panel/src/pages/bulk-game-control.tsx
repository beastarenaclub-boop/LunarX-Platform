import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";

const API = "/api/admin/game-control/bulk";
type Operation = { kind: "rtp"; channel: "b2b" | "b2c" | "both"; playerRtpBps: number; includeTables: boolean }
  | { kind: "table-mode"; mode: string; targetRtpBps?: number }
  | { kind: "budget"; mode: string; budgetPaise?: string };
type ReturnInfo = { minPercent: number | null; maxPercent: number | null; source: string; note: string };
type Master = { id: string; name: string; playerRtpBps: number | null; status: string };
type Budget = { mode: string; combinedBankPaise: string; floorPaise: string; remainingPaise: string | null; sameEachPaise: string | null };
type Overview = { games: { code: string; enabled: boolean; retired: boolean; playerRtp: boolean; tableModes: boolean; defaultRtp: ReturnInfo; b2cRtpBps: number | null; mode: string; tableTargetRtpBps: number | null }[];
  masters: Master[]; playerRtpGames: string[]; tableGames: string[]; budget: Budget };
type Preview = { operation: Operation; previewToken: string; expiresAt: number; b2cGames: string[]; masters: Master[]; tableGames: string[];
  excludedGames: { code: string; reason: string }[]; changes: { target: string; before: string | number | null; after: string | number | null; unit: string }[]; budget: Budget };
type Pending = { operation: Operation; previewToken: string; requestId: string };
type Receipt = { requestId: string; appliedAt: string; b2cGames: string[]; masters: { id: string; name: string }[]; tableGames: string[]; budget: Budget };
const selectClass = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const money = (paise: string) => (Number(paise) / 100).toLocaleString("en-IN", { style: "currency", currency: "INR" });
function returnText(r: ReturnInfo) {
  if (r.minPercent === null || r.maxPercent === null) return "Varies by hand / bet";
  return Math.abs(r.maxPercent - r.minPercent) < .000001 ? `${r.minPercent.toFixed(2)}%` : `${r.minPercent.toFixed(2)}%–${r.maxPercent.toFixed(2)}%`;
}
function rupeesToPaise(value: string) {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value)) return undefined;
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
function summary(operation: Operation) {
  if (operation.kind === "rtp") return `${pct(operation.playerRtpBps)} player RTP · ${operation.channel === "both" ? "B2B + B2C" : operation.channel.toUpperCase()}${operation.includeTables ? " · shared table engines switch to RTP mode" : ""}`;
  if (operation.kind === "table-mode") return `All connected tables: ${operation.mode}${operation.targetRtpBps === undefined ? "" : ` · ${pct(operation.targetRtpBps)} target`}`;
  return operation.mode === "per_game" ? "Restore separate per-game budget floors" : `${operation.mode === "combined" ? "One combined B2B + B2C table budget" : "Budget for each connected table"}: ${money(operation.budgetPaise!)}`;
}

export default function BulkGameControl() {
  const { user } = useAuth(), qc = useQueryClient(), storageKey = `pending-bulk-game-control:${user?.id}`;
  const query = useQuery<Overview>({ queryKey: [API], queryFn: () => customFetch(API), refetchInterval: 15000 });
  const [kind, setKind] = useState<Operation["kind"]>("rtp"), [channel, setChannel] = useState<"b2b" | "b2c" | "both">("both");
  const [rtp, setRtp] = useState(""), [includeTables, setIncludeTables] = useState(true), [mode, setMode] = useState("normal");
  const [budgetMode, setBudgetMode] = useState("combined"), [budget, setBudget] = useState("");
  const [password, setPassword] = useState(""), [search, setSearch] = useState("");
  const [review, setReview] = useState<Preview | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
  const [pending, setPending] = useState<Pending | null>(() => {
    try { const stored = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); return stored?.requestId && stored?.operation && stored?.previewToken ? stored : null; } catch { return null; }
  });
  function remember(value: Pending | null) {
    setPending(value);
    if (value) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey);
  }
  const preview = useMutation({ mutationFn: (operation: Operation) => customFetch<Preview>(`${API}/preview`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(operation),
  }), onSuccess: data => { setReview(data); setReceipt(null); } });
  const apply = useMutation({ mutationFn: (request: Pending) => customFetch<Receipt>(API, {
    method: "PUT", headers: { "Content-Type": "application/json", "X-Confirm-Password": password }, body: JSON.stringify(request), signal: AbortSignal.timeout(20000),
  }), onSuccess: result => {
    remember(null); setReview(null); setReceipt(result);
    for (const key of [[API], ["/api/admin/game-control"], ["b2c-rtp"], ["network", "rtp"]]) void qc.invalidateQueries({ queryKey: key });
  }, onError: error => {
    const status = (error as Error & { status?: number }).status;
    // Authentication and rate-limit failures do not tell us whether an earlier
    // attempt committed. Keep its request ID until the server resolves it.
    if (status && [400, 409, 422].includes(status)) { remember(null); setReview(null); }
  }, onSettled: () => setPassword("") });
  function edit(change: () => void) { change(); setReview(null); setReceipt(null); preview.reset(); apply.reset(); }
  const bps = Math.round(Number(rtp) * 100), validRtp = rtp.trim() !== "" && Number.isFinite(bps) && bps >= 100 && bps <= 10000 && Math.abs(bps / 100 - Number(rtp)) < 1e-8;
  const paise = rupeesToPaise(budget);
  const operation: Operation | null = kind === "rtp" ? validRtp ? { kind, channel, playerRtpBps: bps, includeTables } : null
    : kind === "table-mode" ? !["auto", "rtp"].includes(mode) || validRtp ? { kind, mode, ...(["auto", "rtp"].includes(mode) ? { targetRtpBps: bps } : {}) } : null
    : budgetMode === "per_game" || paise !== undefined ? { kind, mode: budgetMode, ...(budgetMode === "per_game" ? {} : { budgetPaise: paise }) } : null;
  const locked = preview.isPending || apply.isPending || pending !== null;
  if (query.isPending) return <p>Loading all-game controls…</p>;
  if (query.isError) return <p role="alert">{query.error.message} <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button></p>;
  const data = query.data;
  return <div className="space-y-6" aria-label="All games and channels">
    <div><h2 className="text-xl font-semibold">All games · B2B + B2C</h2><p className="mt-2 text-sm text-slate-600">Review current targets, then apply one change to every supported game or current B2B master account.</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[["Player RTP games", data.playerRtpGames.length], ["Table modes / budget", data.tableGames.length], ["B2B masters", data.masters.length], ["Combined settled table bank", money(data.budget.combinedBankPaise)]].map(([label, value]) =>
        <div key={label} className="rounded-lg border bg-white p-4"><p className="text-sm text-slate-500">{label}</p><strong className="mt-1 block text-lg">{value}</strong></div>)}
    </div>
    <Card><CardHeader><CardTitle>Apply settings to all games</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1 text-sm">Change<select aria-label="Bulk change" className={selectClass} disabled={locked} value={kind} onChange={e => edit(() => setKind(e.target.value as Operation["kind"]))}>
          <option value="rtp">Player RTP across channels</option><option value="table-mode">Result mode for every connected table</option><option value="budget">B2B + B2C table bank / loss budget</option>
        </select></label>
        {kind === "rtp" && <label className="space-y-1 text-sm">Channels<select aria-label="Bulk channels" className={selectClass} value={channel} disabled={locked} onChange={e => edit(() => setChannel(e.target.value as typeof channel))}>
          <option value="both">B2B + B2C together</option><option value="b2c">B2C player policies</option><option value="b2b">All current B2B masters</option>
        </select></label>}
        {kind === "table-mode" && <label className="space-y-1 text-sm">Result mode<select aria-label="Bulk result mode" className={selectClass} value={mode} disabled={locked} onChange={e => edit(() => setMode(e.target.value))}>
          {["normal", "collect", "distribute", "auto", "rtp"].map(value => <option key={value}>{value}</option>)}
        </select></label>}
        {(kind === "rtp" || kind === "table-mode" && ["rtp", "auto"].includes(mode)) && <label className="space-y-1 text-sm">Target player RTP (%)<Input aria-label="Bulk target RTP" type="number" min="1" max="100" step="0.01" value={rtp} disabled={locked} onChange={e => edit(() => setRtp(e.target.value))} placeholder="Enter your target" /></label>}
        {kind === "budget" && <><label className="space-y-1 text-sm">Budget policy<select aria-label="Bulk budget policy" className={selectClass} value={budgetMode} disabled={locked} onChange={e => edit(() => setBudgetMode(e.target.value))}>
          <option value="combined">One combined B2B + B2C table budget</option><option value="same_each">Same amount for every connected table</option><option value="per_game">Restore separate per-game floors</option>
        </select></label>{budgetMode !== "per_game" && <label className="space-y-1 text-sm">Loss budget from now (₹)<Input aria-label="Bulk loss budget" inputMode="decimal" value={budget} disabled={locked} onChange={e => edit(() => setBudget(e.target.value))} placeholder="Enter amount" /></label>}</>}
      </div>
      {kind === "rtp" && <label className="flex items-start gap-2 text-sm"><input aria-label="Include shared table RTP modes" className="mt-1" type="checkbox" checked={includeTables} disabled={locked} onChange={e => edit(() => setIncludeTables(e.target.checked))} /><span>Also set all {data.tableGames.length} connected table engines to RTP mode at this target. These shared results affect both B2B and B2C, regardless of the player-policy channel above.</span></label>}
      <p className="text-sm text-slate-600">Player RTP covers {data.playerRtpGames.length} games, including Aviator / Lunar. B2B changes apply to every listed current master and all of that master's supported games. New masters keep their original defaults.</p>
      <p className="text-sm text-slate-600">Result modes and loss budgets cover {data.tableGames.length} shared table engines. Crash, player-action and other independent games keep their own limits and are outside this bank budget. Normal draws and forced results are not stopped by this budget.</p>
      {kind === "budget" && <p className="rounded-md bg-slate-50 p-3 text-sm">Current policy: <strong>{data.budget.mode.replaceAll("_", " ")}</strong>{data.budget.remainingPaise !== null ? ` · Combined remaining: ${money(data.budget.remainingPaise)}` : ""}. A saved budget fixes its floor against the bank at Apply; it does not refill every round or change the result mode.</p>}
      <Button disabled={locked || !operation} onClick={() => operation && preview.mutate(operation)}>{preview.isPending ? "Preparing preview…" : "Preview all-game changes"}</Button>
      {preview.isError && <p role="alert" className="text-red-700">{preview.error.message}</p>}
      {review && <section className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4" aria-label="Bulk change preview">
        <h3 className="font-semibold">Review before applying</h3><p>{summary(review.operation)}</p>
        <p className="text-sm">{review.b2cGames.length} B2C policies · {review.masters.length} B2B masters · {review.tableGames.length} shared table games. Accepted bets keep their saved payout terms. Other parameters and budgets stay unchanged unless selected above.</p>
        <div className="max-h-72 overflow-auto rounded border bg-white"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Affected setting</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead><tbody>{review.changes.map(change => <tr key={change.target} className="border-t"><td className="p-2">{change.target}</td><td className="p-2">{change.before === null ? "Original per-game rules" : change.unit === "rtp-bps" ? pct(Number(change.before)) : change.before}</td><td className="p-2">{change.unit === "rtp-bps" ? pct(Number(change.after)) : change.after}</td></tr>)}</tbody></table></div>
        <details><summary className="cursor-pointer text-sm">Not changed ({review.excludedGames.length} games)</summary><ul className="mt-2 space-y-1 text-sm">{review.excludedGames.map(game => <li key={game.code}>{game.code}: {game.reason}</li>)}</ul></details>
      </section>}
      {(review || pending) && <div className="space-y-3">
        {pending && !apply.isPending && <p role="status" className="text-amber-800">The last apply result is not confirmed. Retry the same request to check it; the budget cannot be applied twice. {summary(pending.operation)}</p>}
        <label className="block max-w-md space-y-1 text-sm">Confirm admin password<Input aria-label="Bulk confirm admin password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} disabled={apply.isPending} /></label>
        <Button disabled={!password || apply.isPending} onClick={() => {
          const request = pending ?? (review ? { operation: review.operation, previewToken: review.previewToken, requestId: crypto.randomUUID() } : null);
          if (request) { remember(request); apply.mutate(request); }
        }}>{apply.isPending ? "Applying…" : pending ? "Check / retry last apply" : "Apply reviewed changes"}</Button>
      </div>}
      {apply.isError && <p role="alert" className="text-red-700">{apply.error.message}</p>}
      {receipt && <p role="status" className="rounded-lg bg-emerald-50 p-4 text-emerald-800">Saved together: {receipt.b2cGames.length} B2C game policies, {receipt.masters.length} B2B masters and {receipt.tableGames.length} shared table games. Reference: {receipt.requestId}</p>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Current targets and payout rules</CardTitle></CardHeader><CardContent className="space-y-3">
      <Input aria-label="Search all-game settings" placeholder="Search games" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="max-h-[600px] overflow-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead className="sticky top-0 bg-white"><tr><th className="p-3">Game</th><th className="p-3">B2C payout / original rules</th><th className="p-3">Shared result mode</th><th className="p-3">Bulk support</th></tr></thead><tbody>
        {data.games.filter(game => game.code.includes(search.toLowerCase())).map(game => <tr key={game.code} className="border-t"><td className="p-3 font-medium">{game.code}<span className="block text-xs font-normal text-slate-500">{game.retired ? "Withdrawn" : game.enabled ? "Enabled" : "Disabled"}</span></td>
          <td className="p-3">{game.playerRtp && game.b2cRtpBps !== null ? <>{pct(game.b2cRtpBps)}<span className="block text-xs text-slate-500">B2C custom policy</span></> : <>{returnText(game.defaultRtp)}<span className="block text-xs text-slate-500">{game.defaultRtp.source}</span></>}<span className="block max-w-xs text-xs text-slate-500">{game.defaultRtp.note}</span></td>
          <td className="p-3">{game.tableModes ? `${game.mode}${game.tableTargetRtpBps === null ? "" : ` · ${pct(game.tableTargetRtpBps)} target`}` : "Own game engine"}</td><td className="p-3">{[game.playerRtp && "Player RTP", game.tableModes && "Modes + budget"].filter(Boolean).join(" · ") || "Separate game settings"}</td></tr>)}
      </tbody></table></div>
      <h3 className="pt-3 font-semibold">B2B master targets</h3>
      {!data.masters.length ? <p className="text-sm text-slate-500">No B2B master accounts yet.</p> : <ul className="grid gap-2 text-sm sm:grid-cols-2">{data.masters.map(master => <li key={master.id} className="rounded border p-3"><strong>{master.name}</strong>: {master.playerRtpBps === null ? "Original per-game rules shown above" : pct(master.playerRtpBps)}<span className="block text-xs text-slate-500">{master.status} · all {data.playerRtpGames.length} supported player-RTP games</span></li>)}</ul>}
    </CardContent></Card>
  </div>;
}
