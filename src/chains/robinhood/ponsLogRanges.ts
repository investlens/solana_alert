// Bound provenance fallback queries. Never send a deployment-to-latest range.
export const PONS_LOG_RANGE_BLOCKS = 1_000_000n;
export function ponsLogRange(start: bigint, end: bigint) {
  if (end < start) return null;
  const from = end - PONS_LOG_RANGE_BLOCKS + 1n > start ? end - PONS_LOG_RANGE_BLOCKS + 1n : start;
  return { from, to: end, next: from > start ? from - 1n : null };
}
