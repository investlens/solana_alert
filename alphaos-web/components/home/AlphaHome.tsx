"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ApiResponse, LiveOpportunity, OpportunitiesResponse } from "@/lib/dashboard/types";
import ContractSearch from "@/components/home/ContractSearch";

type Alert = { id: string; token: string; symbol: string; chain: string; alertPrice: number | null; currentPrice: number | null; roiHigh: number | null; roiNow: number | null; alertedAt: string | null };
type Performance = { recent: Alert[]; generatedAt: string; degraded?: boolean };
const money = (v: number | null) => v == null || !Number.isFinite(v) ? "Not available" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(v);
const pct = (v: number | null) => v == null ? "Not available" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const date = (v: string | null) => v && Number.isFinite(Date.parse(v)) ? new Date(v).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "Time not recorded";
const chainName = (v: string) => v === "robinhood" ? "Robinchain" : v === "unknown" ? "Chain unconfirmed" : v.toUpperCase();
const features = [
  ["01", "Boost & DEX Paid", "See promotion events as they are detected. A payment or boost is evidence of promotion, not buying momentum.", "Event feeds"],
  ["02", "Contract research", "Check recorded market evidence, then use Telegram /scan for a fresh contract or wallet investigation.", "Research tools"],
  ["03", "Creator intelligence", "Inspect developer holdings, observed transfers and recorded launch history. Missing coverage stays explicit.", "Partial coverage"],
  ["04", "Trade Setup Watch", "Watch qualifying recovery evidence. Volume confirmation requires complete history; setups are not automatic entries.", "Conditional feed"],
];

export default function AlphaHome() {
  const [items, setItems] = useState<LiveOpportunity[]>([]);
  const [performance, setPerformance] = useState<Performance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(false);
      const results = await Promise.allSettled([
        fetch("/api/opportunities", { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return await r.json() as ApiResponse<OpportunitiesResponse>; }),
        fetch("/api/top-alerts", { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return await r.json() as ApiResponse<Performance>; }),
      ]);
      if (controller.signal.aborted) return;
      const [opportunities, outcomes] = results;
      if (opportunities.status === "fulfilled" && opportunities.value.success) setItems(opportunities.value.data.items);
      else { setItems([]); setError(true); }
      if (outcomes.status === "fulfilled" && outcomes.value.success) setPerformance(outcomes.value.data);
      else { setPerformance(null); setError(true); }
      setLoading(false);
    }
    void load();
    return () => controller.abort();
  }, [refresh]);
  const visible = items.filter(i => filter === "all" || i.chain === filter).slice(0, 6);
  return <main className="premium-page"><div className="premium-container">
    <div className="product-topline"><span>RESEARCH FIRST. TRADE INFORMED.</span><Link href="/guide">How AlphaOS works ↗</Link></div>
    <section className="product-hero">
      <div><p className="premium-eyebrow">YOUR TOKEN INTELLIGENCE WORKSPACE</p><h1>Understand the token.<br/><span>Before you trade.</span></h1><p className="hero-description">Promotion events, market evidence and creator research. One clear view of what happened, what is known and what still needs checking.</p><div className="hero-actions"><a className="alpha-button-primary" href="/api/open-bot">Open Telegram bot ↗</a><Link className="premium-button" href="/scan">Research a contract</Link></div><div className="chain-tags"><span>Robinchain · PONS</span><span>ARC event alerts</span><span>Solana research</span></div></div>
      <div className="hero-visual" aria-label="AlphaOS research workflow illustration"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="visual-logo">A</div><span className="visual-chip chip-one">01 / MARKET EVIDENCE</span><span className="visual-chip chip-two">02 / CREATOR ACTIVITY</span><span className="visual-chip chip-three">03 / YOUR DECISION</span><div className="visual-footer"><span className="text-emerald-300">ALPHAOS</span><span>EVIDENCE OVER HYPE</span></div></div>
    </section>
    <section className="search-strip"><div><p className="premium-eyebrow">START WITH A CONTRACT</p><h2>No wallet connection needed.</h2></div><ContractSearch compact/></section>
    <section id="terminal" className="section-space"><div className="section-heading"><div><p className="premium-eyebrow">THE TERMINAL</p><h2>Recorded opportunities</h2><p>Stored observations, not executable quotes. Open research to inspect the evidence.</p></div><button className="premium-button" disabled={loading} onClick={() => setRefresh(x => x + 1)}>{loading ? "Loading…" : "Refresh"}</button></div>
      <div className="filter-row" role="group" aria-label="Filter opportunities by chain">{[["all", "All chains"], ["robinhood", "Robinchain"], ["arc", "ARC"], ["solana", "Solana"]].map(([key, label]) => <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)} className={filter === key ? "selected" : ""}>{label}</button>)}</div>
      {error && <p role="status" className="data-notice">Some data could not be loaded. Unavailable data is not a negative trading signal.</p>}
      <div className="opportunity-grid">{visible.map(item => <article className="research-card" key={item.id}><div className="card-top"><span className="chain-label">{chainName(item.chain)}</span><span className="muted">{item.intelligenceState}</span></div><h3>{item.symbol}</h3><p className="card-reason">{item.title === "Venue confirmation pending" ? item.title : item.marketSource}</p><div className="market-highlight"><span>MARKET CAP</span><strong>{money(item.marketCap)}</strong></div><div className="card-facts"><div><span>Liquidity</span><strong>{money(item.liquidity)}</strong></div><div><span>Recorded market risk</span><strong>{item.riskLevel}</strong></div></div><p className="muted small">Observed {date(item.observedAt)} · Not a live quote</p><Link className="card-link" href={`/intelligence/${encodeURIComponent(item.token)}?chain=${encodeURIComponent(item.chain)}`}>Open recorded research <span>↗</span></Link></article>)}</div>
      {!loading && !visible.length && <div className="empty-state">No recorded opportunities in this view. Telegram delivery and this stored shortlist are separate; an empty view does not establish that the scanners are offline.</div>}
    </section>
    <section className="section-space"><div className="section-heading"><div><p className="premium-eyebrow">WHAT YOU CAN DO</p><h2>Less noise. More context.</h2></div><Link className="text-link" href="/guide">Explore the features →</Link></div><div className="feature-grid">{features.map(([n, title, description, status]) => <article className="feature-card" key={n}><span className="feature-number">{n}</span><span className="feature-status">{status}</span><h3>{title}</h3><p>{description}</p></article>)}</div></section>
    <section id="proof" className="section-space"><div className="section-heading"><div><p className="premium-eyebrow">OUTCOME TRANSPARENCY</p><h2>Inspect the record, including drops.</h2><p>Recent sampled records. Recorded change is not realised profit; recorded peaks are not guaranteed ATH.</p></div></div>
      {performance?.degraded && <p className="data-notice">Outcome coverage is incomplete. These records may be cached.</p>}
      <div className="outcome-list">{performance?.recent?.slice(0, 6).map(a => <Link key={a.id} href={`/intelligence/${encodeURIComponent(a.token)}?chain=${encodeURIComponent(a.chain)}`} className="outcome-row"><div><strong>{a.symbol}</strong><span>{chainName(a.chain)} · {date(a.alertedAt)}</span></div><div><span>Recorded vs alert</span><strong className={(a.roiNow ?? 0) < 0 ? "negative" : ""}>{pct(a.roiNow)}</strong></div><div><span>Observed peak move</span><strong>{pct(a.roiHigh)}</strong></div></Link>)}</div>
      {!loading && !performance?.recent?.length && <div className="empty-state">No outcome records are available. No performance claim can be made.</div>}
      <p className="muted small mt-3">{performance ? `Dataset generated ${date(performance.generatedAt)}. Observation freshness varies by token.` : "Coverage includes recorded Solana and Robinchain alerts; ARC outcomes are not yet included."}</p>
    </section>
    <section className="access-banner section-space"><div><p className="premium-eyebrow">BUILT AROUND YOUR RESEARCH</p><h2>Start free. Know what comes next.</h2><p>Compare Free and Pro delivery, learn the tools and follow the planned AlphaOS holder utility.</p></div><div className="hero-actions"><Link className="alpha-button-primary" href="/me">Compare access</Link><Link className="premium-button" href="/token">Holder roadmap →</Link></div></section>
    <footer className="product-footer"><span>AlphaOS · Token intelligence</span><div><Link href="/status">Data coverage</Link><Link href="/guide">Getting started</Link><Link href="/token">Token roadmap</Link></div><p>Research tools, not a profit guarantee. Validate current market conditions before trading.</p></footer>
  </div></main>;
}
