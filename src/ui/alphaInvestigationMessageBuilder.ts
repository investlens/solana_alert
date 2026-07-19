import type {
  AlphaInvestigation,
  AlphaSuggestedAction,
  AlphaVerdict,
  ChecklistStatus,
} from '../types/alphaInvestigation.js';
import { buildAlphaAlert, formatUsd } from './alphaAlert/index.js';

function verdictMeta(verdict: AlphaVerdict): { tone: 'POSITIVE' | 'WATCH' | 'RISK' | 'NEUTRAL' | 'PREMIUM'; title: string } {
  if (verdict === 'STRONG_OPPORTUNITY') return { tone: 'PREMIUM', title: 'STRONG OPPORTUNITY' };
  if (verdict === 'WORTH_WATCHING') return { tone: 'POSITIVE', title: 'WORTH INVESTIGATING' };
  if (verdict === 'HIGH_RISK') return { tone: 'WATCH', title: 'HIGH-RISK WATCH' };
  if (verdict === 'AVOID') return { tone: 'RISK', title: 'AVOID UNTIL RISK CLEARS' };
  return { tone: 'NEUTRAL', title: 'INSUFFICIENT EVIDENCE' };
}

function actionLabel(action: AlphaSuggestedAction): string {
  if (action === 'INVESTIGATE_FURTHER') return 'Investigate further';
  if (action === 'MONITOR_CLOSELY') return 'Monitor closely';
  if (action === 'WAIT_FOR_CONFIRMATION') return 'Wait for confirmation';
  if (action === 'HIGH_RISK_SPECULATION') return 'High-risk speculation';
  return 'Avoid';
}

function statusItem(status: ChecklistStatus, label: string, detail: string): string {
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : status === 'FAIL' ? '❌' : '•';
  return `${icon} ${label}: ${detail}`;
}

export function buildAlphaInvestigationTelegramMessage(investigation: AlphaInvestigation): string {
  const verdict = verdictMeta(investigation.verdict);
  const evidence = investigation.evidence.slice(0, 4).map((x) => `✅ ${x}`);
  const risks = [...investigation.warnings, ...investigation.risks].slice(0, 4).map((x) => `⚠️ ${x}`);

  return buildAlphaAlert({
    title: 'AI RESEARCH INVESTIGATION',
    subtitle: 'Full multi-factor intelligence review',
    tone: verdict.tone,
    symbol: investigation.symbol,
    name: investigation.name,
    address: investigation.tokenAddress,
    score: investigation.confidence,
    confidence: investigation.confidence,
    risk: investigation.verdict === 'AVOID' || investigation.verdict === 'HIGH_RISK' ? 'HIGH' : 'REVIEW REQUIRED',
    status: actionLabel(investigation.suggestedAction).toUpperCase(),
    sections: [
      {
        title: 'MARKET STRUCTURE',
        icon: '📊',
        metrics: [
          { label: 'Market Cap', value: formatUsd(investigation.market.marketCap) },
          { label: 'FDV', value: formatUsd(investigation.market.fdv) },
          { label: 'Liquidity', value: formatUsd(investigation.market.liquidityUsd) },
          { label: '5m Volume', value: formatUsd(investigation.market.volume5m) },
          { label: 'Buys / Sells', value: `${investigation.market.buys5m}/${investigation.market.sells5m}` },
          { label: 'Age', value: `${Math.round(investigation.market.ageMin)}m` },
        ],
      },
      {
        title: 'CREATOR INTELLIGENCE',
        icon: '👤',
        metrics: [
          { label: 'Rating', value: investigation.creator.rating },
          { label: 'Trust Score', value: `${investigation.creator.trustScore}/100` },
          { label: 'Launches', value: investigation.creator.launches },
          { label: 'Successful', value: investigation.creator.successfulLaunches },
          { label: 'Best Market Cap', value: formatUsd(investigation.creator.highestMarketCap) },
        ],
        items: investigation.creator.summary ? [`• ${investigation.creator.summary}`] : [],
      },
      {
        title: 'EVIDENCE CHECKLIST',
        icon: '🧪',
        items: investigation.checklist.slice(0, 5).map((item) => statusItem(item.status, item.label, item.detail)),
      },
      { title: 'SUPPORTING EVIDENCE', icon: '✅', items: evidence },
      { title: 'RISKS TO VERIFY', icon: '⚠️', items: risks },
    ],
    verdictTitle: verdict.title,
    verdict: investigation.executiveSummary,
    tracking: 'ALPHA MEMORY & OUTCOME TRACKING ACTIVE',
    disclaimer: 'Open the full AI Report for complete evidence and ongoing updates.',
  });
}
