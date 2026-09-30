import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { getRobinhoodTokenSocials } from './tokenMetadata.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { getDeliverableUsers } from '../../core/delivery.js';

const MAX_CONCURRENT = Math.max(1, Math.min(3, Number(process.env.PONS_SOCIAL_MAFIA_CONCURRENCY ?? 1)));
const MAX_QUEUE = Math.max(10, Math.min(250, Number(process.env.PONS_SOCIAL_MAFIA_MAX_QUEUE ?? 80)));
const RECIPIENT_CACHE_MS = 5 * 60_000;
const enabled = () => String(process.env.PONS_SOCIAL_MAFIA_ENABLED ?? 'true').toLowerCase() === 'true';

export type VerifiedLaunchpadContext = {
  id: string;
  label: string;
  tokenUrl(tokenAddress: string): string;
};

export type SocialMafiaSocials = {
  xUrl: string;
  xHandle: string;
  telegramUrl: string;
  telegramLabel: string;
};

type QueuedLaunch = { launch: PonsLaunch; launchpad: VerifiedLaunchpadContext };
const queue: QueuedLaunch[] = [];
const seen = new Set<string>();
let active = 0;
let recipientCacheAt = 0;
let recipientCache = new Set<string>();

const PONS_LAUNCHPAD: VerifiedLaunchpadContext = {
  id: 'PONS',
  label: 'PONS',
  tokenUrl: tokenAddress => `https://www.ponsfamily.com/launchpad/${encodeURIComponent(tokenAddress)}`,
};

function normalize(value: string): string { return value.trim().toLowerCase(); }
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'Pending index';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : `${value.toFixed(2)}%`;
}

function parsedHttpUrl(value: string | null | undefined): URL | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch { return null; }
}

export function extractXUsername(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim();
  if (/^@[A-Za-z0-9_]{1,15}$/.test(raw)) return raw.slice(1);
  const url = parsedHttpUrl(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['x.com', 'twitter.com'].includes(host)) return null;
  const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!/^[A-Za-z0-9_]{1,15}$/.test(first)) return null;
  if (['i', 'intent', 'share', 'home', 'search'].includes(first.toLowerCase())) return null;
  return first;
}

export function extractTelegramLabel(value: string | null | undefined): string | null {
  const url = parsedHttpUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!['t.me', 'telegram.me', 'telegram.dog'].includes(host)) return null;
  const first = url.pathname.split('/').filter(Boolean)[0] ?? '';
  if (!first || first === 'share' || first === 'joinchat') return null;
  return first.startsWith('+') ? 'Telegram invite' : `@${first}`;
}

export function resolveSocialMafiaSocials(args: {
  twitter: string | null | undefined;
  telegram: string | null | undefined;
}): SocialMafiaSocials | null {
  const xHandle = extractXUsername(args.twitter);
  const xParsed = parsedHttpUrl(args.twitter);
  const telegramLabel = extractTelegramLabel(args.telegram);
  const telegramParsed = parsedHttpUrl(args.telegram);
  if (!xHandle || !xParsed || !telegramLabel || !telegramParsed) return null;
  return {
    xUrl: `https://x.com/${encodeURIComponent(xHandle)}`,
    xHandle,
    telegramUrl: telegramParsed.toString(),
    telegramLabel,
  };
}

async function recipients(): Promise<string[]> {
  if (Date.now() - recipientCacheAt < RECIPIENT_CACHE_MS && recipientCache.size > 0) return [...recipientCache];
  const next = new Set<string>();
  const admin = String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '').trim();
  if (admin) next.add(admin);
  try {
    const users = await getDeliverableUsers();
    for (const user of users) {
      const telegramId = String(user.telegram_id ?? '').trim();
      if (telegramId && !user.is_blocked) next.add(telegramId);
    }
  } catch (error) {
    console.warn('[SocialMafia] recipient refresh failed; using last-good/admin recipients', {
      reason: error instanceof Error ? error.message : String(error),
    });
    for (const id of recipientCache) next.add(id);
  }
  if (next.size > 0) {
    recipientCache = next;
    recipientCacheAt = Date.now();
  }
  return [...recipientCache];
}

async function sendTelegram(args: {
  chatId: string;
  text: string;
  tokenAddress: string;
  launchpad: VerifiedLaunchpadContext;
  socials: SocialMafiaSocials;
}): Promise<void> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) throw new Error('missing Telegram bot token');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: args.chatId,
      text: args.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: [
        [
          { text: `🚀 ${args.launchpad.label}`, url: args.launchpad.tokenUrl(args.tokenAddress) },
          { text: '𝕏 X', url: args.socials.xUrl },
          { text: '✈️ Telegram', url: args.socials.telegramUrl },
        ],
        [
          { text: '🔎 Explorer', url: `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(args.tokenAddress)}` },
          { text: '📋 Copy CA', callback_data: `COPY_CA_${args.tokenAddress}` },
        ],
      ] },
    }),
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}`);
}

export function buildSocialMafiaAlertText(args: {
  tokenAddress: string;
  launchpadLabel: string;
  socials: SocialMafiaSocials;
  symbol?: string | null;
  name?: string | null;
  marketCap?: number | null;
  devHoldingPercent?: number | null;
}): string {
  const symbol = String(args.symbol ?? '').trim().toUpperCase() || 'TOKEN';
  const name = String(args.name ?? '').trim();
  return [
    '<b>🕶 SOCIAL MAFIA ALERT</b>',
    '',
    `<b>${escapeHtml(symbol)}</b>${name ? ` · ${escapeHtml(name)}` : ''}`,
    `🚀 Launchpad  <b>${escapeHtml(args.launchpadLabel)}</b>`,
    `💵 Market cap  <b>${escapeHtml(money(args.marketCap))}</b>`,
    `👨‍💻 Dev holding  <b>${escapeHtml(percent(args.devHoldingPercent))}</b>`,
    '',
    '<b>COMMUNITY</b>',
    `𝕏 X  <b>@${escapeHtml(args.socials.xHandle)}</b>`,
    `✈️ Telegram  <b>${escapeHtml(args.socials.telegramLabel)}</b>`,
    '',
    `<code>${escapeHtml(args.tokenAddress)}</code>`,
    '',
    '<i>Verified launchpad + X + Telegram · Information only · DYOR</i>',
  ].join('\n');
}

async function processLaunch(item: QueuedLaunch): Promise<void> {
  const { launch, launchpad } = item;
  const token = normalize(launch.token_address);

  // Social Mafia is intentionally launchpad-only. Callers must supply a verified
  // launchpad context; custom/unknown contracts never enter this queue.
  const rawSocials = await getRobinhoodTokenSocials(token)
    .catch(() => ({ twitter: null, telegram: null, website: null }));
  const socials = resolveSocialMafiaSocials(rawSocials);
  if (!socials) {
    console.log('[SocialMafia] skipped; both X and Telegram are required', {
      token,
      launchpad: launchpad.id,
      hasX: Boolean(extractXUsername(rawSocials.twitter)),
    });
    return;
  }

  // Market/dev context is best-effort enrichment only. It never gates the alert.
  const [market, dev] = await Promise.all([
    getRobinhoodMarketSnapshot(token, { priority: 'HIGH', caller: 'pons_social_mafia', queueWaitTimeoutMs: 750 }).catch(() => null),
    scanRobinhoodDevTokenFlow(token, launch.deployer_address).catch(() => null),
  ]);
  const text = buildSocialMafiaAlertText({
    tokenAddress: token,
    launchpadLabel: launchpad.label,
    socials,
    symbol: market?.symbol ?? null,
    name: market?.name ?? null,
    marketCap: market?.marketCapUsd ?? market?.fdvUsd ?? null,
    devHoldingPercent: dev?.devHoldingPercent ?? null,
  });

  const chats = await recipients();
  const results = await Promise.allSettled(chats.map(chatId => sendTelegram({
    chatId, text, tokenAddress: token, launchpad, socials,
  })));
  const delivered = results.filter(result => result.status === 'fulfilled').length;
  const failed = results.length - delivered;
  console.log('[SocialMafia] ALERT_RESULT', {
    token, launchpad: launchpad.id, xHandle: socials.xHandle,
    telegram: socials.telegramLabel, delivered, failed,
  });
}

function drain(): void {
  while (active < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift()!;
    active += 1;
    void processLaunch(item)
      .catch(error => console.warn('[SocialMafia] screening failed', {
        token: normalize(item.launch.token_address),
        launchpad: item.launchpad.id,
        reason: error instanceof Error ? error.message : String(error),
      }))
      .finally(() => { active -= 1; drain(); });
  }
}

export function queueVerifiedLaunchpadSocialMafiaScreen(
  launch: PonsLaunch,
  launchpad: VerifiedLaunchpadContext,
): void {
  if (!enabled()) return;
  const token = normalize(launch.token_address);
  const launchpadId = String(launchpad.id ?? '').trim().toUpperCase();
  if (!token || !launchpadId) return;
  const identity = `${launchpadId}:${token}`;
  if (seen.has(identity)) return;
  seen.add(identity);
  if (queue.length >= MAX_QUEUE) {
    const dropped = queue.shift();
    if (dropped) seen.delete(`${dropped.launchpad.id.toUpperCase()}:${normalize(dropped.launch.token_address)}`);
    console.warn('[SocialMafia] queue full; oldest candidate dropped', { queueDepth: queue.length, maxQueue: MAX_QUEUE });
  }
  queue.push({ launch, launchpad });
  drain();
}

// Current live verified launchpad feed. Additional launchpads should call the
// generic queue above only after their factory/source provenance is verified.
export function queuePonsSocialMafiaScreen(launch: PonsLaunch): void {
  queueVerifiedLaunchpadSocialMafiaScreen(launch, PONS_LAUNCHPAD);
}

export function resetPonsSocialMafiaForTests(): void {
  queue.length = 0;
  seen.clear();
  recipientCache.clear();
  recipientCacheAt = 0;
  active = 0;
}
