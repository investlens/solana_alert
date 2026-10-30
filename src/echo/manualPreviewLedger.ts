import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

/** Durable non-broadcast preview ledger, completely separate from the
 * production echo_live_buy_intents trading reservation table.
 * Stores no private keys, signed transactions or Telegram bot tokens.
 */
export type EchoPreviewIntent = {
  id:string; ownerChatId:string; wallet:string; mint:string;
  action:'BUY'|'SELL'; amountSol?:number; sellPercent?:50|100;
  state:'REQUESTED'|'SIMULATED'|'SIMULATION_FAILED';
  createdAt:number; simulatedAt?:number; simulationError?:string;
};
const addr=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export class EchoPreviewLedger {
  private intents:EchoPreviewIntent[]=[];
  private serial=Promise.resolve();
  constructor(private readonly path:string){}
  async load(){
    try{
      const v=JSON.parse(await readFile(this.path,'utf8'));
      if(v?.version!==1||!Array.isArray(v.intents)||v.intents.length>2000||
        !v.intents.every((x:EchoPreviewIntent)=>x && typeof x.id==='string'&&
        addr.test(x.wallet)&&addr.test(x.mint)&&
        ['REQUESTED','SIMULATED','SIMULATION_FAILED'].includes(x.state)))
        throw Error('CORRUPT_PREVIEW_LEDGER');
      this.intents=v.intents;
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  private async persist(){
    await mkdir(dirname(this.path),{recursive:true,mode:0o700});
    const tmp=this.path+'.tmp';
    await writeFile(tmp,JSON.stringify({version:1,intents:this.intents}),{mode:0o600});
    await rename(tmp,this.path);
  }
  private enqueue<T>(fn:()=>Promise<T>):Promise<T>{
    const next=this.serial.then(fn);
    this.serial=next.then(()=>{},()=>{});
    return next;
  }
  async request(input:Omit<EchoPreviewIntent,'id'|'state'|'createdAt'>,now=Date.now()){
    return this.enqueue(async()=>{
      if(!addr.test(input.wallet)||!addr.test(input.mint)||!/^\d+$/.test(input.ownerChatId)||
        !Number.isSafeInteger(now)||now<=0)throw Error('INVALID_PREVIEW');
      if(input.action==='BUY' ? !(Number.isFinite(input.amountSol)&&input.amountSol!>0&&input.amountSol!<=0.1&&input.sellPercent===undefined)
         : !([50,100].includes(input.sellPercent??0)&&input.amountSol===undefined))
        throw Error('INVALID_PREVIEW_SIZE');
      // One BUY request per wallet and token, across restarts and concurrent users.
      if(input.action==='BUY'&&this.intents.some(x=>x.action==='BUY'&&x.wallet===input.wallet&&x.mint===input.mint))
        return {created:false as const,reason:'DUPLICATE_PREVIEW_BUY'};
      const id=createHash('sha256').update([input.ownerChatId,input.wallet,input.mint,input.action,now].join(':')).digest('hex');
      if(this.intents.some(x=>x.id===id))return {created:false as const,reason:'DUPLICATE_PREVIEW_ID'};
      const item:EchoPreviewIntent={...input,id,state:'REQUESTED',createdAt:now};
      this.intents.push(item);
      try{await this.persist();}catch(e){this.intents=this.intents.filter(x=>x.id!==id);throw e;}
      return {created:true as const,item};
    });
  }
  async markSimulation(id:string,success:boolean){
    return this.enqueue(async()=>{
      const item=this.intents.find(x=>x.id===id);
      if(!item||item.state!=='REQUESTED')return false;
      item.state=success?'SIMULATED':'SIMULATION_FAILED';
      item.simulatedAt=Date.now();
      try{await this.persist();}catch(e){item.state='REQUESTED';item.simulatedAt=undefined;throw e;}
      return true;
    });
  }
  summary(){return {total:this.intents.length,simulated:this.intents.filter(x=>x.state==='SIMULATED').length,liveTrading:false};}
}
