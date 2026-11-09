import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

type Recipient={userId:string;name:string;stakePaise:string;amountPaise:string};
type Preview={amountPaise:string;cutoffAt:string;previewHash:string;recipientCount:number;eligibleCount:number;totalStakePaise:string;recipients:Recipient[]};
type Entry={id:string;kind:string;amount:string;balanceAfter:string;createdAt:string;recipientCount:number|null};
type Detail={master:{id:string;name:string;playerRtpBps:number|null};canDistribute:boolean;totals:Record<string,string|null>;history:Entry[]};
const money=(value:string|null|undefined)=>{const n=BigInt(value??"0"),v=n<0n?-n:n;return `${n<0n?"-":""}₹${(v/100n).toLocaleString("en-IN")}.${String(v%100n).padStart(2,"0")}`;};
function paise(value:string){
 if(!/^\d+(?:\.\d{1,2})?$/.test(value))throw new Error("Enter an amount with up to two decimal places.");
 const [whole,decimal=""]=value.split(".");const amount=BigInt(whole)*100n+BigInt(decimal.padEnd(2,"0"));
 if(amount<=0n)throw new Error("Enter an amount greater than zero.");return amount.toString();
}
const api=<T,>(path:string,body?:unknown)=>customFetch<T>(`/api/network/bank-floor${path}`,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});

export function NetworkBankFloor(){
 const list=useQuery({queryKey:["network","bank-floor"],queryFn:()=>api<{canDistribute:boolean;masters:{id:string;name:string}[]}>(""),retry:false});
 const [selected,setSelected]=useState("");
 useEffect(()=>{if(!selected&&list.data?.masters[0])setSelected(list.data.masters[0].id);},[list.data,selected]);
 return <section className="net-card net-bank-floor" aria-label="Bank floor">
  <style>{`.net-panel .net-bank-floor .net-primary:hover{background:#0b5c4b;color:#fff}`}</style>
  <h2>Bank floor</h2>
  <p>Keep part of a master's earned profit for customer bonuses. Only admin can reserve, return or distribute funds. Masters can view their own balances.</p>
  <p>Bonuses are credited to the cash wallet in proportion to eligible settled stakes across all games. They do not change game results or guarantee a profit margin.</p>
  {list.isError&&<p role="alert" className="net-error">{list.error.message}</p>}
  {list.isPending&&<p>Loading profit banks...</p>}
  {!!list.data?.masters.length&&<label className="net-field"><span>Master</span><select aria-label="Bank floor master" value={selected} onChange={e=>setSelected(e.target.value)}>{list.data.masters.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>}
  {list.data?.masters.length===0&&<p>Create a master to view its profit bank.</p>}
  {selected&&<MasterBank key={selected} masterId={selected}/>}
 </section>;
}
function MasterBank({masterId}:{masterId:string}){
 const qc=useQueryClient();
 const detail=useQuery({queryKey:["network","bank-floor",masterId],queryFn:()=>api<Detail>(`/${masterId}`),refetchInterval:15000,retry:false});
 const [reserve,setReserve]=useState(""),[release,setRelease]=useState(""),[amount,setAmount]=useState("");
 const [preview,setPreview]=useState<Preview|null>(null),[receipt,setReceipt]=useState<Recipient[]|null>(null),[shown,setShown]=useState(50);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const sending=useRef(false);
 // Preserve the request ID and reviewed plan across uncertain network failures.
 const [pending,setPending]=useState<{kind:"reserve"|"return"|"distribute";body:Record<string,string>}|null>(null);
 const rememberKey=`bank-floor:pending:${masterId}`;
 useEffect(()=>{try{const saved=JSON.parse(sessionStorage.getItem(rememberKey)??"null");if(saved&&["reserve","return","distribute"].includes(saved.kind)&&typeof saved.body?.requestId==="string")setPending(saved);}catch{}},[rememberKey]);
 function remember(value:typeof pending){setPending(value);try{if(value)sessionStorage.setItem(rememberKey,JSON.stringify(value));else sessionStorage.removeItem(rememberKey);}catch{}}
 async function send(operation:NonNullable<typeof pending>){
  if(sending.current)return;sending.current=true;
  setBusy(true);setError("");setNotice("");remember(operation);
  try{await api(`/${masterId}/${operation.kind}`,operation.body);remember(null);setPreview(null);setReceipt(null);setReserve("");setRelease("");setAmount("");setNotice(operation.kind==="distribute"?"Profit bonuses credited. Wallet balances and the distribution ledger are updated.":operation.kind==="reserve"?"Profit reserved in the bank floor.":"Unused funds returned to the master's available profit.");await qc.invalidateQueries({queryKey:["network"]});}
  catch(e){setError((e as Error).message);const status=(e as {status?:number}).status;if(status&&status>=400&&status<500){remember(null);setPreview(null);void detail.refetch();}}
  finally{sending.current=false;setBusy(false);}
 }
 async function move(kind:"reserve"|"return",value:string){try{await send({kind,body:{amountPaise:paise(value),requestId:crypto.randomUUID()}});}catch(e){setError((e as Error).message);}}
 async function review(){setBusy(true);setError("");setNotice("");setReceipt(null);try{const value=paise(amount);const plan=await api<Preview>(`/${masterId}/preview?amountPaise=${value}`);setPreview(plan);setShown(50);}catch(e){setError((e as Error).message);setPreview(null);}finally{setBusy(false);}}
 async function showReceipt(id:string){setBusy(true);setError("");try{const result=await api<{recipients:Recipient[]}>(`/${masterId}/distributions/${id}`);setReceipt(result.recipients);setPreview(null);setShown(50);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 const data=detail.data,t=data?.totals,locked=busy||!!pending;
 if(detail.isPending)return <p>Loading balances...</p>;
 if(detail.isError)return <p role="alert" className="net-error">{detail.error.message}</p>;
 const rows=preview?.recipients??receipt;
 return <>
  <div className="net-stats" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:12,margin:"20px 0"}}>
   {[["Settled stakes",t?.settledStakePaise],["Player returns",t?.playerPayoutPaise],["Branch gaming profit",t?.branchProfitPaise],["Master's earned share",t?.masterEarnedPaise],["Available profit to reserve",t?.availableProfitPaise],["Bank floor balance",t?.bankBalancePaise],["Bonuses distributed",t?.distributedPaise]].map(([label,value])=><article key={label}><span>{label}</span><strong style={{display:"block"}}>{money(value)}</strong></article>)}
  </div>
  <p>Actual gaming margin: <strong>{t?.actualMarginPercent===null?"No settled stakes":`${t?.actualMarginPercent}%`}</strong>. {data?.master.playerRtpBps!==null&&<>Current theoretical house edge: <strong>{((10000-data!.master.playerRtpBps!)/100).toFixed(2)}%</strong>. </>}Actual profit can rise or fall.</p>
  <p>Available profit is the master's earned share after company/agent shares, recorded settlements and bank reservations. Bank reservations are shown in the settlement ledger; returning unused funds reverses that reservation.</p>
  {BigInt(t?.unallocatedProfitPaise??"0")<0n&&<p>Unallocated profit/loss balance: <strong>{money(t?.unallocatedProfitPaise)}</strong>. New reservations are unavailable until this balance is positive.</p>}
  {!data?.canDistribute&&<p><strong>View only.</strong> Contact admin to reserve or distribute profit bonuses.</p>}
  {data?.canDistribute&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(230px,1fr))",gap:20}}>
   <form onSubmit={e=>{e.preventDefault();void move("reserve",reserve);}}><h3>Reserve profit</h3><label className="net-field"><span>Amount (₹)</span><input aria-label="Reserve profit amount" inputMode="decimal" value={reserve} onChange={e=>setReserve(e.target.value)} disabled={locked} required/></label><button className="net-primary" disabled={locked}>Add to bank floor</button></form>
   <form onSubmit={e=>{e.preventDefault();void move("return",release);}}><h3>Return unused funds</h3><label className="net-field"><span>Amount (₹)</span><input aria-label="Return unused amount" inputMode="decimal" value={release} onChange={e=>setRelease(e.target.value)} disabled={locked} required/></label><button disabled={locked}>Return to available profit</button></form>
   <form onSubmit={e=>{e.preventDefault();void review();}}><h3>Distribute profit bonus</h3><label className="net-field"><span>Amount (₹)</span><input aria-label="Distribution amount" inputMode="decimal" value={amount} onChange={e=>{setAmount(e.target.value);setPreview(null);}} disabled={locked} required/></label><button className="net-primary" disabled={locked}>Preview distribution</button></form>
  </div>}
  {pending&&data?.canDistribute&&<p role="status">The last {pending.kind} request needs confirmation. Retrying uses the same request ID and cannot pay twice. <button disabled={busy} onClick={()=>void send(pending)}>Check / retry last request</button></p>}
  {error&&<p role="alert" className="net-error">{error}</p>}{notice&&<p role="status" className="net-success">{notice}</p>}
  {preview&&<section aria-label="Distribution preview" style={{marginTop:20}}><h3>Review before crediting wallets</h3><p><strong>{money(preview.amountPaise)}</strong> to <strong>{preview.recipientCount}</strong> users. Total eligible settled stakes: {money(preview.totalStakePaise)}.</p><p>Uses all settled cash stakes up to {new Date(preview.cutoffAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})} IST. Active players under active agents in this master only. Each allocation is proportional to stake; leftover paise follow largest remainders. No wagering requirement. Preview expires after 10 minutes.</p><button className="net-primary" disabled={locked} onClick={()=>void send({kind:"distribute",body:{requestId:crypto.randomUUID(),amountPaise:preview.amountPaise,cutoffAt:preview.cutoffAt,previewHash:preview.previewHash}})}>Distribute {money(preview.amountPaise)} now</button></section>}
  {rows&&<section aria-label={receipt?"Distribution receipt":"Recipient amounts"}><div style={{overflowX:"auto"}}><table className="net-table"><thead><tr><th>User</th><th>Settled stakes</th><th>Profit bonus</th></tr></thead><tbody>{rows.slice(0,shown).map(r=><tr key={r.userId}><td>{r.name}</td><td>{money(r.stakePaise)}</td><td>{money(r.amountPaise)}</td></tr>)}</tbody></table></div>{shown<rows.length&&<button onClick={()=>setShown(n=>n+100)}>Show more ({rows.length-shown} remaining)</button>}</section>}
  <h3 style={{marginTop:24}}>Bank floor history</h3><div style={{overflowX:"auto"}}><table className="net-table"><thead><tr><th>Date (IST)</th><th>Action</th><th>Amount</th><th>Bank balance</th><th>Receipt</th></tr></thead><tbody>{data?.history.map(e=><tr key={e.id}><td>{new Date(e.createdAt).toLocaleString("en-IN",{timeZone:"Asia/Kolkata"})}</td><td>{e.kind}</td><td>{money(e.amount)}</td><td>{money(e.balanceAfter)}</td><td>{e.kind==="distribute"&&<button disabled={busy} onClick={()=>void showReceipt(e.id)}>View {e.recipientCount} credits</button>}</td></tr>)}</tbody></table></div>{data?.history.length===0&&<p>No reservations or distributions yet.</p>}
 </>;
}
