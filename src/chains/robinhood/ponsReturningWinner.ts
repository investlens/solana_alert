import {getPonsFactoryDeployments} from './ponsContracts.js';
import type {PonsLaunch} from './ponsHistoricalLaunchScanner.js';
import {escapeTelegramHtml as esc} from '../../ui/escapeHtml.js';

const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[a-f0-9]{40}$/i.test(v)&&!/^0x0{40}$/i.test(v);
const hash=(v:unknown)=>typeof v==='string'&&/^0x[a-f0-9]{64}$/i.test(v);
const count=(v:unknown):number|null=>{const n=typeof v==='number'||(typeof v==='string'&&/^\d+$/.test(v))?Number(v):NaN;return Number.isSafeInteger(n)&&n>=0?n:null;};
export type PriorWinner={chain:string;token:string;creator:string;creator_source:string;price_unit:'USD'|'ETH_RESERVE_RATIO';baseline_price:number;final_roi:number;sampled_low_roi:number;samples:{status:string;price:number;at:string}[];assessed_at:string};
export type DexReference={token:string;pool:string;source:'PONS_V2_GRADUATED_MAPPED_POOL'|'PONS_V1_MAPPED_POOL';observed_at:string};
export type WinnerHistory={creator:string;known_launches:number;dex_projects:number;dex_references:DexReference[];history_scope:'SHORTLIST'|'PRIOR_LAUNCHES';checked_at?:string};
export type WinnerSnapshot={asOf:number;capped:boolean;developers:Map<string,WinnerHistory>};
export function freshVerifiedPonsLaunch(launch:PonsLaunch,now:number):boolean {
 if(!launch||launch.chain!=='robinhood'||launch.protocol!=='pons'||![launch.token_address,launch.deployer_address,launch.factory_address].every(address)||!hash(launch.transaction_hash)||!Number.isSafeInteger(launch.log_index)||launch.log_index<0||!/^\d+$/.test(launch.block_number))return false;
 const factory=getPonsFactoryDeployments().find(f=>f.enabled&&f.address.toLowerCase()===launch.factory_address.toLowerCase());
 const block=BigInt(launch.block_number),at=Date.parse(launch.block_timestamp);
 return !!factory&&launch.protocol_version===factory.id&&!(factory.startBlock!=null&&block<factory.startBlock)&&!(factory.endBlock!=null&&block>factory.endBlock)
  &&Number.isFinite(at)&&at<=now+30000&&now-at<=10*60000;
}
export function validPriorWinner(row:any,creator:string):row is PriorWinner {
 if(row?.chain!=='robinhood'||!address(row.token)||!address(row.creator)||row.creator.toLowerCase()!==creator.toLowerCase()
  ||!['PONS_FACTORY_EVENT','CHAIN_DEPLOYMENT_RECEIPT'].includes(row.creator_source)||!['USD','ETH_RESERVE_RATIO'].includes(row.price_unit)
  ||!Number.isFinite(row.baseline_price)||row.baseline_price<=0||!Number.isFinite(row.final_roi)||!Number.isFinite(row.sampled_low_roi)
  ||!Array.isArray(row.samples)||row.samples.length!==3||row.samples.some((s:any)=>s?.status!=='MEASURED'||typeof s.price!=='number'||!Number.isFinite(s.price)||s.price<=0||typeof s.at!=='string'||!Number.isFinite(Date.parse(s.at)))
  ||!Number.isFinite(Date.parse(row.assessed_at)))return false;
 const returns=row.samples.map((s:any)=>(s.price/row.baseline_price-1)*100),low=Math.min(0,...returns),last=returns[2];
 const times=row.samples.map((s:any)=>Date.parse(s.at));
 return times[0]<times[1]&&times[1]<times[2]&&times[2]<=Date.parse(row.assessed_at)+30000
  &&last>=25&&low>=-30&&Math.abs(last-row.final_roi)<1e-6*Math.max(1,Math.abs(last))&&Math.abs(low-row.sampled_low_roi)<1e-6*Math.max(1,Math.abs(low));
}
export function parseWinnerSnapshot(payload:any,now:number):WinnerSnapshot|null {
 const asOf=Date.parse(payload?.as_of);
 if(payload?.policy_version!==4||!Number.isFinite(asOf)||asOf>now+30000||now-asOf>5*60000||!Array.isArray(payload.developers)||payload.developers.length>1000)return null;
 const developers=new Map<string,WinnerHistory>();
 for(const row of payload.developers){
  const total=count(row?.known_launches),dex=count(row?.dex_projects);
  if(!address(row?.creator)||total===null||dex===null||total<1||dex<1||dex>total||!['SHORTLIST','PRIOR_LAUNCHES'].includes(row.history_scope)||!Array.isArray(row.dex_references)||row.dex_references.length<1||row.dex_references.length>3)continue;
  const denominator=row.history_scope==='SHORTLIST'?Math.max(total-1,1):total;
  if(dex*10<denominator*3)continue;
  const refs=row.dex_references.filter((r:any)=>address(r?.token)&&typeof r.pool==='string'&&/^0x(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(r.pool)&&!/^0x0+$/i.test(r.pool)&&r.pool.toLowerCase()!==r.token.toLowerCase()
   &&['PONS_V2_GRADUATED_MAPPED_POOL','PONS_V1_MAPPED_POOL'].includes(r.source)&&Number.isFinite(Date.parse(r.observed_at))&&Date.parse(r.observed_at)<=asOf);
  if(refs.length!==row.dex_references.length||refs.length>dex||new Set(refs.map((r:any)=>r.token.toLowerCase())).size!==refs.length)continue;
  const creator=row.creator.toLowerCase();if(developers.has(creator))return null;
  developers.set(creator,{creator,known_launches:total,dex_projects:dex,dex_references:refs,history_scope:row.history_scope,checked_at:new Date(asOf).toISOString()});
 }
 return {asOf,capped:payload.capped===true,developers};
}
export function returningWinnerHistory(launch:PonsLaunch,snapshot:WinnerSnapshot,now:number):WinnerHistory|null {
 if(!freshVerifiedPonsLaunch(launch,now)||now-snapshot.asOf>5*60000)return null;
 const history=snapshot.developers.get(launch.deployer_address.toLowerCase());if(!history)return null;
 const refs=history.dex_references.filter(r=>r.token.toLowerCase()!==launch.token_address.toLowerCase()&&Date.parse(r.observed_at)<Date.parse(launch.block_timestamp));
 return refs.length?{...history,dex_references:refs}:null;
}
export function returningWinnerCard(launch:PonsLaunch,history:WinnerHistory,metadata?:{name?:string|null;symbol?:string|null}):string {
 if(history.history_scope!=='PRIOR_LAUNCHES'||history.dex_projects*10<history.known_launches*3)throw Error('Prior DEX history required');
 const names=[metadata?.name?.slice(0,48),metadata?.symbol?.slice(0,16)].filter(Boolean).map(esc).join(' · ')||'New PONS token · name pending';
 return ['📊 <b>ALPHAOS · DEVELOPER DEX TRACK RECORD</b>',names,'Robinchain · Verified PONS factory launch','',
  `<code>${esc(launch.token_address)}</code>`,`Developer <code>${esc(history.creator)}</code>`,'',
  `<b>DEX reached: ${history.dex_projects} / ${history.known_launches} prior projects · ${(100*history.dex_projects/history.known_launches).toFixed(1)}%</b>`,
  'Qualifies at 30% verified DEX reach.',
  ...(history.known_launches<10?['⚠️ Limited launch history sample']:[]),
  ...history.dex_references.map(r=>`DEX project: <a href="https://robinhoodchain.blockscout.com/token/${r.token}">${r.token.slice(0,8)}…${r.token.slice(-6)}</a>`),
  'Distinct indexed prior projects; the new launch is excluded.',
  'Unverified DEX status does not count as success. Indexed history may be incomplete.',
  'DEX reach is not a profitable-trade or safety guarantee.',
  ...(history.checked_at?[`History checked ${history.checked_at.slice(0,16).replace('T',' ')} UTC`]:[]),
  'LP status Unverified'].join('\n');
}

export function createReturningWinnerQueue(deps:{now:()=>number;load:()=>Promise<unknown>;send:(launch:PonsLaunch,history:WinnerHistory)=>Promise<void>}) {
 const pending=new Map<string,PonsLaunch>();let snapshot:WinnerSnapshot|null=null,nextRead=0,reading:Promise<void>|null=null,active=0;
 const inflight=new Set<string>(),done=new Map<string,number>(),retryAt=new Map<string,number>(),attempts=new Map<string,number>();
 function discard(key:string){pending.delete(key);retryAt.delete(key);attempts.delete(key);}
 async function tick():Promise<void>{
  const now=deps.now();for(const[k,l]of pending)if(!freshVerifiedPonsLaunch(l,now)){pending.delete(k);attempts.delete(k);retryAt.delete(k);}
  for(const[k,at]of done)if(now-at>10*60000)done.delete(k);
  if(!pending.size)return;
  if(now>=nextRead&&!reading){nextRead=now+5*60000;reading=(async()=>{try{snapshot=parseWinnerSnapshot(await deps.load(),deps.now());}catch{snapshot=null;}finally{if(!snapshot)nextRead=deps.now()+60000;reading=null;}})();}
  if(reading)await reading;
  if(!snapshot||deps.now()-snapshot.asOf>5*60000)return;
  for(const[key,launch]of pending){
   if(active>=2)break;if((retryAt.get(key)??0)>deps.now())continue;
   const history=returningWinnerHistory(launch,snapshot,deps.now());if(!history)continue;
   pending.delete(key);inflight.add(key);active++;attempts.set(key,(attempts.get(key)??0)+1);
   void Promise.resolve().then(()=>deps.send(launch,history)).then(()=>{if(done.size>=1000)done.delete(done.keys().next().value!);done.set(key,deps.now());retryAt.delete(key);attempts.delete(key);},()=>{
    console.warn('[ReturningWinnerDev] delivery job unavailable; bounded retry policy applied');
    if((attempts.get(key)??0)<2&&freshVerifiedPonsLaunch(launch,deps.now())){if(pending.size>=100)discard(pending.keys().next().value!);pending.set(key,launch);retryAt.set(key,deps.now()+60000);}
    else{attempts.delete(key);retryAt.delete(key);}
   })
    .finally(()=>{inflight.delete(key);active--;void tick();});
  }
 }
 return {enqueue(launch:PonsLaunch){
  if(!freshVerifiedPonsLaunch(launch,deps.now()))return;
  const key=launch.token_address.toLowerCase();if(done.has(key)||inflight.has(key)||pending.has(key))return;
  // Cached positive matches take priority if launch traffic fills the bounded queue.
  if(pending.size>=100){if(!snapshot||!returningWinnerHistory(launch,snapshot,deps.now()))return;discard(pending.keys().next().value!);}
  pending.set(key,launch);void tick();
 },tick,stats:()=>({pending:pending.size,active,developers:snapshot?.developers.size??0,capped:snapshot?.capped??false})};
}
