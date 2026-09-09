"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiResponse, LiveOpportunity, OpportunitiesResponse } from "@/lib/dashboard/types";

type WindowKey = "today" | "7d" | "30d" | "all";
type ChainFilter = "all" | "solana" | "robinhood";
type AlertItem = {
  id: string; token: string; symbol: string; name: string | null;
  chain: "solana" | "robinhood" | "unknown"; score: number | null;
  alertPrice?: number | null; currentPrice?: number | null; highPrice?: number | null;
  roiHigh: number | null; roiNow: number | null; alertedAt: string | null; alertType?: string | null;
};
type TopAlertResponse = {
  window: WindowKey; top: AlertItem | null; leaders: AlertItem[]; recent?: AlertItem[];
  summary: { tracked: number; winners: number; over100: number; medianPeak: number | null };
};

const windows: Array<{ key: WindowKey; label: string }> = [
  { key: "today", label: "Today" }, { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" }, { key: "all", label: "All Time" },
];

function chainMeta(chain: string) {
  if (chain === "robinhood") return { label: "ROBINHOOD · PONS", dot: "bg-emerald-400", text: "text-emerald-300", border: "border-emerald-400/20" };
  if (chain === "solana") return { label: "SOLANA", dot: "bg-violet-400", text: "text-violet-300", border: "border-violet-400/20" };
  return { label: "CHAIN", dot: "bg-zinc-500", text: "text-zinc-400", border: "border-white/10" };
}

function pct(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(Math.abs(value) >= 100 ? 0 : 1)}%`;
}

function compact(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function timeAgo(value: string | null) {
  if (!value) return "—";
  const diff = Math.max(Date.now() - new Date(value).getTime(), 0);
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function ChainPill({ chain }: { chain: string }) {
  const meta = chainMeta(chain);
  return <span className={`inline-flex items-center gap-2 rounded-full border ${meta.border} bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] ${meta.text}`}><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}</span>;
}

function intelligenceUrl(item: LiveOpportunity) {
  if (item.chain === "robinhood") {
    const params = new URLSearchParams({ chain: "robinhood", symbol: item.symbol, source: item.sourceAgent || "AlphaOS", confidence: String(item.confidence), risk: item.riskLevel });
    if (item.marketCap !== null) params.set("marketCap", String(item.marketCap));
    if (item.liquidity !== null) params.set("liquidity", String(item.liquidity));
    return `/intelligence/${encodeURIComponent(item.token)}?${params.toString()}`;
  }
  return item.reportUrl;
}

function OpportunityCard({ item }: { item: LiveOpportunity }) {
  const meta = chainMeta(item.chain);
  return <article className="rounded-2xl border border-white/[0.08] bg-[#181d21] p-4 shadow-[0_14px_40px_rgba(0,0,0,0.14)] sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><ChainPill chain={item.chain} /><h3 className="mt-3 text-xl font-semibold text-white">{item.symbol}</h3><p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{item.title}</p></div>
      <div className="rounded-xl border border-white/[0.07] bg-white/[0.035] px-3 py-2 text-right"><p className={`text-2xl font-semibold ${meta.text}`}>{item.confidence}</p><p className="text-[8px] tracking-[0.14em] text-zinc-500">ALPHA</p></div>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.07] py-3">
      <div><p className="text-[8px] tracking-wider text-zinc-500">MARKET CAP</p><p className="mt-1 text-xs font-medium text-zinc-100">{compact(item.marketCap)}</p></div>
      <div><p className="text-[8px] tracking-wider text-zinc-500">LIQUIDITY</p><p className="mt-1 text-xs font-medium text-zinc-100">{compact(item.liquidity)}</p></div>
      <div><p className="text-[8px] tracking-wider text-zinc-500">RISK</p><p className="mt-1 text-xs font-medium text-zinc-100">{item.riskLevel}</p></div>
    </div>
    <div className="mt-3 flex items-center justify-between text-[10px] text-zinc-500"><span>{item.sourceAgent || "AlphaOS Intelligence"}</span><span>{timeAgo(item.createdAt)} ago</span></div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button type="button" className="rounded-xl border border-white/[0.09] bg-white/[0.03] px-3 py-2.5 text-xs font-medium text-zinc-200">Track</button>
      <Link href={intelligenceUrl(item)} className="rounded-xl bg-white px-3 py-2.5 text-center text-xs font-semibold text-[#111519] transition hover:bg-zinc-200">Open Intelligence →</Link>
    </div>
  </article>;
}

export default function AlphaHome() {
  const [windowKey, setWindowKey] = useState<WindowKey>("all");
  const [performance, setPerformance] = useState<TopAlertResponse | null>(null);
  const [opportunities, setOpportunities] = useState<LiveOpportunity[]>([]);
  const [chain, setChain] = useState<ChainFilter>("all");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [topResponse, opportunitiesResponse] = await Promise.all([
        fetch(`/api/top-alerts?window=${windowKey}`, { cache: "no-store" }),
        fetch("/api/opportunities", { cache: "no-store" }),
      ]);
      const topPayload = await topResponse.json() as ApiResponse<TopAlertResponse>;
      const oppPayload = await opportunitiesResponse.json() as ApiResponse<OpportunitiesResponse>;
      if (topPayload.success) setPerformance(topPayload.data);
      if (oppPayload.success) setOpportunities(oppPayload.data.items);
    } finally { setLoading(false); }
  }, [windowKey]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => opportunities.filter((item) => chain === "all" || item.chain === chain).slice(0, 4), [opportunities, chain]);
  const leaders = performance?.leaders?.slice(0, 3) ?? [];
  const recent = performance?.recent?.slice(0, 6) ?? [];
  const winRate = performance?.summary.tracked ? Math.round((performance.summary.winners / performance.summary.tracked) * 100) : 0;

  return <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
    <div className="mx-auto max-w-[1180px]">
      <section className="mb-5 flex items-end justify-between gap-4">
        <div><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400">ALPHAOS LIVE INTELLIGENCE</p></div><h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">See what we caught. <span className="text-zinc-400">Then see what&apos;s next.</span></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">AI-ranked crypto intelligence across Solana and Robinhood · PONS, backed by recorded alert outcomes.</p></div>
      </section>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#171b1f] p-1 shadow-sm">
        {windows.map((item) => <button key={item.key} type="button" onClick={() => setWindowKey(item.key)} className={`min-w-max flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${windowKey === item.key ? "bg-white/[0.09] text-white shadow-sm" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>)}
      </div>

      <section className="rounded-3xl border border-white/[0.09] bg-[#171b1f] p-5 shadow-[0_20px_70px_rgba(0,0,0,0.16)] sm:p-7">
        <div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-amber-300">✦ ALPHAOS SUPER HITS</p><h2 className="mt-1 text-xl font-semibold text-white">Proof before promises.</h2></div><p className="hidden text-xs text-zinc-500 sm:block">Peak return recorded after AlphaOS alert</p></div>
        {loading && !performance ? <p className="mt-6 text-sm text-zinc-500">Loading verified performance…</p> : leaders.length ? <div className="mt-5 grid gap-3 md:grid-cols-3">
          {leaders.map((hit, index) => <Link href={`/report/${encodeURIComponent(hit.token)}`} key={hit.id} className={`group rounded-2xl border p-4 transition hover:-translate-y-0.5 ${index === 0 ? "border-amber-300/20 bg-gradient-to-br from-amber-300/[0.08] to-white/[0.025]" : "border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.04]"}`}>
            <div className="flex items-center justify-between"><span className="text-[10px] font-semibold text-zinc-500">#{index + 1} SUPER HIT</span><ChainPill chain={hit.chain} /></div>
            <div className="mt-5 flex items-end justify-between gap-3"><div><p className="text-2xl font-semibold text-white">{hit.symbol}</p><p className="mt-1 text-[10px] text-zinc-500">Alpha score {hit.score ?? "—"}</p></div><div className="text-right"><p className="text-3xl font-semibold tracking-tight text-emerald-300">{pct(hit.roiHigh)}</p><p className="text-[8px] tracking-[0.14em] text-zinc-500">PEAK</p></div></div>
            <div className="mt-4 flex items-center justify-between border-t border-white/[0.07] pt-3 text-[10px] text-zinc-500"><span>Current {pct(hit.roiNow)}</span><span className="text-zinc-300 group-hover:text-white">View receipt →</span></div>
          </Link>)}
        </div> : <div className="mt-5 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">Performance receipts will appear here as tracked alert outcomes are recorded.</div>}
      </section>

      {performance ? <section className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">{[
        ["ALERTS TRACKED", performance.summary.tracked], ["WIN RATE", `${winRate}%`], ["100%+ RUNNERS", performance.summary.over100], ["MEDIAN PEAK", pct(performance.summary.medianPeak)],
      ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/[0.08] bg-[#171b1f] p-3 shadow-sm sm:p-4"><p className="text-[8px] tracking-[0.12em] text-zinc-500 sm:text-[9px]">{label}</p><p className="mt-1.5 text-xl font-semibold text-white">{value}</p></div>)}</section> : null}

      <section className="mt-9">
        <div className="flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400">LIVE RADAR</p></div><h2 className="mt-2 text-2xl font-semibold text-white">What AlphaOS sees now</h2><p className="mt-1 text-xs text-zinc-500">Fresh setups ranked by the intelligence engine.</p></div><Link href="/opportunities" className="text-xs font-semibold text-zinc-300">View all →</Link></div>
        <div className="mt-4 flex gap-1 rounded-xl border border-white/[0.08] bg-[#171b1f] p-1">{(["all", "solana", "robinhood"] as ChainFilter[]).map((item) => <button key={item} type="button" onClick={() => setChain(item)} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-semibold tracking-wide ${chain === item ? "bg-white/[0.09] text-white" : "text-zinc-500"}`}>{item === "all" ? "ALL" : item === "solana" ? "● SOLANA" : "● ROBINHOOD · PONS"}</button>)}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{visible.map((item) => <OpportunityCard key={String(item.id)} item={item} />)}{!loading && visible.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-white/10 bg-[#171b1f] p-8 text-center text-sm text-zinc-500">No live opportunities in this view right now.</div> : null}</div>
      </section>

      <section className="mt-9 pb-3">
        <div><p className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500">RECENT ALPHAOS ALERTS</p><h2 className="mt-2 text-xl font-semibold text-white">The tape</h2></div>
        <div className="mt-4 overflow-hidden rounded-2xl border border-white/[0.08] bg-[#171b1f] shadow-sm">
          {recent.length ? recent.map((alert, index) => <Link href={`/report/${encodeURIComponent(alert.token)}`} key={alert.id} className={`flex items-center gap-3 px-4 py-3.5 transition hover:bg-white/[0.03] ${index ? "border-t border-white/[0.06]" : ""}`}>
            <div className="w-9 text-[10px] text-zinc-600">{timeAgo(alert.alertedAt)}</div>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-sm font-semibold text-white">{alert.symbol}</p><span className={`h-1.5 w-1.5 rounded-full ${chainMeta(alert.chain).dot}`} /></div><p className="mt-0.5 text-[9px] uppercase tracking-wider text-zinc-600">{alert.chain === "robinhood" ? "Robinhood · PONS" : alert.chain}</p></div>
            <div className="text-right"><p className="text-xs font-semibold text-zinc-200">{alert.score ?? "—"} <span className="text-[8px] font-normal text-zinc-600">ALPHA</span></p><p className={`mt-0.5 text-[10px] ${(alert.roiHigh ?? 0) > 0 ? "text-emerald-300" : "text-zinc-500"}`}>{alert.roiHigh === null ? "Tracking" : `${pct(alert.roiHigh)} peak`}</p></div>
            <span className="text-zinc-600">›</span>
          </Link>) : <p className="p-6 text-sm text-zinc-500">No recent alerts in this time window.</p>}
        </div>
      </section>
    </div>
  </main>;
}
