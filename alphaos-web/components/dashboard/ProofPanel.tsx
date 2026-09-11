"use client";

import { useEffect, useMemo, useState } from "react";

type Health = { service: string; status: string; message: string | null; last_seen_at: string | null };
type Outcome = { checkpoint_seconds: number; roi: number | null; peak_roi: number | null; max_drawdown: number | null; outcome_status: string };
type Decision = {
  id: number; createdAt: string; chain: string; symbol: string | null; currentAction: string; shadowAction: string;
  currentScore: number | null; shadowScore: number | null; confidence: number | null; scoreDelta: number | null;
  promotionEligible: boolean; topPositiveReasons: string[]; topNegativeReasons: string[]; outcomes: Outcome[];
};
type ProofData = {
  health: Health[];
  latestRobinhood: null | { symbol: string | null; type: string; marketCap: number | null; liquidity: number | null; createdAt: string; deliveryCount: number };
  decisions: Decision[];
};

function age(value: string | null) {
  if (!value) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

function money(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function pct(value: number | null) {
  if (value == null) return "pending";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function statusClasses(status: string) {
  if (status === "healthy") return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";
  if (status === "critical") return "border-red-400/20 bg-red-400/10 text-red-300";
  return "border-amber-400/20 bg-amber-400/10 text-amber-300";
}

export default function ProofPanel() {
  const [data, setData] = useState<ProofData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const response = await fetch("/api/proof", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Proof data unavailable");
      setData(payload.data); setError(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Proof data unavailable"); }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const disagreements = useMemo(() => data?.decisions.filter(d => d.currentAction !== d.shadowAction.replace("SHADOW_", "")) ?? [], [data]);

  if (!data && !error) return <section className="mt-6 h-64 animate-pulse rounded-3xl border border-white/10 bg-white/[0.025]" />;
  if (error && !data) return <section className="mt-6 rounded-3xl border border-red-400/20 bg-red-400/[0.04] p-6 text-sm text-red-300">AI proof module unavailable: {error}</section>;
  if (!data) return null;

  return (
    <section className="mt-6 space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Proof Layer</p>
          <h2 className="mt-2 text-2xl font-semibold text-white">System health + AI V2 evidence</h2>
          <p className="mt-1 text-sm text-zinc-500">Live operational proof. V2 remains shadow-only.</p>
        </div>
        <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-300">30s refresh</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.health.map(item => (
          <div key={item.service} className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-sm font-semibold text-white">{item.service.replaceAll("_", " ")}</p>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${statusClasses(item.status)}`}>{item.status}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-zinc-500">{item.message || "No detail"}</p>
            <p className="mt-2 text-[11px] text-zinc-600">{age(item.last_seen_at)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Latest Robinhood event</p>
          {data.latestRobinhood ? (
            <>
              <div className="mt-3 flex items-center justify-between gap-3">
                <div><p className="text-xl font-semibold text-white">{data.latestRobinhood.symbol || "Unknown"}</p><p className="mt-1 text-xs text-zinc-500">{data.latestRobinhood.type} · {age(data.latestRobinhood.createdAt)}</p></div>
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${data.latestRobinhood.deliveryCount > 0 ? statusClasses("healthy") : statusClasses("warning")}`}>{data.latestRobinhood.deliveryCount} delivered</span>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-black/20 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Market cap</p><p className="mt-1 font-semibold text-white">{money(data.latestRobinhood.marketCap)}</p></div>
                <div className="rounded-xl bg-black/20 p-3"><p className="text-[10px] uppercase tracking-wider text-zinc-600">Liquidity</p><p className="mt-1 font-semibold text-white">{money(data.latestRobinhood.liquidity)}</p></div>
              </div>
            </>
          ) : <p className="mt-4 text-sm text-zinc-500">No Robinhood event available.</p>}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.025] p-5">
          <div className="flex items-center justify-between"><div><p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Current engine vs V2</p><p className="mt-1 text-sm text-zinc-400">{disagreements.length} disagreements in latest sample</p></div><span className="text-xs text-zinc-600">Evidence only</span></div>
          <div className="mt-4 space-y-3">
            {data.decisions.slice(0, 5).map(decision => {
              const latest = [...decision.outcomes].sort((a,b) => b.checkpoint_seconds - a.checkpoint_seconds)[0];
              const differs = decision.currentAction !== decision.shadowAction.replace("SHADOW_", "");
              return (
                <div key={decision.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><span className="font-semibold text-white">{decision.symbol || "Unknown"}</span><span className="ml-2 text-xs text-zinc-600">{decision.chain}</span></div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${differs ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-300" : "border-white/10 text-zinc-500"}`}>{differs ? "AI DISAGREES" : "AGREES"}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
                    <div><p className="text-zinc-600">Current</p><p className="mt-1 font-semibold text-zinc-300">{decision.currentAction}</p></div>
                    <div><p className="text-zinc-600">V2</p><p className="mt-1 font-semibold text-cyan-300">{decision.shadowAction.replace("SHADOW_", "")}</p></div>
                    <div><p className="text-zinc-600">Confidence</p><p className="mt-1 font-semibold text-white">{decision.confidence?.toFixed(0) ?? "—"}%</p></div>
                    <div><p className="text-zinc-600">Outcome</p><p className={`mt-1 font-semibold ${latest?.roi != null && Number(latest.roi) >= 0 ? "text-emerald-300" : latest?.roi != null ? "text-red-300" : "text-zinc-500"}`}>{latest ? `${Math.round(latest.checkpoint_seconds / 60)}m ${pct(latest.roi != null ? Number(latest.roi) : null)}` : "waiting"}</p></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
