"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ApiResponse, LiveOpportunity, OpportunitiesResponse } from "@/lib/dashboard/types";

function riskTone(risk: LiveOpportunity["riskLevel"]) {
  if (risk === "LOW") return "text-emerald-300";
  if (risk === "HIGH") return "text-rose-300";
  if (risk === "MEDIUM") return "text-amber-300";
  return "text-zinc-500";
}

function compactUsd(value: number | null) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export default function MissionBrief() {
  const [items, setItems] = useState<LiveOpportunity[]>([]);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/opportunities", { cache: "no-store" });
      const payload = (await response.json()) as ApiResponse<OpportunitiesResponse>;
      if (!response.ok || !payload.success) throw new Error("Unavailable");
      setItems(payload.data.items);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 45_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const brief = useMemo(() => {
    const active = items.filter((item) => !["REJECTED", "EXPIRED"].includes(item.status));
    const strongest = [...active].sort((a, b) => b.confidence - a.confidence)[0] ?? null;
    const lowRisk = active.filter((item) => item.riskLevel === "LOW").length;
    const highRisk = active.filter((item) => item.riskLevel === "HIGH").length;
    const averageConfidence = active.length
      ? Math.round(active.reduce((sum, item) => sum + item.confidence, 0) / active.length)
      : 0;

    return { active, strongest, lowRisk, highRisk, averageConfidence };
  }, [items]);

  return (
    <section className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,.65fr)]">
      <article className="alpha-panel relative overflow-hidden p-6 md:p-7">
        <div className="absolute -right-24 -top-24 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="relative">
          <p className="alpha-eyebrow">AI Mission Brief</p>
          <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight text-white md:text-3xl">
                {brief.strongest
                  ? `${brief.strongest.symbol} is the strongest live investigation`
                  : "AlphaOS is scanning for the next asymmetric setup"}
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
                {brief.strongest
                  ? `Current confidence is ${brief.strongest.confidence}/100 with ${brief.strongest.riskLevel.toLowerCase()} assessed risk. AlphaOS is monitoring liquidity, wallet flow, creator behaviour and post-alert performance before conviction changes.`
                  : "No active setup has cleared the current investigation threshold. Scanner, creator intelligence and Alpha Memory remain online."}
              </p>
            </div>

            {brief.strongest ? (
              <Link
                href={`${brief.strongest.reportUrl}?source=mission-control&engine=${encodeURIComponent(brief.strongest.sourceAgent)}`}
                className="alpha-button-primary shrink-0"
              >
                Open investigation
              </Link>
            ) : null}
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3 md:grid-cols-4">
            <BriefMetric label="Active cases" value={String(brief.active.length)} />
            <BriefMetric label="Avg confidence" value={`${brief.averageConfidence}/100`} />
            <BriefMetric label="Low risk" value={String(brief.lowRisk)} tone="text-emerald-300" />
            <BriefMetric label="High risk" value={String(brief.highRisk)} tone="text-rose-300" />
          </div>
        </div>
      </article>

      <article className="alpha-panel p-6 md:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="alpha-eyebrow">Decision Queue</p>
            <h2 className="mt-2 text-xl font-semibold text-white">Priority investigations</h2>
          </div>
          <span className="alpha-live-dot" aria-label="Live" />
        </div>

        <div className="mt-5 space-y-2">
          {brief.active.slice(0, 4).map((item, index) => (
            <Link
              key={String(item.id)}
              href={`${item.reportUrl}?source=mission-control&engine=${encodeURIComponent(item.sourceAgent)}`}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-black/15 px-4 py-3 transition hover:border-emerald-400/20 hover:bg-white/[0.035]"
            >
              <span className="text-xs font-semibold text-zinc-700">0{index + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{item.symbol}</p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-600">
                  {compactUsd(item.marketCap)} · {item.sourceAgent}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-emerald-300">{item.confidence}</p>
                <p className={`text-[10px] font-semibold ${riskTone(item.riskLevel)}`}>{item.riskLevel}</p>
              </div>
            </Link>
          ))}

          {!brief.active.length ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-zinc-600">
              {error ? "Decision queue temporarily unavailable." : "No investigations in queue."}
            </div>
          ) : null}
        </div>
      </article>
    </section>
  );
}

function BriefMetric({ label, value, tone = "text-white" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/20 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">{label}</p>
      <p className={`mt-2 text-xl font-semibold tracking-tight ${tone}`}>{value}</p>
    </div>
  );
}
