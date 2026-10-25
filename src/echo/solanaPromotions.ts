import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
type Kind='BOOST'|'DEX_PAID';
type Event={id:string;kind:Kind;mint:string;amount?:number;date?:string};
const endpoints=[['BOOST','token-boosts/latest/v1'],['DEX_PAID','ads/latest/v1']] as const;
const address=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export class EchoSolanaPromotions {
 private seen=new Set<string>(); private initialized=false; private busy=false; private lastError:string|null=null;
 private lastPoll:number|null=null; private delivered=0; private failed=0;
 constructor(private readonly path:string,private readonly deliver:(e:Event)=>Promise<void>){}
 async load(){try{const data=JSON.parse(await readFile(this.path,'utf8'));if(data.version!==1||!Array.isArray(data.seen))throw Error('Bad promotion state');
 this.seen=new Set(data.seen.filter((x:unknown)=>typeof x==='string').slice(-2000));this.initialized=true;
 }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 private async save(){await mkdir(dirname(this.path),{recursive:true,mode:0o700});const tmp=this.path+'.tmp';
 await writeFile(tmp,JSON.stringify({version:1,seen:[...this.seen].slice(-2000)}),{mode:0o600});await rename(tmp,this.path);}
 async tick(){if(this.busy)return;this.busy=true;
 try{const events:Event[]=[];for(const [kind,path] of endpoints){
 const res=await fetch('https://api.dexscreener.com/'+path,{signal:AbortSignal.timeout(5000)});
 if(!res.ok)throw Error('DexScreener HTTP '+res.status);const rows:unknown=await res.json();
 if(!Array.isArray(rows))throw Error('Invalid promotion feed');
 for(const raw of rows){const x=raw as Record<string,unknown>;if(x.chainId!=='solana'||typeof x.tokenAddress!=='string'||!address.test(x.tokenAddress))continue;
 const amount=typeof x.totalAmount==='number'&&Number.isFinite(x.totalAmount)?x.totalAmount:undefined;
 const date=typeof x.date==='string'?x.date:undefined;
 // BOOST has no event ID; use changing totalAmount; ads use the published date and ad type.
 const suffix=kind==='BOOST'?String(amount??x.amount??'unknown'):String(date??'unknown')+':'+String(x.type??'unknown');
 events.push({id:kind+':'+x.tokenAddress+':'+suffix,kind,mint:x.tokenAddress,amount,date});}
 }
 if(!this.initialized){for(const ev of events)this.seen.add(ev.id);await this.save();this.initialized=true;
 console.log('[EchoPromotions] BASELINED',{count:events.length,notSent:true});}
 else for(const ev of events){if(this.seen.has(ev.id))continue;
 try{await this.deliver(ev);this.seen.add(ev.id);await this.save();this.delivered++;console.log('[EchoPromotions] DELIVERED',{kind:ev.kind,mint:ev.mint});}
 catch{this.failed++;console.warn('[EchoPromotions] DELIVERY_FAILED',{kind:ev.kind,mint:ev.mint});}}
 this.lastPoll=Date.now();this.lastError=null;
 }catch(e){this.lastError=e instanceof Error?e.message:'unavailable';console.warn('[EchoPromotions] POLL_FAILED',this.lastError);}
 finally{this.busy=false;}}
 summary(){return {initialized:this.initialized,lastPoll:this.lastPoll,lastError:this.lastError,delivered:this.delivered,failed:this.failed};}
}
