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

// Keep normal opportunity alerts deliberately small. Deep links, socials, CA copy and
// mute controls belong inside Full Intel rather than competing with the decision.
export function buildAlphaMarketActions(input: AlphaMarketActionInput): AlphaNotificationAction[][] {
  const rows: AlphaNotificationAction[][] = [];
  const primary: AlphaNotificationAction[] = [];
  if (input.fullIntelCallback) primary.push({ text: '🔬 Full Intel', callback_data: input.fullIntelCallback });
  if (input.chartUrl && input.chartUrl !== input.tokenUrl) primary.push({ text: '📊 Chart', url: input.chartUrl });
  if (!primary.length) primary.push({ text: '🔎 Token', url: input.tokenUrl });
  rows.push(primary.slice(0, 2));

  const decision: AlphaNotificationAction[] = [];
  if (input.trackCallback) decision.push({ text: '⭐ Track', callback_data: input.trackCallback });
  if (input.tradeUrl) decision.push({ text: '⚡ Trade', url: input.tradeUrl });
  if (input.walletActivityCallback && !input.trackCallback) decision.push({ text: '🐋 Wallet Activity', callback_data: input.walletActivityCallback });
  if (decision.length) rows.push(decision.slice(0, 2));

  return assertAlphaActions(rows);
}
