import { escapeTelegramHtml } from './escapeHtml.js';

export type XMentionMarketContext = {
  marketCap?: number | null;
  fdv?: number | null;
  liquidity?: number | null;
  volume5m?: number | null;
  pairAge?: string | null;
};

const compactUsd = (value: number) => `$${value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}M`
  : value >= 1_000 ? `${(value / 1_000).toFixed(1)}K` : value.toFixed(0)}`;

export function safeXPostUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.protocol === 'https:' && (host === 'x.com' || host === 'twitter.com') && /\/status\/\d+/.test(url.pathname)
      ? url.toString() : null;
  } catch { return null; }
}

export function boundedXPostExcerpt(value: string, maxLength = 280): string {
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return clean.length <= maxLength ? clean : `${clean.slice(0, maxLength - 1).trimEnd()}…`;
}

export function renderXMentionNotification(args: {
  handle: string;
  displayName?: string | null;
  accountTier: 'HIGH_ALPHA' | 'REPUTED' | 'WATCH';
  postExcerpt: string;
  tokenAddress: string;
  tokenSymbol?: string | null;
  tokenName?: string | null;
  matchMethod: 'EXACT_CA' | 'TOKEN_LINK_RESOLVED';
  market?: XMentionMarketContext | null;
}): string {
  const token = args.tokenName?.trim() || args.tokenSymbol?.trim() || 'Robinhood token';
  const tier = args.accountTier === 'HIGH_ALPHA' ? 'High Alpha Watchlist' : args.accountTier === 'REPUTED'
    ? 'Reputed Account' : 'Watch Account';
  const address = args.tokenAddress;
  const compactAddress = `${address.slice(0, 6)}…${address.slice(-4)}`;
  const lines = [
    '🐦 <b>REPUTED X MENTION</b>', '', `<b>${escapeTelegramHtml(token)}</b>`, '',
    `👤 @${escapeTelegramHtml(args.handle)}`,
    `⭐ ${escapeTelegramHtml(tier)}`, '',
    escapeTelegramHtml(boundedXPostExcerpt(args.postExcerpt)), '',
    `🪙 CA: <code>${escapeTelegramHtml(compactAddress)}</code>`,
    `✅ Robinhood Contract Matched${args.matchMethod === 'TOKEN_LINK_RESOLVED' ? ' via verified token link' : ''}`,
  ];
  const market = args.market;
  if (market?.marketCap != null && Number.isFinite(market.marketCap) && market.marketCap > 0) {
    lines.push('', `💵 Market Cap: <b>${compactUsd(market.marketCap)}</b>`);
  } else if (market?.fdv != null && Number.isFinite(market.fdv) && market.fdv > 0) {
    lines.push('', `💵 FDV: <b>${compactUsd(market.fdv)}</b>`);
  }
  if (market?.liquidity != null && Number.isFinite(market.liquidity) && market.liquidity > 0) {
    lines.push(`💧 Liquidity: <b>${compactUsd(market.liquidity)}</b>`);
  }
  if (market?.volume5m != null && Number.isFinite(market.volume5m) && market.volume5m > 0) {
    lines.push(`📊 5m Volume: <b>${compactUsd(market.volume5m)}</b>`);
  }
  if (market?.pairAge) lines.push(`⏱ Pair Age: <b>${escapeTelegramHtml(market.pairAge)}</b>`);
  lines.push('', '<i>Informational only — no entry or trade action is implied.</i>');
  return lines.join('\n');
}

function safeHttps(value: string | null | undefined, hosts: string[]): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    return url.protocol === 'https:' && hosts.includes(host) ? url.toString() : null;
  } catch { return null; }
}

export function xMentionButtons(args: {
  postUrl: string;
  chartUrl?: string | null;
  tokenAddress: string;
  trackCallback?: string | null;
}) {
  const rows: Array<Array<{ text: string; url?: string; callback_data?: string }>> = [];
  const post = safeXPostUrl(args.postUrl);
  const chart = safeHttps(args.chartUrl, ['dexscreener.com']);
  if (post || chart) rows.push([
    ...(post ? [{ text: '🐦 View Post', url: post }] : []),
    ...(chart ? [{ text: '📊 Chart', url: chart }] : []),
  ]);
  rows.push([
    { text: '🔬 Full Intel', callback_data: `FI_RH_${args.tokenAddress}` },
    { text: '📋 Copy CA', callback_data: `COPY_CA_${args.tokenAddress}` },
  ]);
  if (args.trackCallback && Buffer.byteLength(args.trackCallback, 'utf8') <= 64) {
    rows.push([{ text: '⭐ Track', callback_data: args.trackCallback }]);
  }
  return rows;
}
