import { normalizeNotificationMarketContext } from '../ui/notificationMarketContext.js';
import type { UserFacingSemanticEvent } from './alphaSemanticDeliveryService.js';
export function buildRecoveryAlertAudit(event: UserFacingSemanticEvent, acceptedRecipients: number, now = new Date()) {
  if (acceptedRecipients <= 0 || !event.eventIdentity || !event.assetId) return null;
  const market = normalizeNotificationMarketContext(event.rawSnapshot);
  return {
    event_identity: event.eventIdentity, asset_id: event.assetId, chain: event.chain,
    strategy_key: event.strategyKey ?? null, lifecycle_action: 'OBSERVE', lifecycle_state: 'RECOVERY_DELIVERED',
    alert_type: event.type, semantic_event_type: event.type, symbol: market.symbol, token_name: market.name,
    price: market.price, market_cap: market.marketCap, fdv: market.fdv,
    liquidity: market.liquidity, volume_5m: market.volume5m,
    chart_available: Boolean(market.chartUrl), alerted_at: now.toISOString(),
    raw_snapshot: { deliveryMode: 'RECOVERY', acceptedRecipients, performanceBaselineVerified: false },
  };
}
let active = false; let pauseUntil = 0;
// One compact audit row per accepted event; never retry Telegram to repair audit.
export async function recordRecoveryAlertAudit(event: UserFacingSemanticEvent, accepted: number): Promise<void> {
  const row = buildRecoveryAlertAudit(event, accepted);
  if (!row || active || Date.now() < pauseUntil) return;
  active = true;
  try {
    const { supabase } = await import('./supabase.js');
    const { error } = await supabase.from('alpha_alert_events').upsert(row, { onConflict: 'event_identity', ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(1500));
    if (error) throw error;
    console.log('[RecoveryAlertAudit] RECORDED', { type: event.type, token: event.assetId, accepted });
  } catch (error) {
    pauseUntil = Date.now() + 60_000;
    console.warn('[RecoveryAlertAudit] UNAVAILABLE', { reason: error instanceof Error ? error.message : String(error) });
  } finally { active = false; }
}
