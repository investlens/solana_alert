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
  if (dependencies === productionDependencies && isPositiveSemanticEvent(args.event.type) &&
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

  if (dependencies === productionDependencies && args.event.type === 'DEX_PAID' && args.event.chain === 'robinhood') {
    const safety = await evaluateDexPaidAlertSafety(args.event.assetId);
    if (!safety.allowed) {
      console.warn('[AlphaSemanticDelivery] Robinhood DEX_PAID suppressed by strict safety gate.', {
        alertEventId: args.event.id,
        token: args.event.assetId,
        marketCapUsd: safety.marketCapUsd,
        liquidityUsd: safety.liquidityUsd,
        pairAgeMinutes: safety.pairAgeMinutes,
        reasons: safety.reasons,
      });
      return { delivered: 0, failed: 0 };
    }
    console.log('[AlphaSemanticDelivery] Robinhood DEX_PAID passed strict safety gate.', {
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

  const users = (await dependencies.getUsers()).sort((a, b) => {
    const rank = (tier: DeliverableUser['tier']) => tier === 'admin' ? 0 : tier === 'paid' ? 1 : 2;
    return rank(a.tier) - rank(b.tier);
  });
  const renderedCharacters = deliveryMessage.length;
  const renderedBytes = Buffer.byteLength(deliveryMessage, 'utf8');
  let delivered = 0; let failed = 0;
  for (const user of users) {
    if (!hasCapability(accessProfileForUser(user), 'opportunities.realtime')) continue;
    try {
      const preferenceKey = preferenceKeyForSemanticEvent(args.event);
      if (preferenceKey && !await dependencies.strategyEnabled(user.telegram_id, preferenceKey)) continue;

      if (ephemeralMode) {
        if (!claimEphemeralDelivery(args.event, user)) continue;
        try {
          const sendResult = await dependencies.send(user.telegram_id, deliveryMessage, args.buttons);
          delivered += 1;
          args.onTelegramAccepted?.(user);
          console.log('[AlphaSemanticDelivery] Ephemeral Telegram accepted during DB outage.', {
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
        send: () => dependencies.send(user.telegram_id, deliveryMessage, args.buttons),
        complete: sendResult => dependencies.complete(args.event, user, leaseToken,
          Number.isFinite(Number(sendResult)) ? Number(sendResult) : null),
        release: () => dependencies.release(args.event, user, leaseToken),
      });
      if (result.sent) args.onTelegramAccepted?.(user);
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
  return { delivered, failed };
}
