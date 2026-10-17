import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth, hasRole } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Settings = { interval: number; maxTicket: number; salesEnabled: boolean; seriesPrices: Record<string, number>; payouts: Record<string, number> };
type Ticket = { id: string; seller_id: string; seller_name: string; draw_id: string; game: string;
  total: number; payout: number; status: string; created: number; lines: { series: string; number: string; quantity: number; unitPrice: number }[] };
type Draw = { id: string; closes: number; ends: number; status: string; commitment: string; seed?: string; results: Record<string, Record<string, string>> | null };
type State = { settings: Settings; version: number; enabled: boolean; page: number; pages: number; tickets: Ticket[]; draws: Draw[];
  totals: { count: number; pending: number; sales: number; prizes: number; refunds: number } };
const money = (value: number) => value.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const date = (value: number) => new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

export default function LotteryPage() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Irland Lotto | Admin";
    return () => { document.title = previousTitle; };
  }, []);
  const { user } = useAuth(), qc = useQueryClient();
  const [page, setPage] = useState(1), [selected, setSelected] = useState<Ticket | null>(null);
  const [edit, setEdit] = useState<{ version: number; interval: number; maxTicket: number; salesEnabled: boolean } | null>(null);
  const [password, setPassword] = useState("");
  const state = useQuery({ queryKey: ["admin-lottery", page], queryFn: () => customFetch<State>(`/api/lottery/admin?page=${page}`), refetchInterval: 5000 });
  const save = useMutation({ mutationFn: () => customFetch("/api/lottery/admin/settings", { method: "PUT",
    headers: { "Content-Type": "application/json", "X-Confirm-Password": password }, body: JSON.stringify(edit) }),
    onSuccess: async () => { setEdit(null); setPassword(""); await qc.invalidateQueries({ queryKey: ["admin-lottery"] }); } });
  if (!state.data) return <div role="status">{state.isError ? <><p>Irland Lotto data could not be loaded.</p><Button onClick={() => void state.refetch()}>Retry</Button></> : "Loading Irland Lotto…"}</div>;
  const data = state.data;
  const upcoming = data.draws.filter(d => d.status === "open").sort((a, b) => a.ends - b.ends);
  const results = data.draws.filter(d => d.status === "settled");
  return <div className="space-y-6" data-testid="admin-lottery">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-2xl font-semibold">Irland Lotto</h1><p className="text-sm text-slate-500">Shared player accounts, wallet ledger and ticket records. All times IST.</p></div>
      {hasRole(user, "admin", "super_admin") && <Button onClick={() => { save.reset(); setPassword(""); setEdit({ version: data.version,
        interval: data.settings.interval, maxTicket: data.settings.maxTicket, salesEnabled: data.settings.salesEnabled }); }}>Irland Lotto settings</Button>}
    </div>
    {state.isError && <p role="alert" className="text-red-600">Connection lost. Displayed data may be outdated.</p>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
      {[["Tickets", data.totals.count.toLocaleString()], ["Sales", money(data.totals.sales)], ["Prizes credited", money(data.totals.prizes)],
        ["Refunds", money(data.totals.refunds)], ["Pending tickets", data.totals.pending.toLocaleString()]].map(([label, value]) =>
        <Card key={label}><CardContent className="p-4"><p className="text-xs text-slate-500">{label}</p><strong className="text-xl">{value}</strong></CardContent></Card>)}
    </div>
    <Card><CardHeader><CardTitle className="text-lg">Sales & ticket prices</CardTitle></CardHeader><CardContent className="space-y-4">
      <p data-testid="lottery-sales-status" className={data.enabled && data.settings.salesEnabled ? "text-emerald-700" : "text-amber-700"}>
        {data.enabled && data.settings.salesEnabled ? "Sales open" : "Sales paused"} · {data.settings.interval}-minute draws · Maximum ticket {money(data.settings.maxTicket)}
      </p>
      {!data.enabled && <p className="text-sm">Irland Lotto is disabled in <Link href="/games" className="underline">Games</Link>. Enable it there before resuming sales.</p>}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{Object.entries(data.settings.seriesPrices).map(([series, price]) =>
        <div key={series} className="rounded border bg-slate-50 p-3"><span className="text-xs text-slate-500">{series.replace("JP", "Irland Lotto ")}</span><div className="font-semibold">{money(price)}</div></div>)}</div>
      <p className="text-sm text-slate-500">Exact-match returns: 2D 80× · 3D 800× · Titli 8×. Prizes include the winning stake and credit automatically. Print remains available only in the shop system.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-lg">Upcoming draws</CardTitle></CardHeader><CardContent>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Draw</TableHead><TableHead>Sales close</TableHead><TableHead>Result time</TableHead></TableRow></TableHeader><TableBody>
        {upcoming.map(draw => <TableRow key={draw.id}><TableCell className="font-mono text-xs">{draw.id}</TableCell><TableCell>{date(draw.closes)}</TableCell><TableCell>{date(draw.ends)}</TableCell></TableRow>)}
      </TableBody></Table></div>
      <p className="mt-3 text-xs text-slate-500">Sales close 10 seconds before each result. Published draw rules are retained when settings change.</p>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-lg">Irland Lotto tickets</CardTitle></CardHeader><CardContent>
      <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Ticket / time", "Player", "Game", "Stake", "Prize", "Status", ""].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {data.tickets.map(ticket => <TableRow key={ticket.id} data-testid="lottery-ticket-row"><TableCell><div className="font-mono text-xs">{ticket.id}</div><small>{date(ticket.created)}</small></TableCell>
          <TableCell><Link href={`/users/${ticket.seller_id}`} className="text-emerald-700 underline">{ticket.seller_name}</Link></TableCell>
          <TableCell>{ticket.game}</TableCell><TableCell>{money(ticket.total)}</TableCell><TableCell>{money(ticket.payout)}</TableCell><TableCell>{ticket.status === "claimed" ? "Prize credited" : ticket.status}</TableCell>
          <TableCell><Button variant="outline" size="sm" onClick={() => setSelected(ticket)}>Details</Button></TableCell></TableRow>)}
      </TableBody></Table></div>
      {!data.tickets.length && <p className="py-6 text-center text-slate-500">No Irland Lotto tickets yet.</p>}
      <div className="mt-4 flex items-center justify-end gap-3"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {data.pages}</span><Button variant="outline" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</Button></div>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-lg">Draw results</CardTitle></CardHeader><CardContent className="space-y-3">
      {!results.length && <p className="text-slate-500">Results will appear after the first draw.</p>}
      {results.map(draw => <details key={draw.id} className="rounded border p-3"><summary className="cursor-pointer font-medium">{date(draw.ends)} · {draw.id}</summary>
        <div className="mt-3 overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Ticket</TableHead><TableHead>2D</TableHead><TableHead>3D</TableHead><TableHead>Titli</TableHead></TableRow></TableHeader><TableBody>
          {Object.entries(draw.results || {}).map(([series, result]) => <TableRow key={series}><TableCell>{series.replace("JP", "Irland Lotto ")}</TableCell><TableCell>{result["2D"]}</TableCell><TableCell>{result["3D"]}</TableCell><TableCell>{result.Titli}</TableCell></TableRow>)}
        </TableBody></Table></div><p className="mt-3 break-all text-xs text-slate-500">Seed: {draw.seed}<br />SHA-256 commitment: {draw.commitment}</p>
      </details>)}
    </CardContent></Card>
    <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}><DialogContent className="max-h-[85dvh] overflow-auto"><DialogHeader><DialogTitle>Ticket details</DialogTitle><DialogDescription>{selected?.id} · {selected?.draw_id}</DialogDescription></DialogHeader>
      <Table><TableHeader><TableRow><TableHead>Series</TableHead><TableHead>Number</TableHead><TableHead>Quantity</TableHead><TableHead>Price</TableHead></TableRow></TableHeader><TableBody>
        {selected?.lines.map(line => <TableRow key={`${line.series}:${line.number}`}><TableCell>{line.series.replace("JP", "Irland Lotto ")}</TableCell><TableCell>{line.number}</TableCell><TableCell>{line.quantity}</TableCell><TableCell>{money(line.unitPrice)}</TableCell></TableRow>)}
      </TableBody></Table>
    </DialogContent></Dialog>
    <Dialog open={!!edit} onOpenChange={open => { if (!open && !save.isPending) { setEdit(null); setPassword(""); } }}><DialogContent><DialogHeader><DialogTitle>Irland Lotto settings</DialogTitle><DialogDescription>Sales pause applies immediately. Interval changes apply to newly scheduled draws; existing tickets keep their rules.</DialogDescription></DialogHeader>
      {edit && <form className="space-y-4" onSubmit={event => { event.preventDefault(); save.mutate(); }}>
        <label className="flex items-center gap-2"><input type="checkbox" checked={edit.salesEnabled} onChange={e => setEdit({ ...edit, salesEnabled: e.target.checked })} />Accept ticket sales</label>
        <label className="block text-sm">Draw interval (minutes)<Input type="number" min={1} max={60} required value={edit.interval} onChange={e => setEdit({ ...edit, interval: Number(e.target.value) })} /></label>
        <label className="block text-sm">Maximum ticket (₹)<Input type="number" min={100} max={20000} required value={edit.maxTicket} onChange={e => setEdit({ ...edit, maxTicket: Number(e.target.value) })} /></label>
        <label className="block text-sm">Confirm admin password<Input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
        {save.isError && <p role="alert" className="text-sm text-red-600">{save.error.message}</p>}
        <Button type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</Button>
      </form>}
    </DialogContent></Dialog>
  </div>;
}
