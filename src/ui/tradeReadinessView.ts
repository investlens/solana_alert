import type { Readiness } from '../services/tradeReadiness.js';
import type { Monitor } from '../services/deteriorationMonitor.js';
import type { ChainMarketSnapshot } from '../chains/shared/types.js';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (v: number) => '$' + v.toLocaleString('en-US', { maximumFractionDigits: v < 1 ? 9 : 2 });
export function renderReadiness(token: string, result: Readiness): string {
  const m = result.market;
  return ['🎯 <b>TRADE READINESS · PRO</b>', `<b>${esc(m?.symbol || 'Token')} · ROBINCHAIN</b>`,
    `<b>${result.state === 'WATCH' ? 'WATCH' : 'SETUP FORMING'}</b>`, '',
    ...(m ? [`Price <b>${usd(m.priceUsd)}</b> · LP <b>${usd(m.liquidityUsd)}</b>`,
      ...(m.marketCapUsd > 0 ? [`MC <b>${usd(m.marketCapUsd)}</b>`] : m.fdvUsd && m.fdvUsd > 0 ? [`FDV <b>${usd(m.fdvUsd)}</b> · MC unverified`] : []),
      ...(m.volume5mUsd > 0 ? [`Vol · 5m <b>${usd(m.volume5mUsd)}</b>`] : ['5m volume unavailable or inactive']),
      ...(m.trades5mReported ? [`Trades · 5m <b>${m.buys5m} buy / ${m.sells5m} sell</b>`] : []),
      ...(Number.isFinite(m.priceChange1h) ? [`Move · 1h <b>${m.priceChange1h! >= 0 ? '+' : ''}${m.priceChange1h!.toFixed(2)}%</b>`] : []), ''] : []),
    '<b>WHAT TO CHECK</b>', ...result.reasons.map(reason => `• ${esc(reason)}`),
    '• Creator selling, complete holder ownership and size-specific execution are not assessed by this market check.',
    'Use Position Check / Full Intel for available deeper evidence.', '',
    '<b>PERSONAL MONITOR</b>', 'Opt in below for price ≤ −15% or liquidity ≤ −20% versus the starting snapshot.',
    'About 2-minute checks · 1-hour expiry · Maximum 3 warning events.',
    'Data gaps and pool changes are flagged. Fast dumps can occur between checks.', '',
    `<code>${esc(token)}</code>`,
    `DEXScreener · ${m ? 'Observed ' + new Date(m.timestamp).toISOString().slice(11, 19) + ' UTC' : 'Fresh market unavailable'}`,
    '<i>Market screening only · No entry approval or automatic trade</i>',
  ].join('\n');
}
export function readinessButtons(token: string) {
  return [[{ text: '↻ Readiness', callback_data: `TR_RH_${token}` }, { text: '🔔 Monitor 1h', callback_data: `DM_RH_${token}` }],
    [{ text: '🎯 Position Check', callback_data: `PC_RH_0.01_${token}` }, { text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }],
    [{ text: 'My Monitors', callback_data: 'DM_HOME' }, { text: 'Free / Pro', callback_data: 'FEATURE_GUIDE' }]];
}
export function renderDeterioration(row: Monitor, market: ChainMarketSnapshot | null, mask: number): string {
  const valid = (mask & 12) === 0 && market;
  return ['⚠️ <b>ALPHAOS · MONITOR UPDATE</b>', `<b>${esc(row.symbol || 'Token')} · ROBINCHAIN</b>`, '',
    ...((mask & 4) !== 0 ? ['<b>Market data unavailable or stale</b>', 'Unable to assess the token; this is not a price-drop confirmation.']
      : (mask & 8) !== 0 ? ['<b>Pool changed</b>', 'Current price and liquidity cannot be compared with the monitored pool.']
      : valid ? [
        ...((mask & 1) ? [`Price vs start <b>${((market.priceUsd / row.price - 1) * 100).toFixed(1)}%</b>`] : []),
        ...((mask & 2) ? [`Liquidity vs start <b>${((market.liquidityUsd / row.liquidity - 1) * 100).toFixed(1)}%</b>`] : []),
        `Price <b>${usd(market.priceUsd)}</b> · LP <b>${usd(market.liquidityUsd)}</b>`,
      ] : []),
    `Baseline ${new Date(row.at).toISOString().slice(11, 19)} UTC · ${usd(row.price)}`,
    `Checked ${new Date().toISOString().slice(11, 19)} UTC`,
    'Reassess your setup. Creator selling and cause of the decline are not established.',
    `<code>${esc(row.token)}</code>`, '<i>Sampled monitoring · No trade placed</i>',
  ].join('\n');
}
