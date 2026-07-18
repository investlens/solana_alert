'use client';

import { FormEvent, useState } from 'react';

type AnalysisResponse = {
  token?: string;
  answer?: string;
  error?: string;

  context?: {
    symbol?: string | null;
    score?: number | null;
    action?: string | null;
    learningAdjustment?: number | null;
    riskLevel?: string | null;
  };
};

const exampleQuestions = [
  'Should I enter now or wait?',
  'What would invalidate this trade?',
  'Why did AlphaOS score this token highly?',
  'Is the creator risky?',
  'Should I hold or take profit?',
];

export function AlphaTerminal() {
  const [token, setToken] = useState('');
  const [question, setQuestion] = useState(
    'Should I enter now or wait?'
  );

  const [analysis, setAnalysis] =
    useState<AnalysisResponse | null>(null);

  const [loading, setLoading] = useState(false);

  async function investigate(event: FormEvent) {
    event.preventDefault();

    setLoading(true);
    setAnalysis(null);

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json',
        },

        body: JSON.stringify({
          token,
          question,
        }),
      });

      const data =
        (await response.json()) as AnalysisResponse;

      setAnalysis(data);
    } catch {
      setAnalysis({
        error:
          'AlphaOS could not reach the investigation engine.',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_minmax(0,1fr)]">
      <aside className="rounded-[28px] border border-white/10 bg-white/[0.035] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.28em] text-emerald-400">
              Investigation
            </p>

            <h2 className="mt-2 text-xl font-semibold">
              Ask AlphaOS
            </h2>
          </div>

          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-[11px] font-medium text-emerald-300">
            LIVE
          </span>
        </div>

        <form
          onSubmit={investigate}
          className="mt-6 space-y-5"
        >
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Contract Address
            </label>

            <textarea
              value={token}
              onChange={(event) =>
                setToken(event.target.value)
              }
              placeholder="Paste Solana contract..."
              rows={3}
              className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-4 font-mono text-sm text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/40"
            />
          </div>

          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-zinc-500">
              Ask AlphaOS
            </label>

            <textarea
              value={question}
              onChange={(event) =>
                setQuestion(event.target.value)
              }
              placeholder="Should I enter now?"
              rows={5}
              className="mt-3 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-4 text-sm leading-6 text-white outline-none transition placeholder:text-zinc-700 focus:border-emerald-400/40"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-2xl bg-emerald-400 px-5 py-4 font-semibold text-black transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading
              ? 'Investigating Alpha Memory...'
              : 'Investigate →'}
          </button>
        </form>

        <div className="mt-6 border-t border-white/10 pt-5">
          <p className="text-xs uppercase tracking-[0.2em] text-zinc-600">
            Quick Questions
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {exampleQuestions.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setQuestion(example)}
                className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs text-zinc-400 transition hover:border-white/20 hover:text-white"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <section className="min-h-[650px] overflow-hidden rounded-[28px] border border-white/10 bg-[#080a0e] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-400 font-bold text-black">
              A
            </div>

            <div>
              <p className="text-sm font-semibold">
                AlphaOS
              </p>

              <p className="text-xs text-zinc-600">
                Evidence-based investigation engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Online
          </div>
        </div>

        <div className="p-6 md:p-8">
          {!analysis && !loading ? (
            <div className="flex min-h-[500px] items-center justify-center">
              <div className="max-w-xl text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/20 bg-emerald-400/10 text-2xl font-semibold text-emerald-300">
                  AI
                </div>

                <h3 className="mt-6 text-2xl font-semibold">
                  Investigate a token.
                </h3>

                <p className="mt-3 leading-7 text-zinc-500">
                  Paste a contract and ask a real trading
                  question. AlphaOS will investigate the token
                  against Alpha Memory, historical outcomes,
                  learning signals, creator evidence, and current
                  tracked performance.
                </p>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="flex min-h-[500px] items-center justify-center">
              <div className="text-center">
                <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400" />

                <p className="mt-5 text-sm text-zinc-400">
                  Investigating Alpha Memory...
                </p>

                <p className="mt-2 text-xs text-zinc-700">
                  Token evidence · Outcomes · Learning · Creator
                </p>
              </div>
            </div>
          ) : null}

          {analysis?.error ? (
            <div className="rounded-2xl border border-red-400/20 bg-red-400/10 p-5 text-sm text-red-200">
              {analysis.error}
            </div>
          ) : null}

          {analysis?.answer ? (
            <div>
              <div className="flex flex-wrap gap-2">
                {analysis.context?.symbol ? (
                  <Badge>
                    {analysis.context.symbol}
                  </Badge>
                ) : null}

                {analysis.context?.score != null ? (
                  <Badge>
                    AI {analysis.context.score}/100
                  </Badge>
                ) : null}

                {analysis.context?.action ? (
                  <Badge>
                    {analysis.context.action}
                  </Badge>
                ) : null}

                {analysis.context?.learningAdjustment != null ? (
                  <Badge>
                    AI Edge{' '}
                    {analysis.context.learningAdjustment >= 0
                      ? '+'
                      : ''}
                    {
                      analysis.context
                        .learningAdjustment
                    }
                  </Badge>
                ) : null}
              </div>

              <div className="mt-8 whitespace-pre-wrap text-[15px] leading-8 text-zinc-200">
                {analysis.answer}
              </div>

              {analysis.token ? (
                <div className="mt-8 flex flex-col gap-3 border-t border-white/10 pt-6 sm:flex-row">
                  <a
                    href={`/report/${analysis.token}`}
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-center text-sm font-medium transition hover:bg-white/10"
                  >
                    View Evidence
                  </a>

                  <a
                    href={`https://dexscreener.com/solana/${analysis.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl border border-white/10 bg-white/5 px-5 py-3 text-center text-sm font-medium transition hover:bg-white/10"
                  >
                    Open Chart
                  </a>

                  <a
                    href={`https://jup.ag/swap/SOL-${analysis.token}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-xl bg-emerald-400 px-5 py-3 text-center text-sm font-semibold text-black transition hover:bg-emerald-300"
                  >
                    Trade
                  </a>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Badge({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs text-zinc-300">
      {children}
    </span>
  );
}