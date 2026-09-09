import AppShell from "@/components/layout/AppShell";
import LiveOpportunities from "@/components/dashboard/LiveOpportunities";

export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  return (
    <AppShell>
      <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-8 lg:pt-8">
        <div className="mx-auto max-w-[1500px]">
          <section className="mb-6">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-300">Live AlphaOS</p>
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-[-0.035em] text-white md:text-5xl">Radar</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">Live opportunities across Solana and Robinhood, ranked by AlphaOS intelligence.</p>
          </section>
          <LiveOpportunities />
        </div>
      </main>
    </AppShell>
  );
}
