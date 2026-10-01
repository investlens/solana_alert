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

  const primary: AlphaNotificationAction[] = [];
  const destination = chartUrl && chartUrl !== input.tokenUrl ? chartUrl : input.tokenUrl;
  if (destination) primary.push({ text: /ponsfamily\.com/.test(destination) ? '🚀 PONS' : chartUrl ? '📊 Chart' : '🔎 Token', url: destination });
  if (input.fullIntelCallback) primary.push({ text: '🧠 Full Intel', callback_data: input.fullIntelCallback });
  if (primary.length) rows.push(primary);
  const utility: AlphaNotificationAction[] = [];
  if (input.trackCallback) utility.push({ text: '⭐ Track', callback_data: input.trackCallback });
  else if (input.walletActivityCallback) utility.push({ text: '🐋 Wallet', callback_data: input.walletActivityCallback });
  if (input.copyContractCallback) utility.push({ text: '📋 Copy CA', callback_data: input.copyContractCallback });
  if (utility.length) rows.push(utility);
  // Mute lives in tracking/settings; the token destination is already above.
  if (input.tradeUrl) rows.push([{ text: '⚡ Trade', url: input.tradeUrl }]);

  const socialRow: AlphaNotificationAction[] = [];
  const xUrl = safeSocialUrl(input.xUrl, 'x');
  const telegramUrl = safeSocialUrl(input.telegramUrl, 'telegram');
  if (xUrl) socialRow.push({ text: '𝕏 X', url: xUrl });
  if (telegramUrl) socialRow.push({ text: '✈️ TG', url: telegramUrl });
  if (socialRow.length) rows.push(socialRow);

  if (!rows.length) rows.push([{ text: '🔎 Token', url: input.tokenUrl }]);
  return assertAlphaActions(rows);
}
