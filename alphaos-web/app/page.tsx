import { AlphaTerminal } from '@/components/alpha-terminal';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#050609] text-white">
      <div className="mx-auto max-w-[1450px] px-4 py-5 md:px-7 md:py-7">
        <header className="flex items-center justify-between border-b border-white/10 pb-5">
          <div>
            <p className="text-xl font-semibold tracking-tight">
              AlphaOS{' '}
              <span className="text-emerald-400">
                AI
              </span>
            </p>

            <p className="mt-1 text-xs text-zinc-600">
              Crypto Intelligence Operating System
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Intelligence Online
          </div>
        </header>

        <section className="py-8 md:py-12">
          <div className="mb-8 max-w-4xl">
            <p className="text-xs font-medium uppercase tracking-[0.32em] text-emerald-400">
              AI Research Terminal
            </p>

            <h1 className="mt-4 text-4xl font-semibold tracking-tight md:text-6xl">
              Ask the market a better question.
            </h1>

            <p className="mt-5 max-w-3xl text-base leading-7 text-zinc-500 md:text-lg">
              Paste a contract. Ask AlphaOS whether to enter,
              wait, hold, exit, or investigate the creator.
              Every answer is grounded in Alpha Memory and
              tracked historical outcomes.
            </p>
          </div>

          <AlphaTerminal />
        </section>

        <footer className="border-t border-white/10 py-6 text-center text-xs text-zinc-700">
          AlphaOS provides research intelligence, not financial
          advice.
        </footer>
      </div>
    </main>
  );
}