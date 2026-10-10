"use client";
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Winner } from '@/lib/dashboard/winners';
const price = (v:number) => `$${v.toLocaleString('en-US',{maximumSignificantDigits:6})}`;
const date = (v:string|null) => v ? new Date(v).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'})+' UTC' : '';
export default function WinnerShowcase({ full = false }: {full?:boolean}) {
  const [data,setData] = useState<{items:Winner[];generatedAt:string;degraded:boolean;trackedSample:number}|null>(null);
  const [failed,setFailed] = useState(false);
  useEffect(()=>{ const controller=new AbortController();
    fetch('/api/winners',{signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.json();})
      .then(r=>{if(!r.success)throw new Error();setData(r.data);}).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
    return ()=>controller.abort();
  },[]);
  return <section id="winners" className="section-space"><div className="section-heading"><div><p className="premium-eyebrow">POST-ALERT PRICE MILESTONES</p><h2>Winners, with the evidence.</h2><p>Tokens sampled at 2× or more after a delivered alert. Peak and latest observations shown together.</p></div>{!full && <Link className="premium-button" href="/winners">View all winners →</Link>}</div>
    <p className="data-notice">Selected winners, not an overall win rate. Sampled peaks are not lifetime ATH, live quotes or realised profits. These alerts are research information, not buy signals.</p>
    {data?.degraded && <p role="status" className="data-notice">Coverage is incomplete; results may be cached.</p>}
    <div className="opportunity-grid">{data?.items.slice(0,full?100:6).map(w=><article className="research-card" key={w.identity}>
      <div className="card-top"><span className="chain-label">{w.chain==='robinhood'?'Robinchain':w.chain.toUpperCase()}</span><span className="text-emerald-300">{w.multiple.toFixed(2)}× observed</span></div>
      <h3>{w.symbol}</h3><p className="card-reason">{w.name ?? w.alertType.replaceAll('_',' ')}</p>
      <div className="market-highlight"><span>HIGHEST SAMPLED SINCE ALERT</span><strong>{price(w.peakPrice!)}</strong><p className="muted small">{date(w.peakObservedAt)}</p></div>
      <div className="card-facts"><div><span>Alert price</span><strong>{price(w.alertPrice!)}</strong></div><div><span>Latest sampled</span><strong>{price(w.currentPrice!)}</strong></div><div><span>Latest / alert</span><strong>{w.latestMultiple.toFixed(2)}×</strong></div><div><span>Change from sampled peak</span><strong className={w.drawdown<0?'negative':''}>{w.drawdown.toFixed(1)}%</strong></div></div>
      <p className="muted small">Alert · {date(w.alertedAt)}<br/>Latest · {date(w.measuredAt)}<br/>{w.alertType.replaceAll('_',' ')} · DEX price checkpoints</p>
      <p className="muted small break-all mt-3">{w.token}</p>
      <Link className="card-link" href={`/intelligence/${encodeURIComponent(w.token)}?chain=${encodeURIComponent(w.chain)}`}>Inspect token research <span>↗</span></Link>
    </article>)}</div>
    {!data && !failed && <p role="status" className="empty-state">Loading measured outcomes…</p>}
    {(failed || (data && !data.items.length)) && <p role="status" className="empty-state">{failed || data?.degraded ? 'Winner evidence could not be loaded. No performance claim is made.' : 'No comparable 2× observations in the retained tracking sample yet.'}</p>}
    {data && <p className="muted small mt-3">{data.items.length} qualifying tokens in a bounded sample of {data.trackedSample} retained USD tracking records. Refreshed {date(data.generatedAt)}. Tracking samples may miss peaks and subsequent drops; this is not a complete trading record.</p>}
  </section>;
}
