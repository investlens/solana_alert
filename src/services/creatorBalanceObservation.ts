import { validOwnershipPercent, type OwnershipDisclosure } from '../ui/ownershipDisclosure.js';

// Bounded session observations, not a transaction history or a sale classifier.
export function createCreatorBalanceObserver() {
  const initial = new Map<string,{percent:number;observedAt:number}>();
  return (token:string,evidence:OwnershipDisclosure,now=Date.now()):OwnershipDisclosure => {
    for (const [key,value] of initial) if(now-value.observedAt>=2*60*60_000) initial.delete(key);
    const percent=validOwnershipPercent(evidence.devPercent),at=evidence.devObservedAt;
    if(!evidence.creator || percent==null || !Number.isFinite(at) || at!>now || now-at!>120_000)return evidence;
    const key=`${token.toLowerCase()}:${evidence.creator.toLowerCase()}`;
    let baseline=initial.get(key);
    if(!baseline) {
      baseline={percent,observedAt:at!};initial.set(key,baseline);
      while(initial.size>200)initial.delete(initial.keys().next().value!);
    }
    if(at!<baseline.observedAt)return evidence;
    return {...evidence,devInitialPercent:baseline.percent,devInitialObservedAt:baseline.observedAt};
  };
}
export const observeCreatorBalance=createCreatorBalanceObserver();
