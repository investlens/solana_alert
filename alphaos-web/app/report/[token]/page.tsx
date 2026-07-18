import Link from 'next/link';
import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type LearningReason = {
  metric?: string;
  bucket?: string;
  adjustment?: number;
  sampleSize?: number;
  winnerRate?: number;
  overallWinnerRate?: number;
};

type AlertSnapshot = {
  source?: string;
  baseScore?: number;
  adjustedScore?: number;
  learningAdjustment?: number;
  learningReasons?: LearningReason[];
  actionBucket?: string;
  creatorWallet?: string | null;
};

type TokenMemory = {
  token: string;
  symbol: string | null;
  name: string | null;
  chain: string | null;

  alert_market_cap: number | null;
  alert_liquidity: number | null;
  alert_price: number | null;
  alert_created_at: string | null;

  current_market_cap: number | null;
  current_liquidity: number | null;
  current_price: number | null;
  peak_market_cap: number | null;

  confidence: number | null;
  risk_level: string | null;

  creator_wallet: string | null;
  creator_score: number | null;
  holder_score: number | null;
  authority_score: number | null;

  buy_count: number | null;
  sell_count: number | null;

  return_5m_pct: number | null;
  return_15m_pct: number | null;
  return_30m_pct: number | null;
  return_1h_pct: number | null;
  return_6h_pct: number | null;
  return_24h_pct: number | null;

  max_return_pct: number | null;
  final_outcome: string | null;
  outcome: string | null;
  tracking_complete: boolean | null;

  raw: {
    alert?: AlertSnapshot | null;
    latest?: Record<string, unknown> | null;
    lastSource?: string | null;
  } | null;
};

type CreatorProfile = {
  creator_wallet: string;
  status: string | null;
  trust_score: number | null;
  total_launches: number | null;
  tracked_launches: number | null;
  winning_launches: number | null;
  failed_launches: number | null;
  moonshots: number | null;
  success_rate: number | null;
  average_max_return: number | null;
  best_return_pct: number | null;
  best_market_cap: number | null;
  reputation_summary: string | null;
};

function numberValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number | null | undefined) {
  const amount = numberValue(value);

  if (amount === null) return 'Unavailable';

  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }

  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }

  return `$${amount.toFixed(2)}`;
}

function formatPrice(value: number | null | undefined) {
  const price = numberValue(value);

  if (price === null) return 'Unavailable';

  if (price < 0.000001) return `$${price.toExponential(3)}`;
  if (price < 0.01) return `$${price.toFixed(8)}`;

  return `$${price.toFixed(4)}`;
}

function formatPercent(value: number | null | undefined) {
  const percentage = numberValue(value);

  if (percentage === null) return 'Pending';

  const prefix = percentage > 0 ? '+' : '';

  return `${prefix}${percentage.toFixed(2)}%`;
}

function shortWallet(wallet: string | null | undefined) {
  if (!wallet) return 'Not identified';

  return `${wallet.slice(0, 6)}...${wallet.slice(-6)}`;
}

function checkpointClass(value: number | null | undefined) {
  const percentage = numberValue(value);

  if (percentage === null) {
    return 'border-white/10 bg-white/[0.03] text-zinc-500';
  }

  if (percentage > 0) {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-300';
  }

  return 'border-red-400/20 bg-red-400/10 text-red-300';
}

function readableMetric(metric?: string) {
  return String(metric ?? 'Historical pattern')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function getReport(token: string) {
  const { data, error } = await supabase
    .from('token_memory')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('Report fetch failed:', error.message);
    return null;
  }

  return data as TokenMemory | null;
}

async function getCreatorProfile(
  creatorWallet: string | null
) {
  if (!creatorWallet) return null;

  const { data, error } = await supabase
    .from('proven_creators')
    .select('*')
    .eq('creator_wallet', creatorWallet)
    .maybeSingle();

  if (error) {
    console.error(
      'Creator profile fetch failed:',
      error.message
    );

    return null;
  }

  return data as CreatorProfile | null;
}

export default async function TokenReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const report = await getReport(token);

  if (!report) {
    notFound();
  }

  const alert = report.raw?.alert ?? null;

  const baseScore =
    numberValue(alert?.baseScore) ??
    numberValue(report.confidence) ??
    0;

  const adjustedScore =
    numberValue(alert?.adjustedScore) ??
    numberValue(report.confidence) ??
    baseScore;

  const learningAdjustment =
    numberValue(alert?.learningAdjustment) ?? 0;

  const learningReasons =
    Array.isArray(alert?.learningReasons)
      ? alert.learningReasons
      : [];

  const creatorWallet =
    report.creator_wallet ??
    alert?.creatorWallet ??
    null;

  const creator = await getCreatorProfile(creatorWallet);

  const verdict =
    alert?.actionBucket ??
    report.final_outcome ??
    report.outcome ??
    'MONITOR';

  const buyRatio =
    Number(report.buy_count ?? 0) /
    Math.max(1, Number(report.sell_count ?? 0));

  const dexUrl = `https://dexscreener.com/solana/${report.token}`;
  const buyUrl = `https://jup.ag/swap/SOL-${report.token}`;

  const checkpoints = [
    ['5m', report.return_5m_pct],
    ['15m', report.return_15m_pct],
    ['30m', report.return_30m_pct],
    ['1h', report.return_1h_pct],
    ['6h', report.return_6h_pct],
    ['24h', report.return_24h_pct],
  ] as const;

  return (
    <main className="min-h-screen bg-[#050609] text-white">
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8 md:py-12">
        <header className="mb-8 flex items-center justify-between">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight"
          >
            AlphaOS <span className="text-emerald-400">AI</span>
          </Link>

          <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-zinc-400">
            Live Research Report
          </div>
        </header>

        <section className="overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.08] to-white/[0.02] shadow-2xl">
          <div className="p-6 md:p-10">
            <div className="flex flex-col justify-between gap-8 md:flex-row md:items-start">
              <div>
                <p className="mb-3 text-xs font-medium uppercase tracking-[0.3em] text-emerald-400">
                  AlphaOS Intelligence Report
                </p>

                <h1 className="text-4xl font-semibold tracking-tight md:text-6xl">
                  {report.symbol ?? report.name ?? 'Unknown Token'}
                </h1>

                <p className="mt-4 break-all font-mono text-xs text-zinc-500 md:text-sm">
                  {report.token}
                </p>

                <div className="mt-6 flex flex-wrap gap-3">
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300">
                    Verdict: {verdict}
                  </span>

                  <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
                    Risk: {report.risk_level ?? 'Evaluating'}
                  </span>

                  <span className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-300">
                    {report.tracking_complete
                      ? 'Tracking complete'
                      : 'Live tracking'}
                  </span>
                </div>
              </div>

              <div className="min-w-48 rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-6 text-center">
                <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
                  Final AI Score
                </p>

                <p className="mt-3 text-6xl font-semibold">
                  {Math.round(adjustedScore)}
                </p>

                <p className="mt-1 text-sm text-zinc-400">
                  out of 100
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
              Base Score
            </p>
            <p className="mt-3 text-3xl font-semibold">
              {Math.round(baseScore)}
            </p>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
              AI Learning Boost
            </p>
            <p
              className={`mt-3 text-3xl font-semibold ${
                learningAdjustment >= 0
                  ? 'text-emerald-300'
                  : 'text-red-300'
              }`}
            >
              {learningAdjustment >= 0 ? '+' : ''}
              {learningAdjustment}
            </p>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
            <p className="text-xs uppercase tracking-[0.25em] text-zinc-500">
              Peak Return
            </p>
            <p className="mt-3 text-3xl font-semibold">
              {formatPercent(report.max_return_pct)}
            </p>
          </section>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.35fr_0.65fr]">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <h2 className="text-xl font-semibold">
              Why AlphaOS scored this token
            </h2>

            <div className="mt-6 space-y-4">
              {learningReasons.length ? (
                learningReasons.map((reason, index) => (
                  <div
                    key={`${reason.metric}-${reason.bucket}-${index}`}
                    className="rounded-2xl border border-white/10 bg-black/20 p-5"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="font-medium">
                          {readableMetric(reason.metric)}
                        </p>

                        <p className="mt-1 text-sm text-zinc-500">
                          Bucket: {reason.bucket ?? 'Unknown'}
                        </p>
                      </div>

                      <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-sm font-medium text-emerald-300">
                        {Number(reason.adjustment ?? 0) >= 0
                          ? '+'
                          : ''}
                        {reason.adjustment ?? 0}
                      </span>
                    </div>

                    <p className="mt-4 text-sm leading-6 text-zinc-300">
                      Historically, this setup produced a{' '}
                      <strong>
                        {Number(reason.winnerRate ?? 0).toFixed(2)}%
                      </strong>{' '}
                      winner rate from{' '}
                      <strong>{reason.sampleSize ?? 0}</strong>{' '}
                      completed tokens.
                    </p>
                  </div>
                ))
              ) : (
                <p className="rounded-2xl border border-white/10 bg-black/20 p-5 text-sm text-zinc-400">
                  No statistically reliable learning adjustment was
                  applied to this alert.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <h2 className="text-xl font-semibold">
              Market Structure
            </h2>

            <dl className="mt-6 space-y-5">
              <Metric
                label="Alert Market Cap"
                value={formatUsd(report.alert_market_cap)}
              />
              <Metric
                label="Current Market Cap"
                value={formatUsd(report.current_market_cap)}
              />
              <Metric
                label="Peak Market Cap"
                value={formatUsd(report.peak_market_cap)}
              />
              <Metric
                label="Alert Liquidity"
                value={formatUsd(report.alert_liquidity)}
              />
              <Metric
                label="Current Price"
                value={formatPrice(report.current_price)}
              />
              <Metric
                label="Buy / Sell Ratio"
                value={`${buyRatio.toFixed(2)}x`}
              />
              <Metric
                label="Buys / Sells"
                value={`${report.buy_count ?? 0} / ${
                  report.sell_count ?? 0
                }`}
              />
            </dl>
          </section>
        </div>

        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
          <h2 className="text-xl font-semibold">
            Live Outcome Timeline
          </h2>

          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
            {checkpoints.map(([label, value]) => (
              <div
                key={label}
                className={`rounded-2xl border p-4 text-center ${checkpointClass(
                  value
                )}`}
              >
                <p className="text-xs uppercase tracking-widest">
                  {label}
                </p>

                <p className="mt-2 font-semibold">
                  {formatPercent(value)}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <h2 className="text-xl font-semibold">
              Creator Intelligence
            </h2>

            <dl className="mt-6 space-y-5">
              <Metric
                label="Creator Wallet"
                value={shortWallet(creatorWallet)}
                mono
              />
              <Metric
                label="Status"
                value={creator?.status ?? 'Collecting history'}
              />
              <Metric
                label="Trust Score"
                value={
                  creator?.trust_score != null
                    ? `${creator.trust_score}/100`
                    : 'Pending'
                }
              />
              <Metric
                label="Launches"
                value={String(
                  creator?.total_launches ?? 0
                )}
              />
              <Metric
                label="Tracked Outcomes"
                value={String(
                  creator?.tracked_launches ?? 0
                )}
              />
              <Metric
                label="Winners"
                value={String(
                  creator?.winning_launches ?? 0
                )}
              />
              <Metric
                label="Moonshots"
                value={String(creator?.moonshots ?? 0)}
              />
              <Metric
                label="Best Market Cap"
                value={formatUsd(
                  creator?.best_market_cap
                )}
              />
            </dl>

            {creator?.reputation_summary ? (
              <p className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm leading-6 text-zinc-300">
                {creator.reputation_summary}
              </p>
            ) : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 md:p-8">
            <h2 className="text-xl font-semibold">
              Risk Intelligence
            </h2>

            <dl className="mt-6 space-y-5">
              <Metric
                label="Overall Risk"
                value={report.risk_level ?? 'Evaluating'}
              />
              <Metric
                label="Holder Safety"
                value={
                  report.holder_score != null
                    ? `${report.holder_score}/100`
                    : 'Pending'
                }
              />
              <Metric
                label="Authority Safety"
                value={
                  report.authority_score != null
                    ? `${report.authority_score}/100`
                    : 'Pending'
                }
              />
              <Metric
                label="Current Outcome"
                value={
                  report.final_outcome ??
                  report.outcome ??
                  'Tracking'
                }
              />
              <Metric
                label="Data Source"
                value={
                  report.raw?.lastSource ??
                  alert?.source ??
                  'AlphaOS'
                }
              />
            </dl>
          </section>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={dexUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center font-medium transition hover:bg-white/10"
          >
            View on DexScreener
          </a>

          <a
            href={buyUrl}
            target="_blank"
            rel="noreferrer"
            className="flex-1 rounded-2xl bg-emerald-400 px-6 py-4 text-center font-semibold text-black transition hover:bg-emerald-300"
          >
            Trade on Jupiter
          </a>
        </div>

        <footer className="py-10 text-center text-xs text-zinc-600">
          AlphaOS provides research signals, not financial advice.
        </footer>
      </div>
    </main>
  );
}

function Metric({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/5 pb-4 last:border-none last:pb-0">
      <dt className="text-sm text-zinc-500">{label}</dt>

      <dd
        className={`text-right text-sm font-medium text-zinc-100 ${
          mono ? 'font-mono' : ''
        }`}
      >
        {value}
      </dd>
    </div>
  );
}