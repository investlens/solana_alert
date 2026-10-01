import { getPonsPublicContext, getCreatorHoldingPercent, getTelegramPreviewType, type TelegramPreviewType } from './ponsPublicContext.js';
import type { PonsLaunch } from './ponsHistoricalLaunchScanner.js';
import { getRobinhoodTokenMetadata, getRobinhoodTokenSocials } from './tokenMetadata.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { scanRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { getDeliverableUsers } from '../../core/delivery.js';
import { getPonsFactoryDeployments } from './ponsContracts.js';
import { getPonsV2CurveState } from './ponsV2CurveQuote.js';
import { resolvePonsV2PreIndexValuation } from './ponsPreIndexValuation.js';

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
  if (value == null || !Number.isFinite(value)) return 'Data unavailable';
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? 'Unverified' : `${value.toFixed(2)}%`;
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
  const parts = url.pathname.split('/').filter(Boolean);
  const first = parts[0] ?? '';
  if (parts.length === 2 && first === 'joinchat' && /^[A-Za-z0-9_-]+$/.test(parts[1])) return 'Telegram invite';
  if (parts.length !== 1) return null;
  if (/^\+[A-Za-z0-9_-]+$/.test(first)) return 'Telegram invite';
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(first)
    || ['share', 'joinchat', 'proxy', 'socks', 'login', 'addstickers', 'addemoji', 'setlanguage', 'addtheme', 'addlist', 'boost', 'invoice', 'giftcode'].includes(first.toLowerCase())) return null;
  return `@${first}`;
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
}): Promise<number | null> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) throw new Error('missing Telegram bot token');
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      chat_id: args.chatId,
      text: args.text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buildSocialMafiaActions(args.tokenAddress, args.launchpad, args.socials) },
    }),
  });
  if (!response.ok) throw new Error(`Telegram ${response.status}`);
  const result = await response.json() as { ok?: boolean; result?: { message_id?: number } };
  if (!result.ok) throw new Error('Telegram delivery rejected');
  return result.result?.message_id ?? null;
}

export function buildSocialMafiaAlertText(args: {
  tokenAddress: string;
  launchpadLabel: string;
  socials: SocialMafiaSocials;
  symbol?: string | null;
  name?: string | null;
  marketCap?: number | null;
  fdv?: number | null;
  devHoldingPercent?: number | null;
  creatorAddress?: string | null;
  telegramType?: TelegramPreviewType;
  valuationSource?: string | null;
}): string {
  const symbol = String(args.symbol ?? '').trim().replace(/^\$+/, '').toUpperCase() || 'Symbol unavailable';
  const name = String(args.name ?? '').trim();
  return [
    '<b>🕶 SOCIAL MAFIA ALERT</b>',
    '',
    `<b>${escapeHtml(symbol)}</b>${name ? ` · ${escapeHtml(name)}` : ''}`,
    `🚀 Launchpad  <b>${escapeHtml(args.launchpadLabel)}</b>`,
    args.marketCap == null && args.fdv != null
      ? `💰 FDV  <b>${escapeHtml(money(args.fdv))}</b>`
      : `💵 Market cap  <b>${escapeHtml(money(args.marketCap))}</b>`,
    ...(args.valuationSource ? [`Valuation source  ${escapeHtml(args.valuationSource)}`] : []),
    `👨‍💻 Dev holding  <b>${escapeHtml(percent(args.devHoldingPercent))}</b>`,
    ...(args.creatorAddress ? [`👤 Creator  <a href="https://robinhoodchain.blockscout.com/address/${encodeURIComponent(args.creatorAddress)}">${escapeHtml(args.creatorAddress.slice(0, 6))}…${escapeHtml(args.creatorAddress.slice(-4))}</a>`] : []),
    '',
    '<b>SOCIAL LINKS</b>',
    `𝕏 X  <a href="${escapeHtml(args.socials.xUrl).replace(/"/g, '&quot;')}">@${escapeHtml(args.socials.xHandle)}</a>`,
    `✈️ TG  <a href="${escapeHtml(args.socials.telegramUrl).replace(/"/g, '&quot;')}">${escapeHtml(args.socials.telegramLabel)}</a> · ${escapeHtml(args.telegramType ?? 'Type unverified')}`,
    '',
    `<a href="https://robinhoodchain.blockscout.com/token/${encodeURIComponent(args.tokenAddress)}">${escapeHtml(args.tokenAddress)}</a>`,
    '',
    '<i>Verified launchpad + X + Telegram links · Social ownership unverified · DYOR</i>',
  ].join('\n');
}

async function processLaunch(item: QueuedLaunch): Promise<void> {
  const { launch, launchpad } = item;
  const token = normalize(launch.token_address);

  // Social Mafia is intentionally launchpad-only. Callers must supply a verified
  // launchpad context; custom/unknown contracts never enter this queue.
  const pons = await getPonsPublicContext(token, launch.factory_address, launch.deployer_address);
  const onchainSocials = await getRobinhoodTokenSocials(token)
    .catch(() => ({ twitter: null, telegram: null, website: null }));
  const rawSocials = { twitter: onchainSocials.twitter || pons?.twitter, telegram: onchainSocials.telegram || pons?.telegram };
  const socials = resolveSocialMafiaSocials(rawSocials);
  if (!socials) {
    console.log('[SocialMafia] skipped; both X and Telegram are required', {
      token,
      launchpad: launchpad.id,
      hasX: Boolean(extractXUsername(rawSocials.twitter)),
    });
    return;
  }

  // Independent on-chain identity and verified valuation; never require a DEX index.
  const partial: {
    market: Awaited<ReturnType<typeof getRobinhoodMarketSnapshot>> | null;
    metadata: Awaited<ReturnType<typeof getRobinhoodTokenMetadata>> | null;
    dev: Awaited<ReturnType<typeof scanRobinhoodDevTokenFlow>> | null;
    curve: Awaited<ReturnType<typeof resolvePonsV2PreIndexValuation>> | null;
  } = { market: null, metadata: null, dev: null, curve: null };
  let creatorHolding: number | null = null;
  let telegramType: TelegramPreviewType = 'Type unverified';
  const supplemental = Promise.all([
    getCreatorHoldingPercent(token, launch.deployer_address).then(value => creatorHolding = value),
    getTelegramPreviewType(socials.telegramUrl).then(value => telegramType = value),
  ]);
  const work = Promise.all([
    getRobinhoodMarketSnapshot(token, { priority: 'HIGH', caller: 'pons_social_mafia', queueWaitTimeoutMs: 750 }).catch(() => null).then(value => partial.market = value),
    getRobinhoodTokenMetadata(token, { signal: AbortSignal.timeout(8_000) }).catch(() => null).then(value => partial.metadata = value),
    scanRobinhoodDevTokenFlow(token, launch.deployer_address).catch(() => null).then(value => partial.dev = value),
    launch.protocol_version.startsWith('v2') && launch.curve_address
      ? getPonsV2CurveState(launch.curve_address).then(state => state.tokenAddress.toLowerCase() === token
        ? resolvePonsV2PreIndexValuation(state) : null).catch(() => null).then(value => partial.curve = value)
      : Promise.resolve(null),
  ]).then(async values => { await supplemental; return values; });
  const render = (values: Awaited<typeof work> | null) => {
    const [market, metadata, dev, curve] = values ?? [partial.market, partial.metadata, partial.dev, partial.curve];
    return buildSocialMafiaAlertText({
      tokenAddress: token, launchpadLabel: launchpad.label, socials,
      symbol: market?.symbol || metadata?.symbol || pons?.symbol, name: market?.name || metadata?.name || pons?.name,
      marketCap: market?.marketCapUsd ?? (curve?.valuationType === 'MARKET_CAP' ? curve.valueUsd : null),
      fdv: market?.fdvUsd ?? (curve?.valuationType === 'FDV' ? curve.valueUsd : pons?.fdvUsd),
      devHoldingPercent: dev && dev.evidenceStatus !== 'UNAVAILABLE' && dev.devHoldingPercent != null ? dev.devHoldingPercent : creatorHolding,
      creatorAddress: launch.deployer_address, telegramType,
      valuationSource: market?.marketCapUsd == null && market?.fdvUsd == null && curve?.valueUsd == null && pons?.fdvUsd != null ? 'PONS snapshot' : null,
    });
  };
  const initial = await boundedSocialMafiaContext(work, 1_500);
  const text = render(initial);

  const chats = await recipients();
  const results = await Promise.allSettled(chats.map(chatId => sendTelegram({
    chatId, text, tokenAddress: token, launchpad, socials,
  })));
  if (initial == null) void boundedSocialMafiaContext(work, 12_000).then(async values => {
    const enriched = render(values);
    if (enriched === text) return;
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
    await Promise.allSettled(results.map(async (result, index) => {
      if (result.status !== 'fulfilled' || result.value == null) return;
      await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
        body: JSON.stringify({ chat_id: chats[index], message_id: result.value, text: enriched, parse_mode: 'HTML',
          disable_web_page_preview: true, reply_markup: { inline_keyboard: buildSocialMafiaActions(token, launchpad, socials) } }),
      });
    }));
  }).catch(error => console.warn('[SocialMafia] late enrichment unavailable', String(error)));
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
  if (!token || !isVerifiedSocialMafiaLaunch(launch, launchpadId)) return;
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

export function isVerifiedSocialMafiaLaunch(launch: PonsLaunch, launchpadId: string): boolean {
  // PONS is the only currently integrated verified Robinchain launchpad.
  // Labels alone must never admit CUSTOM/UNKNOWN contracts to this side lane.
  return launchpadId.trim().toUpperCase() === 'PONS'
    && launch.chain === 'robinhood' && launch.protocol === 'pons'
    && getPonsFactoryDeployments().some(factory => factory.enabled
      && factory.id === launch.protocol_version
      && normalize(factory.address) === normalize(launch.factory_address));
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

export function buildSocialMafiaActions(token: string, launchpad: VerifiedLaunchpadContext, socials: SocialMafiaSocials) {
  return [
    [{ text: '🚀 PONS', url: launchpad.tokenUrl(token) }, { text: '📋 Copy CA', callback_data: `COPY_CA_${token}` }],
    [{ text: '𝕏 X', url: socials.xUrl }, { text: '✈️ TG', url: socials.telegramUrl }],
  ];
}

async function boundedSocialMafiaContext<T>(work: Promise<T>, milliseconds: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), milliseconds);
    work.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
}
