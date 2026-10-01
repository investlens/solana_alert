import type { AlphaCanonicalEventType } from '../../services/alphaCanonicalEvent.js';

export type BoostCanonicalEvent = {
  type: Extract<AlphaCanonicalEventType, 'BOOST_DETECTED' | 'BOOST_INCREASED' | 'MAX_BOOST_500_PLUS'>;
  previousTotal: number | null;
  currentTotal: number;
  boostAdded: number;
  crossedMaxThreshold: boolean;
};

export const MAX_BOOST_THRESHOLD = 500;

/**
 * Pure/local BOOST classification. This deliberately performs no RPC, HTTP or DB work.
 * The existing observer supplies the current and previously observed totals.
 */
export function classifyBoostCanonicalEvent(args: {
  previousTotal?: number | null;
  currentTotal: number;
  feedAmount?: number | null;
}): BoostCanonicalEvent | null {
  const previousTotal = Number.isFinite(args.previousTotal) ? Number(args.previousTotal) : null;
  const currentTotal = Number(args.currentTotal);
  if (!Number.isFinite(currentTotal) || currentTotal <= 0) return null;
  if (previousTotal != null && currentTotal <= previousTotal) return null;

  const feedAmount = Number(args.feedAmount);

  // Recovery/redeploy safety: when the observer has no local prior total but the
  // provider says only part of currentTotal was newly added, this is an accumulated
  // historical BOOST state rather than a trustworthy fresh detection. Absorb it
  // silently; the next genuine increase will have previousTotal and alert normally.
  if (previousTotal == null && Number.isFinite(feedAmount) && feedAmount > 0 && feedAmount < currentTotal) {
    return null;
  }

  const boostAdded = previousTotal == null
    ? (Number.isFinite(feedAmount) && feedAmount > 0 ? feedAmount : currentTotal)
    : currentTotal - previousTotal;

  const crossedMaxThreshold = currentTotal >= MAX_BOOST_THRESHOLD
    && (previousTotal == null || previousTotal < MAX_BOOST_THRESHOLD);

  if (crossedMaxThreshold) {
    return {
      type: 'MAX_BOOST_500_PLUS',
      previousTotal,
      currentTotal,
      boostAdded,
      crossedMaxThreshold: true,
    };
  }

  return {
    type: previousTotal == null ? 'BOOST_DETECTED' : 'BOOST_INCREASED',
    previousTotal,
    currentTotal,
    boostAdded,
    crossedMaxThreshold: false,
  };
}

export function boostCanonicalTitle(event: BoostCanonicalEvent): string {
  if (event.type === 'MAX_BOOST_500_PLUS') return '🚨🔥 MAX BOOST 500+';
  if (event.type === 'BOOST_INCREASED') return '🔥 BOOST INCREASED';
  return '🚀 BOOST DETECTED';
}

/** Remember silently absorbed history so a later real increase can be classified. */
export function observeBoostCanonicalEvent(totals: Map<string, number>, tokenAddress: string,
  currentTotal: number, feedAmount: number): BoostCanonicalEvent | null {
  const key = tokenAddress.trim().toLowerCase();
  const previousTotal = totals.get(key);
  const event = classifyBoostCanonicalEvent({ previousTotal, currentTotal, feedAmount });
  if (!event && previousTotal == null && Number.isFinite(currentTotal) && currentTotal > 0
    && Number.isFinite(feedAmount) && feedAmount > 0 && feedAmount < currentTotal) {
    totals.set(key, currentTotal);
  }
  // Fresh events remain unacknowledged until security/delivery handles them.
  return event;
}
