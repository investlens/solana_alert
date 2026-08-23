import type { Investigation } from '../models/investigation.js';
import { renderAlphaNotification } from '../ui/alphaNotification.js';
import { formatUsd } from '../ui/alphaAlert/index.js';

export function renderTelegramInvestigation(investigation: Investigation): string {
  const verdict = String(investigation.ai.verdict ?? 'WATCH').toUpperCase();
  const exit = verdict === 'EXIT' || verdict === 'RISK EXIT';
  const entry = verdict === 'BUY' || verdict === 'STRONG BUY' || verdict === 'SCALP';
  return renderAlphaNotification({
    category: exit ? 'risk' : 'opportunity',
    severity: exit ? 'critical' : entry ? 'positive' : 'watch',
    state: exit ? 'EXIT_AVOID' : entry ? 'ENTRY_READY' : 'WATCHING',
    symbol: investigation.token.symbol,
    subtitle: investigation.signal.timingLabel,
    address: investigation.token.address,
    age: `${investigation.signal.ageMinutes}m`,
    confidence: investigation.ai.confidence,
    risk: investigation.ai.riskLevel,
    metrics: [
      { label: 'Market cap', value: formatUsd(investigation.market.marketCap) },
      { label: 'Liquidity', value: formatUsd(investigation.market.liquidity) },
      { label: '5m volume', value: formatUsd(investigation.market.volume5m) },
      { label: 'Buys / sells', value: `${investigation.orderflow.buys5m}/${investigation.orderflow.sells5m}` },
      ...(investigation.creator.wallet ? [{ label: 'Creator', value: `${Math.round(investigation.creator.score)}/100` }] : []),
    ],
    evidence: investigation.ai.reasons,
    reason: exit
      ? 'Risk increased materially.'
      : entry
        ? 'Market, momentum, and intelligence checks support review.'
        : 'The setup is still developing.',
    recommendedAction: exit ? 'Protect capital · review now.' : entry ? 'Verify live conditions before acting.' : 'Wait for stronger confirmation.',
  });
}
