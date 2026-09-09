import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }>; searchParams: Promise<Record<string,string|string[]|undefined>> };
function one(v:string|string[]|undefined){return Array.isArray(v)?v[0]:v}
function n(v:unknown){const x=Number(v);return Number.isFinite(x)?x:null}
function money(v:number|null){return v===null?"—":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(v)}
function pct(v:number|null){return v===null?"—":`${v>0?"+":""}${v.toFixed(Math.abs(v)>=100?0:1)}%`}
function short(v:string){return v.length>22?`${v.slice(0,10)}…${v.slice(-8)}`:v}
function rawNum(r:Record<string,unknown>,keys:string[]){for(const k of keys){const x=n(r[k]);if(x!==null)return x}return null}
function rawStr(r:Record<string,unknown>,keys:string[]){for(const k of keys){const x=r[k];if(typeof x==="string"&&x.trim())return x.trim()}return null}

export default async function IntelligencePage({params,searchParams}:Props){
  const {token}=await params; const query=await searchParams; const decoded=decodeURIComponent(token);
  let data:any=null;
  const direct=await supabaseAdmin.from("opportunities").select("id,opportunity_type,asset_id,chain,source_agent,title,entry_price,exit_price,expected_profit_percent,risk_score,confidence,status,raw_data,created_at,updated_at").eq("asset_id",decoded).order("created_at",{ascending:false}).limit(1).maybeSingle();
  data=direct.data;
  const raw=data?.raw_data&&typeof data.raw_data==="object"&&!Array.isArray(data.raw_data)?data.raw_data as Record<string,unknown>:{};
  const symbol=rawStr(raw,["symbol","token_symbol","ticker"])??one(query.symbol)??data?.title??"TOKEN";
  const name=rawStr(raw,["name"])??symbol;
  const chain=String(data?.chain??one(query.chain)??"robinhood").toLowerCase();
  const confidence=n(data?.confidence??one(query.confidence)??raw.score)??0;
  const riskScore=n(data?.risk_score)??50;
  const risk=String(raw.risk_level??one(query.risk)??(riskScore>70?"HIGH":riskScore>35?"MEDIUM":"LOW")).toUpperCase();
  const marketCap=rawNum(raw,["marketCap","market_cap","mcap","fdv"])??n(one(query.marketCap));
  const ath=rawNum(raw,["peakMarketCap","athMarketCap","ath_market_cap","allTimeHighMarketCap","marketCapAth"]);
  const fromAth=rawNum(raw,["distanceFromAthMarketCapPct"] ) ?? (marketCap!==null&&ath!==null&&ath>0 ? (marketCap/ath-1)*100 : null);
  const liquidity=rawNum(raw,["liquidity","liquidity_usd","liquidityUsd"])??n(one(query.liquidity));
  const volume=rawNum(raw,["volume5m","volume_5m"]); const buys=rawNum(raw,["buys5m","buys_5m"]); const sells=rawNum(raw,["sells5m","sells_5m"]);
  const currentRoi=rawNum(raw,["currentRoi","current_roi"]); const peakRoi=rawNum(raw,["recentPeakRoi","peakRoi"]); const volumeMultiple=rawNum(raw,["volumeMultiple"]);
  const state=rawStr(raw,["intelligenceState","state"])??String(data?.status??"WATCHING"); const chartUrl=rawStr(raw,["chartUrl"]); const source=String(data?.source_agent??one(query.source)??"AlphaOS Intelligence");
  const isRobinhood=chain==="robinhood";
  const useful=[
    ["MARKET CAP",money(marketCap),"text-white"],
    ["ATH",money(ath),"text-amber-200"],
    ["FROM ATH",pct(fromAth),fromAth!==null&&fromAth<=-30?"text-emerald-300":"text-zinc-100"],
    ["LIQUIDITY",money(liquidity),"text-white"],
    ["5M VOLUME",money(volume),"text-white"],
    ["BUYS / SELLS",buys!==null||sells!==null?`${buys??"—"} / ${sells??"—"}`:"—","text-white"],
    ["CURRENT MOVE",pct(currentRoi),currentRoi!==null&&currentRoi>0?"text-emerald-300":"text-zinc-100"],
    ["PEAK MOVE",pct(peakRoi),"text-emerald-300"],
  ];
  return <main className="min-h-screen bg-[#101316] px-4 pb-28 pt-5 text-white sm:px-6 lg:px-8 lg:pb-10 lg:pt-8"><div className="mx-auto max-w-[1050px]">
    <Link href="/" className="text-xs font-medium text-zinc-500 hover:text-white">← Back to AlphaOS</Link>
    <section className="mt-5 rounded-3xl border border-white/[0.09] bg-[#171b1f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.18)] sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full border px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] ${isRobinhood?"border-emerald-400/20 text-emerald-300":"border-violet-400/20 text-violet-300"}`}>{isRobinhood?"ROBINHOOD · PONS":chain.toUpperCase()}</span><span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold text-zinc-300">{state.toUpperCase()}</span></div><p className="mt-5 text-[10px] font-semibold tracking-[0.18em] text-zinc-500">ALPHAOS TOKEN INTELLIGENCE</p><h1 className="mt-1 text-4xl font-semibold tracking-[-0.04em]">{symbol}</h1><p className="mt-1 text-sm text-zinc-500">{name}</p><p className="mt-2 font-mono text-[10px] text-zinc-600">{short(decoded)}</p></div><div className="rounded-2xl border border-white/[0.08] bg-white/[0.035] px-5 py-4 text-right"><p className="text-4xl font-semibold text-emerald-300">{Math.round(confidence)}</p><p className="mt-1 text-[9px] tracking-[0.16em] text-zinc-500">ALPHA SCORE</p></div></div>
      <div className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-4">{useful.map(([l,v,c])=><div key={String(l)} className="rounded-2xl border border-white/[0.07] bg-[#1c2125] p-3.5"><p className="text-[8px] tracking-[0.13em] text-zinc-500">{l}</p><p className={`mt-1.5 text-sm font-semibold ${c}`}>{v}</p></div>)}</div>
      {volumeMultiple!==null&&volumeMultiple>1.2?<div className="mt-4 rounded-2xl border border-emerald-300/15 bg-emerald-300/[0.04] p-4"><p className="text-xs font-semibold text-emerald-200">Volume expansion {volumeMultiple.toFixed(1)}×</p><p className="mt-1 text-[11px] text-zinc-500">Current 5m activity is materially above the previous observed window.</p></div>:null}
    </section>
    <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_0.65fr]"><section className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6"><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">WHAT MATTERS NOW</p><h2 className="mt-2 text-xl font-semibold">{state.toUpperCase()}</h2><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Risk</span><span className={risk==="HIGH"?"text-rose-300":risk==="MEDIUM"?"text-amber-300":"text-emerald-300"}>{risk}</span></div><div className="flex justify-between border-b border-white/[0.06] pb-3"><span className="text-zinc-500">Source</span><span className="max-w-[62%] text-right text-zinc-200">{source}</span></div><div className="flex justify-between"><span className="text-zinc-500">ATH context</span><span className="text-right text-zinc-200">{ath!==null?`${money(ath)} · ${pct(fromAth)} from ATH`:"ATH not recorded yet"}</span></div></div></section><aside className="rounded-3xl border border-white/[0.08] bg-[#171b1f] p-5 sm:p-6"><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">QUICK ACTIONS</p><h2 className="mt-2 text-xl font-semibold">Verify before acting.</h2>{chartUrl?<a href={chartUrl} target="_blank" rel="noreferrer" className="mt-5 flex min-h-11 items-center justify-center rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-4 text-xs font-semibold text-emerald-200">Open live chart ↗</a>:null}<Link href="/opportunities" className="mt-2 flex min-h-11 items-center justify-center rounded-xl border border-white/[0.09] bg-white/[0.03] px-4 text-xs font-semibold text-zinc-200">Back to Live Radar</Link></aside></div>
  </div></main>;
}
