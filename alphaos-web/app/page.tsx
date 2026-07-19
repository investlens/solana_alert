import Link from "next/link";
import { AlphaTerminal } from "@/components/alpha-terminal";
import AppShell from "@/components/layout/AppShell";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <AppShell>
      <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1500px]">
          <section className="mb-7 overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-emerald-400/[0.07] via-white/[0.02] to-transparent p-6 md:p-8">
            <div className="flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
                  AI Research Terminal
                </p>

                <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl">
                  Ask the market a better question.
                </h1>

                <p className="mt-4 max-w-3xl text-sm leading-7 text-zinc-400 md:text-base">
                  Investigate a token using Alpha
                  Memory, creator intelligence,
                  historical outcomes and live market
                  evidence.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  href="/dashboard"
                  className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-semibold text-black transition hover:bg-emerald-300"
                >
                  Open Mission Control
                </Link>

                <Link
                  href="/opportunities"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
                >
                  View Opportunities
                </Link>
              </div>
            </div>
          </section>

          <section className="mb-7 grid gap-4 md:grid-cols-3">
            <Link
              href="/dashboard"
              className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-emerald-400/[0.04]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-emerald-300">
                Mission Control
              </p>

              <h2 className="mt-3 text-lg font-semibold text-white">
                See what AlphaOS is tracking
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Live scanner metrics, alerts, AI events
                and historical intelligence.
              </p>

              <p className="mt-5 text-sm font-medium text-zinc-300 transition group-hover:text-emerald-300">
                Open dashboard →
              </p>
            </Link>

            <Link
              href="/opportunities"
              className="group rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5 transition hover:-translate-y-0.5 hover:border-emerald-400/20 hover:bg-emerald-400/[0.04]"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-emerald-300">
                Opportunities
              </p>

              <h2 className="mt-3 text-lg font-semibold text-white">
                Review active intelligence
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Browse current signals and open a full
                AI investigation for each token.
              </p>

              <p className="mt-5 text-sm font-medium text-zinc-300 transition group-hover:text-emerald-300">
                View opportunities →
              </p>
            </Link>

            <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.17em] text-emerald-300">
                Alpha Memory
              </p>

              <h2 className="mt-3 text-lg font-semibold text-white">
                Intelligence that improves
              </h2>

              <p className="mt-2 text-sm leading-6 text-zinc-500">
                Every alert and tracked outcome becomes
                evidence for future investigations.
              </p>

              <p className="mt-5 text-sm font-medium text-zinc-600">
                Continuously learning
              </p>
            </div>
          </section>

          <AlphaTerminal />
        </div>
      </main>
    </AppShell>
  );
}