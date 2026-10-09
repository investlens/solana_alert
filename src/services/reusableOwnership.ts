import type {OwnershipDisclosure} from '../ui/ownershipDisclosure.js';
export function reusableOwnership(entries:Iterable<[string,{at:number;value:OwnershipDisclosure}]>,token:string,creator?:string|null,pool?:string|null,now=Date.now()):OwnershipDisclosure {
  const result:OwnershipDisclosure={devPercent:null,top10Percent:null,top10Coverage:'UNAVAILABLE'};
  let devAt=-1,holderAt=-1;
  for(const [key,entry] of entries){
    const [entryToken,entryPool]=key.split(':');const v=entry.value;
    if(entryToken!==token.toLowerCase() || now-entry.at>=30_000 || (creator && v.creator?.toLowerCase()!==creator.toLowerCase()))continue;
    if(v.creator && entry.at>devAt && (v.devPercent!=null || result.devPercent==null)){
      Object.assign(result,{creator:v.creator,devPercent:v.devPercent,devObservedAt:v.devObservedAt,devBlock:v.devBlock,devSource:v.devSource});devAt=entry.at;
    }
    // Pool/burn exclusions are venue specific; never borrow another pool's sample.
    if(pool && entryPool===pool.toLowerCase() && v.top10Percent!=null && entry.at>holderAt){
      Object.assign(result,{top10Percent:v.top10Percent,top10Coverage:v.top10Coverage,top10ObservedAt:v.top10ObservedAt});holderAt=entry.at;
    }
  }
  return result;
}
