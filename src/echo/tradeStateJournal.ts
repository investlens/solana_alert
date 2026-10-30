import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {nextEchoTradeState,type TradeEvidence,type TradeTransition} from './manualTradeLifecycle.js';
const terminal=new Set(['CONFIRMED','FAILED_FINAL']);
/** Crash-recoverable, single-process research journal. Not a substitute for the
 * atomic Supabase (wallet,mint) trade reservation or a signer-level lock.
 * An uncertain state is never automatically retried after restart.
 */
export class EchoTradeStateJournal {
 private records=new Map<string,TradeEvidence>();
 private work=Promise.resolve();
 constructor(private readonly path:string){}
 async load(){
  try{
   const body=JSON.parse(await readFile(this.path,'utf8'));
   if(body?.version!==1||!Array.isArray(body.records)||body.records.length>5000)
    throw Error('CORRUPT_TRADE_JOURNAL');
   const rows=new Map<string,TradeEvidence>();
   for(const v of body.records as TradeEvidence[]){
    if(!v||typeof v.reservationKey!=='string'||v.reservationKey.length>180||
      !/^(RESERVED|QUOTE_VERIFIED|SIMULATED|SUBMISSION_UNKNOWN|SUBMITTED|CONFIRMED|FAILED_FINAL|RECONCILIATION_REQUIRED)$/.test(v.state)||
      rows.has(v.reservationKey))throw Error('CORRUPT_TRADE_JOURNAL');
    rows.set(v.reservationKey,v);
   }
   this.records=rows;
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 private enqueue<T>(fn:()=>Promise<T>):Promise<T>{
  const next=this.work.then(fn);this.work=next.then(()=>{},()=>{});return next;
 }
 private async persist(){
  await mkdir(dirname(this.path),{recursive:true,mode:0o700});
  const tmp=this.path+'.tmp';
  await writeFile(tmp,JSON.stringify({version:1,records:[...this.records.values()]}),{mode:0o600});
  await rename(tmp,this.path);
 }
 get(key:string){const v=this.records.get(key);return v?{...v}:null;}
 async reserve(key:string) {
  return this.enqueue(async()=>{
   if(!key||key.length>180||this.records.has(key)||this.records.size>=5000)return false;
   this.records.set(key,{reservationKey:key,state:'RESERVED'});
   try{await this.persist();return true;}catch(e){this.records.delete(key);throw e;}
  });
 }
 async advance(key:string,event:TradeTransition){
  return this.enqueue(async()=>{
   const old=this.records.get(key);if(!old)return {ok:false as const,reason:'NOT_RESERVED'};
   if(terminal.has(old.state))return {ok:false as const,reason:'TERMINAL_INTENT'};
   const next=nextEchoTradeState(old,event);if(!next.ok)return next;
   this.records.set(key,next.value);
   try{await this.persist();return next;}catch(e){this.records.set(key,old);throw e;}
  });
 }
}
