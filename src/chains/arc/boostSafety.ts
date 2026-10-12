import type {ArcObservedSelling} from './observedSelling.js';
export type ArcBoostSafety = { receiptFallbackEligible?:boolean;taxesUnverified?:boolean;sellabilityMethod?:'SIMULATED_EXIT'|'OBSERVED_SELLS'; observedSelling?:ArcObservedSelling; lpStatus?:'LOCKED'|'BURNED'|'UNLOCKED'|'UNKNOWN';allowed: boolean; reason: string; sellabilityBlocked?: boolean; sellabilityVerified?: boolean; creator?: string | null; devHoldingPercent?: number | null; top10Percent?: number | null };
export function arcBoostSafetyFromEvidence(evidence: Record<string, unknown> | null | undefined): ArcBoostSafety {
  if (!evidence) return { allowed: false, reason: 'honeypot evidence unavailable' };
  for (const field of ['buy_tax','sell_tax','transfer_tax']) {
    const value=evidence[field];
    if(value!=null && value!=='' && (!Number.isFinite(Number(value)) || Number(value)<0 || Number(value)>0.10)) return {allowed:false,sellabilityBlocked:true,reason:'Excessive reported token fee'};
  }
  // GoPlus percentages are fractions of supply. Owner is not necessarily creator.
  const fraction = (value: unknown): number | null => {
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim())) return null;
    const raw = Number(value);
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw * 100 : null;
  };
  const holding = fraction(evidence.creator_percent);
  const holders = Array.isArray(evidence.holders) ? evidence.holders as Record<string, unknown>[] : [];
  const eligible = holders.filter(h => String(h.is_contract) === '0' && !/^0x(?:0{40}|0{36}dead)$/i.test(String(h.address ?? '')));
  const portions = eligible.map(h => fraction(h.percent));
  // Partial provider lists are explicitly labelled; never infer complete coverage.
  const top10Percent = portions.length && portions.every(p => p != null)
    ? portions.sort((a,b) => b! - a!).slice(0,10).reduce<number>((sum,p) => sum + p!, 0) : null;
  const creator=typeof evidence.creator_address==='string' && /^0x[a-fA-F0-9]{40}$/.test(evidence.creator_address) && !/^0x0{40}$/i.test(evidence.creator_address) ? evidence.creator_address : null;
  const ownership={creator,devHoldingPercent:holding,top10Percent:top10Percent!=null && top10Percent<=100?top10Percent:null};
  if (String(evidence.is_honeypot) === '1') return { ...ownership, allowed: false, sellabilityBlocked:true, reason: 'honeypot flag' };
  if (String(evidence.cannot_sell_all) === '1') return { ...ownership, allowed: false, sellabilityBlocked:true, reason: 'cannot-sell flag' };
  if (String(evidence.is_honeypot) !== '0' || String(evidence.cannot_sell_all) !== '0')
    return { ...ownership, allowed: false, taxesUnverified:['buy_tax','sell_tax'].some(field=>evidence[field]==null||evidence[field]===''), receiptFallbackEligible:String(evidence.is_honeypot)==='0' && (evidence.cannot_sell_all==null || evidence.cannot_sell_all==='') &&
      ['buy_tax','sell_tax','transfer_tax'].every(field=>evidence[field]==null||evidence[field]===''||(Number.isFinite(Number(evidence[field]))&&Number(evidence[field])>=0&&Number(evidence[field])<=0.10)), reason: 'honeypot/sell evidence incomplete' };
  return { allowed: true, sellabilityVerified:true, reason: 'no honeypot/cannot-sell flag detected; LP check intentionally skipped for BOOST',
    ...ownership };
}
export async function processArcBoostObservation(totals: Map<string, number>, boost: { tokenAddress: string; totalAmount: number },
  deliver: (eventType: 'NEW' | 'INCREASE') => Promise<boolean>): Promise<void> {
  if (!Number.isFinite(boost.totalAmount) || boost.totalAmount <= 0) return;
  const key = boost.tokenAddress.toLowerCase(); const previous = totals.get(key);
  if (previous != null && boost.totalAmount <= previous) return;
  if (await deliver(previous == null ? 'NEW' : 'INCREASE')) totals.set(key, boost.totalAmount);
}

// DEX payments surface missing evidence as a warning; confirmed exit restrictions still block.
export function arcDexPaidSafety<T extends ArcBoostSafety>(safety: T): T & ArcBoostSafety {
 if(safety.allowed || safety.sellabilityBlocked)return safety;
 return {...safety,allowed:false,sellabilityVerified:false,reason:'Exit unverified; automatic alert withheld.'};
}
