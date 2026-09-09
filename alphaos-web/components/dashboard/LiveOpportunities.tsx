"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiResponse, Chain, LiveOpportunity, OpportunitiesResponse } from "@/lib/dashboard/types";

type ChainFilter = "all" | "solana" | "robinhood";

function money(value: number | null) {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function relative(value: string) {
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function chainMeta(chain: Chain) {
  if (chain === "robinhood") return { label: "ROBINHOOD · PONS", dot: "bg-emerald-400", pill: "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300" };
  if (chain === "solana") return { label: "SOLANA", dot: "bg-violet-400", pill: "border-violet-400/20 bg-violet-400/[0.08] text-violet-300" };
  return { label: chain.toUpperCase(), dot: "bg-zinc-500", pill: "border-white/10 bg-white/[0.04] text-zinc-400" };
}

function stage(opportunity: LiveOpportunity) {
  if (opportunity.status === "APPROVED" || opportunity.status === "EXECUTED") return "ENTRY READY";
  if (opportunity.status === "NEW") return "NEW SIGNAL";
  return "BUILDING";
}

function RadarCard({ opportunity }: { opportunity: LiveOpportunity }) {
  const meta = chainMeta(opportunity.chain);
  return (
    <article className="rounded-2xl border border-white/[0.08] bg-[#0a0c0f] p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[9px] font-semibold tracking-[0.13em] ${meta.pill}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}
          </span>
          <div className="mt-3 flex items-center gap-2">
            <h3 className="truncate text-2xl font-semibold tracking-tight text-white">{opportunity.symbol}</h3>
            <span className="rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[9px] font-semibold text-emerald-300">{stage(opportunity)}</span>
          </div>
          <p className="mt-1 truncate text-xs text-zinc-600">{opportunity.title}</p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tracking-[-0.05em] text-white">{opportunity.confidence}</p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-zinc-700">Alpha score</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2 border-y border-white/[0.06] py-4">
        <div><p className="text-[9px] uppercase tracking-wider text-zinc-700">MC</p><p className="mt-1 text-sm font-medium text-zinc-200">{money(opportunity.marketCap)}</p></div>
        <div><p className="text-[9px] uppercase tracking-wider text-zinc-700">Liquidity</p><p className="mt-1 text-sm font-medium text-zinc-200">{money(opportunity.liquidity)}</p></div>
        <div><p className="text-[9px] uppercase tracking-wider text-zinc-700">Risk</p><p className={`mt-1 text-sm font-medium ${opportunity.riskLevel === "LOW" ? "text-emerald-300" : opportunity.riskLevel === "HIGH" ? "text-rose-300" : "text-amber-300"}`}>{opportunity.riskLevel}</p></div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] text-zinc-600">{opportunity.sourceAgent}</p>
          <p className="mt-0.5 text-[9px] text-zinc-800">updated {relative(opportunity.createdAt)} ago</p>
        </div>
        <Link href={opportunity.reportUrl} className="inline-flex min-h-10 items-center justify-center rounded-xl bg-emerald-400 px-4 text-xs font-semibold text-black transition hover:bg-emerald-300">Open Analysis →</Link>
      </div>
    </article>
  );
}

export default function LiveOpportunities() {
  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChainFilter>("all");

  const load = useCallback(async (background = false) => {
    try {
      background ? setRefreshing(true) : setLoading(true);
      setError(null);
      const response = await fetch("/api/opportunities", { cache: "no-store" });
      const payload = (await response.json()) as ApiResponse<OpportunitiesResponse>;
      if (!response.ok || !payload.success) throw new Error(payload.success ? "Unable to load Radar" : payload.error);
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Radar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const items = useMemo(() => data?.items.filter((item) => filter === "all" || item.chain === filter) ?? [], [data, filter]);
  const entryReady = data?.items.filter((item) => stage(item) === "ENTRY READY").length ?? 0;
  const building = data?.items.filter((item) => stage(item) === "BUILDING").length ?? 0;

  return (
    <section className="mt-5">
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.05] p-4"><p className="text-2xl font-semibold text-white">{entryReady}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-emerald-300">Entry Ready</p></div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-4"><p className="text-2xl font-semibold text-white">{building}</p><p className="mt-1 text-[9px] uppercase tracking-[0.14em] text-zinc-600">Building</p></div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {(["all", "solana", "robinhood"] as ChainFilter[]).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${filter === value ? "bg-white/[0.08] text-white" : "text-zinc-600"}`}>{value === "all" ? "All" : value === "robinhood" ? "Robinhood" : "Solana"}</button>)}
        </div>
        <button type="button" onClick={() => void load(true)} disabled={refreshing} className="text-xs text-zinc-600 hover:text-zinc-300">{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>

      {loading && !data ? <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-64 animate-pulse rounded-2xl border border-white/[0.08] bg-white/[0.02]" />)}</div> : null}
      {error && !data ? <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/[0.04] p-5 text-sm text-rose-300">{error}</div> : null}
      {data && items.length === 0 ? <div className="mt-5 rounded-2xl border border-dashed border-white/[0.08] p-10 text-center text-sm text-zinc-600">No active opportunities in this chain right now. AlphaOS is still scanning.</div> : null}
      {items.length > 0 ? <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <RadarCard key={String(item.id)} opportunity={item} />)}</div> : null}
      {error && data ? <p className="mt-3 text-xs text-amber-300">Refresh failed; showing the last successful Radar snapshot.</p> : null}
    </section>
  );
}
