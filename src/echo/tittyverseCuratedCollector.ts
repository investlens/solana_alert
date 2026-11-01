/** Curated low-load research collector.
 * User-supplied deep links establish provenance, NOT independent listing proof.
 * Only DexScreener supplies verified pool edges; <=1 network GET for <=10 mints.
 * No auth bypass, Tittyverse backend retries, RPC calls, Telegram or trading.
 */
import {evaluateTittyverseSnapshot,type VerifiedCallerBuy,type ResearchFinding,
 type ResearchToken} from './tittyverseResearch.js';
import {readSolanaDexPairs,type DexPairResult} from './tittyverseDexPairs.js';

const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type UserTittyverseLead={mint:string;symbol:string;
 observedAtMs:number;url:string;provenance:'USER_SHARED_LINK'};
export type CuratedResearchSnapshot={
 collectedAtMs:number;siteApiStatus:'UNAUTHORIZED_401';readOnly:true;
 listingIndependentlyVerified:false;
 seeds:number;verifiedDexPairs:number;dexUnverifiedRows:number;
 pairEvidence:DexPairResult['evidence'];findings:ResearchFinding[];
};
export function validateTittyverseLeads(seeds:readonly UserTittyverseLead[]){
 if(seeds.length<1||seeds.length>10)throw Error('INVALID_SEED_COUNT');
 const seen=new Set<string>();
 for(const lead of seeds){
  if(!MINT.test(lead.mint)||seen.has(lead.mint)||
     typeof lead.symbol!=='string'||lead.symbol.length>32||
     !Number.isSafeInteger(lead.observedAtMs)||lead.observedAtMs<=0||
     lead.provenance!=='USER_SHARED_LINK')throw Error('INVALID_USER_LEAD');
  seen.add(lead.mint);
  let url:URL;
  try{url=new URL(lead.url);}catch{throw Error('INVALID_TITTYVERSE_LINK');}
  if(url.protocol!=='https:'||url.hostname!=='tittyverse.fun'||
     url.username||url.password||url.port||url.pathname!=='/'||
     url.search||url.hash!=='#tittyverse/'+lead.mint)
   throw Error('INVALID_TITTYVERSE_LINK');
 }
}
export async function collectCuratedTittyverseResearch(input:{
 leads:readonly UserTittyverseLead[];verifiedBuys:readonly VerifiedCallerBuy[];
 fetcher?:typeof fetch;nowMs?:number;
}):Promise<CuratedResearchSnapshot>{
 validateTittyverseLeads(input.leads);
 const nowMs=input.nowMs??Date.now();
 if(!Number.isSafeInteger(nowMs)||nowMs<=0||
    input.leads.some(l=>l.observedAtMs>nowMs+1000))
  throw Error('INVALID_RESEARCH_OBSERVATION_TIME');
 if(input.verifiedBuys.length>500)throw Error('TOO_MANY_BUY_EVIDENCE_ROWS');
 const observed=await readSolanaDexPairs(input.leads.map(l=>l.mint),input.fetcher,nowMs);
 const tokens:ResearchToken[]=input.leads.map(lead=>{
  const pairs=observed.evidence.filter(pair=>pair.mintA===lead.mint||pair.mintB===lead.mint);
  // Best-liquidity pool is merely a source snapshot, NOT a guarantee of
  // execution depth or a recommendation. Null does not become $0.
  pairs.sort((a,b)=>(b.liquidityUsd??-1)-(a.liquidityUsd??-1));
  return {mint:lead.mint,symbol:lead.symbol,observedAtMs:lead.observedAtMs,
   marketCapUsd:pairs[0]?.marketCapUsd??null,
   liquidityUsd:pairs[0]?.liquidityUsd??null,
   inTittyverse:true,listingEvidence:'USER_SHARED_LINK'};
 });
 const findings=evaluateTittyverseSnapshot({
  tokens,pairs:observed.pairs,buys:input.verifiedBuys
 });
 return {collectedAtMs:nowMs,siteApiStatus:'UNAUTHORIZED_401',readOnly:true,
  listingIndependentlyVerified:false,
  seeds:input.leads.length,verifiedDexPairs:observed.pairs.length,
  dexUnverifiedRows:observed.unverifiedRows,
  pairEvidence:observed.evidence,findings};
}
