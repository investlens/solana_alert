export type PriceEvidence = {
  chain?: string | null;
  token?: string | null;
  price?: number | string | null;
  provenance?: string | null;
  quote?: string | null;
  marketIndexState?: string | null;
};

export type ComparablePriceResult =
  | { comparable: true; previous: number; current: number; changePct: number }
  | { comparable: false; reason: string };

const positive = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};
const normalized = (value: unknown) => String(value ?? '').trim().toLowerCase();
const indexedProvenance = (value: string) => new Set([
  'dexscreener_verified_base_pair', 'verified_market_index', 'dex_base_v1',
]).has(value);
const curveProvenance = (value: string) => /^pons_v\d+_curve_reserve_(ratio|spot)$/.test(value);

/** Conservative by design: numeric values are not comparable without matching identity and units. */
export function compareVerifiedPrices(previous: PriceEvidence, current: PriceEvidence): ComparablePriceResult {
  const previousPrice = positive(previous.price), currentPrice = positive(current.price);
  if (previousPrice == null || currentPrice == null) return { comparable: false, reason: 'MISSING_PRICE' };
  const previousChain = normalized(previous.chain), currentChain = normalized(current.chain);
  const previousToken = normalized(previous.token), currentToken = normalized(current.token);
  if (!previousChain || previousChain !== currentChain || !previousToken || previousToken !== currentToken) {
    return { comparable: false, reason: 'IDENTITY_MISMATCH' };
  }
  const previousProvenance = normalized(previous.provenance), currentProvenance = normalized(current.provenance);
  if (!previousProvenance || !currentProvenance) return { comparable: false, reason: 'MISSING_PROVENANCE' };
  const previousQuote = normalized(previous.quote), currentQuote = normalized(current.quote);
  if (previousQuote && currentQuote && previousQuote !== currentQuote) return { comparable: false, reason: 'QUOTE_MISMATCH' };
  const previousIndexed = indexedProvenance(previousProvenance), currentIndexed = indexedProvenance(currentProvenance);
  const previousCurve = curveProvenance(previousProvenance), currentCurve = curveProvenance(currentProvenance);
  if (previousIndexed !== currentIndexed || previousCurve !== currentCurve) {
    return { comparable: false, reason: 'CURVE_INDEX_PROVENANCE_MISMATCH' };
  }
  if (previousCurve && previousProvenance !== currentProvenance) {
    return { comparable: false, reason: 'CURVE_UNIT_MISMATCH' };
  }
  if (!previousIndexed && !previousCurve && previousProvenance !== currentProvenance) {
    return { comparable: false, reason: 'UNRECOGNIZED_PROVENANCE_MISMATCH' };
  }
  const previousIndexState = normalized(previous.marketIndexState), currentIndexState = normalized(current.marketIndexState);
  if (previousIndexState && currentIndexState && previousIndexState !== currentIndexState) {
    return { comparable: false, reason: 'MARKET_INDEX_STATE_MISMATCH' };
  }
  return { comparable: true, previous: previousPrice, current: currentPrice,
    changePct: ((currentPrice - previousPrice) / previousPrice) * 100 };
}
