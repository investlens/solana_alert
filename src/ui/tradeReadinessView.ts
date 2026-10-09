import { readinessChecks, type Readiness } from '../services/tradeReadiness.js';
import type { Monitor } from '../services/deteriorationMonitor.js';
import type { ChainMarketSnapshot } from '../chains/shared/types.js';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (v: number) => '$' + (v > 0 && v < 1
  ? v < 1e-20 ? v.toPrecision(6) : v.toFixed(Math.min(20,Math.max(2,5-Math.floor(Math.log10(v)))))
  : v.toLocaleString('en-US', { maximumFractionDigits: 2 }));
export function renderReadiness(token: string, result: Readiness): string {
  const m = result.market;
  if (!m) return ['🎯 <b>TRADE READINESS</b>', '<b>Unable to assess · Robinchain</b>', '',
    'A fresh indexed USD price and pool liquidity could not be verified.',
    'Monitoring is unavailable for this snapshot. Retry or open Full Intel for available research.', '',
    `<code>${esc(token)}</code>`, '<i>No readiness or safety conclusion</i>'].join('\n');
  return ['🎯 <b>TRADE READINESS · PRO</b>', `<b>${esc((m.name || 'Token').slice(0,48))}${m.symbol?' ($'+esc(m.symbol.slice(0,24))+')':''} · ROBINCHAIN</b>`,
    `<b>${result.state === 'WATCH' ? 'WATCH' : 'SETUP FORMING'}</b>`, '',
    ...(m ? [
      ...(Number.isFinite(m.marketCapUsd) && m.marketCapUsd > 0 ? [`MC <b>${usd(m.marketCapUsd)}</b>`] : m.fdvUsd && Number.isFinite(m.fdvUsd) && m.fdvUsd > 0 ? [`FDV <b>${usd(m.fdvUsd)}</b> · MC unverified`] : []),
      `Price <b>${usd(m.priceUsd)}</b> · LP <b>${usd(m.liquidityUsd)}</b>`,
      ...(m.volume5mReported && Number.isFinite(m.volume5mUsd) && m.volume5mUsd>=0 ? [`Vol · 5m <b>${usd(m.volume5mUsd)}</b>`] : []),
      ...(m.volume24hUsd!=null && Number.isFinite(m.volume24hUsd) && m.volume24hUsd>=0 ? [`Vol · 24h <b>${usd(m.volume24hUsd)}</b>`] : []),
      ...(m.trades5mReported && [m.buys5m,m.sells5m].every(v=>Number.isFinite(v)&&v>=0) ? [`Trades · 5m <b>${m.buys5m} buy / ${m.sells5m} sell</b>`] : []),
      ...(Number.isFinite(m.priceChange1h) ? [`Move · 1h <b>${m.priceChange1h! >= 0 ? '+' : ''}${m.priceChange1h!.toFixed(2)}%</b>`] : []), ''] : []),
    '<b>MARKET EVIDENCE</b>',
    ...(result.checks ?? readinessChecks(m,result.at)).map(c=>`${c.state==='MET'?'✅':c.state==='BELOW'?'⚠️':'❔'} ${esc(c.label)} · ${c.state==='MET'?'Met':c.state==='BELOW'?'Below threshold':'Unverified'} <i>(${esc(c.target)})</i>`),
    'Market thresholds are screening rules, not a win probability.', '',
    ...((result.ownership?.devPercent!=null || result.ownership?.top10Percent!=null) ? [
      '<b>OWNERSHIP EVIDENCE</b>',
      ...(result.ownership.devPercent!=null ? [`Creator holding <b>${result.ownership.devPercent.toFixed(2)}%</b>`,
        ...(result.ownership.creator ? [`Creator <code>${esc(result.ownership.creator)}</code>`] : []),
        ...(result.ownership.devObservedAt ? [`Balance observed ${new Date(result.ownership.devObservedAt).toISOString().slice(11,19)} UTC`] : [])] : []),
      ...(result.ownership.top10Percent!=null ? [`Top 10 sample <b>${result.ownership.top10Percent.toFixed(2)}%</b> · ${result.ownership.top10Coverage==='INDEXED_SAMPLE'?'Indexed sample; coverage may be partial':'Provider reported'}`] : []),
      'A creator balance does not include linked wallets or prove that no selling occurred.', '',
    ] : []),
    '<b>RESEARCH NEXT</b>',
    '• Creator selling, complete holder ownership and size-specific execution are not assessed by this market check.',
    'Open Full Intel for available creator and holder evidence.', '',
    '<b>PERSONAL MONITOR</b>', 'Opt in below for price ≤ −15% or liquidity ≤ −20% versus the monitor baseline.',
    'About 2-minute checks · 1-hour expiry · Maximum 3 warning events. Baseline is not your entry price.',
    'Data gaps and pool changes are flagged. Fast dumps can occur between checks.', '',
    `<code>${esc(token)}</code>`,
    `DEXScreener · ${m ? 'Observed ' + new Date(m.timestamp).toISOString().slice(11, 19) + ' UTC' : 'Fresh market unavailable'}`,
    '<i>Market screening only · No entry approval or automatic trade</i>',
  ].join('\n');
}
export function readinessButtons(token: string, marketAvailable = false) {
  return [[{ text: '↻ Retry Readiness', callback_data: `TR_RH_${token}` }, { text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }],
    ...(marketAvailable ? [[{ text: '🔔 Monitor 1h', callback_data: `DM_RH_${token}` }, { text: 'My Monitors', callback_data: 'DM_HOME' }]] : [])];
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
    `Baseline observed ${new Date(row.observedAt ?? row.at).toISOString().slice(11, 19)} UTC · Price ${usd(row.price)} · LP ${usd(row.liquidity)}`,
    `Checked ${new Date().toISOString().slice(11, 19)} UTC`,
    'Reassess your setup. Creator selling and cause of the decline are not established.',
    `<code>${esc(row.token)}</code>`, '<i>Sampled monitoring · No trade placed</i>',
  ].join('\n');
}
