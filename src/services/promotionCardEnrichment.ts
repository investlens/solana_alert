import { discloseRobinhoodKeyStats, cachedRobinhoodAlertStats } from './alertKeyStatsService.js';
import { discloseRobinhoodOwnership } from './alertOwnershipService.js';
import { editTelegramMessage } from './telegram.js';
import { withAlertKeyStats } from '../ui/alertKeyStats.js';
import { buildPromotionEventCard, type PromotionCardArgs } from '../ui/promotionEventCard.js';
export type PromotionEditTarget = {chatId:string;messageId:number};
type Dependencies = { refresh:(args:PromotionCardArgs)=>Promise<ReturnType<typeof buildPromotionEventCard>>;edit:typeof editTelegramMessage;schedule:(run:()=>void,ms:number)=>unknown;now:()=>number };
const jobs=new Set<string>();let minute=0,edits=0;
export function promotionContentSignature(text:string):string {
 return text.replace(/\d{2}:\d{2}:\d{2} UTC/g,'TIME').replace(/ · \d+m ago/g,'').replace(/\s+/g,' ').trim();
}
const production:Dependencies={now:Date.now,schedule:(run,ms)=>{const t=setTimeout(run,ms);t.unref();return t;},edit:editTelegramMessage,
 refresh:async args=>{
  let text=await discloseRobinhoodKeyStats(args.text,args.token,false,args.launchType==='PONS'||args.launchType==='FLAP'?`Trusted ${args.launchType} route`:'See sellability disclosure',undefined,true);
  let stats=cachedRobinhoodAlertStats(args.token);
  // A transient provider failure must not erase the still-labelled original quote.
  // Confirmed graduation/mapped-pool transitions may legitimately invalidate it.
  if(args.stats?.price != null && stats?.price == null && !/Graduated|mapped/i.test(stats?.source??'')) { stats=args.stats;text=withAlertKeyStats(text,stats); }
  if(stats)stats={...stats,name:stats.name??args.stats?.name,symbol:stats.symbol??args.stats?.symbol,creator:stats.creator??args.stats?.creator};
  const pool=stats?.chartUrl?.match(/\/robinhood\/(0x[a-fA-F0-9]{40,64})/)?.[1];
  text=await discloseRobinhoodOwnership(text,args.token,stats?.creator,pool);
  return buildPromotionEventCard({...args,text,stats});
 }};
// At most three refreshes per accepted promotion. IDs live in RAM for <=180 seconds.
// Never resend, never write retries to DB, never change eligibility or reservations.
export function schedulePromotionCardEnrichment(key:string,args:PromotionCardArgs,targets:PromotionEditTarget[],original:string,dependencies:Dependencies=production):boolean {
 const useful=targets.filter(t=>t.chatId&&Number.isInteger(t.messageId)&&t.messageId>0).slice(0,50);
 if(!useful.length||jobs.has(key)||jobs.size>=10)return false;
 jobs.add(key);const expires=dependencies.now()+180000;let remaining=3;const signatures=new Map(useful.map(t=>[t.chatId+':'+t.messageId,promotionContentSignature(original)]));
 const run=async()=>{
  try {
   if(dependencies.now()>expires)return;
   if(dependencies===production)console.log('[PromotionCard] ENRICHMENT_CHECK attempt='+String(4-remaining)+' dbRetryWrites=0');
   const card=await dependencies.refresh(args),signature=promotionContentSignature(card.text);
   if(useful.every(t=>signatures.get(t.chatId+':'+t.messageId)===signature))return;
   for(const target of useful){
    if(dependencies.now()>expires)break;
    const id=target.chatId+':'+target.messageId;if(signatures.get(id)===signature)continue;
    const window=Math.floor(dependencies.now()/60000);if(window!==minute){minute=window;edits=0;}
    if(edits>=20)break;edits++;
    await dependencies.edit(target.chatId,target.messageId,card.text,card.buttons).then(()=>{signatures.set(id,signature);if(dependencies===production)console.log('[PromotionCard] EXISTING_MESSAGE_UPDATED');}).catch(()=>undefined);
   }

  } catch { /* provider/editor failure leaves the accepted original intact */ }
  finally { remaining--;if(remaining>0&&dependencies.now()<expires)dependencies.schedule(()=>{void run();},remaining===2?30000:60000);else jobs.delete(key); }
 };
 dependencies.schedule(()=>{void run();},15000);return true;
}
