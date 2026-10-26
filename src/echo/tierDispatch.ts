import {mkdir,readFile,rename,writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {eligibleEchoRecipients,ECHO_TIER_DELAY_MS,type EchoSubscriber} from './tierRecipients.js';
type Item={id:string;mint:string;text:string;buttons:unknown;acceptedAt:number;delivered:string[];doneAt?:number};
type Data={version:1;items:Item[]};
const validMint=(x:string)=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
/** Isolated distribution. Admin has already received the event. Fail closed if credentials/registry unavailable. */
export class EchoTierDispatcher {
 private items:Item[]=[];private busy=false;private lastError:string|null=null;
 private deliveredPaid=0;private deliveredFree=0;private failed=0;private checkedAt:number|null=null;
 private recipientCounts={admin:0,paid:0,free:0};
 readonly configured:boolean;
 constructor(private readonly path:string,private readonly token:string,private readonly adminId:string,
  private readonly url:string|undefined,private readonly key:string|undefined){
  this.configured=!!(url?.startsWith('https://')&&key&&key.length>30);
 }
 async load(){
  try{const parsed=JSON.parse(await readFile(this.path,'utf8')) as Data;
   if(parsed.version!==1||!Array.isArray(parsed.items))throw Error('Invalid tier queue state');
   this.items=parsed.items.filter(i=>validMint(i.mint)&&Array.isArray(i.delivered)&&typeof i.id==='string').slice(-500);
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 }
 private async save(){await mkdir(dirname(this.path),{recursive:true,mode:0o700});const tmp=this.path+'.tmp';
  await writeFile(tmp,JSON.stringify({version:1,items:this.items} satisfies Data),{mode:0o600});await rename(tmp,this.path);
 }
 async enqueue(input:{id:string;mint:string;text:string;buttons:unknown;acceptedAt:number}){
  if(!this.configured||!validMint(input.mint)||!input.id||this.items.some(i=>i.id===input.id))return;
  this.items.push({...input,delivered:[]});this.items=this.items.slice(-500);await this.save();
  console.log('[EchoTiers] QUEUED',{id:input.id});
 }
 private async recipients():Promise<ReturnType<typeof eligibleEchoRecipients>>{
  if(!this.configured)throw Error('No subscriber registry configured');
  const endpoint=this.url!.replace(/\/$/,'')+'/rest/v1/users?select=telegram_id,tier,subscription_status,is_blocked,paid_active_until,free_trial_used,free_trial_limit&is_blocked=eq.false';
  const res=await fetch(endpoint,{headers:{apikey:this.key!,authorization:'Bearer '+this.key!},signal:AbortSignal.timeout(5000)});
  if(!res.ok)throw Error('Registry HTTP '+res.status);
  const rows=await res.json() as EchoSubscriber[];
  if(!Array.isArray(rows))throw Error('Registry malformed');
  return eligibleEchoRecipients(rows);
 }
 async tick(){
  if(this.busy||!this.configured)return;
  const now=Date.now();
  const pending=this.items.filter(i=>!i.doneAt&&now-i.acceptedAt>=ECHO_TIER_DELAY_MS.paid);
  if(!pending.length&&this.checkedAt!==null&&now-this.checkedAt<60000)return;
  this.busy=true;
  try{
   const targets=await this.recipients();this.checkedAt=Date.now();
   this.recipientCounts={admin:targets.admin.length,paid:targets.paid.length,free:targets.free.length};
   for(const item of pending.slice(0,15)){
    let remaining=false;
    for(const tier of ['paid','free'] as const){
     const eligibleAt=item.acceptedAt+ECHO_TIER_DELAY_MS[tier];
     if(Date.now()<eligibleAt){remaining=true;continue;}
     for(const chatId of targets[tier]){
      if(chatId===this.adminId||item.delivered.includes(chatId))continue;
      const res=await fetch('https://api.telegram.org/bot'+this.token+'/sendMessage',{
       method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
       body:JSON.stringify({chat_id:chatId,text:item.text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:item.buttons})
      }).then(r=>r.json()).catch(()=>null);
      if(res?.ok&&Number.isInteger(res.result?.message_id)){
       item.delivered.push(chatId);await this.save();
       if(tier==='paid')this.deliveredPaid++;else this.deliveredFree++;
       console.log('[EchoTiers] DELIVERED',{tier,event:item.id,messageId:res.result.message_id});
      } else {remaining=true;this.failed++;console.warn('[EchoTiers] SEND_FAILED',{tier,event:item.id,code:res?.error_code??null});}
     }
    }
    if(!remaining){item.doneAt=Date.now();await this.save();}
   }
   this.lastError=null;
  }catch(e){this.lastError=e instanceof Error?e.message:'Tier dispatcher unavailable';console.warn('[EchoTiers] FAIL_CLOSED',this.lastError);}
  finally{this.busy=false;}
 }
 summary(){return {configured:this.configured,queued:this.items.filter(i=>!i.doneAt).length,deliveredPaid:this.deliveredPaid,deliveredFree:this.deliveredFree,failed:this.failed,lastError:this.lastError,checkedAt:this.checkedAt,recipientCounts:this.recipientCounts};}
}
