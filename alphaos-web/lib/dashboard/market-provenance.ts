export type LaunchVenue = { token_address: string; chain: string; protocol_version: string | null; curve_address: string | null; pool_address: string | null };
// A launch-time pool being null does not prove the token is still pre-bond.
// Require explicit venue evidence before presenting a secondary DEX pool as its market.
export function needsVenueConfirmation(launch: LaunchVenue | undefined, raw: Record<string, unknown>): boolean {
  if (!launch || !launch.curve_address) return false;
  const evidence = raw.marketEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return true;
  const e = evidence as Record<string, unknown>;
  return !(e.token === launch.token_address && e.chain === launch.chain && e.venueConfirmed === true
    && typeof e.observedAt === 'string' && Number.isFinite(Date.parse(e.observedAt))
    && ((e.venue === 'PONS_CURVE' && e.curveAddress === launch.curve_address)
      || (e.venue === 'DEX' && e.graduated === true && typeof e.pairAddress === 'string' && e.pairAddress === raw.pairAddress)));
}
