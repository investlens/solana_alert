import { normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';
import { validOwnershipPercent, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';
import type { UserFacingSemanticEvent } from './alphaSemanticDeliveryService.js';
export function capturedOwnershipEvidence(ownership: OwnershipDisclosure | null | undefined, now = Date.now()) {
  const creator = ownership?.creator;
  const observedAt = ownership?.devObservedAt;
  const block = ownership?.devBlock;
  const percent = validOwnershipPercent(ownership?.devPercent);
  // Only a fresh, block-tagged balance observation establishes a baseline.
  if (!creator || !/^0x[a-f0-9]{40}$/i.test(creator) || /^0x0{40}$/i.test(creator) || observedAt == null
    || !Number.isFinite(observedAt) || now < observedAt || now - observedAt > 60_000
    || !block || block.length > 64 || !/^(?:0x[a-f0-9]+|[0-9]+)$/i.test(block) || percent == null) return null;
  return { creator, percent, observedAt: new Date(observedAt).toISOString(), block };
}
export function buildRecoveryAlertAudit(event: UserFacingSemanticEvent, acceptedRecipients: number, now = new Date(), ownership?: OwnershipDisclosure | null, capturedAt = now.getTime()) {
  if (acceptedRecipients <= 0 || !event.eventIdentity || !event.assetId) return null;
  const market = normalizeNotificationMarketContext(event.rawSnapshot);
  const evidence = capturedOwnershipEvidence(ownership, capturedAt);
  return {
    event_identity: event.eventIdentity, asset_id: event.assetId, chain: event.chain,
    strategy_key: event.strategyKey ?? null, lifecycle_action: 'OBSERVE', lifecycle_state: 'RECOVERY_DELIVERED',
    alert_type: event.type, semantic_event_type: event.type, symbol: market.symbol, token_name: market.name,
    price: market.price, market_cap: market.marketCap, fdv: market.fdv,
    liquidity: market.liquidity, volume_5m: market.volume5m,
    chart_available: Boolean(market.chartUrl), alerted_at: now.toISOString(),
    dev_holding_percent: evidence?.percent ?? null, dev_holding_source: evidence ? 'ON_CHAIN_BALANCE' : null,
    dev_holding_evidence: evidence ? `Creator ${evidence.creator} balance at block ${evidence.block}; observed ${evidence.observedAt}` : null,
    creator_evidence: evidence ? { address: evidence.creator, observedAt: evidence.observedAt, block: evidence.block } : null,
    raw_snapshot: { deliveryMode: 'RECOVERY', acceptedRecipients, performanceBaselineVerified: false },
  };
}
let active = false; let pauseUntil = 0;
// One compact audit row per accepted event; never retry Telegram to repair audit.
export async function recordRecoveryAlertAudit(event: UserFacingSemanticEvent, accepted: number, ownership?: OwnershipDisclosure | null, capturedAt = Date.now(), recovery = true): Promise<void> {
  const row = buildRecoveryAlertAudit(event, accepted, new Date(), ownership, capturedAt);
  if (!row || (!recovery && !row.creator_evidence) || active || Date.now() < pauseUntil) return;
  active = true;
  try {
    const { supabase } = await import('./supabase.js');
    const write = recovery
      ? supabase.from('alpha_alert_events').upsert(row, { onConflict: 'event_identity', ignoreDuplicates: true })
      : supabase.from('alpha_alert_events').update({ dev_holding_percent: row.dev_holding_percent,
          dev_holding_source: row.dev_holding_source, dev_holding_evidence: row.dev_holding_evidence }).eq('event_identity', event.eventIdentity);
    const { error } = await write.abortSignal(AbortSignal.timeout(1500));
    if (error) throw error;
    console.log('[RecoveryAlertAudit] RECORDED', { type: event.type, token: event.assetId, accepted });
  } catch (error) {
    pauseUntil = Date.now() + 60_000;
    console.warn('[RecoveryAlertAudit] UNAVAILABLE', { reason: error instanceof Error ? error.message : String(error) });
  } finally { active = false; }
}
