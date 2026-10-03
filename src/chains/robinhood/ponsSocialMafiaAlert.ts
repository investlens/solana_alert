import { getSharedJson, setSharedJson, claimSharedDelivery } from '../../services/sharedJsonCache.js';
import { waitForRecipientDelivery, recordDeliveryAccepted } from '../../services/recipientDeliveryTiming.js';
import { recordCompactAlert } from '../../services/compactAlertOutcomes.js';
import { recordLaunchSocialEligibility } from './alertEligibilityState.js';
import { buildAlphaosAlertCard } from '../../ui/alphaosAlertCard.js';
import { sendAlphaosPhotoAlert, alphaosEnrichmentEdit, type AlphaosDelivery } from '../../ui/alphaosPhotoDelivery.js';
import { verifySocialContract, socialEvidenceEligibility } from './socialContractConfirmation.js';
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
// Waiting records contain launch references only, never images or fetched HTML.
// The existing 500-identity ceiling bounds memory; screening concurrency stays separate.
const MAX_QUEUE = Math.max(10, Math.min(500, Number(process.env.PONS_SOCIAL_MAFIA_MAX_QUEUE ?? 500)));
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

type QueuedLaunch = { launch: PonsLaunch; launchpad: VerifiedLaunchpadContext; createdAt: number; nextAt: number; attempt: number; eligibility?: boolean | null };
const SCREEN_INTERVAL_MS = 15 * 60_000;
const SCREEN_LIFETIME_MS = 60 * 60_000;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
const queue: QueuedLaunch[] = [];
const processing = new Map<string, QueuedLaunch>();
const seen = new Map<string, number>();
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
  chatId: string; text: string; tokenAddress: string; launchpad: VerifiedLaunchpadContext;
  socials: SocialMafiaSocials; image: Buffer | null;
}): Promise<AlphaosDelivery> {
  const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
  if (!botToken) throw new Error('missing Telegram bot token');
  return sendAlphaosPhotoAlert({ botToken, chatId: args.chatId, text: args.text, image: args.image,
    keyboard: buildSocialMafiaActions(args.tokenAddress, args.launchpad, args.socials) });
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
  socialContractConfirmed?: boolean;
}): string {
  const symbol = String(args.symbol ?? '').trim().replace(/^\$+/, '').toUpperCase().slice(0, 24) || 'Symbol unavailable';
  const name = String(args.name ?? '').trim().slice(0, 64);
  return [
    '<b>🕶 SOCIAL MAFIA ALERT</b>',
    '',
    `<b>${escapeHtml(symbol)}</b>${name ? ` · ${escapeHtml(name)}` : ''}`,
    `🚀 Launchpad  <b>${escapeHtml(args.launchpadLabel.slice(0, 16))}</b>`,
    '',
    '<b>📊 TOKEN STATS</b>',
    args.marketCap == null && args.fdv != null
      ? `💰 FDV  <b>${escapeHtml(money(args.fdv))}</b>`
      : `💵 Market cap  <b>${escapeHtml(money(args.marketCap))}</b>`,
    ...(args.valuationSource ? [`Valuation source  ${escapeHtml(args.valuationSource)}`] : []),
    `👨‍💻 Dev holding  <b>${escapeHtml(percent(args.devHoldingPercent))}</b>`,
    ...(args.creatorAddress ? [`👤 Creator  <a href="https://robinhoodchain.blockscout.com/address/${encodeURIComponent(args.creatorAddress)}">${escapeHtml(args.creatorAddress.slice(0, 6))}…${escapeHtml(args.creatorAddress.slice(-4))}</a>`] : []),
    '',
    '<b>SOCIAL LINKS</b>',
    ...(args.socialContractConfirmed ? ['✓ CA listed on X · Robinchain'] : []),
    `𝕏 X  <a href="${escapeHtml(args.socials.xUrl).replace(/"/g, '&quot;')}">@${escapeHtml(args.socials.xHandle)}</a>`,
    `✈️ TG  <a href="${escapeHtml(args.socials.telegramUrl).replace(/"/g, '&quot;')}">${escapeHtml(args.socials.telegramLabel)}</a> · ${escapeHtml(args.telegramType ?? 'Type unverified')}`,
    '',
    '<b>CONTRACT</b>',
    `<a href="https://robinhoodchain.blockscout.com/token/${encodeURIComponent(args.tokenAddress)}">${escapeHtml(args.tokenAddress)}</a>`,
    '',
    '<i>Verified launchpad + X + Telegram links · Social ownership unverified · DYOR</i>',
  ].join('\n');
}

export function protocolDiscoveryRoute(name: string | null | undefined, confirmed: boolean): 'SOCIAL_MAFIA' | 'PROTOCOL_DISCOVERY' | null {
  if (confirmed) return 'SOCIAL_MAFIA';
  return /\bprotocols?\b/i.test(name ?? '') ? 'PROTOCOL_DISCOVERY' : null;
}

export function buildProtocolDiscoveryAlertText(args: {
  token: string; name?: string | null; symbol?: string | null; socials: SocialMafiaSocials;
  marketCap?: number | null; fdv?: number | null; price?: number | null;
  liquidity?: number | null; volume5m?: number | null; holding?: number | null;
  creator: string; ageMinutes: number; checkedAt: string;
}): string {
  const positive = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0;
  return [
    '<b>🔎 PROTOCOL DISCOVERY</b>',
    `<b>${escapeHtml(args.name || 'Protocol project')}</b>${args.symbol ? ` ($${escapeHtml(args.symbol)})` : ''}`,
    'PONS · Robinchain · Verified launchpad origin', '', '<b>MARKET SNAPSHOT</b>',
    ...(positive(args.price) ? [`Price  <b>$${args.price.toPrecision(5)}</b>`] : []),
    ...(positive(args.marketCap) ? [`MC  <b>${money(args.marketCap)}</b>`] : positive(args.fdv) ? [`FDV  <b>${money(args.fdv)}</b>`] : []),
    ...(positive(args.liquidity) ? [`Liquidity  <b>${money(args.liquidity)}</b>`] : []),
    ...(args.volume5m != null && Number.isFinite(args.volume5m) && args.volume5m >= 0 ? [`Volume · 5m  <b>${money(args.volume5m)}</b>`] : []),
    `Launch age  <b>${Math.max(0, Math.floor(args.ageMinutes))}m</b>`,
    ...(args.holding != null && Number.isFinite(args.holding) && args.holding >= 0 && args.holding <= 100 ? [`Creator holding  <b>${percent(args.holding)}</b>`] : []),
    `Creator  <a href="https://robinhoodchain.blockscout.com/address/${encodeURIComponent(args.creator)}">${escapeHtml(args.creator.slice(0, 6))}…${escapeHtml(args.creator.slice(-4))}</a>`,
    '', '<b>SOCIAL LINKS</b>',
    `<a href="${escapeHtml(args.socials.xUrl).replace(/"/g, '&quot;')}">X</a> · <a href="${escapeHtml(args.socials.telegramUrl).replace(/"/g, '&quot;')}">Telegram</a>`,
    '', `<code>${escapeHtml(args.token)}</code>`,
    `<i>Protocol-name discovery · Social ownership unverified · Research only.</i>`,
    `Checked ${escapeHtml(args.checkedAt)} · Available PONS / indexed market data`,
  ].join('\n');
}

async function processLaunch(item: QueuedLaunch): Promise<boolean> {
  const { launch, launchpad } = item;
  const token = normalize(launch.token_address);

  // Social Mafia is intentionally launchpad-only. Callers must supply a verified
  // launchpad context; custom/unknown contracts never enter this queue.
  const pons = await getPonsPublicContext(token, launch.factory_address, launch.deployer_address);
  let socialsReadFailed = false;
  const onchainSocials = await getRobinhoodTokenSocials(token, { refresh: true })
    .catch(() => { socialsReadFailed = true; return { twitter: null, telegram: null, website: null, readStatus: 'UNAVAILABLE' as const }; });
  const rawSocials = { twitter: pons?.twitter || onchainSocials.twitter, telegram: pons?.telegram || onchainSocials.telegram };
  const socials = resolveSocialMafiaSocials(rawSocials);
  if (!socials) {
    item.eligibility = socialsReadFailed || onchainSocials.readStatus === 'UNAVAILABLE' ? null : false;
    if (item.attempt >= 4 && item.eligibility === false) recordLaunchSocialEligibility(token, false);
    console.log('[SocialMafia] skipped; both X and Telegram are required', {
      token,
      launchpad: launchpad.id,
      hasX: Boolean(extractXUsername(rawSocials.twitter)),
    });
    return false;
  }

  const earlyMetadata = !pons?.name ? await getRobinhoodTokenMetadata(token, { signal: AbortSignal.timeout(8_000) }).catch(() => null) : null;
  // Protocol discovery explicitly does not claim social identity. Avoid spending
  // scarce public-X requests on a feed whose rules only require metadata links.
  const protocol = protocolDiscoveryRoute(pons?.name || earlyMetadata?.name, false) === 'PROTOCOL_DISCOVERY';
  const identity = protocol ? null
    : await verifySocialContract({ token, xHandle: socials.xHandle, telegramUrl: socials.telegramUrl });
  item.eligibility = identity ? socialEvidenceEligibility(identity) : null;
  const route = protocol ? 'PROTOCOL_DISCOVERY' : protocolDiscoveryRoute(pons?.name || earlyMetadata?.name, identity?.confirmed === true);
  if (!route) {
    if (item.attempt >= 4 && item.eligibility === false) recordLaunchSocialEligibility(token, false);
    console.log('[SocialMafia] suppressed; social contract not confirmed', { token, reason: identity?.reason ?? 'PROTOCOL_SOCIAL_OWNERSHIP_UNVERIFIED' });
    return false;
  }

  if (!protocol) recordLaunchSocialEligibility(token, identity?.confirmed === true);

  // Independent on-chain identity and verified valuation; never require a DEX index.
  const partial: {
    market: Awaited<ReturnType<typeof getRobinhoodMarketSnapshot>> | null;
    metadata: Awaited<ReturnType<typeof getRobinhoodTokenMetadata>> | null;
    dev: Awaited<ReturnType<typeof scanRobinhoodDevTokenFlow>> | null;
    curveRatio: number | null;
    curve: Awaited<ReturnType<typeof resolvePonsV2PreIndexValuation>> | null;
  } = { market: null, metadata: earlyMetadata, dev: null, curve: null, curveRatio: null };
  let creatorHolding: number | null = null;
  let telegramType: TelegramPreviewType = 'Type unverified';
  const supplemental = Promise.all([
    getCreatorHoldingPercent(token, launch.deployer_address).then(value => creatorHolding = value),
    getTelegramPreviewType(socials.telegramUrl).then(value => telegramType = value),
  ]);
  const work = Promise.all([
    getRobinhoodMarketSnapshot(token, { priority: 'HIGH', caller: 'pons_social_mafia', queueWaitTimeoutMs: 750 }).catch(() => null).then(value => partial.market = value),
    (earlyMetadata ? Promise.resolve(earlyMetadata) : getRobinhoodTokenMetadata(token, { signal: AbortSignal.timeout(8_000) }).catch(() => null)).then(value => partial.metadata = value),
    scanRobinhoodDevTokenFlow(token, launch.deployer_address).catch(() => null).then(value => partial.dev = value),
    launch.protocol_version.startsWith('v2') && launch.curve_address
      ? getPonsV2CurveState(launch.curve_address).then(state => {
        if (state.tokenAddress.toLowerCase() !== token) return null;
        if (state.nativeQuote && state.quoteReserve > 0n && state.tokenReserve > 0n) partial.curveRatio = Number(state.quoteReserve) / Number(state.tokenReserve);
        return resolvePonsV2PreIndexValuation(state);
      }).catch(() => null).then(value => partial.curve = value)
      : Promise.resolve(null),
  ]).then(async values => { await supplemental; return values; });
  const render = (values: Awaited<typeof work> | null) => {
    const [market, metadata, dev, curve] = values ?? [partial.market, partial.metadata, partial.dev, partial.curve];
    const positive = (v: number | null | undefined) => v != null && Number.isFinite(v) && v > 0 ? v : null;
    if (route === 'PROTOCOL_DISCOVERY') return buildProtocolDiscoveryAlertText({
      token, name: pons?.name || metadata?.name, symbol: market?.symbol || metadata?.symbol || pons?.symbol,
      socials, creator: launch.deployer_address, ageMinutes: (Date.now() - item.createdAt) / 60_000,
      checkedAt: new Date().toISOString().slice(11, 19) + ' UTC', price: market?.priceUsd,
      marketCap: positive(market?.marketCapUsd) ?? (curve?.valuationType === 'MARKET_CAP' ? curve.valueUsd : null),
      fdv: positive(market?.fdvUsd) ?? (curve?.valuationType === 'FDV' ? curve.valueUsd : pons?.fdvUsd),
      liquidity: market?.liquidityUsd, volume5m: market?.volume5mUsd,
      holding: dev && dev.evidenceStatus !== 'UNAVAILABLE' ? dev.devHoldingPercent : creatorHolding,
    });
    return buildSocialMafiaAlertText({
      tokenAddress: token, launchpadLabel: launchpad.label, socials,
      symbol: market?.symbol || metadata?.symbol || pons?.symbol, name: market?.name || metadata?.name || pons?.name,
      marketCap: positive(market?.marketCapUsd) ?? (curve?.valuationType === 'MARKET_CAP' ? curve.valueUsd : null),
      fdv: positive(market?.fdvUsd) ?? (curve?.valuationType === 'FDV' ? curve.valueUsd : pons?.fdvUsd),
      devHoldingPercent: dev && dev.evidenceStatus !== 'UNAVAILABLE' && dev.devHoldingPercent != null ? dev.devHoldingPercent : creatorHolding,
      creatorAddress: launch.deployer_address, telegramType, socialContractConfirmed: true,
      valuationSource: positive(market?.marketCapUsd) == null && positive(market?.fdvUsd) == null && curve?.valueUsd == null && pons?.fdvUsd != null ? 'PONS snapshot' : null,
    });
  };
  const initial = await boundedSocialMafiaContext(work, 1_500);
  const text = render(initial);

  const deliveryClaim = await claimSharedDelivery(`alphaos:social:delivered:${token}`, 24 * 60 * 60_000);
  if (deliveryClaim === 'EXISTS') return true;
  if (deliveryClaim !== 'CLAIMED') return false;

  // Render once per eligible token, reuse the in-memory buffer across recipients.
  const image = await buildAlphaosAlertCard({ symbol: partial.metadata?.symbol || pons?.symbol,
    name: partial.metadata?.name || pons?.name, logo: pons?.logo,
    ...(route === 'PROTOCOL_DISCOVERY' ? { category: 'PROTOCOL DISCOVERY', badge: 'SOCIAL OWNERSHIP UNVERIFIED', footer: 'Protocol-name discovery. Research only; no safety or trade endorsement.' } : {}) }).catch(() => {
      console.warn('[AlphaosCard] rendering unavailable; using text alert'); return null;
    });
  const chats = await recipients();
  const baseline = partial.market?.priceUsd && partial.market?.pairAddress
    ? {price:partial.market.priceUsd, pair:partial.market.pairAddress, unit:'USD' as const, marketCap:partial.market.marketCapUsd, liquidity:partial.market.liquidityUsd}
    : {price:partial.curveRatio, pair:launch.curve_address, unit:'ETH_RESERVE_RATIO' as const};
  const deliveryStartedAt = Date.now();
  const results = await Promise.allSettled(chats.map(async chatId => {
    await waitForRecipientDelivery(chatId, deliveryStartedAt);
    const accepted = await sendTelegram({chatId, text, tokenAddress: token, launchpad, socials, image});
    recordDeliveryAccepted(chatId, deliveryStartedAt, `pons:social:${token}`);
    return accepted;
  }));
  if (initial == null) void boundedSocialMafiaContext(work, 12_000).then(async values => {
    const enriched = render(values);
    if (enriched === text) return;
    const botToken = String(process.env.TELEGRAM_BOT_TOKEN ?? '').trim();
    await Promise.allSettled(results.map(async (result, index) => {
      if (result.status !== 'fulfilled' || result.value == null) return;
      const edit = alphaosEnrichmentEdit(result.value, chats[index], enriched, buildSocialMafiaActions(token, launchpad, socials));
      await fetch(`https://api.telegram.org/bot${botToken}/${edit.method}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5_000),
        body: JSON.stringify(edit.body),
      });
    }));
  }).catch(error => console.warn('[SocialMafia] late enrichment unavailable', String(error)));
  const delivered = results.filter(result => result.status === 'fulfilled' && result.value != null).length;
  void recordCompactAlert({chain:'robinhood', token, feed:route, ...baseline, creator:launch.deployer_address, creatorSource:'PONS_FACTORY_EVENT'}, delivered);
  const failed = results.length - delivered;
  const admin = String(process.env.ADMIN_TELEGRAM_ID ?? process.env.OWNER_CHAT_ID ?? '').trim();
  const adminResult = results[chats.indexOf(admin)];
  const adminDelivery = adminResult?.status === 'fulfilled' ? adminResult.value : null;
  console.log('[SocialMafia] ALERT_RESULT', {
    token, feed: route, launchpad: launchpad.id, xHandle: socials.xHandle,
    telegram: socials.telegramLabel, delivered, failed,
    adminAccepted: adminDelivery != null, adminMessageId: adminDelivery?.messageId ?? null,
  });
  // Never replay ambiguous Telegram sends to recipients who may have received it.
  return true;
}

function finishSocialScreen(item: QueuedLaunch): void {
  if (item.eligibility === false) recordLaunchSocialEligibility(normalize(item.launch.token_address), false);
  console.log('[SocialMafia] SCREEN_EXPIRED', { token: normalize(item.launch.token_address),
    state: item.eligibility === false ? 'NOT_CONFIRMED' : 'VERIFICATION_UNAVAILABLE' });
}

function prune(now: number): void {
  for (const [identity, expires] of seen) if (now > expires) seen.delete(identity);
  for (let i = queue.length - 1; i >= 0; i--) if (now > queue[i].createdAt + SCREEN_LIFETIME_MS + 30_000) {
    finishSocialScreen(queue[i]);
    queue.splice(i, 1);
  }
}

function drain(): void {
  if (wakeTimer) { clearTimeout(wakeTimer); wakeTimer = null; }
  const now = Date.now();
  prune(now);
  queue.sort((a, b) => a.nextAt - b.nextAt);
  while (active < MAX_CONCURRENT && queue.length > 0 && queue[0].nextAt <= now) {
    const item = queue.shift()!;
    // Skip missed intervals rather than issuing a burst of catch-up requests.
    item.attempt = Math.min(4, Math.max(item.attempt + 1, Math.floor((now - item.createdAt) / SCREEN_INTERVAL_MS)));
    active += 1;
    processing.set(item.launch.token_address.toLowerCase(), item);
    void processLaunch(item)
      .catch(error => {
        item.eligibility = null;
        console.warn('[SocialMafia] screening failed', { token: normalize(item.launch.token_address),
          reason: error instanceof Error ? error.message : String(error) });
        return false;
      })
      .then(done => {
        if (!done && item.attempt < 4 && Date.now() < item.createdAt + SCREEN_LIFETIME_MS) {
          item.nextAt = item.createdAt + (item.attempt + 1) * SCREEN_INTERVAL_MS;
          if (queue.length < MAX_QUEUE) queue.push(item);
        } else if (!done) finishSocialScreen(item);
      })
      .finally(() => { processing.delete(item.launch.token_address.toLowerCase()); active -= 1; drain(); });
  }
  if (queue.length > 0 && active < MAX_CONCURRENT) {
    wakeTimer = setTimeout(drain, Math.max(1, queue[0].nextAt - Date.now()));
    wakeTimer.unref();
  } else if (seen.size > 0 && queue.length === 0 && active === 0) {
    wakeTimer = setTimeout(drain, 30_000); wakeTimer.unref();
  }
}

export function queueVerifiedLaunchpadSocialMafiaScreen(launch: PonsLaunch, launchpad: VerifiedLaunchpadContext): void {
  if (!enabled()) return;
  const now = Date.now(); prune(now);
  const token = normalize(launch.token_address);
  const launchpadId = String(launchpad.id ?? '').trim().toUpperCase();
  const createdAt = Date.parse(launch.block_timestamp);
  if (!/^0x[a-f0-9]{40}$/.test(token) || !isVerifiedSocialMafiaLaunch(launch, launchpadId)
    || !Number.isFinite(createdAt) || createdAt > now || now > createdAt + SCREEN_LIFETIME_MS) return;
  const identity = `${launchpadId}:${token}`;
  if (seen.has(identity)) return;
  // Reject excess admissions, preserving once-per-token protection for admitted candidates.
  if (queue.length + active >= MAX_QUEUE || seen.size >= 500) {
    console.warn('[SocialMafia] admission capacity reached', { queueDepth: queue.length }); return;
  }
  seen.set(identity, createdAt + SCREEN_LIFETIME_MS + 30_000);
  queue.push({ launch, launchpad, createdAt, nextAt: Math.max(now, createdAt + SCREEN_INTERVAL_MS), attempt: 0 });
  console.log('[SocialMafia] SCHEDULED', { token, firstCheckMinutes: 15, expiresMinutes: 60 });
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

export function socialMafiaScreeningStatus() {
  return { waiting: queue.length, active, capacity: MAX_QUEUE, identityCount: seen.size, concurrency: MAX_CONCURRENT };
}

export function drainPonsSocialMafiaForTests(): void { drain(); }

export function resetPonsSocialMafiaForTests(): void {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  queue.length = 0;
  seen.clear();
  recipientCache.clear();
  recipientCacheAt = 0;
  active = 0;
}

export function buildSocialMafiaActions(token: string, launchpad: VerifiedLaunchpadContext, socials: SocialMafiaSocials) {
  return [
    [{ text: '🚀 PONS', url: launchpad.tokenUrl(token) }, { text: '🧠 Full Intel', callback_data: `FI_RH_${token}` }],
    [{ text: '⭐ Track', callback_data: `BOOST_TRACK_${token}` }, { text: '📋 Copy CA', callback_data: `COPY_CA_${token}` }],
    [{ text: '𝕏 X', url: socials.xUrl }, { text: '✈️ TG', url: socials.telegramUrl }],
  ];
}

async function boundedSocialMafiaContext<T>(work: Promise<T>, milliseconds: number): Promise<T | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), milliseconds);
    work.then(value => { clearTimeout(timer); resolve(value); }, () => { clearTimeout(timer); resolve(null); });
  });
}

export async function saveSocialWatchCheckpoint(): Promise<void> {
  const items = [...queue, ...processing.values()].filter(item => item.launchpad.id === 'PONS')
    .slice(0, MAX_QUEUE).map(({ launch, createdAt, nextAt, attempt, eligibility }) => ({ launch, createdAt, nextAt, attempt, eligibility }));
  await setSharedJson('alphaos:watch:social:v1', items, new Date().toISOString(), SCREEN_LIFETIME_MS);
}
export async function restoreSocialWatchCheckpoint(load = () => getSharedJson<Array<Omit<QueuedLaunch, 'launchpad'>>>('alphaos:watch:social:v1')): Promise<void> {
  if (!enabled()) return;
  const saved = await load();
  if (!Array.isArray(saved?.value)) return;
  let restored = 0;
  for (const item of saved.value.slice(0, MAX_QUEUE)) {
    if (!item?.launch || !/^0x[a-fA-F0-9]{40}$/.test(item.launch.token_address) || !isVerifiedSocialMafiaLaunch(item.launch, 'PONS') || queue.length + active >= MAX_QUEUE) continue;
    const createdAt = Date.parse(item.launch.block_timestamp);
    if (!Number.isFinite(createdAt) || createdAt > Date.now() || Date.now() >= createdAt + SCREEN_LIFETIME_MS) continue;
    const identity = `PONS:${normalize(item.launch.token_address)}`;
    if (seen.has(identity)) continue;
    seen.set(identity, createdAt + SCREEN_LIFETIME_MS + 30_000);
    queue.push({ launch: item.launch, launchpad: PONS_LAUNCHPAD, createdAt,
      nextAt: Math.max(Date.now(), Number.isFinite(item.nextAt) ? item.nextAt : createdAt + SCREEN_INTERVAL_MS),
      attempt: Number.isInteger(item.attempt) ? Math.max(0, Math.min(4, item.attempt)) : 0 });
    restored++;
  }
  console.log(`[SocialMafia] RECOVERED waiting=${restored} dbWrites=0`);
  drain();
}
