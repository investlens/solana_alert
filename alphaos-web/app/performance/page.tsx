import Link from 'next/link';
import { loadPerformance } from '@/lib/performance';
export const dynamic='force-dynamic';
export const metadata={title:'AlphaOS | Alert performance'};
export default async function Performance() {
 let data:Awaited<ReturnType<typeof loadPerformance>>|null=null;try{data=await loadPerformance();}catch{}
 const coverage=data?.coverage??[];
 const total=(key:string)=>coverage.reduce((n,row)=>n+Number((row as Record<string,unknown>)[key]??0),0);
 return <main className="min-h-screen bg-slate-950 text-slate-100 px-5 py-12"><div className="max-w-6xl mx-auto">
  <Link href="/" className="text-teal-300">← AlphaOS</Link><p className="text-teal-300 mt-10 text-sm tracking-widest">PUBLIC PERFORMANCE</p>
  <h1 className="text-4xl font-semibold mt-3">Evidence behind the alerts</h1><p className="text-slate-400 mt-4 max-w-3xl">Returns use the recorded alert baseline and sampled prices from the same venue. These are price changes, not realised profits. Sampling may miss peaks; fees and slippage are excluded.</p>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-8">{[['Tracked',total('tracked')],['Winners',total('winners')],['Failed',total('failed')],['Incomplete / excluded',total('incomplete')+total('excluded')]].map(([label,value])=><div key={label} className="border border-slate-800 rounded-2xl p-5"><p className="text-slate-400 text-sm">{label}</p><p className="text-3xl mt-2">{value}</p></div>)}</div>
  <p className="text-sm text-slate-400 mb-6">Coverage: last 30 UTC days, bounded to 1,000 feed/day records. Winner classification requires the 6-hour result ≥25% and no sampled decline below −30%. Recent detail is retained temporarily; successful records persist. This is a monitored subset, not every alert.</p>
  {!data?<p role="alert">Performance data is temporarily unavailable.</p>:!data.items.length?<p>No comparable outcomes have been recorded yet.</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-slate-400">{['Token / feed','Baseline','Latest sampled','Sampled peak','Outcome / evidence'].map(v=><th key={v} className="p-3">{v}</th>)}</tr></thead><tbody>{data.items.map(row=><tr id={row.token} key={row.chain+row.token} className="border-t border-slate-800"><td className="p-3"><code>{row.token.slice(0,8)}…{row.token.slice(-6)}</code><p>{row.chain} · {row.feed}</p></td><td className="p-3">{row.unit==='USD'?`$${row.baseline.toPrecision(5)}`:'Curve reserve ratio'}<p className="text-xs text-slate-400">{row.startedAt??'Original timestamp unavailable'}</p></td><td className="p-3">{row.latest!==null?`${(row.latest/row.baseline).toFixed(2)}× · ${((row.latest/row.baseline-1)*100).toFixed(1)}%`:'Unavailable'}<p className="text-xs text-slate-400">{row.observedAt}</p></td><td className="p-3">{row.peak!==null?`${(row.peak/row.baseline).toFixed(2)}×`:'Not comparable'}</td><td className="p-3">{row.outcome}{row.chart&&<p><a className="text-teal-300" href={row.chart} target="_blank" rel="noreferrer">Verify pool ↗</a></p>}</td></tr>)}</tbody></table></div>}
  <p className="mt-10 text-slate-500 text-xs">Updated {data?.generatedAt??'unavailable'}. Pre-bond reserve ratios are not USD trading returns. Historical winners without an original timestamp cannot establish alert timing.</p>
 </div></main>;
}
