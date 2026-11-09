import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type Master = { id: string; name: string; playerRtpBps: number | null; revision: number };
type Policies = { masters: Master[]; games: string[] };
const policyKey = ["network", "rtp"] as const;
const policyQuery = { queryKey: policyKey, queryFn: ({ signal }: { signal: AbortSignal }) => customFetch<Policies>("/api/network/rtp", { signal, cache: "no-store" }), staleTime: 0 };
const names: Record<string,string> = {jetx: "JetX", fury: "Fury Flight", mines: "Mines", plinko: "Plinko", dice: "Dice", ludo: "Ludo", "lucky-7-live": "Lucky 7 Live", "wheel-2-live": "Wheel 2.0", "poker-20-20": "Poker 20/20", "crazy-time": "Crazy Time", "chicken-road": "Chicken Road", "7up7down": "7 Up Down", "coin-flip": "Coin Flip", wingo: "Colour"};
const rtpValue = (master: Master) => master.playerRtpBps === null ? "" : String(master.playerRtpBps / 100);

export function NetworkRtp() {
  const query = useQuery({ ...policyQuery, refetchInterval: 5000, retry: false });
  return <section className="net-card" aria-label="Master RTP settings">
    <h2>Master RTP</h2>
    <p>Each policy applies only to players under that master's agents, on supported games. Other masters and B2C keep their own rules. Accepted rounds keep their original terms.</p>
    <p><strong>Supported games:</strong> {query.data?.games.map(code => names[code] ?? code).join(", ") ?? "Loading..."}.</p>
    <p>This target changes the posted rates or probabilities in the listed games. Ludo uses the matching pool return and commission; individual return depends on play. Rounding/caps can reduce returns. Company/master profit sharing is calculated separately from actual results.</p>
    {query.isError && <p className="net-error" role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data?.masters.map(master => <MasterRtpForm key={master.id} master={master} />)}
    {query.data?.masters.length === 0 && <p>Create a master to configure its RTP.</p>}
  </section>;
}
function MasterRtpForm({ master }: { master: Master }) {
  const qc = useQueryClient();
  const [inherit, setInherit] = useState(master.playerRtpBps === null);
  const [rtp, setRtp] = useState(rtpValue(master));
  const [revision, setRevision] = useState(master.revision);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  function accept(fresh: Master) {
    setInherit(fresh.playerRtpBps === null); setRtp(rtpValue(fresh)); setRevision(fresh.revision); setDirty(false);
  }
  // Admin and master can have this screen open together. Refresh clean forms,
  // but retain a draft's original revision so another panel cannot be overwritten.
  useEffect(() => {
    if (!dirty) accept(master);
  }, [master.playerRtpBps, master.revision, dirty]);
  const mutation = useMutation({
    mutationFn: (playerRtpBps: number | null) => customFetch<Master>(`/api/network/rtp/${master.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerRtpBps, revision }),
    }),
    onMutate: async () => { await qc.cancelQueries({ queryKey: policyKey, exact: true }); },
    onSuccess: fresh => {
      // Use the confirmed response immediately; an in-flight GET must not put
      // the previous value back or remove the save confirmation by remounting.
      qc.setQueryData<Policies>(policyKey, previous => previous && ({ ...previous, masters: previous.masters.map(item => item.id === fresh.id ? fresh : item) }));
      accept(fresh); setSaved(true); setReloadError(null);
    },
  });
  const percent = Number(rtp), bps = Math.round(percent * 100);
  const valid = rtp.trim() !== "" && Number.isFinite(percent) && bps >= 100 && bps <= 10000 && Math.abs(bps / 100 - percent) < 1e-8;
  const changedElsewhere = dirty && revision !== master.revision;
  const busy = mutation.isPending || reloading;
  function edit() { setDirty(true); setSaved(false); setReloadError(null); mutation.reset(); }
  function submit(event: FormEvent) { event.preventDefault(); if (!busy && !changedElsewhere && (inherit || valid)) mutation.mutate(inherit ? null : bps); }
  async function reload() {
    setReloading(true); setReloadError(null);
    try {
      await qc.cancelQueries({ queryKey: policyKey, exact: true });
      const policies = await qc.fetchQuery(policyQuery);
      const fresh = policies.masters.find(item => item.id === master.id);
      if (!fresh) throw new Error("Master is no longer available. Reload the page.");
      accept(fresh); setSaved(false); mutation.reset();
    } catch (error) { setReloadError(error instanceof Error ? error.message : "Could not reload RTP. Try again."); }
    finally { setReloading(false); }
  }
  return <form onSubmit={submit} style={{ borderTop: "1px solid #dce4e8", paddingTop: 20, marginTop: 20 }}>
    <h3 style={{ fontWeight: 700, marginBottom: 12 }}>{master.name}</h3>
    <p data-testid={`saved-rtp-${master.id}`}><strong>Current saved policy: </strong>{master.playerRtpBps === null ? "Company game settings" : `Player RTP ${(master.playerRtpBps / 100).toFixed(2)}% / theoretical house edge ${((10000 - master.playerRtpBps) / 100).toFixed(2)}%`}.</p>
    <label className="net-field"><span>RTP policy</span><select aria-label={`RTP policy for ${master.name}`} value={inherit ? "company" : "master"} onChange={e => { setInherit(e.target.value === "company"); edit(); }} disabled={busy}>
      <option value="company">Use company game settings</option><option value="master">Set master player RTP</option>
    </select></label>
    {!inherit && <><label className="net-field"><span>Player RTP (%)</span><input aria-label={`Player RTP for ${master.name}`} type="number" min="1" max="100" step="0.01" required value={rtp} onChange={e => { setRtp(e.target.value); edit(); }} disabled={busy} /></label>
      <p>{dirty ? "Unsaved selection" : "Player return target"}: <strong>{valid ? percent.toFixed(2) : "—"}%</strong>. House edge: <strong>{valid ? (100 - percent).toFixed(2) : "—"}%</strong>. Actual player returns and operator profit are not guaranteed.</p></>}
    {dirty && <p>Changes apply after Save RTP, to new rounds only.</p>}
    {changedElsewhere && <p className="net-error" role="alert">This policy changed in another panel. Reload policy to review the latest saved value before editing again.</p>}
    <div className="net-actions"><button className="net-primary" disabled={busy || changedElsewhere || (!inherit && !valid)}>{mutation.isPending ? "Saving..." : "Save RTP"}</button>
      <button type="button" disabled={busy} onClick={() => void reload()}>{reloading ? "Reloading..." : "Reload policy"}</button></div>
    {mutation.isError && <p className="net-error" role="alert">{mutation.error.message}</p>}
    {reloadError && <p className="net-error" role="alert">{reloadError}</p>}
    {saved && !dirty && <p role="status" className="net-success">{master.playerRtpBps === null ? "Saved company game settings." : `Saved player RTP: ${(master.playerRtpBps / 100).toFixed(2)}%.`} Applies to new rounds; accepted rounds keep their original terms.</p>}
  </form>;
}
