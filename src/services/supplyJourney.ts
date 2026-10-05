import { createSupplyJourneyRpc } from './supplyJourneyRpc.js';
import { getPonsFactoryDeployments, PONS_CONTRACTS } from '../chains/robinhood/ponsContracts.js';
import { getSharedJson } from './sharedJsonCache.js';
import { cachedRobinhoodAlertStats } from './alertKeyStatsService.js';
import type { AlertKeyStats } from '../ui/alertKeyStats.js';

const ADDRESS=/^0x[a-f0-9]{40}$/i;
const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO='0x'+'0'.repeat(40),DEAD='0x'+'0'.repeat(36)+'dead';
export type JourneyTransfer={from:string;to:string;amount:string;tx:string;index:number;block:string};
export type SupplyJourney={token:string;creator:string|null;at:number;block:string|null;fromBlock:string|null;status:'WINDOW_COMPLETE'|'PARTIAL'|'UNAVAILABLE';reason:string|null;total:string|null;holding:string|null;recipients:{address:string;balance:string|null}[];transfers:JourneyTransfer[];excluded:number;stats:AlertKeyStats|null};
export type JourneyDependencies={rpc:<T>(method:string,params:unknown[],signal?:AbortSignal)=>Promise<T>;marker:(token:string)=>Promise<{token?:string;factory?:string;creator?:string;curveAddress?:string}|null>;now:()=>number};
const production:JourneyDependencies={rpc:(method,params,signal)=>createSupplyJourneyRpc(process.env.SUPPLY_JOURNEY_RPC_URL?.trim()||process.env.ROBINHOOD_RPC_URL?.trim()||'https://rpc.mainnet.chain.robinhood.com')(method,params,signal),marker:async token=>(await getSharedJson<any>(`alphaos:pons:verified:${token}`))?.value??null,now:Date.now};
const topic=(a:string)=>'0x'+a.slice(2).padStart(64,'0');
const balanceData=(a:string)=>'0x70a08231'+a.slice(2).padStart(64,'0');
function raw(value:unknown):string {if(typeof value!=='string'||!/^0x[0-9a-f]+$/i.test(value))throw Error('Malformed on-chain quantity');return BigInt(value).toString();}
export function decodeJourneyTransfers(logs:unknown,token:string,from:bigint,to:bigint):JourneyTransfer[]{
 if(!Array.isArray(logs)||logs.length>200)throw Error('Transfer response exceeds research cap');
 const rows=new Map<string,JourneyTransfer>();
 for(const log of logs){
  const l=log as any;
  if(l.removed||l.address?.toLowerCase()!==token||l.topics?.length!==3||l.topics[0]?.toLowerCase()!==TRANSFER||!/^0x[0-9a-f]{64}$/i.test(l.transactionHash??'')||!/^0x[0-9a-f]{64}$/i.test(l.data??''))throw Error('Invalid transfer evidence');
  if(!l.topics.slice(1).every((t:string)=>/^0x0{24}[0-9a-f]{40}$/i.test(t)))throw Error('Invalid address topic');
  const block=BigInt(raw(l.blockNumber)),index=Number(raw(l.logIndex));
  if(block<from||block>to||!Number.isSafeInteger(index))throw Error('Transfer outside checked range');
  const row={from:'0x'+l.topics[1].slice(-40).toLowerCase(),to:'0x'+l.topics[2].slice(-40).toLowerCase(),amount:raw(l.data),tx:l.transactionHash.toLowerCase(),index,block:block.toString()};
  const key=row.tx+':'+index,old=rows.get(key);if(old&&JSON.stringify(old)!==JSON.stringify(row))throw Error('Conflicting duplicate transfer');rows.set(key,row);
 }
 return [...rows.values()].sort((a,b)=>BigInt(a.block)<BigInt(b.block)?-1:BigInt(a.block)>BigInt(b.block)?1:a.index-b.index);
}
export function supplyPercent(amount:string|null,total:string|null):string {
 if(amount===null||total===null||BigInt(total)<=0n)return 'Unavailable';
 return (Number(BigInt(amount)*10000n/BigInt(total))/100).toFixed(2)+'%';
}
export async function analyzeSupplyJourney(token:string,d:JourneyDependencies=production):Promise<SupplyJourney>{
 if(!ADDRESS.test(token))throw Error('Invalid Robinchain contract');token=token.toLowerCase();
 const r:SupplyJourney={token,creator:null,at:d.now(),block:null,fromBlock:null,status:'UNAVAILABLE',reason:null,total:null,holding:null,recipients:[],transfers:[],excluded:0,stats:cachedRobinhoodAlertStats(token)};
 const deadline=d.now()+8000;let calls=0;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);timer.unref();
 const rpc=async<T>(method:string,params:unknown[])=>{if(controller.signal.aborted||d.now()>=deadline||++calls>14)throw Error('Research budget reached');return d.rpc<T>(method,params,controller.signal);};
 try{
  const marker=await d.marker(token);
  if(!marker||marker.token?.toLowerCase()!==token||!ADDRESS.test(marker.creator??'')||!ADDRESS.test(marker.curveAddress??'')||!getPonsFactoryDeployments().some(f=>f.enabled&&f.address.toLowerCase()===marker.factory?.toLowerCase())){r.reason='Verified PONS creator context unavailable. Other launchpads are not supported yet.';return r;}
  r.creator=marker.creator!.toLowerCase();
  if(BigInt(raw(await rpc('eth_chainId',[])))!==4663n)throw Error('Wrong chain');
  const head=BigInt(raw(await rpc('eth_blockNumber',[])));
  if(head<40n)throw Error('Insufficient block history');
  // Public archive fallback serves the last 1024 blocks. Leave headroom for
  // chain progress during validation; this is explicitly recent activity.
  const end=head-40n,start=end>511n?end-511n:0n,block='0x'+end.toString(16);
  r.block=end.toString();r.fromBlock=start.toString();
  const before=await rpc<any>('eth_getBlockByNumber',[block,false]);
  if(!/^0x[0-9a-f]{64}$/i.test(before?.hash??''))throw Error('Checked block unavailable');
  const logs=await rpc('eth_getLogs',[{address:token,fromBlock:'0x'+start.toString(16),toBlock:block,topics:[TRANSFER,topic(r.creator)]}]);
  const rows=decodeJourneyTransfers(logs,token,start,end);
  if(rows.some(row=>row.from!==r.creator))throw Error('Unexpected transfer sender');
  const excluded=new Set([ZERO,DEAD,marker.curveAddress!.toLowerCase(),marker.factory!.toLowerCase(),PONS_CONTRACTS.swapRouter.toLowerCase(),PONS_CONTRACTS.positionManager.toLowerCase(),r.creator]);
  // Graduated pool identity is not available from this marker. Do not pretend
  // the recipient set excludes every possible pool, router or distributor.
  r.transfers=rows;r.excluded=rows.filter(row=>excluded.has(row.to)).length;
  const recipients=[...new Set(rows.filter(row=>BigInt(row.amount)>0n&&!excluded.has(row.to)).map(row=>row.to))];
  r.total=raw(await rpc('eth_call',[{to:token,data:'0x18160ddd'},block]));
  if(BigInt(r.total)<=0n)throw Error('Supply unavailable');
  r.holding=raw(await rpc('eth_call',[{to:token,data:balanceData(r.creator)},block]));
  if(BigInt(r.holding)>BigInt(r.total))throw Error('Invalid creator balance');
  for(const address of recipients.slice(0,6)){
   let balance:string|null=null;try{balance=raw(await rpc('eth_call',[{to:token,data:balanceData(address)},block]));}catch{/* No fabricated zero. */}
   if(balance!==null&&BigInt(balance)>BigInt(r.total))balance=null;
   r.recipients.push({address,balance});
  }
  const after=await rpc<any>('eth_getBlockByNumber',[block,false]);
  if(before.hash!==after?.hash){r.transfers=[];r.recipients=[];r.holding=null;r.total=null;throw Error('Checked block changed; retry research');}
  if(r.recipients.every(row=>row.balance!==null) && r.recipients.reduce((sum,row)=>sum+BigInt(row.balance!),BigInt(r.holding))>BigInt(r.total))throw Error('Inconsistent aggregate balances');
  r.status=recipients.length<=6&&r.recipients.every(row=>row.balance!==null)?'WINDOW_COMPLETE':'PARTIAL';
  r.reason=r.status==='PARTIAL'?'Recipient cap or missing balance read; combined holdings are incomplete.':null;
 }catch{r.status='UNAVAILABLE';r.transfers=[];r.recipients=[];r.holding=null;r.total=null;r.reason='Transfer research unavailable, incomplete or over budget. No supply conclusion was made.';}
 finally{clearTimeout(timer);}
 return r;
}
const cache=new Map<string,SupplyJourney>(),pending=new Map<string,Promise<SupplyJourney>>();let minute=0,starts=0;
export async function getSupplyJourney(token:string):Promise<SupplyJourney>{
 if(!ADDRESS.test(token))throw Error('Invalid contract');token=token.toLowerCase();const old=cache.get(token);
 if(old&&Date.now()-old.at<60000)return old;
 if(pending.has(token))return respondWithinDeadline(pending.get(token)!);
 const now=Math.floor(Date.now()/60000);if(now!==minute){minute=now;starts=0;}
 if(pending.size>=1||starts>=2)throw Error('Supply research busy; retry in a minute');starts++;
 const work=analyzeSupplyJourney(token).then(r=>{if(cache.size>=30)cache.delete(cache.keys().next().value!);cache.set(token,r);return r;}).finally(()=>pending.delete(token));pending.set(token,work);return respondWithinDeadline(work);
}

async function respondWithinDeadline(work:Promise<SupplyJourney>):Promise<SupplyJourney>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Supply research deadline reached')),9000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
