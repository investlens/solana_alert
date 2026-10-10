import { requestRobinhoodRpcResilient } from '../chains/robinhood/rpc.js';
import { getReportedPonsPublicContext } from '../chains/robinhood/ponsPublicContext.js';
export type CreatorActivity = {reportedSales?:number;saleTx?:string;burns?:number;outflows?:number;fromBlock?:string;toBlock?:string;observedAt:number};
const transfer='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v);
// Exact token/from identity, mined logs, bounded range and de-duplication. A
// transfer to another wallet/pool is not proof of a sale or common ownership.
export function parseCreatorOutflows(value:unknown,token:string,creator:string,from:bigint,to:bigint):Pick<CreatorActivity,'burns'|'outflows'|'fromBlock'|'toBlock'>|null {
 if(!Array.isArray(value)||value.length>100||!address(token)||!address(creator)||from<0n||to<from||to-from>511n)return null;
 const seen=new Set<string>();let burns=0,outflows=0;
 for(const log of value){
  if(log?.removed||log?.address?.toLowerCase?.()!==token.toLowerCase()||!Array.isArray(log.topics)||log.topics.length!==3
   ||log.topics[0]?.toLowerCase?.()!==transfer||log.topics[1]?.toLowerCase?.()!=='0x'+creator.slice(2).toLowerCase().padStart(64,'0')
   ||!/^0x0{24}[a-f0-9]{40}$/i.test(log.topics[2]??'')||!/^0x[a-f0-9]{64}$/i.test(log.transactionHash??'')
   ||!/^0x[a-f0-9]+$/i.test(log.blockNumber??'')||!/^0x[a-f0-9]+$/i.test(log.logIndex??'')||!/^0x[a-f0-9]{64}$/i.test(log.data??''))return null;
  const block=BigInt(log.blockNumber);if(block<from||block>to)return null;
  const id=log.transactionHash.toLowerCase()+':'+BigInt(log.logIndex);if(seen.has(id))continue;seen.add(id);
  if(BigInt(log.data)===0n)continue;
  const target='0x'+log.topics[2].slice(-40).toLowerCase();if(target===creator.toLowerCase())continue;
  if(target==='0x'+'0'.repeat(40)||target==='0x'+'0'.repeat(36)+'dead')burns++;else outflows++;
 }
 return {burns,outflows,fromBlock:from.toString(),toBlock:to.toString()};
}
const cache=new Map<string,{at:number;value:CreatorActivity|null}>();
const pending=new Map<string,Promise<CreatorActivity|null>>();let minute=0,started=0;
// Enrichment only, after initial delivery. One small log range, no pagination,
// at most 10 tokens/minute and one in-flight job. No database writes or sweeps.
export async function creatorActivityEvidence(token:string,creator:string,block?:string):Promise<CreatorActivity|null> {
 if(!address(token)||!address(creator)||/^0x0{40}$/i.test(creator))return null;
 const key=token.toLowerCase()+':'+creator.toLowerCase(),now=Date.now(),hit=cache.get(key);
 if(hit&&now-hit.at<(hit.value?60_000:15_000))return hit.value;
 if(pending.has(key))return pending.get(key)!;
 if(minute!==Math.floor(now/60_000)){minute=Math.floor(now/60_000);started=0;}
 if(pending.size||started>=10)return null;started++;
 const job=(async()=>{
  const context=await getReportedPonsPublicContext(token).catch(()=>null);
  const sale=context?.creator.toLowerCase()===creator.toLowerCase()?context.creatorSales:undefined;
  let flow:ReturnType<typeof parseCreatorOutflows>=null;
  try{
   const tip=block&&/^\d+$/.test(block)?BigInt(block):BigInt(String(await requestRobinhoodRpcResilient({method:'eth_blockNumber',params:[]})));
   const from=tip>511n?tip-511n:0n;
   const logs=await requestRobinhoodRpcResilient({method:'eth_getLogs',params:[{address:token,fromBlock:'0x'+from.toString(16),toBlock:'0x'+tip.toString(16),topics:[transfer,'0x'+creator.slice(2).toLowerCase().padStart(64,'0')]}]});
   flow=parseCreatorOutflows(logs,token,creator,from,tip);
  }catch{/* Provider unavailable: do not infer activity from balance. */}
  return sale||flow?{reportedSales:sale?.count,saleTx:sale?.latestTx,...flow,observedAt:Date.now()}:null;
 })().then(value=>{if(cache.size>=100)cache.delete(cache.keys().next().value!);cache.set(key,{at:Date.now(),value});return value;}).finally(()=>pending.delete(key));
 pending.set(key,job);return job;
}
