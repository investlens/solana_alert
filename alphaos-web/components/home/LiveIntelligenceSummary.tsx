"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { LiveIntelligenceProof } from "@/lib/intelligence/types";

type ApiResponse = { success: boolean; data?: LiveIntelligenceProof; error?: string };

function money(value: number | null) {
  if (value == null) return "Verifying";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function chainLabel(chain: string) {
  return chain === "robinhood" ? "ROBINHOOD · PONS" : chain.toUpperCase();
}

export default function LiveIntelligenceSummary() {
  const [proof, setProof] = useState<LiveIntelligenceProof | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/proof", { cache: "no-store" });
        const payload = (await response.json()) as ApiResponse;
        if (!active) return;
        if (!response.ok || !payload.success || !payload.data) {
          setError(payload.error ?? "Live intelligence unavailable");
          return;
        }
        setProof(payload.data);
        setError(null);
      } catch {
        if (active) setError("Live intelligence unavailable");
      }
    };

    void load();
    const id = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  if (!proof) {
    return (
      <section className="px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8">
        <div className="mx-auto max-w-[1180px] rounded-3xl border border-white/[0.08] bg-[#171b1f] p-4 sm:p-5">
          <p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">● LIVE INTELLIGENCE</p>
          <p className="mt-2 text-sm text-zinc-500">{error ?? "Loading verified AlphaOS evidence…"}</p>
        </div>
      </section>
    );
  }

  const top = proof.topOpportunity;

  return (
    <section className="px-4 pt-5 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mx-auto max-w-[1180px]">
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["HIGH CONVICTION", proof.status.highConviction, "text-emerald-300"],
            ["WATCHING", proof.status.watching, "text-amber-200"],
            ["RISK BLOCKED", proof.status.riskBlocked, "text-red-300"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="rounded-2xl border border-white/[0.08] bg-[#171b1f] p-4">
              <p className="text-[9px] font-semibold tracking-[0.14em] text-zinc-500">{label}</p>
              <p className={`mt-1.5 text-2xl font-semibold ${tone}`}>{value}</p>
              <p className="mt-1 text-[9px] text-zinc-600">Last 24h · verified event store</p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-3xl border border-emerald-300/15 bg-[#171b1f] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.18em] text-emerald-300">● TOP OPPORTUNITY NOW</p>
              {top ? (
                <>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h2 className="text-2xl font-semibold">{top.symbol ?? "Unknown token"}</h2>
                    <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2.5 py-1 text-[9px] font-semibold text-zinc-400">
                      {chainLabel(top.chain)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-500">{top.type ?? top.state ?? "Observed opportunity"}</p>
                </>
              ) : (
                <p className="mt-2 text-sm text-zinc-500">No opportunity currently has sufficient market evidence to rank.</p>
              )}
            </div>
            {top?.confidence != null ? (
              <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2 text-right">
                <p className="text-2xl font-semibold text-emerald-300">{Math.round(top.confidence)}</p>
                <p className="text-[8px] tracking-[0.14em] text-zinc-500">CONFIDENCE</p>
              </div>
            ) : null}
          </div>

          {top ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">MARKET CAP</p><p className="mt-1 text-sm font-semibold">{money(top.marketCap)}</p></div>
                <div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">LIQUIDITY</p><p className="mt-1 text-sm font-semibold">{money(top.liquidity)}</p></div>
                <div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">5M VOLUME</p><p className="mt-1 text-sm font-semibold">{money(top.volume5m)}</p></div>
                <div className="rounded-xl bg-white/[0.025] p-3"><p className="text-[8px] text-zinc-500">RISK</p><p className="mt-1 text-sm font-semibold">{top.risk ?? "Verifying"}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-xs text-zinc-500">{top.reason ?? "AlphaOS is ranking this from verified market evidence; deeper evidence may still be verifying."}</p>
                <Link href={`/intelligence/${encodeURIComponent(top.token)}`} className="rounded-xl border border-emerald-300/25 bg-emerald-300/[0.08] px-4 py-2.5 text-xs font-semibold text-emerald-200">
                  Open Intelligence →
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
