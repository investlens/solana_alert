import { supabase } from './supabase.js';
import { claimSharedDelivery } from './sharedJsonCache.js';

const CLAIM_TTL_MS = 30 * 24 * 60 * 60_000;
export function boostDeliveryIdentities(token: string, total: number): string[] {
  return ['BOOST_DETECTED', 'BOOST_INCREASED', 'MAX_BOOST_500_PLUS']
    .map(type => `v2:BOOST:${token.toLowerCase()}:${type}:${total}`);
}
async function previouslyAccepted(token: string, total: number): Promise<boolean> {
  const { data, error } = await supabase.from('alpha_alert_events').select('id,raw_snapshot')
    .eq('chain', 'robinhood').in('event_identity', boostDeliveryIdentities(token, total))
    .limit(3).abortSignal(AbortSignal.timeout(1500));
  if (error) throw error;
  if (data?.some(row => (Number(row.raw_snapshot?.acceptedRecipients) > 0 || row.raw_snapshot?.boostDeliveryAccepted === true))) return true;
  if (!data?.length) return false;
  const deliveries = await supabase.from('alpha_alert_event_deliveries').select('id')
    .in('alert_event_id', data.map(row => row.id))
    .in('metadata->>state', ['DELIVERED', 'SENT_UNCONFIRMED']).limit(1)
    .abortSignal(AbortSignal.timeout(1500));
  if (deliveries.error) throw deliveries.error;
  return Boolean(deliveries.data?.length);
}
// Existing audit rows remain the permanent backstop; Redis stores only one small,
// expiring claim per eligible token/total. No discovery rows or new DB tables.
export async function claimBoostDelivery(token: string, total: number, dependencies = {
  previouslyAccepted, claim: claimSharedDelivery,
}): Promise<'CLAIMED' | 'EXISTS' | 'UNAVAILABLE'> {
  if (!/^0x[a-f0-9]{40}$/i.test(token) || !Number.isSafeInteger(total) || total <= 0) return 'UNAVAILABLE';
  try {
    if (await dependencies.previouslyAccepted(token, total)) return 'EXISTS';
    return await dependencies.claim(`alphaos:delivery:robinhood:boost:${token.toLowerCase()}:${total}`, CLAIM_TTL_MS);
  } catch { return 'UNAVAILABLE'; }
}

export async function markBoostDeliveryAccepted(eventIdentity: string, rawSnapshot: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await supabase.from('alpha_alert_events')
      .update({ raw_snapshot: { ...rawSnapshot, boostDeliveryAccepted: true } })
      .eq('chain', 'robinhood').eq('event_identity', eventIdentity)
      .abortSignal(AbortSignal.timeout(1500));
    if (error) throw error;
  } catch {
    // The pre-send Redis claim still prevents ambiguous or partial replay.
    console.warn('[BoostDeliveryGuard] Acceptance audit unavailable; shared claim retained');
  }
}
