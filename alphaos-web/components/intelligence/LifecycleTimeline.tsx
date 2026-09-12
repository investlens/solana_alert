import Link from "next/link";
import type { TokenLifecycle } from "@/lib/intelligence/types";

function chainLabel(chain:string){return chain==="robinhood"?"ROBINHOOD · PONS":chain.toUpperCase()}
function roi(value:number|null){return value==null?null:`${value>=0?"+":""}${value.toFixed(Math.abs(value)>=100?0:1)}%`}
function time(value:string|null){if(!value)return"Time unavailable";const d=new Date(value);return Number.isNaN(d.getTime())?"Time unavailable":d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
function stateTone(state:string|null){const s=String(state??"").toUpperCase();if(["DANGER","WEAKENING","COOLING","EXIT"].includes(s))return"border-red-300/20 bg-red-300/[0.06] text-red-200";if(["ENTRY_READY","OPPORTUNITY","RUNNING","CONFIRMED"].includes(s))return"border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200";return"border-amber-200/15 bg-amber-200/[0.04] text-amber-100"}

export default function LifecycleTimeline({lifecycle}:{lifecycle:TokenLifecycle}){
 return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><p className="text-base font-semibold">{lifecycle.symbol??"Unknown token"}</p><span className="text-[8px] tracking-[0.12em] text-zinc-600">{chainLabel(lifecycle.chain)}</span></div><p className="mt-1 text-[9px] text-zinc-600">{lifecycle.events.length} verified observations · current state {lifecycle.currentState??"unknown"}</p></div><Link href={`/intelligence/${encodeURIComponent(lifecycle.token)}`} className="text-[10px] font-semibold text-emerald-300">Full Intel →</Link></div>
  <div className="mt-4 overflow-x-auto pb-1"><div className="flex min-w-max items-start">{lifecycle.events.map((event,index)=>{const move=roi(event.currentRoi);return <div key={String(event.id)} className="flex items-start"><div className="w-[142px]"><div className={`inline-flex rounded-full border px-2.5 py-1 text-[8px] font-semibold tracking-[0.08em] ${stateTone(event.state)}`}>{event.state??event.type??"OBSERVED"}</div><p className="mt-2 text-[9px] text-zinc-600">{time(event.observedAt)}</p>{move?<p className={`mt-1 text-[10px] font-semibold ${event.currentRoi!=null&&event.currentRoi>=0?"text-emerald-300":"text-red-300"}`}>{move} ROI</p>:null}<p className="mt-1 max-w-[130px] truncate text-[9px] text-zinc-500">{event.type??"event"}</p></div>{index<lifecycle.events.length-1?<div className="mt-3 h-px w-8 bg-white/10"/>:null}</div>})}</div></div>
 </div>
}
