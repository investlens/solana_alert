import type { Investigation } from '../models/investigation.js';
import { buildAlphaAlert, formatUsd } from '../ui/alphaAlert/index.js';

function riskDisplay(hasData: boolean, level: string, score: number): string {
  return hasData ? `${level} (${score}/100)` : 'Enrichment pending';
}

function tierTone(tier: Investigation['signal']['tier']): 'PREMIUM' | 'POSITIVE' | 'WATCH' {
  if (tier === 'P0') return 'PREMIUM';
  if (tier === 'P1') return 'POSITIVE';
  return 'WATCH';
}

export function renderTelegramInvestigation(investigation: Investigation): string {
  const historicalEdge = investigation.ai.historicalEdge >= 0 ? `+${investigation.ai.historicalEdge}` : String(investigation.ai.historicalEdge);
  const creatorMetrics = investigation.creator.wallet
    ? [
        { label: 'Status', value: investigation.creator.status },
        { label: 'Score', value: `${investigation.creator.score}/100` },
        { label: 'Launches', value: investigation.creator.launches },
        { label: 'Best Market Cap', value: investigation.creator.bestMarketCap > 0 ? formatUsd(investigation.creator.bestMarketCap) : 'Tracking' },
      ]
    : [{ label: 'Status', value: 'Creator history scanning' }];

  return buildAlphaAlert({
    title: investigation.signal.title,
    subtitle: `${investigation.signal.status} · ${investigation.signal.ageMinutes}m old · ${investigation.signal.timingLabel}`,
    tone: tierTone(investigation.signal.tier),
    symbol: investigation.token.symbol,
    address: investigation.token.shortAddress,
    score: investigation.ai.finalScore,
    confidence: investigation.ai.confidence,
    risk: investigation.ai.riskLevel,
    status: investigation.signal.status,
    sections: [
      {
        title: 'MARKET SNAPSHOT',
        icon: '📊',
        metrics: [
          { label: 'Market Cap', value: formatUsd(investigation.market.marketCap) },
          { label: 'Liquidity', value: formatUsd(investigation.market.liquidity) },
          { label: '5m Volume', value: formatUsd(investigation.market.volume5m) },
          { label: 'Buy Ratio', value: `${investigation.orderflow.buyRatio.toFixed(2)}x` },
          { label: 'Buyers', value: `${investigation.orderflow.buyerPercentage}%` },
        ],
      },
      { title: 'CREATOR INTELLIGENCE', icon: '👤', metrics: creatorMetrics },
      {
        title: 'RISK INTELLIGENCE',
        icon: '🛡',
        metrics: [
          { label: 'Holder Risk', value: riskDisplay(investigation.risk.holder.hasData, investigation.risk.holder.level, investigation.risk.holder.score) },
          { label: 'Bundle Risk', value: riskDisplay(investigation.risk.bundle.hasData, investigation.risk.bundle.level, investigation.risk.bundle.score) },
          { label: 'Known Buyers', value: investigation.risk.knownBuyers },
        ],
      },
      {
        title: 'WHY ALPHAOS IS WATCHING',
        icon: '🔎',
        items: (investigation.ai.reasons.length ? investigation.ai.reasons : ['AlphaOS is monitoring confirmation signals']).slice(0, 4).map((x) => `• ${x}`),
      },
    ],
    verdictTitle: investigation.ai.verdict,
    verdict: `Historical edge: ${historicalEdge}. Open the AI Report for the complete investigation.`,
    tracking: '5m · 15m · 30m · 1h · 6h · 24h TRACKING',
  });
}
