import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type Policy = { gameCode: string; playerRtpBps: number | null; revision: number };
type Policies = { policies: Policy[] };
const key = ["b2c-rtp"] as const;
const queryOptions = { queryKey:key,queryFn:({signal}:{signal:AbortSignal})=>customFetch<Policies>("/api/game/b2c-rtp",{signal,cache:"no-store"}),staleTime:0 };
const names: Record<string,string> = {lunar:"Aviator / Lunar",jetx:"JetX",fury:"Fury Flight",mines:"Mines",plinko:"Plinko",dice:"Dice",ludo:"Ludo","lucky-7-live":"Lucky 7 Live","wheel-2-live":"Wheel 2.0","poker-20-20":"Poker 20/20","crazy-time":"Crazy Time","chicken-road":"Chicken Road","7up7down":"7 Up Down","coin-flip":"Coin Flip",wingo:"Colour"};
const value = (policy:Policy) => policy.playerRtpBps === null ? "" : String(policy.playerRtpBps/100);

export function B2cRtp({ embedded = false, initialGame = "jetx" }: { embedded?: boolean; initialGame?: string } = {}) {
 const query = useQuery({...queryOptions,refetchInterval:5000,retry:false});
 const [game,setGame] = useState(initialGame);
 const policy = query.data?.policies.find(p=>p.gameCode===game);
 return <section className="b2c-rtp" aria-label="B2C RTP settings">
  <style>{`.b2c-rtp,.b2c-rtp *{box-sizing:border-box}.b2c-rtp{font-family:system-ui,sans-serif;max-width:800px;color:#172b3a;background:white;border:1px solid #dce4e8;border-radius:12px;padding:24px}.b2c-rtp h1{font-size:24px;font-weight:700;margin-bottom:12px}.b2c-rtp h2{font-size:20px;font-weight:700;margin:20px 0 12px}.b2c-rtp p{line-height:1.6;margin:12px 0}.b2c-rtp label{display:grid;gap:6px;margin:16px 0;font-weight:600}.b2c-rtp input,.b2c-rtp select{width:100%;padding:10px;border:1px solid #acbdc9;border-radius:6px;background:white;color:#172b3a}.b2c-rtp button{padding:10px 18px;border:1px solid #acbdc9;border-radius:6px;margin:4px 8px 4px 0}.b2c-rtp button[type=submit]{background:#047857;color:white;border-color:#047857}.b2c-rtp button:disabled{opacity:.5;cursor:not-allowed}.b2c-rtp [role=alert]{color:#b42318}.b2c-rtp [role=status]{color:#047857}.b2c-rtp .rtp-saved{background:#edf7f2;border-radius:8px;padding:12px}@media(max-width:480px){.b2c-rtp{padding:16px}}`}</style>
  {embedded ? <h2>B2C player RTP</h2> : <h1>B2C RTP</h1>}
  <p>Set player RTP separately for each B2C game. These settings apply only to B2C players; B2B masters keep their own policies.</p>
  <p>New rounds use the saved target. Accepted bets and active rounds keep their original terms. Actual returns and profit are not guaranteed; rounding and payout caps can reduce returns. Ludo uses this as the pool return, with the remaining percentage as commission.</p>
  {query.isPending && <p>Loading RTP settings...</p>}
  {query.isError && <p role="alert">{query.error.message} <button onClick={()=>void query.refetch()}>Retry</button></p>}
  {query.data && <label>Game<select aria-label="B2C game" value={game} onChange={e=>setGame(e.target.value)}>{query.data.policies.map(p=><option key={p.gameCode} value={p.gameCode}>{names[p.gameCode]??p.gameCode}</option>)}</select></label>}
  {policy && <PolicyForm key={policy.gameCode} policy={policy} />}
 </section>;
}
function PolicyForm({policy}:{policy:Policy}) {
 const qc=useQueryClient();
 const [inherit,setInherit]=useState(policy.playerRtpBps===null), [rtp,setRtp]=useState(value(policy));
 const [revision,setRevision]=useState(policy.revision), [dirty,setDirty]=useState(false), [saved,setSaved]=useState(false);
 const [password,setPassword]=useState(""), [reloading,setReloading]=useState(false), [reloadError,setReloadError]=useState<string|null>(null);
 function accept(p:Policy){setInherit(p.playerRtpBps===null);setRtp(value(p));setRevision(p.revision);setDirty(false);}
 useEffect(()=>{if(!dirty)accept(policy);},[policy.playerRtpBps,policy.revision,dirty]);
 const save=useMutation({mutationFn:(playerRtpBps:number|null)=>customFetch<Policy>(`/api/game/b2c-rtp/${policy.gameCode}`,{method:"PUT",headers:{"Content-Type":"application/json","X-Confirm-Password":password},body:JSON.stringify({playerRtpBps,revision})}),
  onMutate:async()=>{await qc.cancelQueries({queryKey:key,exact:true});},
  onSuccess:fresh=>{qc.setQueryData<Policies>(key,old=>old&&({...old,policies:old.policies.map(p=>p.gameCode===fresh.gameCode?fresh:p)}));accept(fresh);setSaved(true);setReloadError(null);},
  onSettled:()=>setPassword("")});
 const percent=Number(rtp), bps=Math.round(percent*100);
 const valid=rtp.trim()!==""&&Number.isFinite(percent)&&bps>=100&&bps<=10000&&Math.abs(bps/100-percent)<1e-8;
 const conflict=dirty&&revision!==policy.revision, busy=save.isPending||reloading;
 function edit(){setDirty(true);setSaved(false);setReloadError(null);save.reset();}
 async function reload(){setReloading(true);setReloadError(null);try{
  await qc.cancelQueries({queryKey:key,exact:true});const fresh=(await qc.fetchQuery(queryOptions)).policies.find(p=>p.gameCode===policy.gameCode);
  if(!fresh)throw new Error("Game is no longer available. Reload the page.");accept(fresh);setSaved(false);setPassword("");save.reset();
 }catch(e){setReloadError(e instanceof Error?e.message:"Could not reload RTP");}finally{setReloading(false);}}
 function submit(e:FormEvent){e.preventDefault();if(!busy&&!conflict&&password&&(inherit||valid))save.mutate(inherit?null:bps);}
 return <form onSubmit={submit} aria-label={`B2C RTP for ${names[policy.gameCode]??policy.gameCode}`}>
  <h2>{names[policy.gameCode]??policy.gameCode}</h2>
  <p className="rtp-saved" data-testid="b2c-saved-rtp"><strong>Current saved policy: </strong>{policy.playerRtpBps===null?"Original game rules":`Player RTP ${(policy.playerRtpBps/100).toFixed(2)}% / theoretical house edge ${((10000-policy.playerRtpBps)/100).toFixed(2)}%`}.</p>
  <label>RTP policy<select aria-label="B2C RTP policy" value={inherit?"original":"custom"} onChange={e=>{setInherit(e.target.value==="original");edit();}} disabled={busy}><option value="original">Use original game rules</option><option value="custom">Set B2C player RTP</option></select></label>
  {!inherit&&<><label>Player RTP (%)<input aria-label="B2C player RTP" type="number" min="1" max="100" step="0.01" required value={rtp} onChange={e=>{setRtp(e.target.value);edit();}} disabled={busy}/></label>
  <p>{dirty?"Unsaved selection":"Player return target"}: {valid?percent.toFixed(2):"—"}%. House edge: {valid?(100-percent).toFixed(2):"—"}%.</p></>}
  {dirty&&<p>Changes apply after Save RTP, to new rounds only.</p>}
  {conflict&&<p role="alert">This policy changed in another panel. Reload policy before editing again.</p>}
  <label>Confirm admin password<input aria-label="Confirm admin password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} disabled={busy}/></label>
  <button type="submit" disabled={busy||conflict||!password||(!inherit&&!valid)}>{save.isPending?"Saving...":"Save RTP"}</button>
  <button type="button" disabled={busy} onClick={()=>void reload()}>{reloading?"Reloading...":"Reload policy"}</button>
  {save.isError&&<p role="alert">{save.error.message}</p>}{reloadError&&<p role="alert">{reloadError}</p>}
  {saved&&!dirty&&<p role="status">{policy.playerRtpBps===null?"Saved original game rules.":`Saved player RTP: ${(policy.playerRtpBps/100).toFixed(2)}%.`} Applies to new rounds.</p>}
 </form>;
}
