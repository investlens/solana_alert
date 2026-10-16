import {getPonsFactoryDeployments} from '../chains/robinhood/ponsContracts.js';
import type {PonsPublicContext} from '../chains/robinhood/ponsPublicContext.js';
import type {DexScreenerPair} from '../chains/robinhood/market.js';
import {ponsVenueStats,ponsV1VenueStats} from './ponsAlertVenue.js';
import {verifiedDexReached,type DexReached} from './ponsDexReachedEvidence.js';

export type DexCoverageCandidate={token_address:string;deployer_address:string;factory_address:string;curve_address:string|null;protocol_version:string;block_number:string|number};
const address=(value:unknown):value is string=>typeof value==='string'&&/^0x[a-f0-9]{40}$/i.test(value)&&!/^0x0{40}$/i.test(value);
export function validCoverageCandidate(c:DexCoverageCandidate):boolean {
 if(!c||![c.token_address,c.deployer_address,c.factory_address].every(address)||!/^\d+$/.test(String(c.block_number)))return false;
 const factory=getPonsFactoryDeployments().find(f=>f.enabled&&f.id===c.protocol_version&&f.address.toLowerCase()===c.factory_address.toLowerCase());
 if(!factory)return false;const block=BigInt(c.block_number);
 return !(factory.startBlock!=null&&block<factory.startBlock)&&!(factory.endBlock!=null&&block>factory.endBlock)
  &&(factory.generation==='v1'||address(c.curve_address));
}
export async function verifyDexCoverage(c:DexCoverageCandidate,deps:{
 context:(token:string,factory:string)=>Promise<PonsPublicContext|null>;
 graduated:(token:string,curve:string)=>Promise<boolean|null>;
 v1Pool:(token:string,creator:string)=>Promise<string|null>;
 pairs:(token:string)=>Promise<DexScreenerPair[]>;now:()=>number;
}):Promise<DexReached|null>{
 if(!validCoverageCandidate(c))return null;
 const token=c.token_address.toLowerCase();
 if(c.protocol_version.startsWith('v1-')){
  const pool=await deps.v1Pool(token,c.deployer_address);if(!pool)return null;
  return verifiedDexReached(token,ponsV1VenueStats(token,pool,await deps.pairs(token)),deps.now());
 }
 const context=await deps.context(token,c.factory_address);
 // Match creator AND curve against the factory census, independently of page claims.
 if(!context||context.creator.toLowerCase()!==c.deployer_address.toLowerCase()
   ||context.curveAddress?.toLowerCase()!==c.curve_address?.toLowerCase()||!context.poolId||context.phase===0||context.venue==='curve')return null;
 if(await deps.graduated(token,c.curve_address!)!==true)return null;
 return verifiedDexReached(token,ponsVenueStats(token,context,true,await deps.pairs(token)),deps.now());
}

type Attempt={token:string;at:number};
export type DexCoverageCheckpoint={version:1;attempts:Attempt[]};
export function createDexCoverageWorker(deps:{
 now:()=>number;claim:()=>Promise<boolean>;restore:()=>Promise<unknown>;checkpoint:(value:DexCoverageCheckpoint)=>Promise<void>;
 load:()=>Promise<DexCoverageCandidate[]|null>;verify:(c:DexCoverageCandidate)=>Promise<DexReached|null>;
 save:(items:DexReached[])=>Promise<number>;report:(stats:Record<string,number|string>)=>void;
}){
 let active=false,restored=false,next=0,loadedAt=-Infinity;let candidates:DexCoverageCandidate[]=[];
 const attempts=new Map<string,number>();
 return {async tick(){
  if(active||deps.now()<next)return;active=true;next=deps.now()+60000;
  try{
   // Shared minute claim bounds all replicas together; no Redis means no extra work.
   if(!await deps.claim())return;
   if(!restored){const saved=await deps.restore() as Partial<DexCoverageCheckpoint>|null;
    if(saved){if(saved.version!==1||!Array.isArray(saved.attempts)||saved.attempts.length>200)throw Error('Invalid DEX coverage checkpoint');
     for(const x of saved.attempts)if(address(x.token)&&Number.isFinite(x.at)&&x.at<=deps.now()+30000)attempts.set(x.token.toLowerCase(),x.at);}
    restored=true;
   }
   if(deps.now()-loadedAt>=600000){const loaded=await deps.load();if(loaded===null){deps.report({status:'DATABASE_DEFERRED'});return;}
    const unique=new Map<string,DexCoverageCandidate>();for(const c of loaded.slice(0,200))if(validCoverageCandidate(c))unique.set(c.token_address.toLowerCase(),c);
    candidates=[...unique.values()];loadedAt=deps.now();
   }
   const selected=candidates.filter(c=>deps.now()-(attempts.get(c.token_address.toLowerCase())??-Infinity)>=3600000)
    .sort((a,b)=>(attempts.get(a.token_address.toLowerCase())??0)-(attempts.get(b.token_address.toLowerCase())??0)).slice(0,2);
   if(!selected.length){deps.report({status:'IDLE',candidates:candidates.length});return;}
   for(const c of selected){const key=c.token_address.toLowerCase();attempts.delete(key);attempts.set(key,deps.now());}
   while(attempts.size>200)attempts.delete(attempts.keys().next().value!);
   // Persist rotation BEFORE provider work. Restart storms cannot repeat the same scans.
   await deps.checkpoint({version:1,attempts:[...attempts].map(([token,at])=>({token,at}))});
   const evidence:DexReached[]=[];let unavailable=0;
   for(const c of selected){try{const proof=await deps.verify(c);if(proof)evidence.push(proof);else unavailable++;}catch{unavailable++;}}
   const inserted=evidence.length?await deps.save(evidence):0;
   if(!Number.isInteger(inserted)||inserted<0||inserted>evidence.length)throw Error('Invalid DEX evidence acknowledgement');
   const verified=new Set(evidence.map(x=>x.token));candidates=candidates.filter(c=>!verified.has(c.token_address.toLowerCase()));
   deps.report({status:'CHECKED',candidates:candidates.length,checked:selected.length,verified:evidence.length,inserted,unverified:unavailable});
  }catch{deps.report({status:'DEFERRED'});}finally{active=false;}
 },stats:()=>({active,candidates:candidates.length,attempts:attempts.size})};
}
