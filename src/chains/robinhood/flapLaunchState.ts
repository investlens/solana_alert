import { decodeFunctionResult, encodeFunctionData, getAddress, parseAbi, type Hex } from 'viem';

// Official Robinhood MAINNET deployment, not a metadata label or vanity suffix.
// https://docs.flap.sh/flap/developers/deployed-contract-addresses
export const FLAP_ROBINHOOD_PORTAL = '0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09' as const;
export const FLAP_ORIGIN_ABI = parseAbi([
  'function getTokenV7(address token) view returns ((uint8 status,uint256 reserve,uint256 circulatingSupply,uint256 price,uint8 tokenVersion,uint256 r,uint256 h,uint256 k,uint256 dexSupplyThresh,address quoteTokenAddress,bool nativeToQuoteSwapEnabled,bytes32 extensionID,uint256 taxRate,address pool,uint256 progress,uint8 lpFeeProfile,uint8 dexId) state)',
]);
export function createFlapOriginVerifier(read: (token: string) => Promise<number>, now = Date.now) {
  const cache = new Map<string,{value:boolean;until:number}>();
  const inflight = new Map<string,Promise<boolean>>();
  return async (address: string): Promise<boolean> => {
    let token: string;
    try { token = getAddress(address).toLowerCase(); } catch { return false; }
    const cached = cache.get(token);
    if(cached && cached.until > now())return cached.value;
    const pending = inflight.get(token);if(pending)return pending;
    const work = (async()=>{
      let value = false;let failed=false;
      try {
        const status = await read(token);
        // Invalid and staged addresses are not completed launches. Obsolete duel/
        // killed states explicitly cannot sell, so never confer trusted-route eligibility.
        value = status === 1 || status === 4;
      }catch{failed=true;}
      if(cache.size>=500&&!cache.has(token))cache.delete(cache.keys().next().value!);
      cache.set(token,{value,until:now()+(value?5*60_000:failed?15_000:30_000)});
      return value;
    })();
    inflight.set(token,work);
    try{return await work;}finally{inflight.delete(token);}
  };
}
export const isVerifiedFlapLaunch = createFlapOriginVerifier(async token=>{
  const data = encodeFunctionData({abi:FLAP_ORIGIN_ABI,functionName:'getTokenV7',args:[getAddress(token)]});
  // Bounded on-demand read using already configured Robinhood providers. A custom
  // token can make the Portal revert: do not send that logical failure through
  // the global transport failover/replay loop or scan historical logs.
  const urls=[...new Set([
    process.env.ROBINHOOD_ARCHIVE_RPC_URL?.trim() || 'https://robinhood-mainnet-rpc.blockreq.com/v1/rpc/public',
    process.env.ROBINHOOD_RPC_URL?.trim() || 'https://robinhood-rpc.publicnode.com',
  ])];
  for(const [index,url] of urls.entries()){
    try{
      const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
        body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_call',params:[{to:FLAP_ROBINHOOD_PORTAL,data},'latest']}),
        signal:AbortSignal.timeout(index===0?8000:2000)});
      if(!response.ok)continue;
      const payload=await response.json() as {result?:Hex;error?:{code?:number;message?:string}};
      if(payload.error?.code===3||/execution reverted/i.test(payload.error?.message??''))return 0;
      if(!payload.result)continue;
      return Number(decodeFunctionResult({abi:FLAP_ORIGIN_ABI,functionName:'getTokenV7',data:payload.result}).status);
    }catch{/* At most one fallback; inability to prove origin never grants trust. */}
  }
  throw new Error('Flap origin read unavailable');
});
