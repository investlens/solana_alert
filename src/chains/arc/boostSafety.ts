export type ArcBoostSafety = { allowed: boolean; reason: string; devHoldingPercent?: number | null };
export function arcBoostSafetyFromEvidence(evidence: Record<string, unknown> | null | undefined): ArcBoostSafety {
  if (!evidence) return { allowed: false, reason: 'honeypot evidence unavailable' };
  if (String(evidence.is_honeypot) === '1') return { allowed: false, reason: 'honeypot flag' };
  if (String(evidence.cannot_sell_all) === '1') return { allowed: false, reason: 'cannot-sell flag' };
  if (String(evidence.is_honeypot) !== '0' || String(evidence.cannot_sell_all) !== '0')
    return { allowed: false, reason: 'honeypot/sell evidence incomplete' };
  const raw = Number(evidence.creator_percent ?? evidence.owner_percent ?? NaN);
  const holding = Number.isFinite(raw) && raw >= 0 && raw <= 100 ? (raw <= 1 ? raw * 100 : raw) : null;
  return { allowed: true, reason: 'no honeypot/cannot-sell flag detected; LP check intentionally skipped for BOOST', devHoldingPercent: holding };
}
export async function processArcBoostObservation(totals: Map<string, number>, boost: { tokenAddress: string; totalAmount: number },
  deliver: (eventType: 'NEW' | 'INCREASE') => Promise<boolean>): Promise<void> {
  if (!Number.isFinite(boost.totalAmount) || boost.totalAmount <= 0) return;
  const key = boost.tokenAddress.toLowerCase(); const previous = totals.get(key);
  if (previous != null && boost.totalAmount <= previous) return;
  if (await deliver(previous == null ? 'NEW' : 'INCREASE')) totals.set(key, boost.totalAmount);
}
