import {getPonsFactoryDeployments} from '../chains/robinhood/ponsContracts.js';
export type CensusLaunch={chain:string;protocol:string;token_address:string;deployer_address:string;factory_address:string;transaction_hash:string;block_number:string|number;log_index:number};
export type DeveloperHistory={status:'OBSERVED'|'UNVERIFIED';token:string;creator?:string;prior?:number;capped?:boolean;checkedAt:number};
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
const approved=()=>new Set(getPonsFactoryDeployments().filter(f=>f.enabled).map(f=>f.address.toLowerCase()));
function valid(row:CensusLaunch,factories:Set<string>){return row?.chain==='robinhood'&&row.protocol==='pons'&&address(row.token_address)&&address(row.deployer_address)&&typeof row.factory_address==='string'&&factories.has(row.factory_address.toLowerCase())&&/^0x[a-f0-9]{64}$/i.test(row.transaction_hash??'')&&/^\d{1,20}$/.test(String(row.block_number))&&Number.isSafeInteger(row.log_index)&&row.log_index>=0;}
// Census facts establish the recorded wallet, not the person/team behind it.
// Counts are bounded lower bounds, scoped to approved PONS factories and earlier
// events. Current/future launches and duplicate token rows cannot inflate them.
export function assessDeveloperHistory(token:string,current:CensusLaunch|null,rows:CensusLaunch[],now=Date.now()):DeveloperHistory{
 const unknown:DeveloperHistory={status:'UNVERIFIED',token:token.toLowerCase(),checkedAt:now},factories=approved();
 if(!address(token)||!current||!valid(current,factories)||current.token_address.toLowerCase()!==token.toLowerCase()||!Array.isArray(rows)||rows.length>101)return unknown;
 if(rows.some(row=>!valid(row,factories)||row.deployer_address.toLowerCase()!==current.deployer_address.toLowerCase()))return unknown;
 const tokens=new Set<string>(),events=new Map<string,string>();for(const row of rows){
  const event=`${row.factory_address.toLowerCase()}:${row.transaction_hash.toLowerCase()}:${row.log_index}`,prior=events.get(event);
  if(prior&&prior!==row.token_address.toLowerCase())return unknown;events.set(event,row.token_address.toLowerCase());
  if(row.token_address.toLowerCase()===token.toLowerCase())continue;
  const block=BigInt(row.block_number),at=BigInt(current.block_number);
  if(block<at||block===at&&row.log_index<current.log_index)tokens.add(row.token_address.toLowerCase());
 }
 return {status:'OBSERVED',token:token.toLowerCase(),creator:current.deployer_address.toLowerCase(),prior:tokens.size,capped:rows.length===101,checkedAt:now};
}
export function developerHistoryNote(history?:DeveloperHistory|null):string{
 if(history?.status!=='OBSERVED')return 'Deployer history <b>Unverified</b>';
 if(!history.prior)return 'Deployer history <b>No earlier token found in indexed PONS sample</b> · other wallets/chains unverified';
 return `⚠️ Repeat deployer · <b>${history.capped?'at least ':''}${history.prior} earlier indexed PONS token${history.prior===1?'':'s'}</b>\nSame recorded wallet · team identity and intent unverified.`;
}
type Loader=(token:string)=>Promise<{current:CensusLaunch|null;rows:CensusLaunch[]}>;
export function createDeveloperHistoryReader(load:Loader,now=Date.now){
 const cache=new Map<string,{until:number;value:DeveloperHistory}>(),inflight=new Map<string,Promise<DeveloperHistory>>();let window=0,started=0,backoff=0;
 const unknown=(token:string):DeveloperHistory=>({status:'UNVERIFIED',token,checkedAt:now()});
 const peek=(token:string)=>{const hit=cache.get(token.toLowerCase());return hit&&hit.until>now()?hit.value:null;};
 return {peek,async read(token:string):Promise<DeveloperHistory>{
  token=token.toLowerCase();if(!address(token))return unknown(token);
  const hit=peek(token);if(hit)return hit;
  const pending=inflight.get(token);if(pending)return pending;
  if(now()-window>=60000){window=now();started=0;}
  if(inflight.size>=1||started>=5||backoff>now())return unknown(token);started++;
  const job=(async()=>{let value:DeveloperHistory;
   try{const data=await load(token);value=assessDeveloperHistory(token,data.current,data.rows,now());}
   catch{backoff=now()+300000;value=unknown(token);}
   if(cache.size>=200)cache.delete(cache.keys().next().value!);
   cache.set(token,{value,until:now()+(value.status==='OBSERVED'?300000:15000)});return value;
  })();inflight.set(token,job);try{return await job;}finally{inflight.delete(token);}
 }};
}
const production=createDeveloperHistoryReader(async token=>{
 const {supabase}=await import('./supabase.js');
 const {runDatabaseWork}=await import('./databaseLoadGovernor.js');
 const result=await runDatabaseWork('BACKGROUND',async()=>{
 const fields='chain,protocol,token_address,deployer_address,factory_address,transaction_hash,block_number,log_index';
 const factories=[...approved()];
 const found=await supabase.from('pons_launches').select(fields).eq('chain','robinhood').eq('protocol','pons').eq('token_address',token).in('factory_address',factories).order('block_number',{ascending:true}).limit(1).abortSignal(AbortSignal.timeout(1500)).maybeSingle();
 if(found.error)throw found.error;if(!found.data)return {current:null,rows:[]};
 const current=found.data as CensusLaunch;
 // Existing deployer/time and token/factory indexes; no new table, count-all,
 // chain scan, per-recipient read or performance/blacklist lookup.
 const prior=await supabase.from('pons_launches').select(fields).eq('chain','robinhood').eq('protocol','pons').eq('deployer_address',current.deployer_address).in('factory_address',factories).lte('block_number',current.block_number).neq('token_address',token).order('block_number',{ascending:false}).order('log_index',{ascending:false}).limit(101).abortSignal(AbortSignal.timeout(1500));
 if(prior.error)throw prior.error;return {current,rows:prior.data as CensusLaunch[]};
 });
 if(!result)throw Error('Launch census deferred');return result;
});
export const cachedPromotionDeveloperHistory=production.peek;
export const readPromotionDeveloperHistory=production.read;
