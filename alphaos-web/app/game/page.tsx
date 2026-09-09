import AppShell from "@/components/layout/AppShell";

export const dynamic = "force-dynamic";

export default function GamePage() {
  return (
    <AppShell>
      <main className="px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-8 lg:pt-8">
        <div className="mx-auto max-w-[1100px]">
          <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-br from-violet-400/[0.07] via-white/[0.02] to-transparent p-5 sm:p-7">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-400/[0.07] px-3 py-1.5 text-[10px] font-semibold tracking-[0.16em] text-violet-300">
                  ALPHAOS GAME · PRE-LAUNCH
                </div>
                <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-[-0.04em] text-white sm:text-5xl">
                  Play, build reputation, unlock the AlphaOS economy.
                </h1>
                <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-500">
                  This area is reserved for AlphaOS game mechanics and future token-launch utility. The experience will connect intelligence, participation, streaks and rewards without changing the core research product.
                </p>
              </div>
              <div className="rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-3 text-right">
                <p className="text-[9px] font-semibold tracking-[0.16em] text-zinc-600">STATUS</p>
                <p className="mt-1 text-sm font-semibold text-white">Foundation ready</p>
                <p className="mt-1 text-[11px] text-zinc-600">Token mechanics coming later</p>
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-emerald-300">01 · DAILY INTEL</p>
              <h2 className="mt-3 text-lg font-semibold text-white">Prediction challenges</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Future rounds can turn live market intelligence into short skill-based challenges.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-amber-300">02 · REPUTATION</p>
              <h2 className="mt-3 text-lg font-semibold text-white">Points & streaks</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Participation, consistency and research accuracy can later build a user reputation layer.</p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
              <p className="text-[10px] font-semibold tracking-[0.16em] text-violet-300">03 · TOKEN UTILITY</p>
              <h2 className="mt-3 text-lg font-semibold text-white">Launch-ready hooks</h2>
              <p className="mt-2 text-sm leading-6 text-zinc-500">Rewards, access and future token utility can plug in here when the launch design is finalized.</p>
            </div>
          </section>

          <section className="mt-5 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.015] p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold tracking-[0.16em] text-zinc-600">COMING NEXT</p>
                <h2 className="mt-2 text-lg font-semibold text-white">Game mechanics will be activated after the core AlphaOS polish.</h2>
                <p className="mt-1 text-sm text-zinc-500">No unfinished game actions are exposed yet, so the tab feels intentional rather than broken.</p>
              </div>
              <span className="inline-flex shrink-0 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs font-semibold text-zinc-400">Coming Soon</span>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
