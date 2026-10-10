import { observeCreatorBalance } from './creatorBalanceObservation.js';
import { getIndexedCreatorHolding } from './indexedCreatorHolding.js';
import { resolveCreatorIdentity, resolvePonsCreatorFromSources } from './verifiedCreatorIdentity.js';
import { getPonsLaunchState, getIndexedVerifiedPonsLaunch } from '../chains/robinhood/ponsLaunchState.js';
import { getSharedJson } from './sharedJsonCache.js';
import { reuseRobinhoodDevTokenFlow } from '../chains/robinhood/security/devTokenFlowScanner.js';
import { scanRobinhoodHolderRisk } from '../chains/robinhood/security/holderRiskScanner.js';
import { getCreatorHoldingEvidence, getReportedPonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';
import { withOwnershipDisclosure, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';
import { reusableOwnership } from './reusableOwnership.js';

const empty = (): OwnershipDisclosure => ({ devPercent: null, top10Percent: null, top10Coverage: 'UNAVAILABLE' });
const cache = new Map<string, { at: number; value: OwnershipDisclosure }>();
const pending = new Map<string, Promise<OwnershipDisclosure>>();
const partial = new Map<string, OwnershipDisclosure>();
let windowStart = 0, started = 0;
export function cachedRobinhoodOwnership(token:string,creator?:string|null,pool?:string|null):OwnershipDisclosure {
  return reusableOwnership(cache.entries(),token,creator,pool);
}
// Per token, never per recipient. No database writes or background holder sweeps.
export async function robinhoodOwnership(token: string, creator?: string | null, pool?: string | null): Promise<OwnershipDisclosure> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return empty();
  const key = `${token.toLowerCase()}:${(pool ?? '').toLowerCase()}:${(creator ?? '').toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < (hit.value.devPercent==null?2_000:30_000)) return hit.value;
  const reusable=reusableOwnership(cache.entries(),token,creator,pool);
  let work = pending.get(key);
  if (!work) {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); started = 0; }
    if (pending.size >= 2 || started >= 10) return reusable;
    started++;
    partial.set(key, {...reusable});
    work = (async () => {
      const [dev, holders] = await Promise.allSettled([
        (async () => {
          if(reusable.devPercent!=null && reusable.creator)return {percent:reusable.devPercent,observedAt:reusable.devObservedAt,block:reusable.devBlock,source:reusable.devSource};
          const identity = await resolveCreatorIdentity(token, creator ?? reusable.creator, {
            factory: address => resolvePonsCreatorFromSources(address, {
              marker: async () => (await getSharedJson(`alphaos:pons:verified:${address.toLowerCase()}`))?.value,
              indexed: () => getIndexedVerifiedPonsLaunch(address),
              publicContext: () => getReportedPonsPublicContext(address),
              factory: () => getPonsLaunchState(address, {requireCompleteFactoryVerification: true}),
            }),
            history: async address => (await reuseRobinhoodDevTokenFlow(address)).deployerAddress,
          });
          // Identity remains useful even if the independent balance read fails.
          partial.get(key)!.creator = identity;
          const direct = identity ? await getCreatorHoldingEvidence(token, identity) : null;
          const value = direct ?? (identity ? await getIndexedCreatorHolding(token,identity) : null);
          const block = direct?.block;
          Object.assign(partial.get(key)!,{devPercent:value?.percent ?? null,devObservedAt:value?.observedAt,devBlock:block,devSource:direct?'RPC':value?'BLOCKSCOUT_INDEXED':undefined}); return value?{...value,block,source:direct?'RPC' as const:'BLOCKSCOUT_INDEXED' as const}:null;
        })(),
        pool ? scanRobinhoodHolderRisk(token, { poolAddress: pool, timeoutMs: 1_500 }).then(result => {
          if (result.sampledWallets.length) { partial.get(key)!.top10Percent = result.top10Pct; partial.get(key)!.top10Coverage = 'INDEXED_SAMPLE'; partial.get(key)!.top10ObservedAt=result.scannedAt; }
          return result;
        }) : Promise.reject(new Error('Pool identity unavailable for holder exclusions')),
      ]);
      return { creator:partial.get(key)?.creator ?? null,devPercent: dev.status === 'fulfilled' ? dev.value?.percent ?? null : null,
        devObservedAt:dev.status === 'fulfilled' ? dev.value?.observedAt : undefined,
        devBlock:dev.status === 'fulfilled' ? dev.value?.block : undefined,
        devSource:dev.status === 'fulfilled' ? dev.value?.source : undefined,
        top10ObservedAt:holders.status === 'fulfilled' ? holders.value.scannedAt : undefined,
        top10Percent: holders.status === 'fulfilled' && holders.value.sampledWallets.length ? holders.value.top10Pct : null,
        top10Coverage: holders.status === 'fulfilled' && holders.value.sampledWallets.length ? 'INDEXED_SAMPLE' as const : 'UNAVAILABLE' as const };
    })().then(rawValue => {
      const value = observeCreatorBalance(token,rawValue);
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(key, {at: Date.now(), value}); return value;
    }).finally(() => { pending.delete(key); partial.delete(key); });
    pending.set(key, work);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<OwnershipDisclosure>(resolve => { timer = setTimeout(() => resolve({...partial.get(key) ?? empty()}), 3_500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function discloseRobinhoodOwnership(text: string, token: string, creator?: string | null, pool?: string | null, cachedOnly = false): Promise<string> {
  const cached = cache.get(`${token.toLowerCase()}:${(pool ?? '').toLowerCase()}:${(creator ?? '').toLowerCase()}`);
  const fresh = cached && Date.now() - cached.at < 30_000 ? cached.value : reusableOwnership(cache.entries(),token,creator,pool);
  return withOwnershipDisclosure(text, cachedOnly ? fresh : await robinhoodOwnership(token, creator, pool));
}
