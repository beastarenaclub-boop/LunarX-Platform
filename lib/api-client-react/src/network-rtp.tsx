import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type Master = { id: string; name: string; playerRtpBps: number | null; revision: number };
type Policies = { masters: Master[]; games: string[] };
const names: Record<string,string> = {jetx: "JetX", fury: "Fury Flight", mines: "Mines", plinko: "Plinko", dice: "Dice", ludo: "Ludo", "lucky-7-live": "Lucky 7 Live", "wheel-2-live": "Wheel 2.0", "poker-20-20": "Poker 20/20", "crazy-time": "Crazy Time", "chicken-road": "Chicken Road", "7up7down": "7 Up Down", "coin-flip": "Coin Flip", wingo: "Colour"};

export function NetworkRtp() {
  const query = useQuery({ queryKey: ["network", "rtp"], queryFn: () => customFetch<Policies>("/api/network/rtp"), staleTime: 0 });
  return <section className="net-card" aria-label="Master RTP settings">
    <h2>Master RTP</h2>
    <p>Each policy applies only to players under that master’s agents, on supported games. Other masters and B2C keep their own rules. Accepted rounds keep their original terms.</p>
    <p><strong>Supported games:</strong> {query.data?.games.map(code => names[code] ?? code).join(", ") ?? "Loading…"}.</p>
    <p>This target changes the posted rates or probabilities in the listed games. Ludo uses the matching table commission: 70% pool return means 30% commission; individual return depends on play. Rounding/caps can reduce returns. Company/master profit sharing is calculated separately from actual results.</p>
    {query.isError && <p className="net-error" role="alert">{query.error.message} <button onClick={() => void query.refetch()}>Retry</button></p>}
    {query.data?.masters.map(master => <MasterRtpForm key={`${master.id}:${master.revision}`} master={master} />)}
    {query.data?.masters.length === 0 && <p>Create a master to configure its RTP.</p>}
  </section>;
}
function MasterRtpForm({ master }: { master: Master }) {
  const qc = useQueryClient();
  const [inherit, setInherit] = useState(master.playerRtpBps === null);
  const [rtp, setRtp] = useState(String((master.playerRtpBps ?? 7000) / 100));
  const [saved, setSaved] = useState(false);
  const mutation = useMutation({ mutationFn: (playerRtpBps: number | null) => customFetch<Master>(`/api/network/rtp/${master.id}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playerRtpBps, revision: master.revision }),
  }), onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ["network"] }); } });
  const percent = Number(rtp), bps = Math.round(percent * 100);
  const valid = rtp.trim() !== "" && Number.isFinite(percent) && bps >= 100 && bps <= 10000 && Math.abs(bps / 100 - percent) < 1e-8;
  function submit(event: FormEvent) { event.preventDefault(); if (inherit || valid) mutation.mutate(inherit ? null : bps); }
  return <form onSubmit={submit} style={{ borderTop: "1px solid #dce4e8", paddingTop: 20, marginTop: 20 }}>
    <h3 style={{ fontWeight: 700, marginBottom: 12 }}>{master.name}</h3>
    <label className="net-field"><span>RTP policy</span><select aria-label={`RTP policy for ${master.name}`} value={inherit ? "company" : "master"} onChange={e => { setInherit(e.target.value === "company"); setSaved(false); }} disabled={mutation.isPending}>
      <option value="company">Use company game settings</option><option value="master">Set master player RTP</option>
    </select></label>
    {!inherit && <><label className="net-field"><span>Player RTP (%)</span><input aria-label={`Player RTP for ${master.name}`} type="number" min="1" max="100" step="0.01" required value={rtp} onChange={e => { setRtp(e.target.value); setSaved(false); }} disabled={mutation.isPending} /></label>
      <p>House edge: <strong>{valid ? (100 - percent).toFixed(2) : "—"}%</strong>. 70% player RTP means 30% theoretical house edge before rounding/caps. Actual player returns and operator profit are not guaranteed.</p></>}
    <div className="net-actions"><button className="net-primary" disabled={mutation.isPending || (!inherit && !valid)}>{mutation.isPending ? "Saving…" : "Save RTP"}</button>
      <button type="button" disabled={mutation.isPending} onClick={() => void qc.invalidateQueries({ queryKey: ["network", "rtp"] })}>Reload policy</button></div>
    {mutation.isError && <p className="net-error" role="alert">{mutation.error.message}</p>}
    {saved && <p role="status" className="net-success">RTP saved for new rounds.</p>}
  </form>;
}
