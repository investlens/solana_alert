import {encodeAbiParameters,encodeFunctionData,decodeFunctionResult,keccak256,parseAbi,parseAbiParameters,toHex,type Address,type Hex} from 'viem';
import {governedDexScreenerJson} from './dexscreenerRequestGovernor.js';
import {createExitRpcTransport} from './exitRpcTransport.js';

export type ExitRequest={chain:'robinhood'|'arc';token:string;pairId?:string;security?:Record<string,unknown>};
export type ExitVerification={allowed:boolean;reason:string;pairId?:string;maxLossPercent?:number;observedAt:number;lpStatus?:'LOCKED'|'BURNED'|'UNLOCKED'|'UNKNOWN'};
type PoolKey={currency0:Address;currency1:Address;fee:number;tickSpacing:number;hooks:Address};
type Call={from:Address;to:Address;data:Hex;value?:Hex;gas:Hex;gasPrice:Hex};
type SimCall={status?:string;returnData?:Hex;error?:unknown;logs?:{address:string;topics:string[];data:string;removed?:boolean}[]};
type SimBlock={calls?:SimCall[]};
type Dependencies={rpc:(chain:ExitRequest['chain'],method:string,params:unknown[],signal:AbortSignal)=>Promise<any>;pairs:(request:ExitRequest,signal:AbortSignal)=>Promise<any[]>;now:()=>number;wallet:()=>Address;security?:(request:ExitRequest,signal:AbortSignal)=>Promise<Record<string,unknown>|undefined>};
const ZERO='0x0000000000000000000000000000000000000000' as Address;
const PERMIT2='0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
export const EXIT_CHAIN_CONFIG={
 robinhood:{id:4663,rpc:'https://robinhood-rpc.publicnode.com',quote:'0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73' as Address,router:'0x8876789976decbfcbbbe364623c63652db8c0904' as Address,sizes:[10n**15n,10n**16n,5n*10n**16n]},
 arc:{id:5042,rpc:'https://rpc.mainnet.arc.io',quote:'0x3600000000000000000000000000000000000000' as Address,router:'0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1' as Address,sizes:[10n*10n**18n,100n*10n**18n,500n*10n**18n]},
} as const;
const ERC20=parseAbi(['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)','function deposit() payable']);
const PERMIT_ABI=parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const ROUTER=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
const NATIVE_TRACE='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const TRANSFER_TOPIC=keccak256(toHex('Transfer(address,address,uint256)'));
// eth_simulateV1 traceTransfers emits native transfers at this reserved address.
// Never accept ERC20 Transfer logs or a missing trace as native exit proceeds.
export function nativeWalletDelta(call:SimCall,wallet:Address):bigint {
 if(!Array.isArray(call.logs))throw Error('Native transfer trace unavailable');
 let delta=0n;const topic='0x'+wallet.slice(2).toLowerCase().padStart(64,'0');
 for(const log of call.logs){
  if(log.address.toLowerCase()!==NATIVE_TRACE)continue;
  if(log.removed||log.topics.length!==3||log.topics[0].toLowerCase()!==TRANSFER_TOPIC||!log.topics.slice(1).every(t=>/^0x0{24}[a-f0-9]{40}$/i.test(t))||!/^0x[a-f0-9]{64}$/i.test(log.data))throw Error('Native transfer trace malformed');
  const amount=BigInt(log.data);
  if(log.topics[1].toLowerCase()===topic)delta-=amount;
  if(log.topics[2].toLowerCase()===topic)delta+=amount;
 }
 return delta;
}
const poolParameters=parseAbiParameters('address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks');
// Candidate keys are accepted ONLY if their full ABI encoding hashes to the
// exact observed pool ID. A known fee or a token symbol is never pool proof.
export function resolvePlainV4Key(token:string,quote:string,pairId:string,fee:number):PoolKey|null {
 if(!/^0x[a-f0-9]{64}$/i.test(pairId)||!Number.isInteger(fee)||fee<0||fee>100_000)return null;
 const [currency0,currency1]=[token.toLowerCase(),quote.toLowerCase()].sort() as Address[];
 for(const tickSpacing of [1,10,60,200]){
  const key={currency0,currency1,fee,tickSpacing,hooks:ZERO};
  if(keccak256(encodeAbiParameters(poolParameters,[currency0,currency1,fee,tickSpacing,ZERO])).toLowerCase()===pairId.toLowerCase())return key;
 }
 return null;
}
function swapData(key:PoolKey,input:Address,output:Address,amount:bigint,deadline:bigint):Hex {
 const swap=encodeAbiParameters(parseAbiParameters('((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,uint256 minHopPriceX36,bytes hookData)'),[{poolKey:key,zeroForOne:input.toLowerCase()===key.currency0,amountIn:amount,amountOutMinimum:0n,minHopPriceX36:0n,hookData:'0x'}]);
 const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[input,amount]);
 const take=encodeAbiParameters(parseAbiParameters('address,uint256'),[output,0n]);
 const inputData=encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]]);
 return encodeFunctionData({abi:ROUTER,functionName:'execute',args:['0x10',[inputData],deadline]});
}
function balance(call:SimCall|undefined):bigint {
 if(!call||call.status!=='0x1'||!/^0x[a-f0-9]{64}$/i.test(call.returnData??''))throw Error('Balance read unverified');
 return decodeFunctionResult({abi:ERC20,functionName:'balanceOf',data:call.returnData!});
}
function complete(raw:unknown,count:number):SimCall[]{
 const blocks=raw as SimBlock[];
 const calls=Array.isArray(blocks)&&blocks.length===1?blocks[0]?.calls:null;
 if(!calls||calls.length!==count||calls.some(c=>c.status!=='0x1'||c.error))throw Error('Buy/sell simulation reverted or incomplete');
 return calls;
}
export function roundTripLoss(input:bigint,output:bigint):number {
 if(input<=0n||output<=0n)throw Error('Exit returned no quote currency');
 // Basis points calculated with integers; avoid overflowing token quantities.
 return Math.max(0,Number((input-output)*10000n/input)/100);
}
export function customPoolRisk(security:Record<string,unknown>|undefined,pairId?:string):string|null {
 if(String(security?.is_honeypot)==='1'||String(security?.cannot_sell_all)==='1')return 'Confirmed honeypot or sell restriction';
 for(const field of ['buy_tax','sell_tax','transfer_tax']){
  const v=security?.[field];if(v!=null&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0.10)return 'Excessive reported token fee';
 }
 const pools=Array.isArray(security?.dex)?security!.dex as Record<string,unknown>[]:[];
 // Pool fees belong to a venue. A dust pool cannot condemn an independently
 // checked main pool; token-level restrictions above still block every route.
 if(pairId && pools.some(p=>String(p.pair).toLowerCase()===pairId.toLowerCase()&&p.pool_fee!=null&&p.pool_fee!==''&&Number(p.pool_fee)>0.10))return 'Selected pool has excessive fees';
 return null;
}
export function observedLpStatus(security:Record<string,unknown>|undefined):'LOCKED'|'BURNED'|'UNLOCKED'|'UNKNOWN'{
 const holders=Array.isArray(security?.lp_holders)?security!.lp_holders as Record<string,unknown>[]:[];
 if(!holders.length)return 'UNKNOWN';let locked=0,burned=0;
 for(const h of holders){const pct=Number(h.percent);if(!Number.isFinite(pct)||pct<0||pct>1)return 'UNKNOWN';
  if(/^0x(?:0{40}|0{36}dead)$/i.test(String(h.address)))burned+=pct;
  else if(String(h.is_locked)==='1')locked+=pct;
 }
 return burned>=0.95?'BURNED':locked+burned>=0.95?'LOCKED':'UNLOCKED';
}
export function createCustomExitVerifier(deps:Dependencies){
 const cache=new Map<string,{until:number;value:ExitVerification}>(),inflight=new Map<string,Promise<ExitVerification>>();let active=0;
 return async(request:ExitRequest):Promise<ExitVerification>=>{
  const key=`${request.chain}:${request.token.toLowerCase()}:${request.pairId?.toLowerCase()??''}`;
  const blocked=(reason:string):ExitVerification=>({allowed:false,reason,observedAt:deps.now()});
  const risk=customPoolRisk(request.security,request.pairId);if(risk)return blocked(risk);
  if(!/^0x[a-f0-9]{40}$/i.test(request.token))return blocked('Invalid token identity');
  const prior=cache.get(key);if(prior&&prior.until>deps.now())return prior.value;
  const pending=inflight.get(key);if(pending)return pending;
  if(active>=2)return blocked('Exit verification capacity busy; retry required');
  active++;
  const promise=(async()=>{
   const signal=AbortSignal.timeout(8_000),config=EXIT_CHAIN_CONFIG[request.chain];
   try{
    const security=request.security??await deps.security?.(request,signal);
    const evidenceRisk=customPoolRisk(security,request.pairId);if(evidenceRisk)return blocked(evidenceRisk);
    if(Number(BigInt(await deps.rpc(request.chain,'eth_chainId',[],signal)))!==config.id)throw Error('RPC chain identity mismatch');
    // ARC's public RPC currently lacks eth_simulateV1. Probe before enrichment,
    // and fail closed rather than presenting provider flags as execution proof.
    if(request.chain==='arc'){
     await deps.rpc(request.chain,'eth_simulateV1',[{blockStateCalls:[{calls:[{to:ZERO,data:'0x'}]}],validation:false},'latest'],signal);
     throw Error('ARC native quote funding not independently supported');
    }
    const pairs=(await deps.pairs(request,signal)).filter(p=>p?.chainId===request.chain&&String(p.baseToken?.address??'').toLowerCase()===request.token.toLowerCase());
    const pool=request.pairId?pairs.find(p=>String(p.pairAddress).toLowerCase()===request.pairId!.toLowerCase()):pairs.sort((a,b)=>Number(b.liquidity?.usd??0)-Number(a.liquidity?.usd??0))[0];
    const poolQuote=String(pool?.quoteToken?.address??'').toLowerCase();
    const nativeQuote=request.chain==='robinhood'&&poolQuote===ZERO;
    if(!pool||pool.dexId!=='uniswap'||(!nativeQuote&&poolQuote!==config.quote.toLowerCase()))throw Error('Exact supported DEX pool unavailable');
    const pairId=String(pool.pairAddress);
    const selectedRisk=customPoolRisk(security,pairId);if(selectedRisk)return blocked(selectedRisk);
    const known=Array.isArray(security?.dex)?(security!.dex as any[]).find(d=>String(d.pair).toLowerCase()===pairId.toLowerCase()):null;
    const fee=known?.pool_fee!=null&&known.pool_fee!==''?Math.round(Number(known.pool_fee)*1e6):null;
    const fees=fee==null?[0,100,500,3000,10000]:[fee];
    const key=fees.map(f=>resolvePlainV4Key(request.token,poolQuote,pairId,f)).find(Boolean);
    if(!key)throw Error('Exact V4 pool key unsupported; hooks/route unverified');
    const block=await deps.rpc(request.chain,'eth_blockNumber',[],signal);
    const token=request.token.toLowerCase() as Address,deadline=BigInt(Math.floor(deps.now()/1000)+300);
    let maxLoss=0;
    for(const amount of config.sizes){
     const wallet=deps.wallet();
     const call=(to:Address,data:Hex,value:Hex='0x0'):Call=>({from:wallet,to,data,value,gas:to.toLowerCase()===config.router.toLowerCase()?'0x124f80':'0x493e0',gasPrice:'0x0'});
     const read=(currency:Address)=>call(currency,encodeFunctionData({abi:ERC20,functionName:'balanceOf',args:[wallet]}));
     const approvals=(currency:Address)=>[
      call(currency,encodeFunctionData({abi:ERC20,functionName:'approve',args:[PERMIT2,2n**256n-1n]})),
      call(PERMIT2,encodeFunctionData({abi:PERMIT_ABI,functionName:'approve',args:[currency,config.router,2n**160n-1n,Number(deadline)]})),
     ];
     // ONLY the test EOA's native balance is overridden. Token code, token
     // balances, router and pool state are never fabricated or overwritten.
     const simulate=(calls:Call[])=>deps.rpc(request.chain,'eth_simulateV1',[{blockStateCalls:[{stateOverrides:{[wallet]:{balance:toHex(amount)}},calls}],validation:false,...(nativeQuote?{traceTransfers:true}:{})},block],signal);
     if(nativeQuote){
      const buy=[read(token),call(config.router,swapData(key,ZERO,token,amount,deadline),toHex(amount)),read(token)];
      const bought=complete(await simulate(buy),buy.length);
      const tokens=balance(bought[2]);
      if(balance(bought[0])!==0n||tokens<=0n||nativeWalletDelta(bought[1],wallet)!==-amount)throw Error('Native buy debit or received tokens unverified');
      const roundtrip=[...buy,...approvals(token),call(config.router,swapData(key,token,ZERO,tokens,deadline)),read(token)];
      const exited=complete(await simulate(roundtrip),roundtrip.length);
      if(balance(exited[0])!==0n||balance(exited[2])!==tokens||balance(exited[6])!==0n||nativeWalletDelta(exited[1],wallet)!==-amount)throw Error('Full same-wallet native sell unverified');
      const output=nativeWalletDelta(exited[5],wallet);
      if(exited.reduce((sum,c)=>sum+nativeWalletDelta(c,wallet),0n)!==output-amount)throw Error('Native wallet cash flow unverified');
      const loss=roundTripLoss(amount,output);maxLoss=Math.max(maxLoss,loss);
      if(loss>10)throw Error('Exit loss exceeds 10% at a tested size');
      continue;
     }
     const buy=[read(token),read(config.quote),call(config.quote,encodeFunctionData({abi:ERC20,functionName:'deposit'}),toHex(amount)),...approvals(config.quote),call(config.router,swapData(key,config.quote,token,amount,deadline)),read(token),read(config.quote)];
     const bought=complete(await simulate(buy),buy.length);
     if(balance(bought[0])!==0n||balance(bought[1])!==0n||balance(bought[7])!==0n)throw Error('Test wallet balance or buy debit unverified');
     const tokens=balance(bought[6]);if(tokens<=0n)throw Error('Buy received no tokens');
     const roundtrip=[...buy,...approvals(token),call(config.router,swapData(key,token,config.quote,tokens,deadline)),read(config.quote),read(token)];
     const exited=complete(await simulate(roundtrip),roundtrip.length);
     if(balance(exited[6])!==tokens||balance(exited[12])!==0n)throw Error('Full same-wallet sell unverified');
     const loss=roundTripLoss(amount,balance(exited[11]));maxLoss=Math.max(maxLoss,loss);
     if(loss>10)throw Error('Exit loss exceeds 10% at a tested size');
    }
    return {allowed:true,reason:`Same-wallet buy/sell simulated at three sizes · max round-trip loss ${maxLoss.toFixed(2)}% (excludes gas). Use the exact checked pool; execution can change.`,pairId,maxLossPercent:maxLoss,observedAt:deps.now(),lpStatus:observedLpStatus(security)};
   }catch(error){
    // Only locally defined reasons are exposed; provider errors may include secrets.
    const message=error instanceof Error?error.message:'';
    const known=/^(?:Exact supported DEX pool unavailable|Exact V4 pool key unsupported; hooks\/route unverified|ARC native quote funding not independently supported|RPC chain identity mismatch|Native transfer trace unavailable|Native transfer trace malformed|Native buy debit or received tokens unverified|Full same-wallet native sell unverified|Native wallet cash flow unverified|Buy\/sell simulation reverted or incomplete|Exit loss exceeds 10% at a tested size|Exit returned no quote currency)$/;
    const reason=known.test(message)?message:'Exit verification data unavailable or incomplete';
    return blocked(`Exit unverified: ${reason}; automatic alert withheld. Available for manual research.`);
   }
  })();
  inflight.set(key,promise);
  try{const value=await promise;if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{until:deps.now()+(value.allowed?20_000:60_000),value});return value;}
  finally{active--;inflight.delete(key);}
 };
}
const exitRpc=createExitRpcTransport({
 chainId:chain=>EXIT_CHAIN_CONFIG[chain].id,
 urls:chain=>chain==='robinhood'
  ?[process.env.ROBINHOOD_RPC_URL,process.env.ROBINHOOD_RPC_FALLBACK_URL,EXIT_CHAIN_CONFIG.robinhood.rpc,'https://rpc.mainnet.chain.robinhood.com']
  :[process.env.ARC_RPC_URL,EXIT_CHAIN_CONFIG.arc.rpc],
});
export const verifyCustomTokenExit=createCustomExitVerifier({
 now:Date.now,wallet:()=>('0x'+keccak256(toHex(crypto.randomUUID())).slice(-40)) as Address,
 rpc:exitRpc,
 security:async(request,signal)=>{
  const response=await fetch(`https://api.gopluslabs.io/api/v1/token_security/${EXIT_CHAIN_CONFIG[request.chain].id}?contract_addresses=${request.token}`,{signal});
  if(!response.ok)return undefined;
  const json=await response.json() as any;return json.result?.[request.token.toLowerCase()];
 },
 pairs:async(request,signal)=>{
  const result=await governedDexScreenerJson<any>({url:`https://api.dexscreener.com/token-pairs/v1/${request.chain}/${request.token}`,caller:'CUSTOM_EXIT',endpoint:'token-pairs',cacheTtlMs:15_000,signal,httpTimeoutMs:4000,queueWaitTimeoutMs:2000});
  return Array.isArray(result.value)?result.value:[];
 },
});
