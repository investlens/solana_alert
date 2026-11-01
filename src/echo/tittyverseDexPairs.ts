/** Bounded read-only DexScreener Solana pool verification for curated Tittyverse mints.
 * This module DOES NOT discover Tittyverse membership. Pool evidence is independent,
 * no Solana RPC, no signing, and no modification of Echo's live scanner.
 * Per run: <=1 HTTP GET, <=10 seed mints, <=600 kB response.
 */
import type {VerifiedPair} from './tittyverseResearch.js';
const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const URL_BASE='https://api.dexscreener.com/tokens/v1/solana/';
export type DexPairEvidence={pairAddress:string;mintA:string;mintB:string;
 liquidityUsd:number|null;marketCapUsd:number|null;dexId:string;observedAtMs:number};
export type DexPairResult={pairs:VerifiedPair[];evidence:DexPairEvidence[];
 totalReturned:number;unverifiedRows:number;source:'DEXSCREENER';readOnly:true};
const amount=(n:unknown):number|null=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e15?n:null;
const obj=(v:unknown):Record<string,unknown>|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
export function parseSolanaDexPairs(data:unknown,mints:readonly string[],observedAtMs:number):DexPairResult{
 if(!Array.isArray(data)||data.length>1500)throw Error('UNEXPECTED_PAIR_RESPONSE');
 const seed=new Set(mints);
 const pairs:VerifiedPair[]=[],evidence:DexPairEvidence[]=[];
 const seen=new Set<string>();
 let unverifiedRows=0;
 for(const entry of data){
  const row=obj(entry),base=obj(row?.baseToken),quote=obj(row?.quoteToken);
  const pairAddress=row?.pairAddress;
  const mintA=base?.address,mintB=quote?.address;
  if(row?.chainId!=='solana'||typeof pairAddress!=='string'||!MINT.test(pairAddress)||
    typeof mintA!=='string'||!MINT.test(mintA)||
    typeof mintB!=='string'||!MINT.test(mintB)||mintA===mintB||
    (!seed.has(mintA)&&!seed.has(mintB))||
    typeof row?.dexId!=='string'||row.dexId.length>64){
   unverifiedRows++;continue;
  }
  if(seen.has(pairAddress))continue;
  seen.add(pairAddress);
  const liquidityUsd=amount(obj(row.liquidity)?.usd);
  const marketCapUsd=amount(row.marketCap);
  pairs.push({pairAddress,mintA,mintB,verifiedAtMs:observedAtMs,
   source:'DEXSCREENER',verified:true});
  evidence.push({pairAddress,mintA,mintB,liquidityUsd,marketCapUsd,
   dexId:row.dexId,observedAtMs});
 }
 return {pairs,evidence,totalReturned:data.length,unverifiedRows,
  source:'DEXSCREENER',readOnly:true};
}
export async function readSolanaDexPairs(mints:readonly string[],
 fetcher:typeof fetch=fetch,observedAtMs=Date.now()):Promise<DexPairResult>{
 if(mints.length<1||mints.length>10||new Set(mints).size!==mints.length||
   !mints.every(m=>MINT.test(m))||!Number.isSafeInteger(observedAtMs)||observedAtMs<=0)
  throw Error('INVALID_BOUNDED_TOKEN_SELECTION');
 const url=URL_BASE+mints.join(',');
 const res=await fetcher(url,{
  method:'GET',headers:{accept:'application/json'},
  signal:AbortSignal.timeout(7000)
 });
 if(res.status===429)throw Error('DEX_RATE_LIMITED_NO_RETRY');
 if(!res.ok)throw Error('DEX_HTTP_'+res.status);
 const type=res.headers.get('content-type')??'';
 if(!type.includes('application/json'))throw Error('DEX_NOT_JSON');
 const advertised=Number(res.headers.get('content-length')??'0');
 if(Number.isFinite(advertised)&&advertised>600_000)throw Error('DEX_RESPONSE_TOO_LARGE');
 const text=await res.text();
 if(text.length>600_000)throw Error('DEX_RESPONSE_TOO_LARGE');
 let data:unknown;
 try{data=JSON.parse(text);}catch{throw Error('DEX_JSON_UNREADABLE');}
 return parseSolanaDexPairs(data,mints,observedAtMs);
}
