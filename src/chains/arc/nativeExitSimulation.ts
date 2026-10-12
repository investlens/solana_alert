import {readArcProbeResponse} from './simulationCapability.js';
// Read-only eth_simulateV1: no signing, broadcasting or fabricated token/pool state.
import {encodeAbiParameters,encodeFunctionData,parseAbi,parseAbiParameters,toHex,keccak256,type Address,type Hex} from 'viem';
import {resolveArcObservedPoolKey,type ArcObservedPoolMetadata,ARC_NATIVE_USDC,ARC_USDC} from './observedSelling.js';
import type {ExitVerification} from '../../services/customTokenExitVerification.js';
const ROUTER='0x4fcA4a51Ab4F23A7447b3284fBd7D73289A89Fb1' as Address;
const PERMIT2='0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;
const TOKEN=parseAbi(['function balanceOf(address) view returns (uint256)','function approve(address,uint256) returns (bool)']);
const PERMIT=parseAbi(['function approve(address token,address spender,uint160 amount,uint48 expiration)']);
const ROUTE=parseAbi(['function execute(bytes commands,bytes[] inputs,uint256 deadline) payable']);
type Call={from:Address;to:Address;data:Hex;value:Hex;gas:Hex;gasPrice:Hex};
function result(raw:any,count:number){const calls=raw?.[0]?.calls;if(Array.isArray(calls)&&calls.some(c=>c.status==='0x0'))throw Error('Confirmed native simulation reverted');if(!Array.isArray(raw)||raw.length!==1||!Array.isArray(calls)||calls.length!==count||calls.some(c=>c.status!=='0x1'||c.error))throw Error('Simulation reverted or incomplete');return calls;}
function value(call:any){if(!/^0x[a-f0-9]{64}$/i.test(call?.returnData??''))throw Error('Balance unverified');return BigInt(call.returnData);}
export function arcNativeRoute(key:NonNullable<ReturnType<typeof resolveArcObservedPoolKey>>,input:Address,output:Address,amount:bigint,deadline:bigint){
 const swap=encodeAbiParameters(parseAbiParameters('((address,address,uint24,int24,address),bool,uint128,uint128,uint256,bytes)'),[[[key.currency0,key.currency1,key.fee,key.tickSpacing,key.hooks],input.toLowerCase()===key.currency0.toLowerCase(),amount,0n,0n,'0x']]);
 const settle=encodeAbiParameters(parseAbiParameters('address,uint256'),[input,amount]);
 const take=encodeAbiParameters(parseAbiParameters('address,uint256'),[output,0n]);
 return encodeFunctionData({abi:ROUTE,functionName:'execute',args:['0x10',[encodeAbiParameters(parseAbiParameters('bytes,bytes[]'),['0x060c0f',[swap,settle,take]])],deadline]});
}
type Dependencies={rpc:(method:string,params:unknown[],signal:AbortSignal)=>Promise<any>;now:()=>number};
export function createArcNativeExitSimulator(deps:Dependencies){
 let active=false;const starts:number[]=[];const cache=new Map<string,{until:number;result:ExitVerification}>();
 return async(token:string,pool:string,metadata?:ArcObservedPoolMetadata):Promise<ExitVerification>=>{
  const now=deps.now(),identity=`${token}:${pool}`.toLowerCase();const deny=(reason:string):ExitVerification=>({allowed:false,reason,observedAt:deps.now()});
  const key=resolveArcObservedPoolKey(token,ARC_NATIVE_USDC,pool,metadata);
  if(!key)return deny('Native exit simulation unavailable for this exact pool');
  const saved=cache.get(identity);if(saved&&saved.until>now)return saved.result;
  while(starts.length&&starts[0]<=now-60000)starts.shift();
  if(active||starts.length>=2)return deny('Native exit simulation capacity busy');active=true;starts.push(now);
  let checked:ExitVerification;let stage='CHAIN_ID';
  try{
   const signal=AbortSignal.timeout(25000);
   if(BigInt(await deps.rpc('eth_chainId',[],signal))!==5042n)throw Error('Chain mismatch');
   stage='BLOCK';const block=await deps.rpc('eth_blockNumber',[],signal);let maxLoss=0;
   for(const dollars of [10n,100n,500n]){
    const amount=dollars*10n**18n,quote=dollars*10n**6n,deadline=BigInt(Math.floor(deps.now()/1000)+300);
    const wallet=('0x'+keccak256(toHex(crypto.randomUUID())).slice(-40)) as Address;
    const call=(to:Address,data:Hex,native=0n):Call=>({from:wallet,to,data,value:toHex(native),gas:to.toLowerCase()===ROUTER.toLowerCase()?'0x1e8480':'0x30d40',gasPrice:'0x0'});
    const read=(currency:Address)=>call(currency,encodeFunctionData({abi:TOKEN,functionName:'balanceOf',args:[wallet]}));
    const simulate=(calls:Call[])=>deps.rpc('eth_simulateV1',[{blockStateCalls:[{stateOverrides:{[wallet]:{balance:toHex(amount)}},calls}],validation:false},block],signal);
    const buy=[read(token as Address),read(ARC_USDC),call(ROUTER,arcNativeRoute(key,ARC_NATIVE_USDC,token as Address,amount,deadline),amount),read(token as Address),read(ARC_USDC)];
    stage=`BUY_${dollars}`;const bought=result(await simulate(buy),5);const tokens=value(bought[3]);
    if(value(bought[0])!==0n||value(bought[1])!==quote||value(bought[4])!==0n||tokens<=0n)throw Error('Native funding or buy debit unverified');
    const full=[...buy,call(token as Address,encodeFunctionData({abi:TOKEN,functionName:'approve',args:[PERMIT2,2n**256n-1n]})),call(PERMIT2,encodeFunctionData({abi:PERMIT,functionName:'approve',args:[token as Address,ROUTER,2n**160n-1n,Number(deadline)]})),call(ROUTER,arcNativeRoute(key,token as Address,ARC_NATIVE_USDC,tokens,deadline)),read(ARC_USDC),read(token as Address)];
    stage=`FULL_SELL_${dollars}`;const sold=result(await simulate(full),10),returned=value(sold[8]);
    if(value(sold[0])!==0n||value(sold[1])!==quote||value(sold[3])!==tokens||value(sold[4])!==0n||value(sold[9])!==0n||returned<=0n)throw Error('Full exit unverified');
    const loss=Math.max(0,Number((quote-returned)*10000n/quote)/100);maxLoss=Math.max(maxLoss,loss);
    if(loss>10)throw Error('Confirmed simulated exit loss exceeds 10%');
   }
   checked={allowed:true,pairId:pool,observedAt:deps.now(),lpStatus:'UNKNOWN',maxLossPercent:maxLoss,reason:`Same-wallet native-USDC buy/full-sell simulated at $10/$100/$500 · max loss ${maxLoss.toFixed(2)}% excluding gas. Execution can change.`};
  }catch(error){
   const safe=error instanceof Error&&/^(Simulation (HTTP|RPC)|Dedicated simulation endpoint|Endpoint URL|Chain mismatch|Native funding|Full exit|Balance unverified|Simulation reverted)/.test(error.message)?error.message:error instanceof Error&&error.name==='TimeoutError'?'Deadline exceeded':'Provider request unavailable';
   checked=deny(error instanceof Error&&/^Confirmed /.test(error.message)?error.message:`Native exit simulation unavailable (${stage}: ${safe}); receipt evidence still required`);
  }
  finally{active=false;}
  if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(identity,{until:deps.now()+(checked.allowed?20000:60000),result:checked});
  console.log('[ArcNativeExitSimulation]',{token,pool,allowed:checked.allowed,maxLossPercent:checked.maxLossPercent,reason:checked.reason});return checked;
 };
}
export const verifyArcNativeExit=createArcNativeExitSimulator({now:Date.now,rpc:async(method,params,signal)=>{
 const endpoint=process.env.ARC_SIMULATION_RPC_URL?.trim().replace(/^(['"])(.*)\1$/,'$2');if(!endpoint)throw Error('Dedicated simulation endpoint unavailable');
 try{if(new URL(endpoint).protocol!=='https:')throw Error('Endpoint URL invalid');}catch{throw Error('Endpoint URL invalid');}
 const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal});
 if(!response.ok)throw Error(`Simulation HTTP ${response.status}`);const json=await readArcProbeResponse(response);if(json.error||json.result==null)throw Error(`Simulation RPC ${method} code ${json.error?.code??'missing-result'}`);return json.result;
}});
