export type LaunchVenue = { token_address: string; chain: string; protocol_version: string | null; curve_address: string | null; pool_address: string | null };
// A launch-time pool being null does not prove the token is still pre-bond.
// Require explicit venue evidence before presenting a secondary DEX pool as its market.
export function needsVenueConfirmation(launch: LaunchVenue | undefined, raw: Record<string, unknown>): boolean {
  if (!launch || !launch.curve_address) return false;
  const evidence = raw.marketEvidence;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return true;
  const e = evidence as Record<string, unknown>;
  const same=(a:unknown,b:string)=>typeof a==='string' && (/^0x[0-9a-f]+$/i.test(b)?a.toLowerCase()===b.toLowerCase():a===b);
  return !(same(e.token, launch.token_address) && e.chain === launch.chain && e.venueConfirmed === true
    && typeof e.observedAt === 'string' && Number.isFinite(Date.parse(e.observedAt)) && Date.parse(e.observedAt) <= Date.now() + 60_000
    && ((e.venue === 'PONS_CURVE' && same(e.curveAddress, launch.curve_address))
      || (e.venue === 'DEX' && e.graduated === true && typeof e.pairAddress === 'string' && typeof raw.pairAddress === 'string' && same(e.pairAddress, raw.pairAddress))));
}
