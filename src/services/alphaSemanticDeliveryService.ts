import { getDeliverableUsers, markTelegramUserBlocked, type DeliverableUser } from '../core/delivery.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import { createLeaseToken, DELIVERY_LEASE_SECONDS } from './reservationLease.js';
import { DEX_PAID_STRATEGY_KEY, isStrategyEnabledForUser, X_REPUTED_MENTION_STRATEGY_KEY } from './strategyService.js';
import { supabase } from './supabase.js';
import { sendTelegramWithMessageId } from './telegram.js';
import { deliverReservedTelegram } from './telegramDeliveryContract.js';
import { loadPriorDeliveredAlertComparison, renderMomentumUpdate } from './alertComparisonService.js';

type InlineButton = { text: string; callback_data?: string; url?: string };

export type UserFacingSemanticEvent = {
  id: number; eventIdentity: string; type: string; assetId: string; chain: string;
  strategyKey?: string | null;
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

export async function deliverAlphaSemanticEvent(args: {
  event: UserFacingSemanticEvent; message: string; buttons?: InlineButton[][]; preserveMessage?: boolean;
  onFailure?: (error: unknown) => void;
}, dependencies: SemanticDeliveryDependencies = productionDependencies): Promise<{ delivered: number; failed: number }> {
  let deliveryMessage = args.message;
  if (dependencies === productionDependencies && !args.preserveMessage) {
    try {
      const comparison = await loadPriorDeliveredAlertComparison({ currentEventId: args.event.id, assetId: args.event.assetId, chain: args.event.chain });
      deliveryMessage = renderMomentumUpdate(comparison) ?? args.message;
    } catch (error) {
      console.warn('[AlphaSemanticDelivery] Comparison unavailable; using standard alert.', { alertEventId: args.event.id,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
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
      const leaseToken = createLeaseToken();
      if (!await dependencies.reserve(args.event, user, leaseToken)) continue;
      const result = await deliverReservedTelegram({
        send: () => dependencies.send(user.telegram_id, deliveryMessage, args.buttons),
        complete: sendResult => dependencies.complete(args.event, user, leaseToken,
          Number.isFinite(Number(sendResult)) ? Number(sendResult) : null),
        release: () => dependencies.release(args.event, user, leaseToken),
      });
      if (result.recorded) { delivered += 1; continue; }
      failed += 1;
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
      console.error('[AlphaSemanticDelivery] Recipient processing failed:', { alertEventId: args.event.id,
        semanticEventType: args.event.type, telegramId: user.telegram_id,
        reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { delivered, failed };
}
