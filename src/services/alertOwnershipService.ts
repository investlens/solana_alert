import { reuseRobinhoodDevTokenFlow } from '../chains/robinhood/security/devTokenFlowScanner.js';
import { scanRobinhoodHolderRisk } from '../chains/robinhood/security/holderRiskScanner.js';
import { getCreatorHoldingPercent } from '../chains/robinhood/ponsPublicContext.js';
import { withOwnershipDisclosure, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';

const empty = (): OwnershipDisclosure => ({ devPercent: null, top10Percent: null, top10Coverage: 'UNAVAILABLE' });
const cache = new Map<string, { at: number; value: OwnershipDisclosure }>();
const pending = new Map<string, Promise<OwnershipDisclosure>>();
const partial = new Map<string, OwnershipDisclosure>();
let windowStart = 0, started = 0;
// Per token, never per recipient. No database writes or background holder sweeps.
export async function robinhoodOwnership(token: string, creator?: string | null, pool?: string | null): Promise<OwnershipDisclosure> {
  if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return empty();
  const key = `${token.toLowerCase()}:${(pool ?? '').toLowerCase()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30_000) return hit.value;
  let work = pending.get(key);
  if (!work) {
    if (Date.now() - windowStart >= 60_000) { windowStart = Date.now(); started = 0; }
    if (pending.size >= 2 || started >= 10) return empty();
    started++;
    partial.set(key, empty());
    work = (async () => {
      const [dev, holders] = await Promise.allSettled([
        (async () => {
          const identity = creator || (await reuseRobinhoodDevTokenFlow(token)).deployerAddress;
          const value = identity ? await getCreatorHoldingPercent(token, identity) : null;
          partial.get(key)!.devPercent = value; return value;
        })(),
        pool ? scanRobinhoodHolderRisk(token, { poolAddress: pool, timeoutMs: 1_500 }).then(result => {
          if (result.sampledWallets.length) { partial.get(key)!.top10Percent = result.top10Pct; partial.get(key)!.top10Coverage = 'INDEXED_SAMPLE'; }
          return result;
        }) : Promise.reject(new Error('Pool identity unavailable for holder exclusions')),
      ]);
      return { devPercent: dev.status === 'fulfilled' ? dev.value : null,
        top10Percent: holders.status === 'fulfilled' && holders.value.sampledWallets.length ? holders.value.top10Pct : null,
        top10Coverage: holders.status === 'fulfilled' && holders.value.sampledWallets.length ? 'INDEXED_SAMPLE' as const : 'UNAVAILABLE' as const };
    })().then(value => {
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
  const cached = cache.get(`${token.toLowerCase()}:${(pool ?? '').toLowerCase()}`);
  const fresh = cached && Date.now() - cached.at < 30_000 ? cached.value : empty();
  return withOwnershipDisclosure(text, cachedOnly ? fresh : await robinhoodOwnership(token, creator, pool));
}
