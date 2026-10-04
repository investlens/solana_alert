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
  const metadata={creator:context?.creator,name:context?.name,symbol:context?.symbol,twitter:context?.twitter,telegram:context?.telegram};
  const unavailable:AlertKeyStats={...metadata,authoritativeVenue:true,source:'PONS venue data pending',checkedAt};
  if(!context) return unavailable;
  if(graduated==null) {
    // Public exact-contract quotes remain useful when the RPC venue read is slow.
    // They are reported quotes, not confirmed execution or circulating valuation.
    if(context.phase===0 && context.venue==='curve') return {...unavailable,
      price:context.priceUsd,fdv:context.fdvUsd,source:'PONS reported curve quote · venue unconfirmed'};
    return unavailable;
  }
  if(!graduated){
    if(context.venue!=='curve'||context.phase!==0)return unavailable;
    return {...metadata,authoritativeVenue:true,preBond:true,price:context.priceUsd,marketCap:null,fdv:context.fdvUsd,
      source:'PONS bonding-curve snapshot · FDV, not circulating market cap',checkedAt};
  }
  // Official exact-contract pool mapping + on-chain graduation. Never choose a
  // secondary pool just because it has marginally greater reported liquidity.
  if(!context.poolId || context.venue==='curve'||context.phase===0)return {...unavailable,source:'Graduated · DEX data pending'};
  const matching=pairs.filter(p=>p.chainId==='robinhood'&&p.baseToken?.address?.toLowerCase()===token.toLowerCase()
    &&p.pairAddress?.toLowerCase()===context.poolId!.toLowerCase());
  const m=robinhoodMarketSnapshotFromPairs(token,matching);
  if(!m)return {...unavailable,source:'Graduated · mapped DEX pool pending'};
  return {name:m.name,symbol:m.symbol,chartUrl:m.chartUrl,authoritativeVenue:true,preBond:false,price:m.priceUsd,marketCap:m.marketCapUsd>0?m.marketCapUsd:null,fdv:m.fdvUsd,
    liquidity:m.liquidityUsd,volume5m:m.volume5mReported?m.volume5mUsd:null,volume24h:m.volume24hUsd,
    move5m:m.priceChange5m,move1h:m.priceChange1h,buys:m.trades5mReported?m.buys5m:null,sells:m.trades5mReported?m.sells5m:null,
    pairCreatedAt:m.pairCreatedAt,source:'DEXScreener · PONS-mapped graduated pool',checkedAt};
}
export function ponsV1VenueStats(token: string, pool: string, pairs: DexScreenerPair[]): AlertKeyStats {
  const m = robinhoodMarketSnapshotFromPairs(token, pairs.filter(pair => pair.chainId === 'robinhood'
    && pair.baseToken?.address?.toLowerCase() === token.toLowerCase()
    && pair.pairAddress?.toLowerCase() === pool.toLowerCase()));
  if (!m) return {authoritativeVenue:true,source:'PONS V1 mapped DEX pool pending',checkedAt:new Date().toISOString().slice(11,19)};
  return {name:m.name,symbol:m.symbol,chartUrl:m.chartUrl,authoritativeVenue:true,preBond:false,price:m.priceUsd,marketCap:m.marketCapUsd>0?m.marketCapUsd:null,fdv:m.fdvUsd,
    liquidity:m.liquidityUsd,volume5m:m.volume5mReported?m.volume5mUsd:null,volume24h:m.volume24hUsd,
    move5m:m.priceChange5m,move1h:m.priceChange1h,buys:m.trades5mReported?m.buys5m:null,sells:m.trades5mReported?m.sells5m:null,
    pairCreatedAt:m.pairCreatedAt,source:'DEXScreener · PONS V1 mapped pool',checkedAt:new Date(m.timestamp).toISOString().slice(11,19)};
}
