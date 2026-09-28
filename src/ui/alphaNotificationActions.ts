import { assertAlphaActions, type AlphaNotificationAction } from './alphaNotification.js';

export type AlphaMarketActionInput = {
  chartUrl?: string | null;
  tokenUrl: string;
  tradeUrl?: string | null;
  trackCallback?: string | null;
  muteCallback?: string | null;
  copyContractCallback?: string | null;
  walletActivityCallback?: string | null;
  fullIntelCallback?: string | null;
  xUrl?: string | null;
  telegramUrl?: string | null;
};

function safeSocialUrl(value: string | null | undefined, platform: 'x' | 'telegram'): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const allowed = platform === 'x' ? host === 'x.com' || host === 'twitter.com'
      : host === 't.me' || host === 'telegram.me';
    return allowed ? url.toString() : null;
  } catch { return null; }
}

function directChartUrl(input: AlphaMarketActionInput): string | null {
  if (input.chartUrl && /^https:\/\//i.test(input.chartUrl)) return input.chartUrl;
  try {
    const tokenUrl = new URL(input.tokenUrl);
    const host = tokenUrl.hostname.toLowerCase();
    const parts = tokenUrl.pathname.split('/').filter(Boolean);
    const tokenIndex = parts.findIndex(part => part.toLowerCase() === 'token');
    const tokenAddress = tokenIndex >= 0 ? parts[tokenIndex + 1] : null;
    if (host === 'robinhoodchain.blockscout.com' && tokenAddress && /^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
      return `https://dexscreener.com/robinhood/${tokenAddress}`;
    }
  } catch {
    // Explorer remains available even when a chart URL cannot be derived.
  }
  return null;
}

export function extractAutomaticSocials(raw: Record<string, unknown> | null | undefined) {
  const data = raw ?? {}; const urls: unknown[] = [data.xUrl, data.twitterUrl, data.telegramUrl];
  for (const list of [data.socials, (data.market as Record<string, unknown> | undefined)?.socials]) {
    if (Array.isArray(list)) for (const item of list) urls.push(typeof item === 'string' ? item
      : item && typeof item === 'object' ? (item as Record<string, unknown>).url : null);
  }
  let xUrl: string | null = null; let telegramUrl: string | null = null;
  for (const value of urls) { if (typeof value !== 'string') continue;
    xUrl ??= safeSocialUrl(value, 'x'); telegramUrl ??= safeSocialUrl(value, 'telegram'); }
  return { xUrl, telegramUrl };
}

export function buildAlphaMarketActions(input: AlphaMarketActionInput): AlphaNotificationAction[][] {
  const rows: AlphaNotificationAction[][] = [];
  const chartUrl = directChartUrl(input);

  if (chartUrl && chartUrl !== input.tokenUrl) rows.push([{ text: '📊 Chart', url: chartUrl }]);
  if (input.fullIntelCallback) rows.push([{ text: '🧠 Full Intel', callback_data: input.fullIntelCallback }]);
  if (input.trackCallback) rows.push([{ text: '⭐ Track', callback_data: input.trackCallback }]);
  if (input.copyContractCallback) rows.push([{ text: '📋 Copy CA', callback_data: input.copyContractCallback }]);
  if (input.muteCallback) rows.push([{ text: '🔕 Mute', callback_data: input.muteCallback }]);
  if (input.tokenUrl) rows.push([{ text: '🔎 Token', url: input.tokenUrl }]);
  if (input.walletActivityCallback && !input.trackCallback) rows.push([{ text: '🐋 Wallet Activity', callback_data: input.walletActivityCallback }]);
  if (input.tradeUrl) rows.push([{ text: '⚡ Trade', url: input.tradeUrl }]);

  const socialRow: AlphaNotificationAction[] = [];
  const xUrl = safeSocialUrl(input.xUrl, 'x');
  const telegramUrl = safeSocialUrl(input.telegramUrl, 'telegram');
  if (xUrl) socialRow.push({ text: '𝕏 X', url: xUrl });
  if (telegramUrl) socialRow.push({ text: '✈️ Telegram', url: telegramUrl });
  if (socialRow.length) rows.push(socialRow);

  if (!rows.length) rows.push([{ text: '🔎 Token', url: input.tokenUrl }]);
  return assertAlphaActions(rows);
}
