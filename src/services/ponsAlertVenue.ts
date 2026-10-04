import { decodeFunctionResult, encodeFunctionData, parseAbi } from 'viem';
import { requestRobinhoodRpcResilient } from '../chains/robinhood/rpc.js';
import type { PonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';
import { robinhoodMarketSnapshotFromPairs, type DexScreenerPair } from '../chains/robinhood/market.js';
import type { AlertKeyStats } from '../ui/alertKeyStats.js';
const ABI=parseAbi(['function token() view returns (address)','function graduated() view returns (bool)']);
export async function confirmedCurveGraduation(token:string,curve:string):Promise<boolean|null>{
  try {
    const read=async(functionName:'token'|'graduated')=>{
      const raw=await requestRobinhoodRpcResilient({method:'eth_call',params:[{to:curve,data:encodeFunctionData({abi:ABI,functionName})},'latest']});
      return decodeFunctionResult({abi:ABI,functionName,data:raw as `0x${string}`});
    };
    const [identity,graduated]=await Promise.all([read('token'),read('graduated')]);
    return String(identity).toLowerCase()===token.toLowerCase() && typeof graduated==='boolean' ? graduated : null;
  } catch {return null;}
}
export function ponsVenueStats(token:string,context:PonsPublicContext|null,graduated:boolean|null,pairs:DexScreenerPair[]):AlertKeyStats {
  const checkedAt=new Date().toISOString().slice(11,19);
  const unavailable:AlertKeyStats={authoritativeVenue:true,source:'PONS venue data pending',checkedAt};
  if(!context || graduated==null) return unavailable;
  if(!graduated){
    if(context.venue!=='curve'||context.phase!==0)return unavailable;
    return {authoritativeVenue:true,preBond:true,price:context.priceUsd,marketCap:null,fdv:context.fdvUsd,
      source:'PONS bonding-curve snapshot · FDV, not circulating market cap',checkedAt};
  }
  // Official exact-contract pool mapping + on-chain graduation. Never choose a
  // secondary pool just because it has marginally greater reported liquidity.
  if(!context.poolId || context.venue==='curve'||context.phase===0)return {...unavailable,source:'Graduated · DEX data pending'};
  const matching=pairs.filter(p=>p.chainId==='robinhood'&&p.baseToken?.address?.toLowerCase()===token.toLowerCase()
    &&p.pairAddress?.toLowerCase()===context.poolId!.toLowerCase());
  const m=robinhoodMarketSnapshotFromPairs(token,matching);
  if(!m)return {...unavailable,source:'Graduated · mapped DEX pool pending'};
  return {authoritativeVenue:true,preBond:false,price:m.priceUsd,marketCap:m.marketCapUsd>0?m.marketCapUsd:null,fdv:m.fdvUsd,
    liquidity:m.liquidityUsd,volume5m:m.volume5mReported?m.volume5mUsd:null,volume24h:m.volume24hUsd,
    move5m:m.priceChange5m,move1h:m.priceChange1h,buys:m.trades5mReported?m.buys5m:null,sells:m.trades5mReported?m.sells5m:null,
    pairCreatedAt:m.pairCreatedAt,source:'DEXScreener · PONS-mapped graduated pool',checkedAt};
}
