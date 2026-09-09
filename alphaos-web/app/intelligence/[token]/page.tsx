import Link from "next/link";
import AppShell from "@/components/layout/AppShell";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Props={params:Promise<{token:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>};
function one(v:string|string[]|undefined){return Array.isArray(v)?v[0]:v}
function n(v:unknown){if(v===null||v===undefined||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null}
function money(v:number|null){return v===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(v)}
function pct(v:number|null){return v===null?"—":`${v>0?"+":""}${v.toFixed(Math.abs(v)>=100?0:1)}%`}
function short(v:string){return v.length>22?`${v.slice(0,10)}…${v.slice(-8)}`:v}
function rawN(r:Record<string,unknown>,keys:string[]){for(const k of keys){const x=n(r[k]);if(x!==null)return x}return null}
function rawS(r:Record<string,unknown>,keys:string[]){for(const k of keys){const x=r[k];if(typeof x==="string"&&x.trim())return x.trim()}return null}
function riskClass(v:string){return v==="HIGH"||v==="CRITICAL"?"text-rose-300":v==="MEDIUM"?"text-amber-300":"text-emerald-300"}

export default async function IntelligencePage({params,searchParams}:Props){
  const {token}=await params;const q=await searchParams;const decoded=decodeURIComponent(token);
  const [oppResult,alertResult,memoryResult]=await Promise.all([
    supabaseAdmin.from("opportunities").select("id,opportunity_type,asset_id,chain,source_agent,title,risk_score,confidence,status,raw_data,created_at,updated_at").eq("asset_id",decoded).order("created_at",{ascending:false}).limit(1).maybeSingle(),
    supabaseAdmin.from("alerts").select("token_address,symbol,name,score_at_alert,risk_at_alert,alert_price,current_price,high_price_after_alert,liquidity_at_alert,buys5m_at_alert,sells5m_at_alert,volume5m_at_alert,roi_now,roi_high,alerted_at,alert_type").eq("token_address",decoded).order("alerted_at",{ascending:false}).limit(1).maybeSingle(),
    supabaseAdmin.from("token_memory").select("token,symbol,name,chain,current_market_cap,peak_market_cap,current_liquidity,current_price,highest_price,confidence,risk_level,status,max_return_pct,drawdown_from_peak_pct,last_updated").eq("token",decoded).maybeSingle()
  ]);
  const opp:any=oppResult.data,alert:any=alertResult.data,memory:any=memoryResult.data;
  const raw=opp?.raw_data&&typeof opp.raw_data==="object"&&!Array.isArray(opp.raw_data)?opp.raw_data as Record<string,unknown>:{};
  const chain=String(opp?.chain??memory?.chain??one(q.chain)??(decoded.startsWith("0x")?"robinhood":"solana")).toLowerCase();
  const isRobinhood=chain==="robinhood";
  const symbol=rawS(raw,["symbol","token_symbol","ticker"])??alert?.symbol??memory?.symbol??one(q.symbol)??"TOKEN";
  const name=rawS(raw,["name"])??alert?.name??memory?.name??symbol;
  const confidence=n(opp?.confidence)??n(alert?.score_at_alert)??n(memory?.confidence)??n(one(q.confidence))??0;
  const risk=String(raw.risk_level??alert?.risk_at_alert??memory?.risk_level??one(q.risk)??(n(opp?.risk_score)!==null&&n(opp?.risk_score)!>70?"HIGH":n(opp?.risk_score)!>35?"MEDIUM":"LOW")).toUpperCase();
  const marketCap=rawN(raw,["marketCap","market_cap","mcap","fdv"])??n(memory?.current_market_cap)??n(one(q.marketCap));
  const ath=rawN(raw,["peakMarketCap","athMarketCap","ath_market_cap","allTimeHighMarketCap","marketCapAth"])??n(memory?.peak_market_cap);
  const fromAth=rawN(raw,["distanceFromAthMarketCapPct"])??n(memory?.drawdown_from_peak_pct)??(marketCap!==null&&ath!==null&&ath>0?(marketCap/ath-1)*100:null);
  const liquidity=rawN(raw,["liquidity","liquidity_usd","liquidityUsd"])??n(memory?.current_liquidity)??n(alert?.liquidity_at_alert)??n(one(q.liquidity));
  const volume=rawN(raw,["volume5m","volume_5m"])??n(alert?.volume5m_at_alert);
  const buys=rawN(raw,["buys5m","buys_5m"])??n(alert?.buys5m_at_alert);const sells=rawN(raw,["sells5m","sells_5m"])??n(alert?.sells5m_at_alert);
  const currentRoi=rawN(raw,["currentRoi","current_roi"])??n(alert?.roi_now);const peakRoi=rawN(raw,["recentPeakRoi","peakRoi"])??n(alert?.roi_high)??n(memory?.max_return_pct);
  const volumeMultiple=rawN(raw,["volumeMultiple"]);const state=rawS(raw,["intelligenceState","state"])??String(opp?.status??memory?.status??alert?.alert_type??"TRACKING");
  const chartUrl=rawS(raw,["chartUrl"]);const source=String(opp?.source_agent??one(q.source)??(alert?"AlphaOS Alert Engine":"AlphaOS Intelligence"));
  const hasEvidence=Boolean(opp||alert||memory);
  const facts:[[string,string,string],[string,string,string],[string,string,string],[string,string,string],[string,string,string],[string,string,string],[string,string,string],[string,string,string]]=[
    ["MARKET CAP",money(marketCap),"text-white"],["RECORDED ATH",money(ath),"text-amber-200"],["FROM ATH",pct(fromAth),fromAth!==null&&fromAth<=-30?"text-emerald-300":"text-zinc-100"],["LIQUIDITY",money(liquidity),"text-white"],["5M VOLUME",money(volume),"text-white"],["BUYS / SELLS",buys!==null||sells!==null?`${buys??"—"} / ${sells??"—"}`:"—","text-white"],["CURRENT MOVE",pct(currentRoi),currentRoi!==null&&currentRoi>0?"text-emerald-300":"text-zinc-100"],["PEAK MOVE",pct(peakRoi),"text-emerald-300"]
  ];
  return <AppShell><main className="px-4 pb-28 pt-5 text-white sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"><div className="mx-auto max-w-[1100px]">
    <div className="flex items-center justify-between"><Link href="/" className="text-xs font-medium text-zinc-500 hover:text-white">← Home</Link><Link href="/opportunities" className="text-xs font-medium text-zinc-400 hover:text-white">Live Radar →</Link></div>
    <section className="mt-5 rounded-3xl border border-white/[0.09] bg-[#171b1f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-7"><div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] ${isRobinhood?"border-emerald-400/20 text-emerald-300":"border-violet-400/20 text-violet-300"}`}>{isRobinhood?"ROBINHOOD · PONS":chain.toUpperCase()}</span><span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold text-zinc-300">{state.toUpperCase()}</span></div><p className="mt-5 text-[10px] font-semibold tracking-[0.18em] text-zinc-500">ALPHAOS TOKEN INTELLIGENCE</p><h1 className="mt-1 text-4xl font-semibold tracking-[-0.04em]">{symbol}</h1><p className="mt-1 text-sm text-zinc-500">{name}</p><p className="mt-2 font-mono text-[10px] text-zinc-600">{short(decoded)}</p></div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-4 text-right"><p className="text-4xl font-semibold text-emerald-300">{Math.round(confidence)}</p><p className="mt-1 text-[9px] tracking-[0.16em] text-zinc-500">ALPHA SCORE</p></div></div>
      {hasEvidence?<><div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">{facts.map(([l,v,c])=><div key={l} className="rounded-2xl border border-white/[0.07] bg-[#1c2125] p-3.5"><p className="text-[8px] tracking-[0.13em] text-zinc-500">{l}</p><p className={`mt-1.5 text-sm font-semibold ${c}`}>{v}</p></div>)}</div>{volumeMultiple!==null&&volumeMultiple>1.2?<div className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4"><p className="text-xs font-semibold text-emerald-200">Volume expansion {volumeMultiple.toFixed(1)}×</p><p className="mt-1 text-[11px] text-zinc-500">Current 5m activity is above the previous observed window.</p></div>:null}</>:<div className="mt-7 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">AlphaOS has the token reference, but no market evidence has been stored yet. Keep it on Radar until the next observation arrives.</div>}
    </section>
    <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]"><section className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6"><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">WHAT MATTERS NOW</p><h2 className="mt-2 text-xl font-semibold">{state.toUpperCase()}</h2><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Risk</span><span className={riskClass(risk)}>{risk}</span></div><div className="flex justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Source</span><span className="max-w-[62%] text-right text-zinc-200">{source}</span></div><div className="flex justify-between"><span className="text-zinc-500">ATH context</span><span className="text-right text-zinc-200">{ath!==null?`${money(ath)} · ${pct(fromAth)} from ATH`:"Awaiting recorded peak"}</span></div></div></section><aside className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6"><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">QUICK ACTIONS</p><h2 className="mt-2 text-xl font-semibold">Verify before acting.</h2>{chartUrl?<a href={chartUrl} target="_blank" rel="noreferrer" className="mt-5 flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-4 text-xs font-semibold text-emerald-200">Open live chart ↗</a>:null}<Link href="/opportunities" className="mt-2 flex min-h-11 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 text-xs font-semibold text-zinc-200">Back to Live Radar</Link></aside></div>
  </div></main></AppShell>;
}
