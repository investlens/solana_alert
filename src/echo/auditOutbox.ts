import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { echoAuditRow, type EchoAuditDelivery } from './auditWriter.js';

type Pending = { id: string; value: EchoAuditDelivery };
const MAX_PENDING = 5000;
const idOf = (v:EchoAuditDelivery) => [v.signature,v.callerWallet,v.mint,'BUY'].join(':');

/** Optional research-only delivery journal. Existing EchoStore remains authoritative.
 * All mutating operations serialize; failed writes keep durable queue entries.
 */
export class EchoAuditOutbox {
  private pending:Pending[]=[];
  private writes=Promise.resolve();
  private running=false;
  private lastError:string|null=null;
  constructor(private readonly path:string,private readonly write:(v:EchoAuditDelivery)=>Promise<boolean>) {}
  async load() {
    try {
      const state=JSON.parse(await readFile(this.path,'utf8'));
      if(state.version!==1 || !Array.isArray(state.pending) || state.pending.length>MAX_PENDING ||
        !state.pending.every((x:Pending)=>x && typeof x.id==='string' && echoAuditRow(x.value) &&
          x.id===idOf(x.value))) throw Error('Invalid Echo audit queue');
      this.pending=state.pending;
    } catch(e) {if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  private persist() {
    this.writes=this.writes.then(async()=>{
      await mkdir(dirname(this.path),{recursive:true,mode:0o700});
      const tmp=this.path+'.tmp';
      await writeFile(tmp,JSON.stringify({version:1,pending:this.pending}),{mode:0o600});
      await rename(tmp,this.path);
    });
    return this.writes;
  }
  async enqueue(v:EchoAuditDelivery) {
    if(!echoAuditRow(v))return false;
    const id=idOf(v);
    if(this.pending.some(x=>x.id===id))return true;
    if(this.pending.length>=MAX_PENDING){this.lastError='QUEUE_CAPACITY';return false;}
    this.pending.push({id,value:v});
    try { await this.persist(); return true; }
    catch {this.lastError='PERSIST_FAILED';return false;}
  }
  async flush() {
    if(this.running)return;
    this.running=true;
    try {
      for(let n=0;n<20 && this.pending.length;n++){
        const current=this.pending[0];
        let ok=false;
        try {ok=await this.write(current.value);}catch{}
        if(!ok){this.lastError='REMOTE_WRITE_FAILED';break;}
        this.pending.shift();
        try{await this.persist();}catch{this.lastError='PERSIST_FAILED';break;}
        this.lastError=null;
      }
    }finally{this.running=false;}
  }
  summary(){return {queued:this.pending.length,lastError:this.lastError};}
}
