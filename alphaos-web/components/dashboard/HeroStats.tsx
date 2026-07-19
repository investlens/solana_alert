"use client";

import { useEffect, useState } from "react";
import type {
  ApiResponse,
  DashboardStatsResponse,
} from "@/lib/dashboard/types";

type StatCardProps = {
  label: string;
  value: string;
  helper?: string;
  accent?: boolean;
};

function StatCard({
  label,
  value,
  helper,
  accent = false,
}: StatCardProps) {
  return (
    <div
      className={[
        "relative overflow-hidden rounded-2xl border p-5",
        "bg-white/[0.025] backdrop-blur-xl",
        accent
          ? "border-emerald-400/30 shadow-[0_0_40px_rgba(52,211,153,0.08)]"
          : "border-white/10",
      ].join(" ")}
    >
      <div
        className={[
          "absolute inset-x-0 top-0 h-px",
          accent
            ? "bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent"
            : "bg-gradient-to-r from-transparent via-white/20 to-transparent",
        ].join(" ")}
      />

      <p className="text-xs font-medium uppercase tracking-[0.18em] text-zinc-500">
        {label}
      </p>

      <p
        className={[
          "mt-3 text-3xl font-semibold tracking-tight",
          accent ? "text-emerald-300" : "text-white",
        ].join(" ")}
      >
        {value}
      </p>

      {helper ? (
        <p className="mt-2 text-sm text-zinc-500">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function HeroStatsSkeleton() {
  return (
    <section className="space-y-5">
      <div className="h-24 animate-pulse rounded-3xl border border-white/10 bg-white/[0.025]" />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-36 animate-pulse rounded-2xl border border-white/10 bg-white/[0.025]"
          />
        ))}
      </div>
    </section>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCurrency(value: number | null) {
  if (value == null) return "Unavailable";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatTime(value: string | null) {
  if (!value) return "No recent alert";

  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

export default function HeroStats() {
  const [data, setData] =
    useState<DashboardStatsResponse | null>(null);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  async function loadStats() {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/stats", {
        cache: "no-store",
      });

      const payload =
        (await response.json()) as ApiResponse<DashboardStatsResponse>;

      if (!response.ok || !payload.success) {
        throw new Error(
          payload.success
            ? "Unable to load statistics"
            : payload.error
        );
      }

      setData(payload.data);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load statistics"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStats();

    const interval = window.setInterval(() => {
      void loadStats();
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  if (loading && !data) {
    return <HeroStatsSkeleton />;
  }

  if (error && !data) {
    return (
      <section className="rounded-3xl border border-red-400/20 bg-red-400/[0.04] p-6">
        <p className="text-sm font-medium text-red-300">
          Mission Control statistics unavailable
        </p>

        <p className="mt-2 text-sm text-zinc-500">
          The remaining dashboard modules can continue operating.
        </p>

        <button
          type="button"
          onClick={() => void loadStats()}
          className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-white transition hover:bg-white/[0.08]"
        >
          Retry module
        </button>
      </section>
    );
  }

  if (!data) {
    return null;
  }

  const latestSymbol =
    data.latestBuy?.symbol || "No alert yet";

  return (
    <section className="space-y-5">
      <div className="relative overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-400/[0.08] via-white/[0.025] to-transparent p-6 md:p-8">
        <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-400/10 blur-3xl" />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </span>

              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
                AlphaOS Online
              </span>
            </div>

            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white md:text-5xl">
              Mission Control
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400 md:text-base">
              AlphaOS is actively scanning, investigating, and learning from live
              Solana opportunities.
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 px-5 py-4 backdrop-blur-xl">
            <p className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              Latest high-conviction alert
            </p>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="text-lg font-semibold text-white">
                {latestSymbol}
              </span>

              {data.latestBuy?.score != null ? (
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                  Score {data.latestBuy.score}
                </span>
              ) : null}
            </div>

            <p className="mt-2 text-sm text-zinc-500">
              {formatCurrency(
                data.latestBuy?.marketCap ?? null
              )}
              {" · "}
              {formatTime(
                data.latestBuy?.createdAt ?? null
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Tokens Tracked"
          value={formatNumber(data.tokensTracked)}
          helper="Historical intelligence records"
        />

        <StatCard
          label="AI Events"
          value={formatNumber(data.timelineEvents)}
          helper="Signals, checkpoints and updates"
        />

        <StatCard
          label="Alerts Today"
          value={formatNumber(data.alertsToday)}
          helper={`${formatNumber(data.buysToday)} high-conviction alerts`}
          accent
        />

        <StatCard
          label="Million-Dollar Calls"
          value={formatNumber(data.moonshots)}
          helper="Tracked tokens that reached $1M"
        />
      </div>
    </section>
  );
}