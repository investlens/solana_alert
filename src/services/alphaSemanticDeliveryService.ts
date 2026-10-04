import { discloseRobinhoodKeyStats } from './alertKeyStatsService.js';
import { routeBoostSecurity } from '../chains/robinhood/boostSecurityRouter.js';
import { getPonsLaunchState } from '../chains/robinhood/ponsLaunchState.js';
import { withOwnershipDisclosure, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';
import { decorateDexPaidAlert, discloseAlertDexPaid } from './alertDexPaidDisclosure.js';
import { discloseRobinhoodOwnership } from './alertOwnershipService.js';
import { liveFeedEnabled, semanticLiveFeed } from './liveAlertPreferences.js';
import { claimSharedDelivery } from './sharedJsonCache.js';
import { recordCompactAlert } from './compactAlertOutcomes.js';
import { recordRecoveryAlertAudit } from './recoveryAlertAudit.js';
import { waitForRecipientDelivery, isUndelayedRiskEvent, recipientDelayMs, recordDeliveryAccepted } from './recipientDeliveryTiming.js';
import { getDeliverableUsers, markTelegramUserBlocked, type DeliverableUser } from '../core/delivery.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import { evaluateDexPaidAlertSafety } from '../chains/robinhood/security/dexPaidAlertSafetyGate.js';
import { evaluateRobinhoodPositiveAlertSecurity } from '../chains/robinhood/launchSecurity.js';
import { evaluatePositiveAlertSecurity, isPositiveSemanticEvent, labelLaunchType, type LaunchClassification } from '../security/positiveAlertSecurity.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';
import { DEX_PAID_STRATEGY_KEY, isStrategyEnabledForUser, X_REPUTED_MENTION_STRATEGY_KEY } from './strategyService.js';
import { getEphemeralSemanticEventEvidence } from './alphaSemanticEventService.js';
import { supabase } from './supabase.js';
import { sendTelegramWithMessageId } from './telegram.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { loadPriorDeliveredAlertComparison, renderMomentumUpdate } from './alertComparisonService.js';

type InlineButton = { text: string; callback_data?: string; url?: string };

export type UserFacingSemanticEvent = {
  id: number; eventIdentity: string; type: string; assetId: string; chain: string;
  strategyKey?: string | null;
  ephemeral?: boolean;
  rawSnapshot?: Record<string, unknown> | null;
};

export async function claimDexRecipient(eventIdentity: string, recipient: string,
  claim = claimSharedDelivery): Promise<boolean> {
  return await claim(`alphaos:dex:delivery:${eventIdentity}:${recipient}`, 24 * 60 * 60_000) === 'CLAIMED';
}

type SemanticDeliveryDependencies = {
  getUsers: () => Promise<DeliverableUser[]>;
  strategyEnabled: (telegramId: string, strategyKey: string) => Promise<boolean>;
  reserve: (event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string) => Promise<boolean>;
  complete: (event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string, messageId?: number | null) => Promise<void>;
  release: (event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string) => Promise<void>;
  sentUnconfirmed: (event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string) => Promise<void>;
  send: (telegramId: string, message: string, buttons?: InlineButton[][]) => Promise<number | null | void>;
  blocked: (telegramId: string) => Promise<void>;
};

const EPHEMERAL_CLAIM_TTL_MS = 6 * 60 * 60 * 1000;
const ephemeralClaims = new Map<string, number>();

function ephemeralClaimKey(event: UserFacingSemanticEvent, user: DeliverableUser): string {
  return `${event.eventIdentity}:${user.telegram_id}`;
}

function claimEphemeralDelivery(event: UserFacingSemanticEvent, user: DeliverableUser, now = Date.now()): boolean {
  for (const [key, claimedAt] of ephemeralClaims) {
    if (now - claimedAt > EPHEMERAL_CLAIM_TTL_MS) ephemeralClaims.delete(key);
  }
  const key = ephemeralClaimKey(event, user);
  if (ephemeralClaims.has(key)) return false;
  ephemeralClaims.set(key, now);
  return true;
}

function releaseEphemeralDelivery(event: UserFacingSemanticEvent, user: DeliverableUser): void {
  ephemeralClaims.delete(ephemeralClaimKey(event, user));
}

export function preferenceKeyForSemanticEvent(event: UserFacingSemanticEvent): string | null {
  if (event.type === 'DEX_PAID') return DEX_PAID_STRATEGY_KEY;
  if (event.type === 'X_REPUTED_MENTION') return X_REPUTED_MENTION_STRATEGY_KEY;
  return event.strategyKey ?? null;
}

async function reserve(event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('reserve_alpha_semantic_delivery', {
    p_alert_event_id: event.id, p_telegram_id: user.telegram_id, p_tier_at_delivery: user.tier,
    p_delivery_channel: 'telegram', p_lease_token: leaseToken, p_lease_seconds: DELIVERY_LEASE_SECONDS,
  });
  if (error) throw error;
  return data === true;
}

async function updateLease(event: UserFacingSemanticEvent, user: DeliverableUser, leaseToken: string,
  metadata: Record<string, unknown>, deliveredAt?: string): Promise<void> {
  const { data, error } = await supabase.from('alpha_alert_event_deliveries').update({ metadata,
    ...(deliveredAt ? { delivered_at: deliveredAt } : {}) })
    .eq('alert_event_id', event.id).eq('telegram_id', user.telegram_id).eq('delivery_channel', 'telegram')
    .contains('metadata', { state: 'RESERVED', lease_token: leaseToken }).select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Semantic delivery lease was lost');
}

const productionDependencies: SemanticDeliveryDependencies = {
  getUsers: getDeliverableUsers,
  strategyEnabled: isStrategyEnabledForUser,
  reserve,
  complete: (event, user, leaseToken, messageId) => updateLease(event, user, leaseToken,
    { state: 'DELIVERED', event_identity: event.eventIdentity, semantic_event_type: event.type,
      ...(messageId != null ? { telegram_message_id: messageId } : {}) }, new Date().toISOString()),
  release: (event, user, leaseToken) => updateLease(event, user, leaseToken,
    { state: 'RESERVED', lease_token: leaseToken, reserved_at: new Date(0).toISOString(), retry_pending: true,
      event_identity: event.eventIdentity, semantic_event_type: event.type }),
  sentUnconfirmed: (event, user, leaseToken) => updateLease(event, user, leaseToken,
    { state: 'SENT_UNCONFIRMED', event_identity: event.eventIdentity, semantic_event_type: event.type }),
  send: sendTelegramWithMessageId,
  blocked: markTelegramUserBlocked,
};

async function loadSemanticRawSnapshot(eventId: number): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('alpha_alert_events').select('raw_snapshot').eq('id', eventId).maybeSingle();
  if (error) throw error;
  return (data?.raw_snapshot as Record<string, unknown> | null) ?? null;
}

export async function deliverAlphaSemanticEvent(args: {
  event: UserFacingSemanticEvent; message: string; buttons?: InlineButton[][]; preserveMessage?: boolean;
  onFailure?: (error: unknown) => void;
  onTelegramAccepted?: (user: DeliverableUser) => void;
  onRecipientFailure?: (user: DeliverableUser, error: unknown,
    stage: 'recipient_setup' | 'telegram_send' | 'delivery_completion') => void;
}, dependencies: SemanticDeliveryDependencies = productionDependencies): Promise<{ delivered: number; failed: number }> {
  const ephemeralMode = dependencies === productionDependencies && (args.event.ephemeral === true || args.event.id < 0);
  let launchType: LaunchClassification | null = null;
  if (dependencies === productionDependencies && !(['DEX_PAID','BOOST'].includes(args.event.type) && args.event.chain.toLowerCase() === 'robinhood') && isPositiveSemanticEvent(args.event.type) &&
      ['robinhood', 'solana'].includes(args.event.chain.toLowerCase())) {
    let raw: Record<string, unknown> | null = args.event.rawSnapshot ??
      (ephemeralMode ? getEphemeralSemanticEventEvidence(args.event.eventIdentity) : null);
    if (!raw && !ephemeralMode) {
      try {
        raw = await loadSemanticRawSnapshot(args.event.id);
      } catch (error) {
        console.warn('[AlphaSemanticDelivery] Security evidence unavailable; positive alert suppressed fail-closed.', {
          alertEventId: args.event.id, token: args.event.assetId,
          reason: error instanceof Error ? error.message : String(error),
        });
        return { delivered: 0, failed: 0 };
      }
    }
    if (!raw) {
      console.warn('[AlphaSemanticDelivery] Ephemeral security evidence missing; positive alert suppressed fail-closed.', {
        alertEventId: args.event.id, token: args.event.assetId,
      });
      return { delivered: 0, failed: 0 };
    }
    const security = args.event.chain.toLowerCase() === 'robinhood'
      ? await evaluateRobinhoodPositiveAlertSecurity({ tokenAddress: args.event.assetId, raw })
      : evaluatePositiveAlertSecurity({ launchType: 'CUSTOM', raw });
    launchType = security.launchType;
    if (!security.allowed) {
      console.warn('[AlphaSemanticDelivery] Positive alert suppressed by fail-closed liquidity security.', {
        alertEventId: args.event.id, semanticEventType: args.event.type, token: args.event.assetId,
        launchType: security.launchType, liquidityState: security.liquidityState,
        liquidityVerified: security.liquidityVerified, reason: security.reason,
      });
      return { delivered: 0, failed: 0 };
    }
  }

  if (dependencies === productionDependencies && args.event.type === 'BOOST' && args.event.chain.toLowerCase() === 'robinhood') {
    const launch = await getPonsLaunchState(args.event.assetId, {requireCompleteFactoryVerification:true}).catch(() => null);
    const trusted = Boolean(launch?.exists && launch.token.toLowerCase() === args.event.assetId.toLowerCase());
    const safety = await routeBoostSecurity({tokenAddress:args.event.assetId, verifiedTrustedLaunchpad:trusted, requireExplicitSellability:true});
    if (!safety.allowed) { console.warn('[AlphaSemanticDelivery] Boost sellability blocked', {reason:safety.reason}); return {delivered:0,failed:0}; }
    launchType = trusted ? 'PONS' : 'CUSTOM';
  }
  let paidOwnership: OwnershipDisclosure | null = null;
  let paidCreator: string | null = null;
  let paidSecurityNote: string | null = null;
  if (dependencies === productionDependencies && args.event.type === 'DEX_PAID' && args.event.chain.toLowerCase() === 'robinhood') {
    const safety = await evaluateDexPaidAlertSafety(args.event.assetId);
    if (!safety.allowed) {
      console.warn('[AlphaSemanticDelivery] Robinhood DEX_PAID suppressed by event safety gate.', {
        alertEventId: args.event.id,
        token: args.event.assetId,
        marketCapUsd: safety.marketCapUsd,
        liquidityUsd: safety.liquidityUsd,
        pairAgeMinutes: safety.pairAgeMinutes,
        reasons: safety.reasons,
      });
      return { delivered: 0, failed: 0 };
    }
    launchType=safety.launchType ?? 'UNKNOWN';paidCreator=safety.ponsDeployer;paidSecurityNote=safety.securityNote ?? null;
    if(safety.devHoldingPercent!=null||safety.top10Percent!=null)paidOwnership = {devPercent: safety.devHoldingPercent ?? null, top10Percent: safety.top10Percent ?? null,
      top10Coverage: safety.top10Percent == null ? 'UNAVAILABLE' : 'INDEXED_SAMPLE'};
    console.log('[AlphaSemanticDelivery] Robinhood DEX_PAID passed event safety gate.', {
      alertEventId: args.event.id,
      token: args.event.assetId,
      marketCapUsd: safety.marketCapUsd,
      liquidityUsd: safety.liquidityUsd,
      pairAgeMinutes: safety.pairAgeMinutes,
      ponsDeployer: safety.ponsDeployer,
      ephemeral: ephemeralMode,
    });
  }

  let deliveryMessage = args.message;
  if (dependencies === productionDependencies && !args.preserveMessage && !ephemeralMode) {
    try {
      const comparison = await loadPriorDeliveredAlertComparison({ currentEventId: args.event.id, assetId: args.event.assetId, chain: args.event.chain });
      deliveryMessage = renderMomentumUpdate(comparison) ?? args.message;
    } catch (error) {
      console.warn('[AlphaSemanticDelivery] Comparison unavailable; using standard alert.', { alertEventId: args.event.id,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (launchType) deliveryMessage = labelLaunchType(deliveryMessage, launchType);

  const deliveryStartedAt = Date.now();
  const users = (await dependencies.getUsers()).sort((a, b) => recipientDelayMs(a, deliveryStartedAt) - recipientDelayMs(b, deliveryStartedAt));
  if (dependencies === productionDependencies && !deliveryMessage.includes('<b>OWNERSHIP</b>') && /^(robinhood|robinchain)$/i.test(args.event.chain ?? '')) {
    deliveryMessage = paidOwnership ? withOwnershipDisclosure(deliveryMessage, paidOwnership)
      : await discloseRobinhoodOwnership(deliveryMessage, args.event.assetId,
          paidCreator ?? (typeof args.event.rawSnapshot?.creator === 'string' ? args.event.rawSnapshot.creator : null),
          typeof args.event.rawSnapshot?.pairAddress === 'string' ? args.event.rawSnapshot.pairAddress : null,
          isUndelayedRiskEvent(args.event.type));
  }
  if(paidSecurityNote)deliveryMessage += `\n\n${paidSecurityNote}`;
  let deliveryButtons = args.buttons;
  if (dependencies === productionDependencies && args.event.chain === 'robinhood' && !isUndelayedRiskEvent(args.event.type)) {
    const card = args.event.type === 'DEX_PAID'
      ? decorateDexPaidAlert(deliveryMessage, deliveryButtons ?? [], args.event.assetId, 'PAID')
      : await discloseAlertDexPaid(deliveryMessage, deliveryButtons ?? [], args.event.assetId);
    deliveryMessage = card.text; deliveryButtons = card.buttons;
  }
  if (dependencies === productionDependencies && args.event.chain.toLowerCase() === 'robinhood' && !isUndelayedRiskEvent(args.event.type)) deliveryMessage = await discloseRobinhoodKeyStats(deliveryMessage,args.event.assetId,false,['DEX_PAID','BOOST'].includes(args.event.type)?(launchType==='PONS'?'Trusted PONS route':'Verified flags · not a guarantee'):undefined);
  const renderedCharacters = deliveryMessage.length;
  const renderedBytes = Buffer.byteLength(deliveryMessage, 'utf8');
  let delivered = 0; let failed = 0; let accepted = 0;
  for (const user of users) {
    if (!hasCapability(accessProfileForUser(user), 'opportunities.realtime')) continue;
    try {
      const liveFeed = semanticLiveFeed(args.event.type, args.event.chain);
      if (dependencies === productionDependencies && liveFeed && !await liveFeedEnabled(user.telegram_id, liveFeed)) continue;
      const preferenceKey = preferenceKeyForSemanticEvent(args.event);
      if (preferenceKey && !await dependencies.strategyEnabled(user.telegram_id, preferenceKey)) continue;

      if (dependencies === productionDependencies) await waitForRecipientDelivery(user, deliveryStartedAt, isUndelayedRiskEvent(args.event.type));

      // DEX payment claims survive DB outages, restarts and concurrent workers.
      // Keep an ambiguous Telegram result claimed rather than risk a duplicate.
      if (dependencies === productionDependencies && args.event.type === 'BOOST' && args.event.chain.toLowerCase() === 'robinhood') {
    const launch = await getPonsLaunchState(args.event.assetId, {requireCompleteFactoryVerification:true}).catch(() => null);
    const trusted = Boolean(launch?.exists && launch.token.toLowerCase() === args.event.assetId.toLowerCase());
    const safety = await routeBoostSecurity({tokenAddress:args.event.assetId, verifiedTrustedLaunchpad:trusted, requireExplicitSellability:true});
    if (!safety.allowed) { console.warn('[AlphaSemanticDelivery] Boost sellability blocked', {reason:safety.reason}); return {delivered:0,failed:0}; }
    launchType = trusted ? 'PONS' : 'CUSTOM';
  }
  let paidOwnership: OwnershipDisclosure | null = null;
  if (dependencies === productionDependencies && args.event.type === 'DEX_PAID') {
        if (!await claimDexRecipient(args.event.eventIdentity, user.telegram_id)) continue;
      }

      if (ephemeralMode) {
        if (!claimEphemeralDelivery(args.event, user)) continue;
        try {
          const sendResult = await dependencies.send(user.telegram_id, deliveryMessage, deliveryButtons);
          if (dependencies === productionDependencies) recordDeliveryAccepted(user, deliveryStartedAt, args.event.eventIdentity, isUndelayedRiskEvent(args.event.type));
          delivered += 1; accepted += 1;
          args.onTelegramAccepted?.(user);
          console.log('[AlphaSemanticDelivery] Telegram accepted via bounded persistence fallback.', {
            eventIdentity: args.event.eventIdentity,
            semanticEventType: args.event.type,
            telegramId: user.telegram_id,
            telegramMessageId: Number.isFinite(Number(sendResult)) ? Number(sendResult) : null,
          });
        } catch (error) {
          releaseEphemeralDelivery(args.event, user);
          failed += 1;
          args.onFailure?.(error);
          args.onRecipientFailure?.(user, error, 'telegram_send');
          const reason = error instanceof Error ? error.message : String(error);
          if (reason.includes('403')) await dependencies.blocked(user.telegram_id).catch(() => undefined);
          console.error('[AlphaSemanticDelivery] Ephemeral Telegram delivery failed:', {
            eventIdentity: args.event.eventIdentity,
            semanticEventType: args.event.type,
            telegramId: user.telegram_id,
            reason,
          });
        }
        continue;
      }

      const leaseToken = createLeaseToken();
      if (!await dependencies.reserve(args.event, user, leaseToken)) continue;
      const result = await deliverReservedTelegram({
        send: () => dependencies.send(user.telegram_id, deliveryMessage, deliveryButtons),
        complete: sendResult => dependencies.complete(args.event, user, leaseToken,
          Number.isFinite(Number(sendResult)) ? Number(sendResult) : null),
        release: () => dependencies.release(args.event, user, leaseToken),
      });
      if (result.sent) { if (dependencies === productionDependencies) recordDeliveryAccepted(user, deliveryStartedAt, args.event.eventIdentity, isUndelayedRiskEvent(args.event.type)); accepted += 1; args.onTelegramAccepted?.(user); }
      if (result.recorded) { delivered += 1; continue; }
      failed += 1;
      args.onRecipientFailure?.(user, result.error, result.sent ? 'delivery_completion' : 'telegram_send');
      if (result.sent) await dependencies.sentUnconfirmed(args.event, user, leaseToken).catch(error =>
        console.error('[AlphaSemanticDelivery] Could not preserve sent-unconfirmed state:', error));
      const reason = result.error instanceof Error ? result.error.message : String(result.error ?? 'unknown');
      args.onFailure?.(result.error);
      if (reason.includes('403')) await dependencies.blocked(user.telegram_id);
      console.error('[AlphaSemanticDelivery] Delivery failed:', { alertEventId: args.event.id,
        semanticEventType: args.event.type, recipientCount: users.length, renderedCharacters, renderedBytes,
        telegramErrorCategory: reason.includes('text is too long') ? 'MESSAGE_TOO_LONG' : reason.includes('403') ? 'RECIPIENT_BLOCKED' : 'SEND_FAILED',
        telegramId: user.telegram_id, sent: result.sent, reason });
    } catch (error) {
      failed += 1;
      args.onFailure?.(error);
      args.onRecipientFailure?.(user, error, 'recipient_setup');
      console.error('[AlphaSemanticDelivery] Recipient processing failed:', { alertEventId: args.event.id,
        semanticEventType: args.event.type, telegramId: user.telegram_id,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  if (ephemeralMode && delivered > 0) void recordRecoveryAlertAudit(args.event, delivered);
  if (dependencies === productionDependencies && isPositiveSemanticEvent(args.event.type)) {
    const raw = args.event.rawSnapshot ?? getEphemeralSemanticEventEvidence(args.event.eventIdentity) ?? {};
    void recordCompactAlert({chain:args.event.chain, token:args.event.assetId, feed:args.event.type,
      price:raw.price as number | null, marketCap:raw.marketCap as number | null,
      liquidity:raw.liquidity as number | null, pair:raw.pairAddress as string | null}, accepted);
  }
  return { delivered, failed };
}
