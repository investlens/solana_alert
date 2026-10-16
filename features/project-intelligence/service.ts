import {createHash} from 'node:crypto';
import {chainName,tokenAddress,type Chain,type Report,type Finding} from './model.js';
export type Member={telegram_id:string;tier:string;subscription_status?:string;paid_active_until?:string;is_blocked?:boolean};
export function isPro(member:Member|null,now=Date.now()):boolean{
 if(!member||member.is_blocked)return false;
 return member.tier==='admin'||member.tier==='paid'&&member.subscription_status==='active'&&Date.parse(member.paid_active_until??'')>now;
}
export class ResearchService{
 private cache=new Map<string,{until:number;report:Report}>();private pending=new Map<string,Promise<Report>>();private rates=new Map<string,{until:number;count:number}>();
 constructor(private deps:{member:(id:string)=>Promise<Member|null>;build:(chain:Chain,token:string)=>Promise<Report>;now?:()=>number}){}
 async authorize(id:string){if(!/^\d{1,20}$/.test(id)||!isPro(await this.deps.member(id),this.now()))throw Error('Active Pro membership required');}
 private now(){return (this.deps.now??Date.now)();}
 async report(id:string,chainInput:unknown,tokenInput:unknown):Promise<Report>{
  await this.authorize(id);const chain=chainName(chainInput),token=tokenAddress(tokenInput),key=`${chain}:${token}`,time=this.now();
  let rate=this.rates.get(id);if(!rate||rate.until<=time){rate={until:time+60000,count:0};if(this.rates.size>=1000){for(const [k,r] of this.rates)if(r.until<=time)this.rates.delete(k);if(this.rates.size>=1000)throw Error('Research capacity busy');}this.rates.set(id,rate);}
  if(++rate.count>6)throw Error('Research request limit reached');
  const cached=this.cache.get(key);if(cached&&cached.until>time)return structuredClone(cached.report);
  const pending=this.pending.get(key);if(pending)return structuredClone(await pending);
  if(this.pending.size>=1)throw Error('Research busy; try again shortly');
  const job=this.deps.build(chain,token).then(report=>{if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value!);this.cache.set(key,{until:this.now()+300000,report:structuredClone(report)});return report;}).finally(()=>this.pending.delete(key));
  this.pending.set(key,job);return structuredClone(await job);
 }
}
export type Track={id:string;user:string;chain:Chain;token:string;expires:number;next:number;baseline:Report;last:Report};
export type Notice={id:string;track:string;user:string;text:string;state:'PENDING'|'HELD'|'SENT';created:number};
export type TrackState={tracks:Track[];notices:Notice[]};
export type StateStore={read:()=>Promise<TrackState>;mutate:<T>(fn:(state:TrackState)=>T)=>Promise<T>};
export function materialChanges(before:Report,after:Report):string[]{
 if(before.chain!==after.chain||before.token!==after.token||Date.parse(after.generatedAt)<=Date.parse(before.generatedAt))return [];
 if(!before.block||!after.block||BigInt(after.block)<BigInt(before.block))return [];
 const changes:string[]=[];
 for(const next of after.findings){const old=before.findings.find(f=>f.id===next.id);if(!old||old.quality!==next.quality)continue;
  if(next.id==='owner'&&next.quality==='VERIFIED'&&old.subject&&next.subject&&next.subject!==old.subject){changes.push('The on-chain owner address changed.');continue;}
  if(old.value===undefined||next.value===undefined||old.subject!==next.subject)continue;
  if(next.id==='developer-holding'&&next.quality==='VERIFIED'&&BigInt(String(next.value))<BigInt(String(old.value)))changes.push('Verified deployer token balance decreased. A balance change alone does not establish a sale.');
  if(next.id==='liquidity-usd'&&next.quality==='SOURCE_REPORTED'&&typeof next.value==='number'&&typeof old.value==='number'&&old.value>0&&next.value<=old.value*0.8)changes.push('Reported pool liquidity valuation fell by at least 20%. This is not proof of liquidity withdrawal.');
  if(next.id.startsWith('reported:')&&next.quality==='SOURCE_REPORTED'&&old.value==='0'&&next.value==='1')changes.push(`Security provider flag changed: ${next.id.slice(9)} is now reported as present; independent confirmation may be unavailable.`);
 }
 return [...new Set(changes)].slice(0,5);
}
export function createTracking(deps:{store:StateStore;service:ResearchService;send:(id:string,text:string)=>Promise<void>;now?:()=>number}){
 const now=deps.now??Date.now;let running=false;
 return {
  async list(user:string){await deps.service.authorize(user);return (await deps.store.read()).tracks.filter(t=>t.user===user&&t.expires>now()).map(({id,chain,token,expires})=>({id,chain,token,expires}));},
  async start(user:string,chainInput:unknown,tokenInput:unknown){
   const report=await deps.service.report(user,chainInput,tokenInput),time=now();
   const id=createHash('sha256').update(`${user}:${report.chain}:${report.token}`).digest('hex');
   return deps.store.mutate(state=>{
    state.tracks=state.tracks.filter(t=>t.expires>time);
    const existing=state.tracks.find(t=>t.id===id);if(existing)return id;
    if(state.tracks.length>=10||state.tracks.filter(t=>t.user===user).length>=3||new Set(state.tracks.map(t=>`${t.chain}:${t.token}`)).size>=10&&!state.tracks.some(t=>t.chain===report.chain&&t.token===report.token))throw Error('Tracking capacity reached');
    state.tracks.push({id,user,chain:report.chain,token:report.token,expires:time+7*86400000,next:time+300000,baseline:report,last:report});return id;
   });
  },
  async stop(user:string,id:string){await deps.service.authorize(user);await deps.store.mutate(s=>{s.tracks=s.tracks.filter(t=>t.user!==user||t.id!==id);s.notices=s.notices.filter(n=>n.user!==user||n.track!==id);});},
  async tick(){if(running)return;running=true;
   try{
    const state=await deps.store.read();
    for(const track of state.tracks.filter(t=>t.expires>now()&&t.next<=now()).sort((a,b)=>a.next-b.next).slice(0,2)){
     try{
      const report=await deps.service.report(track.user,track.chain,track.token),changes=materialChanges(track.last,report);
      await deps.store.mutate(s=>{const current=s.tracks.find(t=>t.id===track.id);if(!current||current.expires<=now()||current.last.generatedAt!==track.last.generatedAt)return;
       current.next=now()+300000;
       // Incomplete evidence never replaces the last usable observation.
       const merged=structuredClone(report);for(const f of track.last.findings)if(f.quality==='VERIFIED'&&!merged.findings.some(n=>n.id===f.id&&n.quality==='VERIFIED'))merged.findings.push(f);
       current.last=merged;
       if(changes.length){const id=createHash('sha256').update(track.id+report.generatedAt+changes.join('|')).digest('hex');if(!s.notices.some(n=>n.id===id)&&s.notices.length<100)s.notices.push({id,track:track.id,user:track.user,text:`Project Intelligence — ${track.chain}\n${track.token}\n${changes.join('\n')}\nObserved: ${report.generatedAt}\nReview a fresh report for evidence.`,state:'PENDING',created:now()});}
      });
     }catch{
      // Back off failed or ineligible tracks so the same first two cannot
      // monopolize every cycle. Preserve the last usable observation.
      await deps.store.mutate(s=>{const current=s.tracks.find(t=>t.id===track.id);if(current&&current.next<=now())current.next=now()+300000;});
     }
    }
    const pending=(await deps.store.read()).notices.filter(n=>n.state==='PENDING').slice(0,2);
    for(const notice of pending){
     try{await deps.service.authorize(notice.user);}catch{continue;}
     const claimed=await deps.store.mutate(s=>{const n=s.notices.find(n=>n.id===notice.id),t=s.tracks.find(t=>t.id===notice.track&&t.user===notice.user&&t.expires>now());if(!n||n.state!=='PENDING'||!t||now()-n.created>3600000)return false;n.state='HELD';return true;});
     if(!claimed)continue;
     // Persist before send. Any network ambiguity remains HELD, never replayed.
     try{await deps.send(notice.user,notice.text);await deps.store.mutate(s=>{const n=s.notices.find(n=>n.id===notice.id);if(n)n.state='SENT';});}catch{}
    }
    await deps.store.mutate(s=>{s.tracks=s.tracks.filter(t=>t.expires>now());s.notices=s.notices.filter(n=>now()-n.created<86400000);});
   }finally{running=false;}
  },
 };
}
