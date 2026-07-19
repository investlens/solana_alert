"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import type {
  ApiResponse,
  LiveOpportunity,
  OpportunitiesResponse,
  OpportunityStatus,
  RiskLevel,
} from "@/lib/dashboard/types";

function formatCompactCurrency(
  value: number | null
): string {
  if (value === null) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatPercent(
  value: number | null
): string {
  if (value === null) {
    return "Not estimated";
  }

  const prefix = value > 0 ? "+" : "";

  return `${prefix}${value.toFixed(1)}%`;
}

function formatRelativeTime(value: string): string {
  const timestamp = new Date(value).getTime();

  if (!Number.isFinite(timestamp)) {
    return "Recently";
  }

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / 1000)
  );

  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);

  return `${days}d ago`;
}

function getRiskClasses(
  riskLevel: RiskLevel
): string {
  switch (riskLevel) {
    case "LOW":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";

    case "MEDIUM":
      return "border-amber-400/20 bg-amber-400/10 text-amber-300";

    case "HIGH":
      return "border-red-400/20 bg-red-400/10 text-red-300";

    default:
      return "border-white/10 bg-white/[0.04] text-zinc-400";
  }
}

function getStatusClasses(
  status: OpportunityStatus
): string {
  switch (status) {
    case "NEW":
      return "border-cyan-400/20 bg-cyan-400/10 text-cyan-300";

    case "WATCHING":
      return "border-violet-400/20 bg-violet-400/10 text-violet-300";

    case "APPROVED":
      return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300";

    case "EXECUTED":
      return "border-blue-400/20 bg-blue-400/10 text-blue-300";

    case "REJECTED":
      return "border-red-400/20 bg-red-400/10 text-red-300";

    case "EXPIRED":
      return "border-white/10 bg-white/[0.04] text-zinc-500";

    default:
      return "border-white/10 bg-white/[0.04] text-zinc-400";
  }
}

function OpportunitySkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map(
        (_, index) => (
          <div
            key={index}
            className="h-72 animate-pulse rounded-2xl border border-white/10 bg-white/[0.025]"
          />
        )
      )}
    </div>
  );
}

function EmptyOpportunities() {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.015] px-6 py-14 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-xl">
        ◎
      </div>

      <h3 className="mt-5 text-base font-semibold text-white">
        No active opportunities
      </h3>

      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
        AlphaOS is scanning continuously. New
        investigations will appear here as soon as
        they are registered.
      </p>
    </div>
  );
}

function OpportunityCard({
  opportunity,
}: {
  opportunity: LiveOpportunity;
}) {
  return (
    <article className="group relative overflow-hidden rounded-2xl border border-white/10 bg-[#0b0d10] p-5 transition duration-300 hover:-translate-y-0.5 hover:border-emerald-400/25 hover:shadow-[0_20px_70px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-400/40 to-transparent opacity-0 transition group-hover:opacity-100" />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-xl font-semibold tracking-tight text-white">
              {opportunity.symbol}
            </h3>

            <span
              className={[
                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.13em]",
                getStatusClasses(
                  opportunity.status
                ),
              ].join(" ")}
            >
              {opportunity.status}
            </span>
          </div>

          <p className="mt-1 truncate text-sm text-zinc-500">
            {opportunity.title}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold tracking-tight text-emerald-300">
            {opportunity.confidence}
          </p>

          <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600">
            Confidence
          </p>
        </div>
      </div>

      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-700"
          style={{
            width: `${Math.max(
              3,
              opportunity.confidence
            )}%`,
          }}
        />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            Market Cap
          </p>

          <p className="mt-1 text-sm font-medium text-zinc-200">
            {formatCompactCurrency(
              opportunity.marketCap
            )}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            Liquidity
          </p>

          <p className="mt-1 text-sm font-medium text-zinc-200">
            {formatCompactCurrency(
              opportunity.liquidity
            )}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            Expected Move
          </p>

          <p className="mt-1 text-sm font-medium text-zinc-200">
            {formatPercent(
              opportunity.expectedProfitPercent
            )}
          </p>
        </div>

        <div className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
          <p className="text-[10px] uppercase tracking-[0.14em] text-zinc-600">
            Risk
          </p>

          <span
            className={[
              "mt-1 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              getRiskClasses(
                opportunity.riskLevel
              ),
            ].join(" ")}
          >
            {opportunity.riskLevel}
          </span>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-white/[0.07] pt-4">
        <div>
          <p className="text-xs text-zinc-500">
            {opportunity.sourceAgent}
          </p>

          <p className="mt-0.5 text-[11px] text-zinc-700">
            {formatRelativeTime(
              opportunity.createdAt
            )}
          </p>
        </div>

        <Link
          href={opportunity.reportUrl}
          className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-xs font-semibold text-emerald-300 transition hover:border-emerald-400/40 hover:bg-emerald-400/15"
        >
          Investigate →
        </Link>
      </div>
    </article>
  );
}

export default function LiveOpportunities() {
  const [data, setData] =
    useState<OpportunitiesResponse | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [refreshing, setRefreshing] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const loadOpportunities = useCallback(
    async (background = false) => {
      try {
        if (background) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        setError(null);

        const response = await fetch(
          "/api/opportunities",
          {
            cache: "no-store",
          }
        );

        const payload =
          (await response.json()) as ApiResponse<OpportunitiesResponse>;

        if (!response.ok || !payload.success) {
          throw new Error(
            payload.success
              ? "Unable to load opportunities"
              : payload.error
          );
        }

        setData(payload.data);
      } catch (error) {
        setError(
          error instanceof Error
            ? error.message
            : "Unable to load opportunities"
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadOpportunities();

    const interval = window.setInterval(() => {
      void loadOpportunities(true);
    }, 30_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [loadOpportunities]);

  return (
    <section className="mt-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>

            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Live Intelligence
            </p>
          </div>

          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">
            Live Opportunities
          </h2>

          <p className="mt-1 text-sm text-zinc-500">
            Independent opportunities currently being
            tracked by AlphaOS agents.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {refreshing ? (
            <span className="text-xs text-zinc-600">
              Refreshing…
            </span>
          ) : null}

          <button
            type="button"
            onClick={() =>
              void loadOpportunities(true)
            }
            disabled={refreshing}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && !data ? (
        <OpportunitySkeleton />
      ) : null}

      {error && !data ? (
        <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.04] p-6">
          <p className="text-sm font-medium text-red-300">
            Live Opportunities unavailable
          </p>

          <p className="mt-2 text-sm text-zinc-500">
            Hero Stats and all other AlphaOS modules
            remain operational.
          </p>

          <button
            type="button"
            onClick={() =>
              void loadOpportunities()
            }
            className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.08]"
          >
            Retry module
          </button>
        </div>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyOpportunities />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          {error ? (
            <div className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.04] px-4 py-3 text-xs text-amber-300">
              Refresh failed. Showing the last
              successful opportunity data.
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.items.map((opportunity) => (
              <OpportunityCard
                key={String(opportunity.id)}
                opportunity={opportunity}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}