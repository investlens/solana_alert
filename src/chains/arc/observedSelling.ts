import {decodeEventLog,parseAbiItem,encodeAbiParameters,parseAbiParameters,keccak256,type Address,type Hex} from 'viem';
import {resolvePlainV4Key} from '../../services/customTokenExitVerification.js';
import {governedDexScreenerJson} from '../../services/dexscreenerRequestGovernor.js';
import {getArcBlock,getArcBlockNumber,getArcLogs,getArcBytecode,getArcTransaction,getArcTransactionReceipt} from './rpc.js';
import {ARC_UNISWAP_V4_POOL_MANAGER as MANAGER} from './uniswap.js';
export const ARC_USDC='0x3600000000000000000000000000000000000000';
export const ARC_NATIVE_USDC='0x0000000000000000000000000000000000000000';
export const ARC_NATIVE_TRANSFER_EMITTER='0xfffffffffffffffffffffffffffffffffffffffe';
export const ARC_SWAP=parseAbiItem('event Swap(bytes32 indexed id,address indexed sender,int128 amount0,int128 amount1,uint160 sqrtPriceX96,uint128 liquidity,int24 tick,uint24 fee)');
const TRANSFER=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const WINDOW_MS=300_000;
export type ObservedSale={wallet:string;tx:string;at:number;usdc:bigint};
export type ArcObservedSelling={allowed:boolean;reason:string;poolId?:string;sellers?:number;sells?:number;totalUsdc?:number;largestSellerPercent?:number;oldestAt?:number;observedAt:number};
const same=(a:unknown,b:unknown)=>typeof a==='string'&&typeof b==='string'&&a.toLowerCase()===b.toLowerCase();
export type ArcObservedPoolMetadata={fee:number;tickSpacing:number;hooks:string;quoteAsset:string};
export function resolveArcObservedPoolKey(token:string,quote:string,poolId:string,metadata?:ArcObservedPoolMetadata){
 if(metadata){
  if(!same(metadata.quoteAsset,quote)||!same(metadata.hooks,ARC_NATIVE_USDC)||!Number.isInteger(metadata.fee)||metadata.fee<0||metadata.fee>100000||!Number.isInteger(metadata.tickSpacing)||metadata.tickSpacing<=0||metadata.tickSpacing>32767)return null;
  const [currency0,currency1]=[token.toLowerCase(),quote.toLowerCase()].sort() as Address[];
  const key={currency0,currency1,fee:metadata.fee,tickSpacing:metadata.tickSpacing,hooks:ARC_NATIVE_USDC as Address};
  const hash=keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),[currency0,currency1,key.fee,key.tickSpacing,key.hooks]));
  return same(hash,poolId)?key:null;
 }
 return [0,100,500,3000,10000].map(fee=>resolvePlainV4Key(token,quote,poolId,fee)).find(Boolean)??null;
}
export function assessObservedSales(sales:ObservedSale[],now:number,creator?:string|null):ArcObservedSelling {
 const unique=new Map<string,ObservedSale>();
 for(const sale of sales){
  if(!/^0x[a-f0-9]{40}$/i.test(sale.wallet)||!/^0x[a-f0-9]{64}$/i.test(sale.tx)||!Number.isFinite(sale.at)||sale.at>now||sale.at<now-WINDOW_MS||sale.usdc<5_000_000n||same(sale.wallet,creator))continue;
  unique.set(sale.tx.toLowerCase(),sale);
 }
 const wallets=new Map<string,bigint>();
 for(const sale of unique.values())wallets.set(sale.wallet.toLowerCase(),(wallets.get(sale.wallet.toLowerCase())??0n)+sale.usdc);
 const total=[...wallets.values()].reduce((a,b)=>a+b,0n);
 const largest=[...wallets.values()].reduce((a,b)=>a>b?a:b,0n);
 const concentration=total?Number(largest*10_000n/total)/100:100;
 const allowed=wallets.size>=4&&total>=50_000_000n&&largest*100n<=total*60n;
 return {allowed,reason:allowed?'Recent receipt-backed sells observed; no buy/sell simulation. Distinct wallets do not prove unrelated ownership.':'Insufficient recent distinct-wallet sell evidence',sellers:wallets.size,sells:unique.size,totalUsdc:Number(total)/1e6,largestSellerPercent:concentration,oldestAt:unique.size?Math.min(...[...unique.values()].map(x=>x.at)):undefined,observedAt:now};
}
/** Only a single plain-pool sell with net token debit and net USDC receipt by the actual EOA sender counts. */
export function saleFromReceipt(input:{token:string;poolId:string;tokenIs0:boolean;transaction:any;receipt:any;at:number;code:Hex|undefined;nativeQuote?:boolean}):ObservedSale|null {
 const {token,poolId,transaction:tx,receipt:r,at,code,tokenIs0}=input;
 if(code!=='0x'||!tx?.from||!/^0x[a-f0-9]{40}$/i.test(tx.from)||r?.status!=='success'||!same(tx.hash,r.transactionHash)||tx.blockNumber!==r.blockNumber||!same(tx.blockHash,r.blockHash)||!Array.isArray(r.logs))return null;
 const native=!!input.nativeQuote,quoteEmitter=native?ARC_NATIVE_TRANSFER_EMITTER:ARC_USDC;
 let swaps=0,tokenIn=0n,quoteOut=0n,tokenNet=0n,quoteNet=0n,quoteCredit=0n;
 try {
  for(const log of r.logs){
   if(log.removed||!same(log.transactionHash,r.transactionHash)||log.blockNumber!==r.blockNumber||!same(log.blockHash,r.blockHash))return null;
   if(same(log.address,MANAGER)){
    let event:any;try{event=decodeEventLog({abi:[ARC_SWAP],data:log.data,topics:log.topics});}catch{continue;}
    swaps++;if(!same(event.args.id,poolId))return null;
    const inputDelta=tokenIs0?event.args.amount0:event.args.amount1,outputDelta=tokenIs0?event.args.amount1:event.args.amount0;
    if(inputDelta>=0n||outputDelta<=0n)return null;tokenIn=-BigInt(inputDelta);quoteOut=BigInt(outputDelta);
   }
   if(same(log.address,token)||same(log.address,quoteEmitter)){
    let event:any;try{event=decodeEventLog({abi:[TRANSFER],data:log.data,topics:log.topics});}catch{continue;}
    const value=BigInt(event.args.value);const net=(same(event.args.to,tx.from)?value:0n)-(same(event.args.from,tx.from)?value:0n);
    if(same(log.address,token))tokenNet+=net;else {quoteNet+=net;if(same(event.args.to,tx.from))quoteCredit+=value;}
   }
  }
  // Exact settlement avoids attributing donations, multi-hop routes or unrelated transfers to a sell.
  const scale=native?1_000_000_000_000n:1n;
  if(swaps!==1||tokenNet!==-tokenIn||quoteCredit!==quoteOut||quoteNet!==quoteOut||quoteNet<5_000_000n*scale)return null;
  return {wallet:tx.from,tx:tx.hash,at,usdc:quoteNet/scale};
 }catch{return null;}
}
type Dependencies={now:()=>number;pairs:(token:string)=>Promise<any[]>;head:()=>Promise<bigint>;logs:(args:any)=>Promise<any[]>;transaction:(hash:Hex)=>Promise<any>;receipt:(hash:Hex)=>Promise<any>;block:(number:bigint)=>Promise<any>;code:(address:Address)=>Promise<Hex|undefined>};
export function createArcObservedVerifier(deps:Dependencies){
 const cache=new Map<string,{until:number;result:ArcObservedSelling}>(),pending=new Map<string,Promise<ArcObservedSelling>>();let active=0;const starts:number[]=[];
 return async(token:string,creator?:string|null,expectedPool?:string,metadata?:ArcObservedPoolMetadata):Promise<ArcObservedSelling>=>{
  const now=deps.now(),key=[token,creator??'',expectedPool??'',metadata?`${metadata.quoteAsset}:${metadata.fee}:${metadata.tickSpacing}:${metadata.hooks}`:''].join(':').toLowerCase();
  const blocked=(reason:string):ArcObservedSelling=>({allowed:false,reason,observedAt:deps.now()});
  if(!/^0x[a-f0-9]{40}$/i.test(token))return blocked('Invalid ARC token');
  const cached=cache.get(key);if(cached&&cached.until>now)return cached.result;
  if(pending.has(key))return pending.get(key)!;
  while(starts.length&&starts[0]<=now-60_000)starts.shift();
  if(active>=1||starts.length>=2)return blocked('ARC observed-selling budget busy; retry required');
  starts.push(now);active++;
  const work=(async()=>{
   try{
    const deadline=now+25_000;
    const pairs=(await deps.pairs(token)).filter(p=>p.chainId==='arc'&&p.dexId==='uniswap'&&same(p.baseToken?.address,token)&&(same(p.quoteToken?.address,ARC_USDC)||same(p.quoteToken?.address,ARC_NATIVE_USDC))&&(!expectedPool||same(p.pairAddress,expectedPool))).sort((a,b)=>Number(b.liquidity?.usd??0)-Number(a.liquidity?.usd??0));
    const pool=pairs[0];if(!pool||Number(pool.txns?.m5?.sells??0)<4||Number(pool.liquidity?.usd??0)<2500)return blocked('No eligible liquid ARC pool with recent sells');
    const poolId=String(pool.pairAddress);const poolKey=resolveArcObservedPoolKey(token,pool.quoteToken.address,poolId,metadata);
    if(!poolKey)return blocked('Unknown hook or unsupported ARC pool identity');
    const head=await deps.head();if(head<2n)return blocked('ARC head unavailable');
    const toBlock=head-2n,fromBlock=toBlock>600n?toBlock-600n:0n;
    const logs=await deps.logs({address:MANAGER,event:ARC_SWAP,args:{id:poolId},fromBlock,toBlock});
    if(logs.length>200)return blocked('ARC sell window exceeds bounded log budget');
    const minimumQuote=5_000_000n*(same(pool.quoteToken.address,ARC_NATIVE_USDC)?1_000_000_000_000n:1n);
    const tokenIs0=same(poolKey.currency0,token);
    const hashes=[...new Set(logs.filter(l=>!l.removed&&l.transactionHash&&l.blockNumber!=null&&l.blockNumber>=fromBlock&&l.blockNumber<=toBlock&&same(l.args?.id,poolId)&&(tokenIs0?l.args?.amount0:l.args?.amount1)<0n&&(tokenIs0?l.args?.amount1:l.args?.amount0)>=minimumQuote).sort((a,b)=>a.blockNumber>b.blockNumber?-1:1).map(l=>l.transactionHash as Hex))].slice(0,12);
    const sales:ObservedSale[]=[],blocks=new Map<bigint,any>(),codes=new Map<string,Hex|undefined>();
    for(const hash of hashes){
     if(deps.now()>deadline)break;
     const tx=await deps.transaction(hash),receipt=await deps.receipt(hash);
     if(!tx||!same(tx.hash,hash)||!same(receipt.transactionHash,hash)||receipt.blockNumber<fromBlock||receipt.blockNumber>toBlock||receipt.status!=='success'||same(tx.from,creator))continue;
     let block=blocks.get(receipt.blockNumber);if(!block){block=await deps.block(receipt.blockNumber);blocks.set(receipt.blockNumber,block);}
     if(!same(block.hash,receipt.blockHash))continue;
     const at=Number(block.timestamp)*1000;if(at<deps.now()-WINDOW_MS||at>deps.now())continue;
     const wallet=String(tx.from).toLowerCase();if(!codes.has(wallet))codes.set(wallet,await deps.code(tx.from));
     const sale=saleFromReceipt({token,poolId,tokenIs0:same(poolKey.currency0,token),transaction:tx,receipt,at,code:codes.get(wallet),nativeQuote:same(pool.quoteToken.address,ARC_NATIVE_USDC)});if(sale)sales.push(sale);
    }
    return {...assessObservedSales(sales,deps.now(),creator),poolId};
   }catch{return blocked('ARC receipt evidence unavailable; alert withheld');}
  })().then(result=>{
   if(cache.size>=100)cache.delete(cache.keys().next().value!);
   const until=result.allowed?Math.min(deps.now()+30_000,(result.oldestAt??0)+WINDOW_MS):deps.now()+60_000;
   cache.set(key,{until,result});
   console.log('[ArcObservedSelling]',{token,poolId:result.poolId,allowed:result.allowed,sellers:result.sellers,sells:result.sells,totalUsdc:result.totalUsdc,largestSellerPercent:result.largestSellerPercent,reason:result.reason});
   return result;
  }).finally(()=>{active--;pending.delete(key);});pending.set(key,work);return work;
 };
}
export const verifyArcObservedSelling=createArcObservedVerifier({now:Date.now,pairs:async token=>(await governedDexScreenerJson<any[]>({url:`https://api.dexscreener.com/token-pairs/v1/arc/${token}`,caller:'arc_observed_selling',endpoint:'ARC_TOKEN_PAIRS',priority:'NORMAL',cacheKey:`arc-alert-pairs:${token.toLowerCase()}`,cacheTtlMs:30_000,queueWaitTimeoutMs:750,httpTimeoutMs:2000})).value,head:getArcBlockNumber,logs:getArcLogs,transaction:getArcTransaction,receipt:getArcTransactionReceipt,block:number=>getArcBlock({blockNumber:number}),code:async address=>(await getArcBytecode(address))??'0x'});
