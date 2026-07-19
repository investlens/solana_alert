import AppShell from "@/components/layout/AppShell";
import LiveOpportunities from "@/components/dashboard/LiveOpportunities";

export const dynamic = "force-dynamic";

export default function OpportunitiesPage() {
  return (
    <AppShell>
      <main className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-[1500px]">
          <section className="mb-8 rounded-3xl border border-white/[0.08] bg-white/[0.02] p-6 md:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              AlphaOS Intelligence
            </p>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white md:text-5xl">
              Opportunities
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-7 text-zinc-500 md:text-base">
              Review the market setups currently being
              tracked by AlphaOS and open a complete AI
              investigation for deeper evidence.
            </p>
          </section>

          <LiveOpportunities />
        </div>
      </main>
    </AppShell>
  );
}