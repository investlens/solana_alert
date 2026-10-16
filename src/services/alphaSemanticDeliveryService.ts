import {acquireBoostRecipientClaim} from './boostDeliveryGuard.js';
import {forEachDeliveryRecipient} from './recipientDeliveryTiming.js';
import { telegramRecipientUnavailable } from '../ui/alphaosPhotoDelivery.js';
import { schedulePromotionCardEnrichment, type PromotionEditTarget } from './promotionCardEnrichment.js';
import type { PromotionCardArgs } from '../ui/promotionEventCard.js';
import { recordFeedDelivery,recordPromotionAudit } from './feedDeliveryHealth.js';
import { buildPromotionEventCard } from '../ui/promotionEventCard.js';
import { discloseRobinhoodKeyStats, cachedRobinhoodAlertStats } from './alertKeyStatsService.js';
import {robinhoodAlertSafety} from './robinhoodAlertSafety.js';
import { routeBoostSecurity } from '../chains/robinhood/boostSecurityRouter.js';
import { getVerifiedRobinhoodLaunchpad } from '../chains/robinhood/trustedLaunchpad.js';
import { withOwnershipDisclosure, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';
import { decorateDexPaidAlert, discloseAlertDexPaid } from './alertDexPaidDisclosure.js';
import { discloseRobinhoodOwnership, cachedRobinhoodOwnership } from './alertOwnershipService.js';
import { liveFeedEnabled, semanticLiveFeed } from './liveAlertPreferences.js';
import { claimSharedDelivery } from './sharedJsonCache.js';
import { acquireRecipientClaim, retryTelegramRejection, telegramExplicitRejection } from './recipientDeliveryClaim.js';
import { recordCompactAlert } from './compactAlertOutcomes.js';
import { recordRecoveryAlertAudit, type AcceptedRecoveryRecipient } from './recoveryAlertAudit.js';
import { waitForRecipientDelivery, isUndelayedRiskEvent, recipientDelayMs, recordDeliveryAccepted } from './recipientDeliveryTiming.js';
import { getDeliverableUsers, markTelegramUserBlocked, type DeliverableUser } from '../core/delivery.js';
import { accessProfileForUser, hasCapability } from '../product/capabilities.js';
import { evaluateDexPaidAlertSafety } from '../chains/robinhood/security/dexPaidAlertSafetyGate.js';
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
  recipientClaim?:typeof acquireRecipientClaim;
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
  protectBoostRecipients?:boolean;
  onFailure?: (error: unknown) => void;
  onTelegramAccepted?: (user: DeliverableUser) => void;
  onSendStarted?: () => void;
  onRecipientFailure?: (user: DeliverableUser, error: unknown,
    stage: 'recipient_setup' | 'telegram_send' | 'delivery_completion') => void;
}, dependencies: SemanticDeliveryDependencies = productionDependencies): Promise<{ delivered: number; failed: number; alreadyConfirmed?:number;withheld?:true }> {
  const ephemeralMode = dependencies === productionDependencies && (args.event.ephemeral === true || args.event.id < 0);
  let launchType: LaunchClassification | null = null;
  let exitPairId:string|undefined;
  let positiveSecurityNote: string | null = null;
  if (dependencies === productionDependencies && isPositiveSemanticEvent(args.event.type) &&
      !(['DEX_PAID','BOOST'].includes(args.event.type) && args.event.chain.toLowerCase() === 'robinhood')) {
    if (args.event.chain.toLowerCase() === 'robinhood') {
      // Provenance comes before snapshot loading: a verified PONS launch does
      // not depend on custom LP evidence or a stored security snapshot.
      const {origin,security:gate}=await robinhoodAlertSafety(args.event.assetId);
      launchType = origin?.launchType ?? 'UNKNOWN';
      if (!gate.allowed) {
        console.warn('[AlphaSemanticDelivery] WITHHELD custom positive exit unverified', {reason:gate.reason});
        return {delivered:0,failed:0};
      }
      exitPairId=gate.exitPairId;
      if (!origin) positiveSecurityNote=gate.reason;
    } else if (args.event.chain.toLowerCase() === 'solana') {
      const raw = args.event.rawSnapshot ?? (ephemeralMode ? getEphemeralSemanticEventEvidence(args.event.eventIdentity) : await loadSemanticRawSnapshot(args.event.id).catch(()=>null));
      const security=evaluatePositiveAlertSecurity({launchType:'CUSTOM',raw});
      if (!security.allowed) return {delivered:0,failed:0};
      launchType=security.launchType;
    }
  }

  let boostSecurityNote: string | null = null;
  let lpStatus: string | null = null;
  if (dependencies === productionDependencies && args.event.type === 'BOOST' && args.event.chain.toLowerCase() === 'robinhood') {
    const origin = await getVerifiedRobinhoodLaunchpad(args.event.assetId).catch(() => null);
    const trusted = origin?.launchType === 'PONS';
    const safety = await routeBoostSecurity({tokenAddress:args.event.assetId, verifiedTrustedLaunchpad:trusted, requireExplicitSellability:true, allowUnknownSellability:true,promotionEvent:true});
    if (!safety.allowed) { console.warn('[AlphaSemanticDelivery] Boost sellability blocked', {reason:safety.reason}); return {delivered:0,failed:0}; }
    launchType = origin?.launchType ?? 'UNKNOWN';
    exitPairId=safety.exitPairId;
    lpStatus = safety.liquidity?.status ?? null;
    boostSecurityNote = safety.reason;
  }
  let paidOwnership: OwnershipDisclosure | null = null;
  let paidCreator: string | null = null;
  let paidSecurityNote: string | null = null;
  if (dependencies === productionDependencies && args.event.type === 'DEX_PAID' && args.event.chain.toLowerCase() === 'robinhood') {
    const expectedPayment=(args.event.rawSnapshot??(ephemeralMode?getEphemeralSemanticEventEvidence(args.event.eventIdentity):null))?.paymentTimestamp;
    const safety = await evaluateDexPaidAlertSafety(args.event.assetId,typeof expectedPayment==='number'?expectedPayment:undefined);
    if (!safety.allowed) {
      console.warn('[AlphaSemanticDelivery] Robinhood DEX_PAID suppressed by event safety gate.', {
        alertEventId: args.event.id,
        token: args.event.assetId,
        marketCapUsd: safety.marketCapUsd,
        liquidityUsd: safety.liquidityUsd,
        pairAgeMinutes: safety.pairAgeMinutes,
        reasons: safety.reasons,
      });
      if(typeof expectedPayment==='number')recordPromotionAudit('RH_DEX_PAID',`${args.event.assetId.toLowerCase()}:${expectedPayment<10_000_000_000?expectedPayment*1000:expectedPayment}`,safety.reasons.some(reason=>/HARD BLOCK|PAYMENT_CHANGED/i.test(reason))?'BLOCKED':'WATCHED');
      return { delivered: 0, failed: 0,withheld:true };
    }
    if(typeof expectedPayment==='number')recordPromotionAudit('RH_DEX_PAID',`${args.event.assetId.toLowerCase()}:${expectedPayment<10_000_000_000?expectedPayment*1000:expectedPayment}`,'READY');
    exitPairId=safety.exitPairId;
    lpStatus=safety.lpStatus ?? null;
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
  if (positiveSecurityNote) deliveryMessage += '\n\n' + positiveSecurityNote;

  if(dependencies===productionDependencies && ['DEX_PAID','BOOST'].includes(args.event.type) && args.event.chain==='robinhood') {
    deliveryMessage=await discloseRobinhoodKeyStats(deliveryMessage,args.event.assetId,false,
      launchType==='PONS'||launchType==='FLAP'?`Trusted ${launchType} route`:'See sellability disclosure');
    // Resolve the public exact-contract creator before starting ownership work.
    paidCreator=paidCreator ?? cachedRobinhoodAlertStats(args.event.assetId)?.creator ?? null;
  }
  const outcomeStats = args.event.chain === 'robinhood' && ['DEX_PAID','BOOST'].includes(args.event.type) ? cachedRobinhoodAlertStats(args.event.assetId) : null;
  const deliveryStartedAt = Date.now();
  const users = (await dependencies.getUsers()).sort((a, b) => recipientDelayMs(a, deliveryStartedAt) - recipientDelayMs(b, deliveryStartedAt));
  if (dependencies === productionDependencies && (!deliveryMessage.includes('<b>OWNERSHIP</b>') || ['DEX_PAID','BOOST'].includes(args.event.type)) && /^(robinhood|robinchain)$/i.test(args.event.chain ?? '')) {
    deliveryMessage = paidOwnership?.devPercent != null ? withOwnershipDisclosure(deliveryMessage, paidOwnership)
      : await discloseRobinhoodOwnership(deliveryMessage, args.event.assetId,
          paidCreator ?? (typeof args.event.rawSnapshot?.creator === 'string' ? args.event.rawSnapshot.creator : null),
          cachedRobinhoodAlertStats(args.event.assetId)?.chartUrl?.match(/\/robinhood\/(0x[a-fA-F0-9]{40,64})/)?.[1] ?? (cachedRobinhoodAlertStats(args.event.assetId)?.authoritativeVenue ? null : typeof args.event.rawSnapshot?.pairAddress === 'string' ? args.event.rawSnapshot.pairAddress : null),
          isUndelayedRiskEvent(args.event.type) || ['DEX_PAID','BOOST'].includes(args.event.type));
    if(paidOwnership?.devPercent==null && paidOwnership?.top10Percent!=null)deliveryMessage=withOwnershipDisclosure(deliveryMessage,paidOwnership);
  }
  // Read the evidence already fetched for the card; no additional provider calls.
  const ownershipCapturedAt = Date.now();
  const baselineOwnership = dependencies === productionDependencies && args.event.chain === 'robinhood'
    ? cachedRobinhoodOwnership(args.event.assetId, paidCreator,
        outcomeStats?.chartUrl?.match(/\/robinhood\/(0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64}))(?:[?#]|$)/)?.[1] ?? null)
    : null;
  if(paidSecurityNote)deliveryMessage += `\n\n${paidSecurityNote}`;
  let deliveryButtons = args.buttons;
  if (dependencies === productionDependencies && args.event.chain === 'robinhood' && !isUndelayedRiskEvent(args.event.type)) {
    const card = args.event.type === 'DEX_PAID'
      ? decorateDexPaidAlert(deliveryMessage, deliveryButtons ?? [], args.event.assetId, 'PAID')
      : await discloseAlertDexPaid(deliveryMessage, deliveryButtons ?? [], args.event.assetId);
    deliveryMessage = card.text; deliveryButtons = card.buttons;
  }
  // Promotion stats were already resolved above. A second cold-cache wait can
  // add another 2.5 seconds without changing eligibility; existing card edits
  // fill optional evidence as it finishes.
  if (dependencies === productionDependencies && args.event.chain.toLowerCase() === 'robinhood' &&
      !isUndelayedRiskEvent(args.event.type) && !['DEX_PAID','BOOST'].includes(args.event.type)) {
    deliveryMessage = await discloseRobinhoodKeyStats(deliveryMessage,args.event.assetId);
  }
  if (dependencies === productionDependencies && ['DEX_PAID','BOOST'].includes(args.event.type) && args.event.chain==='robinhood') {
    const raw=args.event.rawSnapshot ?? getEphemeralSemanticEventEvidence(args.event.eventIdentity);
    const card=buildPromotionEventCard({kind:args.event.type as 'DEX_PAID'|'BOOST',text:deliveryMessage,token:args.event.assetId,launchType,
      stats:cachedRobinhoodAlertStats(args.event.assetId),securityNote:paidSecurityNote??boostSecurityNote,lpStatus,buttons:deliveryButtons??[],
      paymentTimestamp:typeof raw?.paymentTimestamp==='number'?raw.paymentTimestamp:null});
    deliveryMessage=card.text;deliveryButtons=card.buttons;
  }
  if(exitPairId){const cardPool=cachedRobinhoodAlertStats(args.event.assetId)?.chartUrl?.split('/').pop()?.split(/[?#]/)[0];if(cardPool?.toLowerCase()!==exitPairId.toLowerCase()){console.warn('[AlphaSemanticDelivery] WITHHELD checked exit pool differs from card venue');return {delivered:0,failed:0};}}
  const enrichmentTargets: PromotionEditTarget[] = [];
  const renderedCharacters = deliveryMessage.length;
  const renderedBytes = Buffer.byteLength(deliveryMessage, 'utf8');
  let delivered = 0; let failed = 0; let accepted = 0;let alreadyConfirmed=0;const countConfirmation=args.protectBoostRecipients===true||(dependencies===productionDependencies&&args.event.type==='DEX_PAID');
  const acceptedRecipients:AcceptedRecoveryRecipient[]=[];
  await forEachDeliveryRecipient(users, async user => {
    if (!hasCapability(accessProfileForUser(user), 'opportunities.realtime')) return;
    let recipientClaim: Awaited<ReturnType<typeof acquireRecipientClaim>> | undefined;
    let sendStarted = false;
    let telegramAccepted = false;
    try {
      const liveFeed = semanticLiveFeed(args.event.type, args.event.chain);
      if (dependencies === productionDependencies && liveFeed && !await liveFeedEnabled(user.telegram_id, liveFeed)) return;
      const preferenceKey = preferenceKeyForSemanticEvent(args.event);
      if (preferenceKey && !await dependencies.strategyEnabled(user.telegram_id, preferenceKey)) return;

      if (dependencies === productionDependencies) await waitForRecipientDelivery(user, deliveryStartedAt, isUndelayedRiskEvent(args.event.type));

      // DEX payment claims survive DB outages, restarts and concurrent workers.
      // Keep an ambiguous Telegram result claimed rather than risk a duplicate.
      if ((dependencies === productionDependencies && ['DEX_PAID','PUMPFUN_MOMENTUM'].includes(args.event.type)) || (args.event.type==='BOOST'&&args.protectBoostRecipients===true)) {
        recipientClaim = await (dependencies.recipientClaim??(args.protectBoostRecipients?acquireBoostRecipientClaim:acquireRecipientClaim))(args.event.eventIdentity, user.telegram_id);
        if (recipientClaim.state !== 'CLAIMED') {
          if(countConfirmation){if(recipientClaim.state==='DELIVERED')alreadyConfirmed++;else failed++;}

          if (liveFeed) recordFeedDelivery(liveFeed, recipientClaim.state === 'DELIVERED' ? 'DEDUPLICATED' : 'UNCONFIRMED');
          console.warn('[AlphaSemanticDelivery] Recipient claim skipped', JSON.stringify({eventIdentity:args.event.eventIdentity,
            telegramId:user.telegram_id,state:recipientClaim.state}));
          return;
        }
      }
      const send = async () => {
        sendStarted = true;
        args.onSendStarted?.();
        const result = await retryTelegramRejection(() => dependencies.send(user.telegram_id, deliveryMessage, deliveryButtons));
        telegramAccepted = true;
        if(ephemeralMode)acceptedRecipients.push({telegramId:String(user.telegram_id),tier:user.tier,messageId:typeof result==='number'?result:null,acceptedAt:new Date().toISOString()});
        if (recipientClaim?.state === 'CLAIMED') {
          try { await recipientClaim.finish(typeof result === 'number' ? result : null); }
          catch (error) { console.error('[AlphaSemanticDelivery] Accepted recipient confirmation unavailable', JSON.stringify({
            eventIdentity:args.event.eventIdentity,telegramId:user.telegram_id,reason:String(error)})); }
        }
        return result;
      };

      if (ephemeralMode) {
        if (!claimEphemeralDelivery(args.event, user)) {
          if (recipientClaim?.state === 'CLAIMED') await recipientClaim.release();
          return;
        }
        try {
          const sendResult = await send();
          if(dependencies===productionDependencies && typeof sendResult==='number' && enrichmentTargets.length<50)enrichmentTargets.push({chatId:user.telegram_id,messageId:sendResult});
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
          if (telegramExplicitRejection(error)) {
            releaseEphemeralDelivery(args.event, user);
            if (recipientClaim?.state === 'CLAIMED') await recipientClaim.release().catch(() => undefined);
          }
          failed += 1;
          args.onFailure?.(error);
          args.onRecipientFailure?.(user, error, 'telegram_send');
          const reason = error instanceof Error ? error.message : String(error);
          if (telegramRecipientUnavailable(error)) await dependencies.blocked(user.telegram_id).catch(() => undefined);
          console.error('[AlphaSemanticDelivery] Ephemeral Telegram delivery failed:', {
            eventIdentity: args.event.eventIdentity,
            semanticEventType: args.event.type,
            telegramId: user.telegram_id,
            reason,
          });
        }
        return;
      }

      const leaseToken = createLeaseToken();
      if (!await dependencies.reserve(args.event, user, leaseToken)) {
        if (recipientClaim?.state === 'CLAIMED') await recipientClaim.release();
        if(countConfirmation)failed++;
        return;
      }
      const result = await deliverReservedTelegram({
        send: async () => { const result=await send();
          if(dependencies===productionDependencies && typeof result==='number' && enrichmentTargets.length<50)enrichmentTargets.push({chatId:user.telegram_id,messageId:result});return result; },
        complete: sendResult => dependencies.complete(args.event, user, leaseToken,
          Number.isFinite(Number(sendResult)) ? Number(sendResult) : null),
        release: () => dependencies.release(args.event, user, leaseToken),
      });
      if (result.sent) { if (dependencies === productionDependencies) recordDeliveryAccepted(user, deliveryStartedAt, args.event.eventIdentity, isUndelayedRiskEvent(args.event.type)); accepted += 1; args.onTelegramAccepted?.(user); }
      if (result.recorded) { delivered += 1; return; }
      if (!result.sent && telegramExplicitRejection(result.error) && recipientClaim?.state === 'CLAIMED')
        await recipientClaim.release().catch(() => undefined);
      failed += 1;
      args.onRecipientFailure?.(user, result.error, result.sent ? 'delivery_completion' : 'telegram_send');
      if (result.sent) await dependencies.sentUnconfirmed(args.event, user, leaseToken).catch(error =>
        console.error('[AlphaSemanticDelivery] Could not preserve sent-unconfirmed state:', error));
      const reason = result.error instanceof Error ? result.error.message : String(result.error ?? 'unknown');
      args.onFailure?.(result.error);
      if (telegramRecipientUnavailable(result.error)) await dependencies.blocked(user.telegram_id);
      console.error('[AlphaSemanticDelivery] Delivery failed:', { alertEventId: args.event.id,
        semanticEventType: args.event.type, recipientCount: users.length, renderedCharacters, renderedBytes,
        telegramErrorCategory: reason.includes('text is too long') ? 'MESSAGE_TOO_LONG' : telegramRecipientUnavailable(result.error) ? 'RECIPIENT_BLOCKED' : 'PROCESSING_FAILED',
        telegramId: user.telegram_id, sent: result.sent, reason });
    } catch (error) {
      if (!sendStarted && !telegramAccepted && recipientClaim?.state === 'CLAIMED')
        await recipientClaim.release().catch(() => undefined);
      failed += 1;
      args.onFailure?.(error);
      args.onRecipientFailure?.(user, error, 'recipient_setup');
      console.error('[AlphaSemanticDelivery] Recipient processing failed:', { alertEventId: args.event.id,
        semanticEventType: args.event.type, telegramId: user.telegram_id,
        reason: error instanceof Error ? error.message : String(error) });
    }
  });
  if(dependencies===productionDependencies && args.event.chain==='robinhood' && ['DEX_PAID','BOOST'].includes(args.event.type)) {
    const raw=args.event.rawSnapshot ?? getEphemeralSemanticEventEvidence(args.event.eventIdentity);
    const evidence:PromotionCardArgs={kind:args.event.type as 'DEX_PAID'|'BOOST',text:deliveryMessage,token:args.event.assetId,launchType,stats:cachedRobinhoodAlertStats(args.event.assetId),securityNote:paidSecurityNote??boostSecurityNote,lpStatus,buttons:deliveryButtons??[],paymentTimestamp:typeof raw?.paymentTimestamp==='number'?raw.paymentTimestamp:null};
    schedulePromotionCardEnrichment(args.event.eventIdentity,evidence,enrichmentTargets,deliveryMessage);
  }
  if (dependencies === productionDependencies) {
    const feed = semanticLiveFeed(args.event.type,args.event.chain);
    if (feed) { recordFeedDelivery(feed,'ACCEPTED',accepted); recordFeedDelivery(feed,'PROCESSING_FAILED',failed); }
  }
  if (dependencies === productionDependencies && accepted > 0) void recordRecoveryAlertAudit(args.event, accepted, baselineOwnership, ownershipCapturedAt, ephemeralMode, acceptedRecipients);
  if (dependencies === productionDependencies && isPositiveSemanticEvent(args.event.type)) {
    const raw = args.event.rawSnapshot ?? getEphemeralSemanticEventEvidence(args.event.eventIdentity) ?? {};
    const stats=outcomeStats;
    const verifiedPair=stats?.source?.includes('DEXScreener')?stats.chartUrl?.match(/^https:\/\/dexscreener\.com\/robinhood\/(0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64}))(?:[?#]|$)/)?.[1]:null;
    void recordCompactAlert({chain:args.event.chain, token:args.event.assetId, feed:args.event.type,
      price:verifiedPair?stats!.price:raw.price as number | null, marketCap:verifiedPair?stats!.marketCap:raw.marketCap as number | null,
      liquidity:verifiedPair?stats!.liquidity:raw.liquidity as number | null, pair:verifiedPair??raw.pairAddress as string | null}, accepted);
  }
  return countConfirmation?{delivered,failed,alreadyConfirmed}:{ delivered, failed };
}
