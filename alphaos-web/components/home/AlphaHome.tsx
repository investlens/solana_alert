"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiResponse, LiveOpportunity, OpportunitiesResponse } from "@/lib/dashboard/types";

type WindowKey = "today" | "7d" | "30d" | "all";
type ChainFilter = "all" | "solana" | "robinhood";
type TopAlert = {
  id: string; token: string; symbol: string; name: string | null;
  chain: "solana" | "robinhood" | "unknown"; score: number | null;
  roiHigh: number | null; roiNow: number | null; alertedAt: string | null;
};
type TopAlertResponse = {
  window: WindowKey; top: TopAlert | null; leaders: TopAlert[];
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
  return `${value >= 0 ? "+" : ""}${value.toFixed(value >= 100 ? 0 : 1)}%`;
}

function compact(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function ChainPill({ chain }: { chain: string }) {
  const meta = chainMeta(chain);
  return <span className={`inline-flex items-center gap-2 rounded-full border ${meta.border} bg-white/[0.025] px-2.5 py-1 text-[10px] font-semibold tracking-[0.13em] ${meta.text}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
  </span>;
}

function OpportunityCard({ item }: { item: LiveOpportunity }) {
  const meta = chainMeta(item.chain);
  const robinhood = item.chain === "robinhood";
  return <article className="rounded-2xl border border-white/[0.08] bg-[#0a0c0f] p-4 sm:p-5">
    <div className="flex items-start justify-between gap-3">
      <div><ChainPill chain={item.chain} /><h3 className="mt-3 text-xl font-semibold text-white">{item.symbol}</h3><p className="mt-0.5 line-clamp-1 text-xs text-zinc-600">{item.title}</p></div>
      <div className="text-right"><p className={`text-2xl font-semibold ${meta.text}`}>{item.confidence}</p><p className="text-[9px] tracking-[0.14em] text-zinc-600">ALPHA</p></div>
    </div>
    <div className="mt-4 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-3">
      <div><p className="text-[9px] tracking-wider text-zinc-600">MC</p><p className="mt-1 text-xs font-medium text-zinc-200">{compact(item.marketCap)}</p></div>
      <div><p className="text-[9px] tracking-wider text-zinc-600">LIQ</p><p className="mt-1 text-xs font-medium text-zinc-200">{compact(item.liquidity)}</p></div>
      <div><p className="text-[9px] tracking-wider text-zinc-600">RISK</p><p className="mt-1 text-xs font-medium text-zinc-200">{item.riskLevel}</p></div>
    </div>
    <div className="mt-3 space-y-1.5 text-xs text-zinc-400">
      <p><span className="text-emerald-300">✓</span> {robinhood ? "Robinhood opportunity" : "Solana market evidence"}</p>
      <p><span className="text-emerald-300">✓</span> {item.sourceAgent || "AlphaOS intelligence"}</p>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button type="button" className="rounded-xl border border-white/[0.08] bg-white/[0.025] px-3 py-2.5 text-xs font-medium text-zinc-300">Track</button>
      <Link href={item.reportUrl} className="rounded-xl bg-emerald-400 px-3 py-2.5 text-center text-xs font-semibold text-black transition hover:bg-emerald-300">Open Analysis</Link>
    </div>
  </article>;
}

export default function AlphaHome() {
  const [windowKey, setWindowKey] = useState<WindowKey>("today");
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
  const top = performance?.top ?? null;

  return <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-8">
    <div className="mx-auto max-w-[1180px]">
      <section className="mb-6 flex items-end justify-between gap-4">
        <div><p className="text-[11px] font-semibold tracking-[0.18em] text-emerald-300">ALPHAOS LIVE</p><h1 className="mt-2 text-3xl font-semibold tracking-[-0.035em] text-white sm:text-4xl">Market intelligence, ranked.</h1><p className="mt-2 max-w-xl text-sm leading-6 text-zinc-500">See what AlphaOS caught, then move straight into what it is watching now.</p></div>
        <Link href="/opportunities" className="hidden rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-white sm:block">Open Radar →</Link>
      </section>

      <div className="mb-4 flex gap-1 overflow-x-auto rounded-xl border border-white/[0.07] bg-white/[0.02] p-1">
        {windows.map((item) => <button key={item.key} type="button" onClick={() => setWindowKey(item.key)} className={`min-w-max flex-1 rounded-lg px-3 py-2 text-xs font-medium transition ${windowKey === item.key ? "bg-white/[0.09] text-white" : "text-zinc-500 hover:text-zinc-300"}`}>{item.label}</button>)}
      </div>

      <section className="overflow-hidden rounded-3xl border border-emerald-400/15 bg-gradient-to-br from-emerald-400/[0.09] via-[#0a0c0f] to-[#08090c] p-5 sm:p-7">
        {loading && !performance ? <p className="text-sm text-zinc-500">Loading AlphaOS performance…</p> : top ? <>
          <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-semibold tracking-[0.18em] text-amber-300">🏆 TOP ALERT · {windows.find((item) => item.key === windowKey)?.label.toUpperCase()}</p><div className="mt-3"><ChainPill chain={top.chain} /></div><h2 className="mt-4 text-3xl font-semibold tracking-tight text-white">{top.symbol}</h2></div><div className="text-right"><p className="text-4xl font-semibold tracking-tight text-emerald-300">{pct(top.roiHigh)}</p><p className="mt-1 text-[9px] tracking-[0.16em] text-zinc-600">PEAK SINCE ALERT</p></div></div>
          <div className="mt-6 grid grid-cols-3 gap-3 border-y border-white/[0.07] py-4"><div><p className="text-[9px] tracking-wider text-zinc-600">ALPHA SCORE</p><p className="mt-1 text-sm font-semibold text-white">{top.score ?? "—"}</p></div><div><p className="text-[9px] tracking-wider text-zinc-600">CURRENT</p><p className="mt-1 text-sm font-semibold text-white">{pct(top.roiNow)}</p></div><div><p className="text-[9px] tracking-wider text-zinc-600">CHAIN</p><p className="mt-1 text-sm font-semibold text-white">{top.chain === "robinhood" ? "Robinhood" : top.chain === "solana" ? "Solana" : "—"}</p></div></div>
          <div className="mt-5 flex items-center justify-between gap-3"><p className="text-xs text-zinc-500">Peak performance is shown separately from current return.</p><Link href={`/report/${top.token}`} className="shrink-0 rounded-xl bg-emerald-400 px-4 py-2.5 text-xs font-semibold text-black">View Analysis</Link></div>
        </> : <div className="py-5"><p className="text-xs font-semibold tracking-[0.16em] text-zinc-500">TOP ALERT</p><h2 className="mt-3 text-xl font-semibold text-white">No completed performance yet</h2><p className="mt-2 text-sm text-zinc-500">AlphaOS will rank verified alert outcomes here as they are recorded.</p></div>}
      </section>

      {performance ? <section className="mt-4 grid grid-cols-4 gap-2 sm:gap-3">{[
        ["TRACKED", performance.summary.tracked], ["WINNERS", performance.summary.winners], [">100%", performance.summary.over100], ["MEDIAN PEAK", pct(performance.summary.medianPeak)],
      ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-3 sm:p-4"><p className="text-[8px] tracking-[0.12em] text-zinc-600 sm:text-[9px]">{label}</p><p className="mt-1.5 text-base font-semibold text-white sm:text-xl">{value}</p></div>)}</section> : null}

      <section className="mt-8">
        <div className="flex items-end justify-between gap-3"><div><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400" /><p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">LIVE RADAR</p></div><h2 className="mt-2 text-2xl font-semibold text-white">What AlphaOS sees now</h2></div><Link href="/opportunities" className="text-xs font-semibold text-zinc-400">View all →</Link></div>
        <div className="mt-4 flex gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1">{(["all", "solana", "robinhood"] as ChainFilter[]).map((item) => <button key={item} type="button" onClick={() => setChain(item)} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-semibold tracking-wide ${chain === item ? "bg-white/[0.09] text-white" : "text-zinc-600"}`}>{item === "all" ? "ALL" : item === "solana" ? "● SOLANA" : "● ROBINHOOD"}</button>)}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{visible.map((item) => <OpportunityCard key={String(item.id)} item={item} />)}{!loading && visible.length === 0 ? <div className="col-span-full rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-zinc-500">No live opportunities in this view right now.</div> : null}</div>
      </section>
    </div>
  </main>;
}
