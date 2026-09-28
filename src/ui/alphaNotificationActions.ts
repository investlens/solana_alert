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

// One consistent Telegram action grammar across AlphaOS alerts:
// 1) act on the market, 2) manage the token, 3) inspect/share, 4) optional socials.
export function buildAlphaMarketActions(input: AlphaMarketActionInput): AlphaNotificationAction[][] {
  const rows: AlphaNotificationAction[][] = [];
  const chartUrl = directChartUrl(input);

  const primary: AlphaNotificationAction[] = [];
  if (chartUrl && chartUrl !== input.tokenUrl) primary.push({ text: '📈 Chart', url: chartUrl });
  if (input.fullIntelCallback) primary.push({ text: '🧠 Full Intel', callback_data: input.fullIntelCallback });
  if (primary.length) rows.push(primary.slice(0, 2));

  const manage: AlphaNotificationAction[] = [];
  if (input.trackCallback) manage.push({ text: '⭐ Track', callback_data: input.trackCallback });
  if (input.copyContractCallback) manage.push({ text: '📋 Copy CA', callback_data: input.copyContractCallback });
  if (manage.length) rows.push(manage.slice(0, 2));

  const inspect: AlphaNotificationAction[] = [];
  if (input.tokenUrl) inspect.push({ text: '🔎 Explorer', url: input.tokenUrl });
  if (input.muteCallback) inspect.push({ text: '🔕 Mute', callback_data: input.muteCallback });
  if (inspect.length) rows.push(inspect.slice(0, 2));

  if (input.walletActivityCallback && !input.trackCallback) {
    rows.push([{ text: '🐋 Wallet Activity', callback_data: input.walletActivityCallback }]);
  }

  // Execution stays visually isolated from research/navigation actions.
  if (input.tradeUrl) rows.push([{ text: '⚡ Trade', url: input.tradeUrl }]);

  const socialRow: AlphaNotificationAction[] = [];
  const xUrl = safeSocialUrl(input.xUrl, 'x');
  const telegramUrl = safeSocialUrl(input.telegramUrl, 'telegram');
  if (xUrl) socialRow.push({ text: '𝕏 X', url: xUrl });
  if (telegramUrl) socialRow.push({ text: '✈️ Telegram', url: telegramUrl });
  if (socialRow.length) rows.push(socialRow);

  if (!rows.length) rows.push([{ text: '🔎 Explorer', url: input.tokenUrl }]);
  return assertAlphaActions(rows);
}
