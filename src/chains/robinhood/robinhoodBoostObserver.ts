import { waitForRecipientDelivery, recordDeliveryAccepted } from '../../services/recipientDeliveryTiming.js';
import { claimBoostDelivery, markBoostDeliveryAccepted } from '../../services/boostDeliveryGuard.js';
import { boostVerificationDue, recordBoostSecurityBlock, type BoostVerificationRetry } from './alertEligibilityState.js';
import { getVerifiedPonsPublicContext, getCreatorHoldingPercent, getTelegramPreviewType } from './ponsPublicContext.js';
import { reuseRobinhoodDevTokenFlow } from './security/devTokenFlowScanner.js';
import { fetchRobinhoodBoosts } from './discovery.js';
import { boostMetadataFallback, resolveBoostMetadata } from './boostMetadataResolver.js';
import { editTelegramMessage, sendTelegramWithMessageId } from '../../services/telegram.js';
import { config } from '../../config.js';
import { getDeliverableUsers } from '../../core/delivery.js';
import { runtimeDeliverableUsers } from '../../services/runtimeSubscriberRegistry.js';
import { isVerifiedPonsLaunch } from './ponsLaunchState.js';
import { getRobinhoodTokenSocials } from './tokenMetadata.js';
import { getRobinhoodMarketSnapshot } from './market.js';
import { observeBoostCanonicalEvent, boostCanonicalTitle } from './boostCanonicalEvent.js';
import { routeBoostSecurity } from './boostSecurityRouter.js';
import { buildPremiumTokenNotification, verifiedPairAge } from '../../ui/premiumTokenNotification.js';
import { buildAlphaMarketActions } from '../../ui/alphaNotificationActions.js';
import { persistOrLoadAlphaSemanticEventRecord } from '../../services/alphaSemanticEventService.js';
import { deliverAlphaSemanticEvent } from '../../services/alphaSemanticDeliveryService.js';
import { supabase } from '../../services/supabase.js';

const BOOST_INTERVAL_MS = 15_000;
export const BOOSTED_OPPORTUNITY_THRESHOLD = 200;
export const MAJOR_BOOST_THRESHOLD = 500;
const BOOST_PERSIST_BUDGET_MS = 350;
const BOOST_INITIAL_ENRICH_BUDGET_MS = 700;

type BoostAction = { text: string; callback_data?: string; url?: string };
type BoostSecurityDisplay = 'SAFE' | 'UNKNOWN' | 'SCAM';
type BoostMarket = Awaited<ReturnType<typeof getRobinhoodMarketSnapshot>>;
type BoostSocials = Awaited<ReturnType<typeof getRobinhoodTokenSocials>>;
type BoostMarketHistory = {
  volume5m: number | null;
  price: number | null;
  liquidity: number | null;
};

export function boostNotificationState(totalBoostAmount: number) {
  return totalBoostAmount >= BOOSTED_OPPORTUNITY_THRESHOLD ? 'BOOSTED_OPPORTUNITY' as const : 'BUILDING' as const;
}
export function boostPresentationState(totalBoostAmount: number) {
  return totalBoostAmount >= MAJOR_BOOST_THRESHOLD ? 'MAJOR_BOOST' as const : 'BOOST' as const;
}

const boostTotals = new Map<string, number>();
const verificationRetries = new Map<string, BoostVerificationRetry>();
const acceptedAdminBoostNotifications = new Set<string>();
const boostMarketHistory = new Map<string, BoostMarketHistory>();
let boostRecipientCacheAt = 0;
let boostRecipientCache = new Set<string>();
const BOOST_RECIPIENT_CACHE_MS = 5 * 60_000;
let boostObserverStarted = false;
let boostObserverRunning = false;
let boostBaselineReady = false;
let boostBaselinePromise: Promise<boolean> | null = null;
let boostObserverInterval: ReturnType<typeof setInterval> | null = null;

function normalize(value: string) { return value.trim().toLowerCase(); }
function shortAddress(value: string) {
  const v = value.trim();
  return v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-6)}` : v;
}
function money(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}
function stableNegativeId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return -Math.max(1, hash >>> 0);
}

export function boostFallbackIdentity(tokenAddress: string, totalBoostAmount: number) {
  return `${normalize(tokenAddress)}:${totalBoostAmount}`;
}
export function recordAcceptedAdminBoostNotification(tokenAddress: string, totalBoostAmount: number) {
  acceptedAdminBoostNotifications.add(boostFallbackIdentity(tokenAddress, totalBoostAmount));
}

async function boostRecipients(): Promise<string[]> {
  const now = Date.now();
  if (now - boostRecipientCacheAt > BOOST_RECIPIENT_CACHE_MS) {
    const next = new Set<string>();
    if (config.adminTelegramId) next.add(String(config.adminTelegramId));
    for (const user of runtimeDeliverableUsers({ allRealtime: true })) {
      if (user.telegram_id && !user.is_blocked) next.add(String(user.telegram_id));
    }
    try {
      const users = await Promise.race([
        getDeliverableUsers(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('recipient lookup timeout')), 1500)),
      ]);
      for (const user of users) if (user.telegram_id && !user.is_blocked) next.add(String(user.telegram_id));
    } catch (error) {
      console.warn('[RobinhoodBoostObserver] Recipient DB refresh unavailable; using runtime/admin cache', {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    if (next.size) {
      boostRecipientCache = next;
      boostRecipientCacheAt = now;
    }
  }
  if (!boostRecipientCache.size && config.adminTelegramId) boostRecipientCache.add(String(config.adminTelegramId));
  return [...boostRecipientCache];
}

export async function deliverAdminBoostFallback(
  args: { tokenAddress: string; totalBoostAmount: number; message: string; buttons?: BoostAction[][] },
  dependencies: {
    send?: typeof sendTelegramWithMessageId;
    adminTelegramId?: string;
    log?: (event: string, details: Record<string, unknown>) => void;
  } = {},
): Promise<boolean> {
  const identity = boostFallbackIdentity(args.tokenAddress, args.totalBoostAmount);
  if (acceptedAdminBoostNotifications.has(identity)) return false;
  const log = dependencies.log ?? ((event, details) => console.log(`[RobinhoodBoostObserver] ${event}`, details));
  const send = dependencies.send ?? sendTelegramWithMessageId;
  const recipients = dependencies.adminTelegramId ? [dependencies.adminTelegramId] : await boostRecipients();
  if (!recipients.length) return false;
  const deliveryStartedAt = Date.now();
  const results = await Promise.allSettled(recipients.map(async chatId => {
    if (!dependencies.send) await waitForRecipientDelivery(chatId, deliveryStartedAt);
    const accepted = await send(chatId, args.message, args.buttons);
    if (!dependencies.send) recordDeliveryAccepted(chatId, deliveryStartedAt, `boost:${identity}`);
    return accepted;
  }));
  const delivered = results.filter(result => result.status === 'fulfilled').length;
  const failed = results.length - delivered;
  if (delivered > 0) {
    acceptedAdminBoostNotifications.add(identity);
    log('BOOST_DELIVERED', { token: normalize(args.tokenAddress), totalBoost: args.totalBoostAmount, delivered, failed });
    return true;
  }
  log('BOOST_DELIVERY_FAILED', { token: normalize(args.tokenAddress), totalBoost: args.totalBoostAmount, delivered, failed });
  return false;
}
export function resetRobinhoodBoostFallbackForTests() { acceptedAdminBoostNotifications.clear(); }

async function ensureBoostBaseline() {
  if (boostBaselineReady) return true;
  if (boostBaselinePromise) return boostBaselinePromise;
  boostBaselinePromise = (async () => {
    try {
      const boosts = await fetchRobinhoodBoosts();
      for (const boost of boosts) boostTotals.set(normalize(boost.tokenAddress), boost.totalAmount);
      boostBaselineReady = true;
      console.log('[RobinhoodBoostObserver] LIVE_ONLY_BASELINE_READY', { tokens: boosts.length, supabase: 'bypassed' });
      console.log('[RobinhoodBoostObserver] BASELINE_ABSORBED_SILENTLY', { tokens: boosts.length, recoveryAlertsSuppressed: true });
      return true;
    } catch (error) {
      console.error('[RobinhoodBoostObserver] Baseline failed:', error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      boostBaselinePromise = null;
    }
  })();
  return boostBaselinePromise;
}

export function buildBoostMessage(args: {
  symbol: string; name?: string | null; tokenAddress: string; boostAmount: number; totalBoostAmount: number;
  canonicalTitle?: string | null; price?: number | null; marketCap?: number | null; fdv?: number | null;
  liquidity?: number | null; volume5m?: number | null; buys5m?: number | null; sells5m?: number | null;
  age?: string | null; move?: number | null; momentum?: number | null; confidence?: number | null; risk?: string | null;
  rawData?: Record<string, unknown> | null; marketContext?: Record<string, unknown> | null;
  devHoldingPercent: number | null; burnedPercent?: number | null; holderTop1Percent: number | null;
  eventType: 'NEW' | 'INCREASE'; securityStatus?: BoostSecurityDisplay; securityReason?: string;
  launchSource?: 'PONS' | 'CUSTOM';
}): string {
  const ctx = args.marketContext ?? {};
  const mc = typeof ctx.marketCap === 'number' ? ctx.marketCap : args.marketCap;
  const fdv = typeof ctx.fdv === 'number' ? ctx.fdv : args.fdv;
  const liq = typeof ctx.liquidity === 'number' ? ctx.liquidity : args.liquidity;
  const vol = typeof ctx.volume5m === 'number' ? ctx.volume5m : args.volume5m;
  const raw = args.rawData ?? {};
  const pre = (raw.preIndexValuation && typeof raw.preIndexValuation === 'object' ? raw.preIndexValuation : null) as Record<string, unknown> | null;
  const preValue = pre && typeof pre.valueUsd === 'number' ? pre.valueUsd : null;
  const move = args.move ?? args.momentum;
  const security = args.securityStatus ?? 'UNKNOWN';
  const title = args.canonicalTitle ?? (args.eventType === 'INCREASE' ? '🔥 BOOST INCREASED' : '🚀 BOOST DETECTED');
  const displaySymbol = String(args.symbol ?? '').trim().toUpperCase();
  const lines = [
    `<b>${title}</b>`, '', `<b>${displaySymbol}</b>${args.name ? ` · ${args.name}` : ''}`,
    args.launchSource ? `Source  <b>${args.launchSource === 'PONS' ? 'Verified PONS launchpad' : 'Direct / custom token'}</b>` : '',
    `🔥 Boost  <b>${args.totalBoostAmount} total (+${args.boostAmount})</b>`,
  ].filter(Boolean);
  if (mc != null) lines.push(`Market cap  <b>${money(mc)}</b>`);
  else if (fdv != null) lines.push(`FDV  <b>${money(fdv)}</b>`);
  else if (preValue != null) lines.push(`FDV  <b>${money(preValue)}</b>`);
  if (liq != null) lines.push(`Liquidity  <b>${money(liq)}</b>`);
  if (vol != null) lines.push(`5m volume  <b>${money(vol)}</b>`);
  if (args.buys5m != null || args.sells5m != null) lines.push(`5m buys / sells  <b>${args.buys5m ?? '—'} / ${args.sells5m ?? '—'}</b>`);
  if (move != null) lines.push(`Move  <b>${move >= 0 ? '+' : ''}${move.toFixed(1)}%</b>`);
  if (args.devHoldingPercent != null) lines.push(`Dev holding  <b>${args.devHoldingPercent}%</b>`);
  lines.push(security === 'SAFE'
    ? `🛡️ Security  <b>VERIFIED</b>${args.securityReason ? ` · ${args.securityReason}` : ''}`
    : security === 'SCAM'
      ? `⛔ Security  <b>BLOCKED</b>${args.securityReason ? ` · ${args.securityReason}` : ''}`
      : `⚠️ Security  <b>UNVERIFIED</b>${args.securityReason ? ` · ${args.securityReason}` : ''}`);
  lines.push('', `<code>${args.tokenAddress}</code>`, '', '⚠️ <b>Do your own diligence.</b>');
  return lines.join('\n');
}

export function buildBoostActions(args: {
  tokenAddress: string; chartUrl?: string | null; opportunityId?: number | null; strategyKey?: string | null;
  rawData?: Record<string, unknown> | null; socials?: { website?: string | null; twitter?: string | null; telegram?: string | null };
}): BoostAction[][] {
  const rows: BoostAction[][] = [[{ text: '🔬 Full Intel', callback_data: `FI_RH_${args.tokenAddress}` }]];
  if (args.chartUrl) rows[0].push({ text: '📊 Chart', url: args.chartUrl });
  rows.push([
    { text: '⭐ Track', callback_data: `BOOST_TRACK_${args.tokenAddress}` },
    { text: '📋 Copy CA', callback_data: `COPY_CA_${args.tokenAddress}` },
  ]);
  rows.push([{ text: '🔕 Mute', callback_data: `BOOST_MUTE_${args.tokenAddress}` }]);
  const socials = args.socials;
  if (socials?.website || socials?.twitter || socials?.telegram) rows.push([
    ...(socials.website ? [{ text: '🌐 Project', url: socials.website }] : []),
    ...(socials.twitter ? [{ text: '𝕏 X', url: socials.twitter }] : []),
    ...(socials.telegram ? [{ text: '✈️ TG', url: socials.telegram }] : []),
  ]);
  return rows;
}

function boostRawSecurityEvidence(args: {
  verifiedPons: boolean;
  liquidityStatus?: 'LOCKED' | 'BURNED' | 'UNLOCKED' | 'UNKNOWN' | null;
}) {
  return {
    launchSource: args.verifiedPons ? 'PONS' : 'UNKNOWN',
    ...(args.verifiedPons ? {} : {
      liquiditySafetyStatus: args.liquidityStatus ?? 'UNKNOWN',
      liquiditySafetyVerified: args.liquidityStatus === 'LOCKED' || args.liquidityStatus === 'BURNED',
    }),
  };
}

async function loadDeliveredBoostMessages(eventId: number): Promise<Array<{ telegramId: string; messageId: number }>> {
  const { data, error } = await supabase.from('alpha_alert_event_deliveries')
    .select('telegram_id,metadata,delivered_at')
    .eq('alert_event_id', eventId)
    .not('delivered_at', 'is', null);
  if (error) throw error;
  return (data ?? []).flatMap(row => {
    const metadata = row.metadata as Record<string, unknown> | null;
    const messageId = Number(metadata?.telegram_message_id);
    return Number.isFinite(messageId) && messageId > 0
      ? [{ telegramId: String(row.telegram_id), messageId }]
      : [];
  });
}

export async function enrichDeliveredBoostAlert(args: {
  eventId: number;
  semanticIdentity: string;
  tokenAddress: string;
  canonicalTitle: string;
  canonicalType: string;
  totalBoostAmount: number;
  boostAmount: number;
  verifiedPons: boolean;
  securityReason: string;
  baseSymbol?: string | null;
  baseName?: string | null;
}): Promise<number> {
  if (args.eventId < 0) return 0;
  const [market, metadata, socials] = await Promise.all([
    getRobinhoodMarketSnapshot(args.tokenAddress, {
      priority: 'HIGH', caller: 'robinhood_boost_observer', queueWaitTimeoutMs: 750,
    }).catch(() => null),
    resolveBoostMetadata(args.tokenAddress, { symbol: args.baseSymbol, name: args.baseName, source: 'BOOST_FEED' }, 650)
      .catch(() => boostMetadataFallback(args.tokenAddress)),
    getRobinhoodTokenSocials(args.tokenAddress).catch(() => ({ website: null, twitter: null, telegram: null })),
  ]);
  const pons = args.verifiedPons ? await getVerifiedPonsPublicContext(args.tokenAddress) : null;
  if (!market && !metadata.name && !metadata.symbol && !pons) return 0;
  const symbol = market?.symbol || metadata.symbol || pons?.symbol || args.baseSymbol || null;
  const name = market?.name || metadata.name || pons?.name || args.baseName || null;
  const state = args.canonicalType === 'MAX_BOOST_500_PLUS' ? 'MAJOR_BOOST' as const : 'BOOST' as const;
  const marketContext = {
    symbol, name, address: args.tokenAddress,
    price: market?.priceUsd ?? null,
    marketCap: market?.marketCapUsd ?? null,
    fdv: market?.fdvUsd ?? pons?.fdvUsd ?? null,
    liquidity: market?.liquidityUsd ?? null,
    volume5m: market?.volume5mUsd ?? null,
    chartUrl: market?.chartUrl ?? null,
  };
  const message = buildPremiumTokenNotification({
    age: verifiedPairAge(market?.pairCreatedAt), move1h: market?.priceChange1h,
    buys5m: market?.trades5mReported ? market.buys5m : null, sells5m: market?.trades5mReported ? market.sells5m : null,
    observedAt: market?.timestamp, source: market ? 'DEXScreener' : null,
    state, symbol, name, address: args.tokenAddress, chain: 'robinhood', market: marketContext,
    evidence: await boostDeveloperEvidence(args.tokenAddress, pons?.creator), socials: { twitter: socials.twitter || pons?.twitter, telegram: socials.telegram || pons?.telegram },
    telegramType: await getTelegramPreviewType(socials.telegram || pons?.telegram || ''),
    launchSource: args.verifiedPons ? 'PONS' : 'UNKNOWN',
    boostTotal: args.totalBoostAmount, boostIncrement: args.boostAmount, risk: 'UNKNOWN',
    insightTitle: 'WHY NOW', insight: [`${args.canonicalTitle} verified after security gate`, args.securityReason],
    statusTitle: 'Security', status: 'VERIFIED', displayIntent: 'WATCH',
  });
  const tokenUrl = args.verifiedPons
    ? `https://www.ponsfamily.com/launchpad/${encodeURIComponent(args.tokenAddress)}`
    : `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(args.tokenAddress)}`;
  const buttons = buildAlphaMarketActions({
    chartUrl: market?.chartUrl ?? null, tokenUrl,
    fullIntelCallback: `FI_RH_${args.tokenAddress}`,
    trackCallback: `BOOST_TRACK_${args.tokenAddress}`,
    copyContractCallback: `COPY_CA_${args.tokenAddress}`,
    muteCallback: `BOOST_MUTE_${args.tokenAddress}`,
    xUrl: socials.twitter, telegramUrl: socials.telegram,
  });
  const deliveries = await loadDeliveredBoostMessages(args.eventId).catch(() => []);
  const edits = await Promise.allSettled(deliveries.map(delivery =>
    editTelegramMessage(delivery.telegramId, delivery.messageId, message, buttons)));

  if (market) {
    const tokenKey = normalize(args.tokenAddress);
    const previous = boostMarketHistory.get(tokenKey);
    const current = {
      volume5m: market.volume5mUsd ?? null,
      price: market.priceUsd ?? null,
      liquidity: market.liquidityUsd ?? null,
    };
    if (previous && isMaterialVolumeSurge({
      previousVolume5m: previous.volume5m,
      currentVolume5m: current.volume5m,
      previousPrice: previous.price,
      currentPrice: current.price,
    })) {
      void persistOrLoadAlphaSemanticEventRecord({
        identity: `${args.semanticIdentity}:volume-surge`,
        type: 'VOLUME_SURGE',
        assetId: args.tokenAddress,
        chain: 'robinhood',
        rawSnapshot: {
          comparisonWindow: 'DEXSCREENER_M5_TO_DEXSCREENER_M5',
          previousVolume5m: previous.volume5m,
          currentVolume5m: current.volume5m,
          previousPrice: previous.price,
          currentPrice: current.price,
        },
      }).catch(error => console.warn('[RobinhoodBoostObserver] Volume-surge persistence unavailable', {
        token: tokenKey, reason: error instanceof Error ? error.message : String(error),
      }));
    }
    boostMarketHistory.set(tokenKey, current);
  }
  return edits.filter(result => result.status === 'fulfilled').length;
}

export function isMaterialVolumeSurge(args: {
  previousVolume5m: number | null; currentVolume5m: number | null;
  previousPrice: number | null; currentPrice: number | null;
}) {
  return args.previousVolume5m != null && args.previousVolume5m > 0 &&
    args.currentVolume5m != null && args.currentVolume5m >= args.previousVolume5m * 1.5 &&
    args.previousPrice != null && args.previousPrice > 0 &&
    args.currentPrice != null && args.currentPrice >= args.previousPrice * 0.5;
}

export function volumeIgnitionDecision(args: {
  previousVolume5m: number | null; currentVolume5m: number | null;
  previousPrice: number | null; currentPrice: number | null;
  previousLiquidity?: number | null; currentLiquidity?: number | null;
  buys5m?: number | null; sells5m?: number | null;
}) {
  const multiple = args.previousVolume5m != null && args.previousVolume5m > 0 && args.currentVolume5m != null
    ? args.currentVolume5m / args.previousVolume5m : null;
  const priceConstructive = args.previousPrice != null && args.previousPrice > 0 && args.currentPrice != null && args.currentPrice >= args.previousPrice * 0.5;
  const liquidityStable = args.previousLiquidity == null || args.currentLiquidity == null || args.previousLiquidity <= 0 || args.currentLiquidity >= args.previousLiquidity * 0.85;
  const flowConstructive = args.buys5m == null || args.sells5m == null || args.buys5m >= args.sells5m;
  return { eligible: multiple != null && multiple >= 1.5 && priceConstructive && liquidityStable && flowConstructive, volumeMultiple: multiple };
}

async function initialBoostEnrichment(tokenAddress: string): Promise<{ market: BoostMarket | null; socials: BoostSocials }> {
  const emptySocials: BoostSocials = { website: null, twitter: null, telegram: null };
  const work = Promise.all([
    getRobinhoodMarketSnapshot(tokenAddress, {
      priority: 'HIGH', caller: 'robinhood_boost_initial', queueWaitTimeoutMs: 500,
    }).catch(() => null),
    getRobinhoodTokenSocials(tokenAddress).catch(() => emptySocials),
  ]).then(([market, socials]) => ({ market, socials }));
  return Promise.race([
    work,
    new Promise<{ market: null; socials: BoostSocials }>(resolve =>
      setTimeout(() => resolve({ market: null, socials: emptySocials }), BOOST_INITIAL_ENRICH_BUDGET_MS)),
  ]);
}

async function processBoost(boost: { tokenAddress: string; amount: number; totalAmount: number }): Promise<boolean> {
  const tokenKey = normalize(boost.tokenAddress);
  if (!boostVerificationDue(verificationRetries, tokenKey, boost.totalAmount, Date.now())) return false;
  const canonical = observeBoostCanonicalEvent(boostTotals, tokenKey, boost.totalAmount, boost.amount);
  if (!canonical) return false;

  const verifiedPons = await isVerifiedPonsLaunch(boost.tokenAddress);
  const security = await routeBoostSecurity({ tokenAddress: boost.tokenAddress, verifiedTrustedLaunchpad: verifiedPons });
  console.log('[RobinhoodBoostObserver] BOOST_SECURITY_DECISION', {
    token: tokenKey, eventType: canonical.type, route: security.route,
    allowed: security.allowed, reason: security.reason, cached: security.cached,
  });
  if (!security.allowed) {
    const disposition = recordBoostSecurityBlock(boostTotals, verificationRetries, tokenKey, boost.totalAmount, security.liquidity?.status === 'UNKNOWN', Date.now());
    console.log('[RobinhoodBoostObserver] BOOST_VERIFICATION_DISPOSITION', { token: tokenKey, disposition });
    console.warn('[RobinhoodBoostObserver] BOOST_BLOCKED_SECURITY', {
      token: tokenKey, eventType: canonical.type, totalBoost: boost.totalAmount, reason: security.reason,
    });
    return false;
  }

  const [metadata, initialEnrichment] = await Promise.all([
    resolveBoostMetadata(boost.tokenAddress, null, 500)
      .catch(() => boostMetadataFallback(boost.tokenAddress)),
    initialBoostEnrichment(boost.tokenAddress),
  ]);
  const pons = verifiedPons ? await getVerifiedPonsPublicContext(boost.tokenAddress) : null;
  const market = initialEnrichment.market;
  const socials = initialEnrichment.socials;
  const symbol = market?.symbol || metadata.symbol || pons?.symbol || null;
  const name = market?.name || metadata.name || pons?.name || null;
  const securityReason = verifiedPons ? 'Verified PONS origin; trusted launchpad fast path.' : security.reason;
  const eventId = `${tokenKey}:${canonical.type}:${canonical.currentTotal}`;
  const rawSnapshot = {
    symbol, name, tokenAddress: boost.tokenAddress,
    boostTotal: canonical.currentTotal,
    boostIncrement: canonical.boostAdded,
    canonicalEventType: canonical.type,
    ...(market ? {
      price: market.priceUsd ?? null,
      pairAddress: market.pairAddress ?? null,
      marketCap: market.marketCapUsd ?? null,
      fdv: market.fdvUsd ?? null,
      liquidity: market.liquidityUsd ?? null,
      volume5m: market.volume5mUsd ?? null,
      chartUrl: market.chartUrl ?? null,
    } : {}),
    ...boostRawSecurityEvidence({ verifiedPons, liquidityStatus: security.liquidity?.status }),
  };

  // Persist first when the database is healthy, but never let persistence/entry-price capture
  // hold the critical BOOST path indefinitely. The same promise continues in the background.
  const persistPromise = persistOrLoadAlphaSemanticEventRecord({
    identity: String(eventId),
    type: 'BOOST',
    assetId: boost.tokenAddress,
    chain: 'robinhood',
    symbol: symbol ?? undefined,
    rawSnapshot,
  });
  const persisted = await Promise.race([
    persistPromise.catch(() => null),
    new Promise<null>(resolve => setTimeout(() => resolve(null), BOOST_PERSIST_BUDGET_MS)),
  ]);

  const semanticEvent = persisted ? {
    id: persisted.id,
    eventIdentity: persisted.event_identity,
    type: 'BOOST',
    assetId: boost.tokenAddress,
    chain: 'robinhood',
    rawSnapshot,
  } : {
    id: stableNegativeId(`v2:BOOST:${eventId}`),
    eventIdentity: `v2:BOOST:${eventId}`,
    type: 'BOOST',
    assetId: boost.tokenAddress,
    chain: 'robinhood',
    ephemeral: true,
    rawSnapshot,
  };

  const state = canonical.type === 'MAX_BOOST_500_PLUS' ? 'MAJOR_BOOST' as const : 'BOOST' as const;
  const marketContext = {
    symbol, name, address: boost.tokenAddress,
    price: market?.priceUsd ?? null,
    marketCap: market?.marketCapUsd ?? null,
    fdv: market?.fdvUsd ?? pons?.fdvUsd ?? null,
    liquidity: market?.liquidityUsd ?? null,
    volume5m: market?.volume5mUsd ?? null,
    chartUrl: market?.chartUrl ?? null,
  };
  const baseMessage = buildPremiumTokenNotification({
    age: verifiedPairAge(market?.pairCreatedAt), move1h: market?.priceChange1h,
    buys5m: market?.trades5mReported ? market.buys5m : null, sells5m: market?.trades5mReported ? market.sells5m : null,
    observedAt: market?.timestamp, source: market ? 'DEXScreener' : null,
    state, symbol, name, address: boost.tokenAddress, chain: 'robinhood', market: marketContext,
    evidence: await boostDeveloperEvidence(boost.tokenAddress, pons?.creator), socials: { twitter: socials.twitter || pons?.twitter, telegram: socials.telegram || pons?.telegram },
    telegramType: await getTelegramPreviewType(socials.telegram || pons?.telegram || ''),
    launchSource: verifiedPons ? 'PONS' : 'UNKNOWN',
    boostTotal: canonical.currentTotal, boostIncrement: canonical.boostAdded, risk: 'UNKNOWN',
    insightTitle: 'WHY NOW', insight: [`${boostCanonicalTitle(canonical)} verified after security gate`, securityReason],
    statusTitle: 'Security',
    status: security.liquidity?.status && security.liquidity.status !== 'UNKNOWN'
      ? `LP ${security.liquidity.status}`
      : 'VERIFIED',
    displayIntent: 'WATCH',
  });
  const tokenUrl = verifiedPons
    ? `https://www.ponsfamily.com/launchpad/${encodeURIComponent(boost.tokenAddress)}`
    : `https://robinhoodchain.blockscout.com/token/${encodeURIComponent(boost.tokenAddress)}`;
  const baseButtons = buildAlphaMarketActions({
    chartUrl: market?.chartUrl ?? null,
    tokenUrl,
    fullIntelCallback: `FI_RH_${boost.tokenAddress}`,
    trackCallback: `BOOST_TRACK_${boost.tokenAddress}`,
    copyContractCallback: `COPY_CA_${boost.tokenAddress}`,
    muteCallback: `BOOST_MUTE_${boost.tokenAddress}`,
    xUrl: socials.twitter,
    telegramUrl: socials.telegram,
  });

  const claim = await claimBoostDelivery(boost.tokenAddress, boost.totalAmount);
  if (claim !== 'CLAIMED') {
    console.log('[RobinhoodBoostObserver] BOOST_DELIVERY_GUARD', { token: tokenKey, totalBoost: boost.totalAmount, state: claim });
    if (claim === 'EXISTS') boostTotals.set(tokenKey, boost.totalAmount);
    else {
      if (verificationRetries.size >= 100 && !verificationRetries.has(tokenKey)) verificationRetries.delete(verificationRetries.keys().next().value!);
      verificationRetries.set(tokenKey, { total: boost.totalAmount, firstAt: Date.now(), nextAt: Date.now() + 60_000, attempts: 1 });
    }
    return false;
  }
  let delivered = 0;
  let accepted = 0;
  let sharedDeliveryUnavailable = false;
  try {
    const result = await deliverAlphaSemanticEvent({ event: semanticEvent, message: baseMessage, buttons: baseButtons, preserveMessage: true,
      onTelegramAccepted: () => { accepted += 1; recordAcceptedAdminBoostNotification(boost.tokenAddress, boost.totalAmount); },
    });
    delivered = result.delivered;
  } catch (error) {
    sharedDeliveryUnavailable = true;
    console.warn('[RobinhoodBoostObserver] Shared delivery unavailable; using bounded runtime/admin fallback', {
      token: tokenKey, reason: error instanceof Error ? error.message : String(error),
    });
  }

  if (sharedDeliveryUnavailable && accepted === 0) {
    const fallbackDelivered = await deliverAdminBoostFallback({
      tokenAddress: boost.tokenAddress,
      totalBoostAmount: boost.totalAmount,
      message: baseMessage,
      buttons: baseButtons,
    });
    if (fallbackDelivered) delivered = 1;
  }

  if (delivered > 0 || accepted > 0 || acceptedAdminBoostNotifications.has(boostFallbackIdentity(boost.tokenAddress, boost.totalAmount))) {
    await markBoostDeliveryAccepted(semanticEvent.eventIdentity, rawSnapshot);
    boostTotals.set(tokenKey, boost.totalAmount);
    verificationRetries.delete(tokenKey);
    console.log('[RobinhoodBoostObserver] BOOST_ALERT_VERIFIED', {
      token: tokenKey, eventType: canonical.type, boostAdded: canonical.boostAdded,
      totalBoost: canonical.currentTotal, verifiedPons, securityRoute: security.route,
      semanticEventIdentity: semanticEvent.eventIdentity,
    });

    // Late enrichment is explicitly optional: send first, enrich once, then safely edit only
    // durable deliveries that have a Telegram message id. Missing market data cannot block alerting.
    void (async () => {
      const durable = persisted ?? await persistPromise.catch(() => null);
      if (!durable) return;
      await enrichDeliveredBoostAlert({
        eventId: durable.id,
        semanticIdentity: String(eventId),
        tokenAddress: boost.tokenAddress,
        canonicalTitle: boostCanonicalTitle(canonical),
        canonicalType: canonical.type,
        totalBoostAmount: canonical.currentTotal,
        boostAmount: canonical.boostAdded,
        verifiedPons,
        securityReason,
        baseSymbol: symbol,
        baseName: name,
      }).catch(error => console.warn('[RobinhoodBoostObserver] Late BOOST enrichment failed', {
        token: tokenKey, reason: error instanceof Error ? error.message : String(error),
      }));
    })();
    return true;
  }
  return false;
}

export async function runRobinhoodBoostObserverCycle() {
  if (boostObserverRunning) return;
  boostObserverRunning = true;
  try {
    if (!await ensureBoostBaseline()) return;
    const boosts = await fetchRobinhoodBoosts();
    console.log('[RobinhoodBoostObserver] Feed:', { boosts: boosts.length, mode: 'LIVE_ONLY' });
    let alertsSent = 0;
    const unchangedTotals = boosts.filter(boost => {
      const prior = boostTotals.get(normalize(boost.tokenAddress));
      return prior != null && boost.totalAmount <= prior;
    }).length;
    for (const boost of boosts) {
      try { if (await processBoost(boost)) alertsSent += 1; }
      catch (error) {
        console.error('[RobinhoodBoostObserver] Token processing failed:', {
          token: boost.tokenAddress, error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    console.log('[RobinhoodBoostObserver] Cycle complete:', { alertsSent, unchangedTotals, observed: boosts.length });
  } catch (error) {
    console.error('[RobinhoodBoostObserver] Cycle failed:', error instanceof Error ? error.message : String(error));
  } finally {
    boostObserverRunning = false;
  }
}

export function startRobinhoodBoostObserver(): ReturnType<typeof setInterval> | null {
  if (boostObserverStarted) return boostObserverInterval;
  boostObserverStarted = true;
  console.log('[RobinhoodBoostObserver] Starting LIVE_ONLY canonical security-routed path...');
  void ensureBoostBaseline();
  boostObserverInterval = setInterval(() => void runRobinhoodBoostObserverCycle(), BOOST_INTERVAL_MS);
  return boostObserverInterval;
}
async function boostDeveloperEvidence(token: string, creator?: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const dev = await Promise.race([reuseRobinhoodDevTokenFlow(token).catch(() => null),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 750); })]);
    const direct = creator && (!dev || dev.evidenceStatus === 'UNAVAILABLE' || dev.devHoldingPercent == null)
      ? await Promise.race([getCreatorHoldingPercent(token, creator), new Promise<null>(resolve => setTimeout(() => resolve(null), 750))]) : null;
    return { devHoldingEvidence: direct != null ? 'VERIFIED' as const : dev && dev.evidenceStatus !== 'UNAVAILABLE' && dev.devHoldingPercent != null ? 'VERIFIED' as const : 'UNAVAILABLE' as const,
      devHoldingPercent: direct ?? (dev && dev.evidenceStatus !== 'UNAVAILABLE' ? dev.devHoldingPercent : null),
      burnEvidence: dev?.evidenceStatus === 'COMPLETE' && dev.totalBurnPercent != null ? 'VERIFIED' as const : 'UNAVAILABLE' as const,
      burnedPercent: dev?.evidenceStatus === 'COMPLETE' ? dev.totalBurnPercent : null };
  } finally { if (timer) clearTimeout(timer); }
}
