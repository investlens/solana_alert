"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { LiveIntelligenceProof, ShadowDecision } from "@/lib/intelligence/types";

type ApiResponse = { success: boolean; data?: LiveIntelligenceProof; error?: string };

function money(value: number | null) {
  if (value == null) return "Verifying";
  return new Intl.NumberFormat("en-US", { style:"currency", currency:"USD", notation:"compact", maximumFractionDigits:1 }).format(value);
}
function chainLabel(chain:string){return chain==="robinhood"?"ROBINHOOD · PONS":chain.toUpperCase()}
function reasonText(value:unknown){if(typeof value==="string")return value;if(value&&typeof value==="object"){const record=value as Record<string,unknown>;for(const key of ["reason","label","message","name"]){if(typeof record[key]==="string")return String(record[key])}}return null}
function LearningCard({decision}:{decision:ShadowDecision}){
 const positives=decision.topPositiveReasons.map(reasonText).filter(Boolean).slice(0,2) as string[];
 const negatives=decision.topNegativeReasons.map(reasonText).filter(Boolean).slice(0,2) as string[];
 const measured=decision.outcomes.length;
 const changed=decision.shadowAction&&decision.currentAction&&decision.shadowAction!==decision.currentAction;
 return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4">
  <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold">{decision.symbol??"Unknown token"}</p><p className="mt-1 text-[9px] tracking-[0.12em] text-zinc-600">{chainLabel(decision.chain)}</p></div><span className={`rounded-full border px-2 py-1 text-[8px] font-semibold ${decision.promotionEligible?"border-emerald-300/20 text-emerald-300":"border-white/[0.08] text-zinc-500"}`}>{decision.promotionEligible?"EVIDENCE READY":"SHADOW ONLY"}</span></div>
  <div className="mt-3 grid grid-cols-3 gap-2"><div><p className="text-[8px] text-zinc-600">PRODUCTION</p><p className="mt-1 text-xs font-semibold">{decision.currentAction??"—"}</p></div><div><p className="text-[8px] text-zinc-600">AI V2</p><p className="mt-1 text-xs font-semibold text-emerald-200">{decision.shadowAction??"—"}</p></div><div><p className="text-[8px] text-zinc-600">DELTA</p><p className="mt-1 text-xs font-semibold">{decision.scoreDelta==null?"—":`${decision.scoreDelta>=0?"+":""}${decision.scoreDelta}`}</p></div></div>
  <p className="mt-3 text-[10px] text-zinc-500">{changed?"AI V2 disagrees with production and is being measured before any promotion.":"AI V2 currently agrees with production; outcomes continue to accumulate."} {measured?`${measured} measured checkpoint${measured===1?"":"s"} attached.`:"No measured checkpoint attached yet."}</p>
  {positives.length?<p className="mt-2 text-[10px] text-emerald-300/80">Supports: {positives.join(" · ")}</p>:null}
  {negatives.length?<p className="mt-1 text-[10px] text-amber-200/75">Watch: {negatives.join(" · ")}</p>:null}
 </div>
}

export default function LiveIntelligenceSummary(){
 const[proof,setProof]=useState<LiveIntelligenceProof|null>(null),[error,setError]=useState<string|null>(null);
 useEffect(()=>{let active=true;const load=async()=>{try{const response=await fetch("/api/proof",{cache:"no-store"});const payload=await response.json() as ApiResponse;if(!active)return;if(!response.ok||!payload.success||!payload.data){setError(payload.error??"Live intelligence unavailable");return}setProof(payload.data);setError(null)}catch{if(active)setError("Live intelligence unavailable")}};void load();const id=window.setInterval(load,30000);return()=>{active=false;window.clearInterval(id)}},[]);
 const learning=useMemo(()=>proof?.decisions.filter(d=>d.currentAction!==d.shadowAction||d.promotionEligible).slice(0,3)??[],[proof]);
 if(!proof)return <section className="px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8"><div className="mx-auto max-w-[1180px] rounded-3xl border border-white/[0.08] bg-[#171b1f] p-4 sm:p-5"><p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">● LIVE INTELLIGENCE</p><p className="mt-2 text-sm text-zinc-500">{error??"Loading verified AlphaOS evidence…"}</p></div></section>;
 const top=proof.topOpportunity;
 return <section className="px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8"><div className="mx-auto max-w-[1180px]">
  <div className="grid gap-2 sm:grid-cols-3">{[["HIGH CONVICTION",proof.status.highConviction,"text-emerald-300"],["WATCHING",proof.status.watching,"text-amber-200"],["RISK BLOCKED",proof.status.riskBlocked,"text-red-300"]].map(([label,value,tone])=><div key={String(label)} className="rounded-2xl border border-white/[0.08] bg-[#171b1f] p-4"><p className="text-[9px] font-semibold tracking-[0.14em] text-zinc-500">{label}</p><p className={`mt-1.5 text-2xl font-semibold ${tone}`}>{value}</p><p className="mt-1 text-[9px] text-zinc-600">Last 24h · verified event store</p></div>)}</div>
  <div className="mt-3 rounded-3xl border border-emerald-300/15 bg-[#171b1f] p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">● TOP OPPORTUNITY NOW</p>{top?<><div className="mt-2 flex flex-wrap items-center gap-2"><h2 className="text-2xl font-semibold">{top.symbol??"Unknown token"}</h2><span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold text-zinc-400">{chainLabel(top.chain)}</span></div><p className="mt-1 text-xs text-zinc-500">{top.type??top.state??"Observed opportunity"}</p></>:<p className="mt-2 text-sm text-zinc-500">No opportunity currently has sufficient market evidence to rank.</p>}</div>{top?.confidence!=null?<div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-right"><p className="text-2xl font-semibold text-emerald-300">{Math.round(top.confidence)}</p><p className="text-[8px] tracking-[0.14em] text-zinc-500">CONFIDENCE</p></div>:null}</div>
  {top?<><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">MARKET CAP</p><p className="mt-1 text-sm font-semibold">{money(top.marketCap)}</p></div><div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">LIQUIDITY</p><p className="mt-1 text-sm font-semibold">{money(top.liquidity)}</p></div><div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">5M VOLUME</p><p className="mt-1 text-sm font-semibold">{money(top.volume5m)}</p></div><div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">RISK</p><p className="mt-1 text-sm font-semibold">{top.risk??"Verifying"}</p></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-xs text-zinc-500">{top.reason??"Verified market evidence is available; deeper evidence is still being evaluated."}</p><Link href={`/intelligence/${encodeURIComponent(top.token)}`} className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-2.5 text-xs font-semibold text-emerald-200">Open Intelligence →</Link></div></>:null}</div>
  <div className="mt-3 rounded-3xl border border-white/[0.08] bg-[#171b1f] p-4 sm:p-5"><div className="flex items-end justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-violet-300">● AI LEARNING LAB</p><h2 className="mt-1 text-xl font-semibold">What AlphaOS is learning</h2><p className="mt-1 text-xs text-zinc-500">Shadow V2 can recommend, disagree and learn — but cannot change production decisions yet.</p></div><span className="text-[9px] text-zinc-600">MEASURED OUTCOMES ONLY</span></div><div className="mt-4 grid gap-2 lg:grid-cols-3">{learning.length?learning.map(d=><LearningCard key={d.id} decision={d}/>):<p className="text-sm text-zinc-600">No evidence-backed shadow recommendation is ready to surface yet.</p>}</div></div>
 </div></section>
}
