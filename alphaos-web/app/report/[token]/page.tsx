import type { Metadata } from 'next';
import Link from 'next/link';

import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type PageProps = {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{
    source?: string;
    engine?: string;
    event?: string;
  }>;
};

type TokenMemoryRow = {
  token: string;
  symbol: string | null;
  name: string | null;
  chain: string | null;
  creator_wallet: string | null;
  first_seen: string | null;
  last_updated: string | null;

  first_market_cap: number | string | null;
  current_market_cap: number | string | null;
  peak_market_cap: number | string | null;

  first_liquidity: number | string | null;
  current_liquidity: number | string | null;

  first_price: number | string | null;
  current_price: number | string | null;
  highest_price: number | string | null;

  buy_count: number | null;
  sell_count: number | null;
  holder_count: number | null;
  smart_wallet_count: number | null;

  confidence: number | null;
  risk_level: string | null;
  authority_score: number | null;
  creator_score: number | null;
  holder_score: number | null;

  status: string | null;
  outcome: string | null;
  final_outcome: string | null;
  ai_summary: string | null;

  alert_market_cap: number | string | null;
  alert_price: number | string | null;
  alert_liquidity: number | string | null;
  alert_created_at: string | null;
  alert_pair_address: string | null;

  market_cap_5m: number | string | null;
  return_5m_pct: number | string | null;

  market_cap_15m: number | string | null;
  return_15m_pct: number | string | null;

  market_cap_30m: number | string | null;
  return_30m_pct: number | string | null;

  market_cap_1h: number | string | null;
  return_1h_pct: number | string | null;

  market_cap_6h: number | string | null;
  return_6h_pct: number | string | null;

  market_cap_24h: number | string | null;
  return_24h_pct: number | string | null;

  max_return_pct: number | string | null;
  drawdown_from_peak_pct: number | string | null;

  tracking_complete: boolean | null;

  raw: Record<string, unknown> | null;
};

type AlphaSignalRow = {
  token: string;
  symbol: string | null;
  title: string | null;
  score: number | string | null;
  conviction: string | null;
  summary: string | null;
  dex_url: string | null;
  buy_url: string | null;
  alert_price: number | string | null;
  current_price: number | string | null;
  high_after_alert: number | string | null;
  roi_now: number | string | null;
  roi_high: number | string | null;
  created_at: string | null;
};

type AlertRow = {
  token_address: string;
  pair_address: string | null;
  score_at_alert: number | null;
  risk_at_alert: string | null;
  action_at_alert: string | null;
  liquidity_at_alert: number | string | null;
  buys5m_at_alert: number | null;
  sells5m_at_alert: number | null;
  volume5m_at_alert: number | string | null;
  alerted_at: string | null;
};

type CreatorRow = {
  creator_wallet: string;
  total_launches: number | null;
  successful_launches: number | null;
  failed_launches: number | null;
  best_market_cap: number | string | null;
  avg_market_cap: number | string | null;
  trust_score: number | null;
  last_token: string | null;
};

type TimelineItem = {
  label: string;
  marketCap: number | string | null;
  returnPct: number | string | null;
};

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'number' && typeof value !== 'string') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(
  value: number | string | null | undefined
): string {
  const amount = toNumber(value);

  if (amount === null) {
    return '—';
  }

  if (amount >= 1_000_000_000) {
    return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  }

  if (amount >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(2)}M`;
  }

  if (amount >= 1_000) {
    return `$${(amount / 1_000).toFixed(1)}K`;
  }

  return `$${amount.toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}`;
}

function formatPrice(
  value: number | string | null | undefined
): string {
  const price = toNumber(value);

  if (price === null) {
    return '—';
  }

  if (price === 0) {
    return '$0';
  }

  if (price < 0.000001) {
    return `$${price.toExponential(3)}`;
  }

  if (price < 0.01) {
    return `$${price.toFixed(8)}`;
  }

  return `$${price.toLocaleString('en-US', {
    maximumFractionDigits: 6,
  })}`;
}

function formatPercent(
  value: number | string | null | undefined
): string {
  const percent = toNumber(value);

  if (percent === null) {
    return '—';
  }

  return `${percent > 0 ? '+' : ''}${percent.toFixed(2)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function shortenAddress(
  value: string | null | undefined
): string {
  if (!value) {
    return 'Unavailable';
  }

  if (value.length <= 20) {
    return value;
  }

  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function getTokenAge(value: string | null | undefined): string {
  if (!value) {
    return 'Unknown';
  }

  const firstSeen = new Date(value).getTime();

  if (!Number.isFinite(firstSeen)) {
    return 'Unknown';
  }

  const elapsed = Math.max(Date.now() - firstSeen, 0);
  const minutes = Math.floor(elapsed / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }

  return `${Math.max(minutes, 1)}m`;
}

function getReturnClass(
  value: number | string | null | undefined
): string {
  const percent = toNumber(value);

  if (percent === null || percent === 0) {
    return 'text-zinc-300';
  }

  return percent > 0
    ? 'text-emerald-400'
    : 'text-rose-400';
}

function getRiskClasses(risk: string): string {
  const normalized = risk.toUpperCase();

  if (normalized === 'LOW') {
    return 'border-emerald-400/20 bg-emerald-400/10 text-emerald-400';
  }

  if (
    normalized === 'HIGH' ||
    normalized === 'CRITICAL'
  ) {
    return 'border-rose-400/20 bg-rose-400/10 text-rose-400';
  }

  return 'border-amber-400/20 bg-amber-400/10 text-amber-300';
}

function getScoreColor(score: number): string {
  if (score >= 80) {
    return 'text-emerald-400';
  }

  if (score >= 70) {
    return 'text-amber-300';
  }

  return 'text-zinc-300';
}

function getConfidenceLabel(confidence: number): string {
  if (confidence >= 75) {
    return 'High confidence';
  }

  if (confidence >= 50) {
    return 'Confidence building';
  }

  return 'Early signal';
}

function objectFromUnknown(
  value: unknown
): Record<string, unknown> | null {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value as Record<string, unknown>;
  }

  return null;
}

function textFromUnknown(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  return text.length > 0 ? text : null;
}

async function loadReport(token: string) {
  const [
    memoryResult,
    signalResult,
    alertResult,
  ] = await Promise.all([
    supabaseAdmin
      .from('token_memory')
      .select('*')
      .eq('token', token)
      .maybeSingle<TokenMemoryRow>(),

    supabaseAdmin
      .from('alpha_signals')
      .select('*')
      .eq('token', token)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<AlphaSignalRow>(),

    supabaseAdmin
      .from('alerts')
      .select('*')
      .eq('token_address', token)
      .order('alerted_at', { ascending: false })
      .limit(1)
      .maybeSingle<AlertRow>(),
  ]);

  if (memoryResult.error) {
    console.error(
      'Token memory query failed:',
      memoryResult.error
    );
  }

  if (signalResult.error) {
    console.error(
      'Alpha signal query failed:',
      signalResult.error
    );
  }

  if (alertResult.error) {
    console.error('Alert query failed:', alertResult.error);
  }

  const memory = memoryResult.data;
  const signal = signalResult.data;
  const alert = alertResult.data;

  let creator: CreatorRow | null = null;

  if (memory?.creator_wallet) {
    const creatorResult = await supabaseAdmin
      .from('creator_intelligence')
      .select('*')
      .eq('creator_wallet', memory.creator_wallet)
      .maybeSingle<CreatorRow>();

    if (creatorResult.error) {
      console.error(
        'Creator intelligence query failed:',
        creatorResult.error
      );
    }

    creator = creatorResult.data;
  }

  return {
    memory,
    signal,
    alert,
    creator,
  };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { token } = await params;
  const decodedToken = decodeURIComponent(token);

  const { data } = await supabaseAdmin
    .from('token_memory')
    .select('symbol,name')
    .eq('token', decodedToken)
    .maybeSingle<{
      symbol: string | null;
      name: string | null;
    }>();

  const tokenName =
    data?.name ??
    data?.symbol ??
    shortenAddress(decodedToken);

  return {
    title: `${tokenName} AI Report | AlphaOS AI`,
    description: `AlphaOS AI investigation and market intelligence report for ${tokenName}.`,
  };
}

export default async function TokenReportPage({
  params,
  searchParams,
}: PageProps) {
  const { token } = await params;
  const origin = (await searchParams) ?? {};
  const sourceLabel = origin.source?.trim() || null;
  const engineLabel = origin.engine?.trim() || null;
  const eventLabel = origin.event?.trim() || null;
  const decodedToken = decodeURIComponent(token);

  const { memory, signal, alert, creator } =
    await loadReport(decodedToken);

  if (!memory && !signal && !alert) {
    return (
      <main className="alpha-grid min-h-screen bg-[#050609] text-white">
        <div className="mx-auto max-w-[1450px] px-4 py-5 md:px-7 md:py-7">
          <AlphaHeader />

          <section className="flex min-h-[70vh] items-center justify-center py-12">
            <div className="w-full max-w-xl alpha-panel p-7 text-center md:p-10">
              <p className="text-xs font-medium uppercase tracking-[0.32em] text-emerald-400">
                AI Research Report
              </p>

              <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
                Report not available yet
              </h1>

              <p className="mt-4 leading-7 text-zinc-500">
                AlphaOS has not stored an investigation for this
                token yet.
              </p>

              <div className="mt-6 break-all rounded-2xl border border-white/10 bg-black/20 p-4 font-mono text-xs text-zinc-500">
                {decodedToken}
              </div>

              <Link
                href="/"
                className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-400 px-5 text-sm font-semibold text-black transition hover:bg-emerald-300"
              >
                Open AlphaOS Terminal
              </Link>
            </div>
          </section>

          <AlphaFooter />
        </div>
      </main>
    );
  }

  const rawAlert = objectFromUnknown(memory?.raw?.['alert']);
  const rawLatest = objectFromUnknown(memory?.raw?.['latest']);

  const score =
    toNumber(rawAlert?.['adjustedScore']) ??
    toNumber(rawLatest?.['score']) ??
    toNumber(signal?.score) ??
    alert?.score_at_alert ??
    memory?.confidence ??
    0;

  const confidence =
    memory?.confidence ?? Math.round(score);

  const risk =
    memory?.risk_level ??
    alert?.risk_at_alert ??
    'MEDIUM';

  const tier =
    textFromUnknown(rawLatest?.['tier']) ??
    signal?.conviction ??
    memory?.status ??
    'MONITORING';

  const action =
    textFromUnknown(rawAlert?.['actionBucket']) ??
    alert?.action_at_alert ??
    (score >= 80
      ? 'HIGH CONVICTION WATCH'
      : score >= 70
        ? 'STRONG WATCH'
        : 'MONITOR');

  const symbol =
    memory?.symbol ??
    signal?.symbol ??
    'UNKNOWN';

  const name =
    memory?.name ??
    memory?.symbol ??
    signal?.symbol ??
    'Unknown Token';

  const chain = memory?.chain ?? 'solana';

  const pairAddress =
    memory?.alert_pair_address ??
    alert?.pair_address ??
    null;

  const dexUrl =
    signal?.dex_url ??
    textFromUnknown(memory?.raw?.['dexUrl']) ??
    (pairAddress
      ? `https://dexscreener.com/${chain}/${pairAddress}`
      : `https://dexscreener.com/${chain}/${decodedToken}`);

  const buyUrl =
    signal?.buy_url ??
    (chain.toLowerCase() === 'solana'
      ? `https://jup.ag/swap/SOL-${decodedToken}`
      : null);

  const buyCount =
    memory?.buy_count ??
    alert?.buys5m_at_alert ??
    0;

  const sellCount =
    memory?.sell_count ??
    alert?.sells5m_at_alert ??
    0;

  const totalTrades = buyCount + sellCount;

  const buyPressure =
    totalTrades > 0
      ? (buyCount / totalTrades) * 100
      : null;

  const alertMarketCap =
    memory?.alert_market_cap ??
    memory?.first_market_cap ??
    null;

  const currentMarketCap =
    memory?.current_market_cap ?? null;

  const peakMarketCap =
    memory?.peak_market_cap ?? null;

  const liquidity =
    memory?.current_liquidity ??
    memory?.first_liquidity ??
    alert?.liquidity_at_alert ??
    null;

  const currentPrice =
    memory?.current_price ??
    signal?.current_price ??
    memory?.alert_price ??
    signal?.alert_price ??
    null;

  const roiNow =
    signal?.roi_now ??
    (toNumber(alertMarketCap) &&
    toNumber(currentMarketCap)
      ? ((Number(currentMarketCap) -
          Number(alertMarketCap)) /
          Number(alertMarketCap)) *
        100
      : null);

  const peakReturn =
    memory?.max_return_pct ??
    signal?.roi_high ??
    null;

  const outcome =
    memory?.final_outcome ??
    memory?.outcome ??
    memory?.status ??
    'TRACKING';

  const aiSummary =
    memory?.ai_summary ??
    signal?.summary ??
    `AlphaOS is investigating ${symbol} using market structure, liquidity, transaction flow, creator intelligence and historical outcome data.`;

  const creatorTrust =
    creator?.trust_score ??
    memory?.creator_score ??
    null;

  const smartWalletCount =
    memory?.smart_wallet_count ?? 0;

  const reasons: string[] = [];

  if (score >= 70) {
    reasons.push(
      `Composite AI score reached ${Math.round(score)}/100`
    );
  }

  if (buyPressure !== null && buyPressure >= 55) {
    reasons.push(
      `Buy pressure represents ${buyPressure.toFixed(1)}% of tracked transactions`
    );
  }

  if (
    toNumber(liquidity) !== null &&
    Number(liquidity) >= 10_000
  ) {
    reasons.push(
      `Current liquidity is ${formatUsd(liquidity)}`
    );
  }

  if (creatorTrust !== null && creatorTrust >= 60) {
    reasons.push(
      `Creator trust score is ${creatorTrust}/100`
    );
  }

  if (smartWalletCount > 0) {
    reasons.push(
      `${smartWalletCount} smart wallet${
        smartWalletCount === 1 ? '' : 's'
      } detected`
    );
  }

  if (reasons.length === 0) {
    reasons.push(
      'AlphaOS is collecting additional confirmation data'
    );
  }

  const timeline: TimelineItem[] = [
    {
      label: '5 minutes',
      marketCap: memory?.market_cap_5m ?? null,
      returnPct: memory?.return_5m_pct ?? null,
    },
    {
      label: '15 minutes',
      marketCap: memory?.market_cap_15m ?? null,
      returnPct: memory?.return_15m_pct ?? null,
    },
    {
      label: '30 minutes',
      marketCap: memory?.market_cap_30m ?? null,
      returnPct: memory?.return_30m_pct ?? null,
    },
    {
      label: '1 hour',
      marketCap: memory?.market_cap_1h ?? null,
      returnPct: memory?.return_1h_pct ?? null,
    },
    {
      label: '6 hours',
      marketCap: memory?.market_cap_6h ?? null,
      returnPct: memory?.return_6h_pct ?? null,
    },
    {
      label: '24 hours',
      marketCap: memory?.market_cap_24h ?? null,
      returnPct: memory?.return_24h_pct ?? null,
    },
  ].filter((item) => item.marketCap !== null);

  return (
    <main className="alpha-grid min-h-screen bg-[#050609] text-white">
      <div className="mx-auto max-w-[1450px] px-4 py-5 md:px-7 md:py-7">
        <AlphaHeader />

        <section className="py-8 md:py-12">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.32em] text-emerald-400">
                AI Research Report
              </p>

              <p className="mt-2 text-sm text-zinc-600">
                Alpha Memory investigation and tracked market outcome
              </p>

              {sourceLabel || engineLabel || eventLabel ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {sourceLabel ? <OriginBadge label={`Source · ${sourceLabel}`} /> : null}
                  {engineLabel ? <OriginBadge label={`Engine · ${engineLabel}`} /> : null}
                  {eventLabel ? <OriginBadge label={`Event · ${eventLabel}`} /> : null}
                </div>
              ) : null}
            </div>

            <Link
              href="/"
              className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.07]"
            >
              ← Back to Terminal
            </Link>
          </div>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <article className="alpha-panel p-6 md:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  label={`${risk} Risk`}
                  className={getRiskClasses(risk)}
                />

                <StatusBadge
                  label={tier}
                  className="border-white/10 bg-white/[0.04] text-zinc-300"
                />

                <StatusBadge
                  label={chain.toUpperCase()}
                  className="border-white/10 bg-white/[0.04] text-zinc-500"
                />
              </div>

              <div className="mt-8">
                <h1 className="text-5xl font-semibold tracking-[-0.06em] md:text-7xl">
                  {symbol}
                </h1>

                <p className="mt-3 text-lg font-medium text-zinc-300">
                  {name}
                </p>

                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-zinc-600">
                  <span>{shortenAddress(decodedToken)}</span>

                  <span>
                    Detected {getTokenAge(memory?.first_seen)} ago
                  </span>
                </div>
              </div>

              <p className="mt-7 max-w-4xl text-sm leading-7 text-zinc-500 md:text-base">
                {aiSummary}
              </p>

              <div className="mt-7 flex flex-wrap gap-3">
                <a
                  href={dexUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-emerald-400 px-5 text-sm font-semibold text-black transition hover:bg-emerald-300"
                >
                  Open Live Chart
                </a>

                {buyUrl ? (
                  <a
                    href={buyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-5 text-sm font-medium text-zinc-300 transition hover:border-white/20 hover:bg-white/[0.07]"
                  >
                    Trade on Jupiter
                  </a>
                ) : null}
              </div>
            </article>

            <article className="alpha-panel p-6 md:p-8">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-zinc-600">
                AlphaOS AI Score
              </p>

              <div
                className={`mt-5 text-7xl font-semibold tracking-[-0.08em] ${getScoreColor(
                  score
                )}`}
              >
                {Math.round(score)}
                <span className="ml-2 text-base tracking-normal text-zinc-700">
                  /100
                </span>
              </div>

              <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full bg-emerald-400"
                  style={{
                    width: `${Math.max(
                      0,
                      Math.min(score, 100)
                    )}%`,
                  }}
                />
              </div>

              <p className="mt-3 text-sm text-zinc-500">
                {getConfidenceLabel(confidence)}
              </p>

              <div className="mt-7 space-y-5 border-t border-white/10 pt-6">
                <DataRow
                  label="Decision"
                  value={action}
                />

                <DataRow
                  label="Confidence"
                  value={`${confidence}%`}
                />

                <DataRow
                  label="Outcome"
                  value={outcome}
                />
              </div>
            </article>
          </section>

          <section className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Market Cap"
              value={formatUsd(currentMarketCap)}
              detail={`Alert ${formatUsd(alertMarketCap)}`}
            />

            <MetricCard
              label="Liquidity"
              value={formatUsd(liquidity)}
              detail={`Initial ${formatUsd(
                memory?.first_liquidity ??
                  alert?.liquidity_at_alert
              )}`}
            />

            <MetricCard
              label="Current Price"
              value={formatPrice(currentPrice)}
              detail={`Alert ${formatPrice(
                memory?.alert_price ??
                  signal?.alert_price
              )}`}
            />

            <MetricCard
              label="Peak Market Cap"
              value={formatUsd(peakMarketCap)}
              detail={`Peak return ${formatPercent(
                peakReturn
              )}`}
            />
          </section>

          <section className="mt-4 grid gap-4 lg:grid-cols-2">
            <ReportPanel
              eyebrow="AI Verdict"
              title="Why AlphaOS is watching"
              className="lg:col-span-2"
            >
              <div className="grid gap-3 md:grid-cols-2">
                {reasons.map((reason) => (
                  <div
                    key={reason}
                    className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3 text-sm text-zinc-400"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-xs font-bold text-emerald-400">
                      ✓
                    </span>

                    <span>{reason}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-4 border-t border-white/10 pt-6 sm:grid-cols-3">
                <DataBlock
                  label="Current Return"
                  value={formatPercent(roiNow)}
                  valueClassName={getReturnClass(roiNow)}
                />

                <DataBlock
                  label="Peak Return"
                  value={formatPercent(peakReturn)}
                  valueClassName={getReturnClass(
                    peakReturn
                  )}
                />

                <DataBlock
                  label="Tracked Outcome"
                  value={outcome}
                />
              </div>
            </ReportPanel>

            <ReportPanel
              eyebrow="Market Flow"
              title="Transaction activity"
            >
              <div className="grid grid-cols-2 gap-3">
                <DataTile
                  label="Buys"
                  value={buyCount.toLocaleString()}
                  valueClassName="text-emerald-400"
                />

                <DataTile
                  label="Sells"
                  value={sellCount.toLocaleString()}
                  valueClassName="text-rose-400"
                />
              </div>

              <div className="mt-6 h-2 overflow-hidden rounded-full bg-rose-400/20">
                <div
                  className="h-full bg-emerald-400"
                  style={{
                    width: `${buyPressure ?? 50}%`,
                  }}
                />
              </div>

              <div className="mt-3 flex justify-between gap-4 text-xs text-zinc-600">
                <span>
                  Buy pressure{' '}
                  {buyPressure !== null
                    ? `${buyPressure.toFixed(1)}%`
                    : '—'}
                </span>

                <span>
                  Volume{' '}
                  {formatUsd(alert?.volume5m_at_alert)}
                </span>
              </div>
            </ReportPanel>

            <ReportPanel
              eyebrow="Risk Intelligence"
              title="Safety assessment"
            >
              <div className="space-y-1">
                <RiskRow
                  label="Overall risk"
                  value={risk}
                  state={risk}
                />

                <RiskRow
                  label="Holder score"
                  value={
                    memory?.holder_score !== null &&
                    memory?.holder_score !== undefined
                      ? `${memory.holder_score}/100`
                      : 'Scanning'
                  }
                  state={
                    (memory?.holder_score ?? 0) >= 60
                      ? 'LOW'
                      : 'MEDIUM'
                  }
                />

                <RiskRow
                  label="Authority score"
                  value={
                    memory?.authority_score !== null &&
                    memory?.authority_score !== undefined
                      ? `${memory.authority_score}/100`
                      : 'Scanning'
                  }
                  state={
                    (memory?.authority_score ?? 0) >= 60
                      ? 'LOW'
                      : 'MEDIUM'
                  }
                />

                <RiskRow
                  label="Smart wallets"
                  value={smartWalletCount.toString()}
                  state={
                    smartWalletCount > 0
                      ? 'LOW'
                      : 'MEDIUM'
                  }
                />
              </div>
            </ReportPanel>

            <ReportPanel
              eyebrow="Creator Intelligence"
              title="Developer history"
            >
              <div className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
                <span className="text-xs uppercase tracking-wider text-zinc-600">
                  Creator wallet
                </span>

                <strong className="font-mono text-xs font-medium text-zinc-400">
                  {shortenAddress(memory?.creator_wallet)}
                </strong>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <DataTile
                  label="Trust Score"
                  value={
                    creatorTrust !== null
                      ? `${creatorTrust}/100`
                      : 'Unknown'
                  }
                />

                <DataTile
                  label="Launches"
                  value={
                    creator?.total_launches?.toString() ??
                    '—'
                  }
                />

                <DataTile
                  label="Successful"
                  value={
                    creator?.successful_launches?.toString() ??
                    '—'
                  }
                />

                <DataTile
                  label="Best Market Cap"
                  value={formatUsd(
                    creator?.best_market_cap
                  )}
                />
              </div>
            </ReportPanel>

            <ReportPanel
              eyebrow="Alpha Memory"
              title="Performance after alert"
              className="lg:col-span-2"
              status={
                memory?.tracking_complete
                  ? 'Tracking Complete'
                  : 'Live Tracking'
              }
            >
              {timeline.length > 0 ? (
                <div>
                  {timeline.map((item) => (
                    <div
                      key={item.label}
                      className="grid min-h-16 grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-4 border-b border-white/10 last:border-b-0"
                    >
                      <span className="h-2.5 w-2.5 rounded-full border-2 border-emerald-400 bg-[#050609]" />

                      <div>
                        <p className="text-xs text-zinc-600">
                          {item.label}
                        </p>

                        <p className="mt-1 text-sm font-medium text-zinc-300">
                          {formatUsd(item.marketCap)}
                        </p>
                      </div>

                      <strong
                        className={`text-sm ${getReturnClass(
                          item.returnPct
                        )}`}
                      >
                        {formatPercent(item.returnPct)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-zinc-600">
                  AlphaOS is collecting performance checkpoints.
                </div>
              )}
            </ReportPanel>
          </section>
        </section>

        <div className="flex flex-col gap-2 border-t border-white/10 py-6 text-center text-xs text-zinc-700 md:flex-row md:justify-between md:text-left">
          <span>
            AlphaOS provides research intelligence, not
            financial advice.
          </span>

          <span>
            Last updated {formatDate(memory?.last_updated)}
          </span>
        </div>
      </div>
    </main>
  );
}

function AlphaHeader() {
  return (
    <header className="flex items-center justify-between border-b border-white/10 pb-5">
      <Link href="/">
        <p className="text-xl font-semibold tracking-tight">
          AlphaOS{' '}
          <span className="text-emerald-400">
            AI
          </span>
        </p>

        <p className="mt-1 text-xs text-zinc-600">
          Crypto Intelligence Operating System
        </p>
      </Link>

      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-400">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Intelligence Online
      </div>
    </header>
  );
}

function AlphaFooter() {
  return (
    <footer className="border-t border-white/10 py-6 text-center text-xs text-zinc-700">
      AlphaOS provides research intelligence, not financial
      advice.
    </footer>
  );
}

function OriginBadge({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-cyan-400/15 bg-cyan-400/[0.06] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-300">
      {label}
    </span>
  );
}

function StatusBadge({
  label,
  className,
}: {
  label: string;
  className: string;
}) {
  return (
    <span
      className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider ${className}`}
    >
      {label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="alpha-panel rounded-2xl p-5">
      <p className="text-xs uppercase tracking-wider text-zinc-600">
        {label}
      </p>

      <p className="mt-3 text-2xl font-semibold tracking-tight text-white">
        {value}
      </p>

      <p className="mt-2 text-xs text-zinc-600">
        {detail}
      </p>
    </article>
  );
}

function ReportPanel({
  eyebrow,
  title,
  status,
  className = '',
  children,
}: {
  eyebrow: string;
  title: string;
  status?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`alpha-panel p-6 md:p-7 ${className}`}
    >
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-emerald-400">
            {eyebrow}
          </p>

          <h2 className="mt-2 text-xl font-semibold tracking-tight">
            {title}
          </h2>
        </div>

        {status ? (
          <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
            {status}
          </span>
        ) : null}
      </div>

      {children}
    </article>
  );
}

function DataRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </p>

      <p className="mt-1.5 text-sm font-medium text-zinc-300">
        {value}
      </p>
    </div>
  );
}

function DataBlock({
  label,
  value,
  valueClassName = 'text-zinc-300',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </p>

      <p
        className={`mt-2 text-sm font-semibold ${valueClassName}`}
      >
        {value}
      </p>
    </div>
  );
}

function DataTile({
  label,
  value,
  valueClassName = 'text-zinc-200',
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/10 p-4">
      <p className="text-[10px] uppercase tracking-wider text-zinc-600">
        {label}
      </p>

      <p
        className={`mt-2 text-lg font-semibold ${valueClassName}`}
      >
        {value}
      </p>
    </div>
  );
}

function RiskRow({
  label,
  value,
  state,
}: {
  label: string;
  value: string;
  state: string;
}) {
  const normalized = state.toUpperCase();

  const dotClass =
    normalized === 'LOW'
      ? 'bg-emerald-400'
      : normalized === 'HIGH' ||
          normalized === 'CRITICAL'
        ? 'bg-rose-400'
        : 'bg-amber-300';

  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-white/10 last:border-b-0">
      <span className="text-sm text-zinc-500">
        {label}
      </span>

      <strong className="flex items-center gap-2 text-sm font-medium text-zinc-300">
        <span
          className={`h-2 w-2 rounded-full ${dotClass}`}
        />

        {value}
      </strong>
    </div>
  );
}