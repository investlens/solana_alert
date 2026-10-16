import type {PonsLaunch} from './ponsHistoricalLaunchScanner.js';
import {createReturningWinnerQueue,returningWinnerCard,type WinnerHistory} from './ponsReturningWinner.js';
import {runDatabaseWork} from '../../services/databaseLoadGovernor.js';
import {claimSharedDelivery} from '../../services/sharedJsonCache.js';
import {getDeliverableUsers} from '../../core/delivery.js';
import {enabledLiveRecipients} from '../../services/liveAlertPreferences.js';
import {forEachDeliveryRecipient,waitForRecipientDelivery,recordDeliveryAccepted} from '../../services/recipientDeliveryTiming.js';
import {sendAlphaosPhotoAlert} from '../../ui/alphaosPhotoDelivery.js';
import {recordFeedDelivery} from '../../services/feedDeliveryHealth.js';
import {getCachedPonsPublicContext} from './ponsPublicContext.js';

const FEED='RH_RETURNING_WINNER_DEV' as const;
export type WinnerDeliveryDependencies={
 recipients:()=>Promise<string[]>;enabled:(users:string[])=>Promise<string[]>;
 claim:(key:string)=>Promise<'CLAIMED'|'EXISTS'|'UNAVAILABLE'>;
 wait:(user:string,at:number)=>Promise<void>;send:(user:string,text:string,keyboard:unknown)=>Promise<unknown>;now:()=>number;
};
export async function deliverReturningWinner(launch:PonsLaunch,history:WinnerHistory,deps:WinnerDeliveryDependencies):Promise<{delivered:number;failed:number;deduplicated:number}> {
 const recipients=[...new Set(await deps.enabled(await deps.recipients()))];
 const metadata=getCachedPonsPublicContext(launch.token_address,launch.factory_address,launch.deployer_address);
 const text=returningWinnerCard(launch,history,metadata??undefined);
 const keyboard=[
  [{text:'🚀 PONS project',url:`https://www.ponsfamily.com/launchpad/${launch.token_address}`}],
  [{text:'👤 Developer',url:`https://robinhoodchain.blockscout.com/address/${history.creator}`},{text:'🔎 Token',url:`https://robinhoodchain.blockscout.com/token/${launch.token_address}`}],
  [{text:'Full Intel',callback_data:`FI_RH_${launch.token_address}`},{text:'📋 Copy CA',callback_data:`COPY_CA_${launch.token_address}`}],
 ];
 const startedAt=deps.now();let delivered=0,failed=0,deduplicated=0,unavailable=0;
 await forEachDeliveryRecipient(recipients,async user=>{
  // Independent, recipient-level key: Boost/DEX deduplication is never touched.
  const claim=await deps.claim(`alphaos:returning-winner:robinhood:${launch.token_address.toLowerCase()}:${user}`);
  if(claim==='EXISTS'){deduplicated++;return;}
  if(claim!=='CLAIMED'){unavailable++;return;}
  try{await deps.wait(user,startedAt);await deps.send(user,text,keyboard);delivered++;recordDeliveryAccepted(user,startedAt,FEED);}
  catch{failed++;}
  // Ambiguous Telegram responses retain the claim; never blindly replay a send.
 });
 recordFeedDelivery(FEED,'ACCEPTED',delivered);recordFeedDelivery(FEED,'DEDUPLICATED',deduplicated);
 recordFeedDelivery(FEED,'UNCONFIRMED',failed);recordFeedDelivery(FEED,'DATA_UNAVAILABLE',unavailable);
 console.log('[ReturningWinnerDev] DELIVERY',{delivered,failed,deduplicated,unavailable});
 if(unavailable>0)throw new Error('Returning-winner delivery store unavailable');
 return {delivered,failed,deduplicated};
}
const worker=createReturningWinnerQueue({
 now:Date.now,
 load:async()=>{
  const result=await runDatabaseWork('BACKGROUND',async()=>{
   const {supabase}=await import('../../services/supabase.js');
   const {data,error}=await supabase.rpc('alpha_returning_winner_history').abortSignal(AbortSignal.timeout(4000));
   if(error)throw error;return data;
  });
  console.log('[ReturningWinnerDev] HISTORY',{available:result!==null,developers:Array.isArray(result?.developers)?result.developers.length:0,capped:result?.capped===true});
  if(result===null)recordFeedDelivery(FEED,'DATA_UNAVAILABLE');
  return result;
 },
 send:async(launch,history)=>{
  recordFeedDelivery(FEED,'QUALIFIED');
  await deliverReturningWinner(launch,history,{
   now:Date.now,
   recipients:async()=>{
    const users=(await getDeliverableUsers()).filter(u=>!u.is_blocked).map(u=>String(u.telegram_id));
    const admin=process.env.ADMIN_TELEGRAM_ID??process.env.OWNER_CHAT_ID;if(admin)users.push(admin);
    return [...new Set(users.filter(Boolean))];
   },
   enabled:users=>enabledLiveRecipients(users,FEED),
   claim:key=>claimSharedDelivery(key,7*86400000),wait:waitForRecipientDelivery,
   send:(chatId,text,keyboard)=>sendAlphaosPhotoAlert({botToken:process.env.TELEGRAM_BOT_TOKEN??'',chatId,text,keyboard,image:null}),
  });
 },
});
const enabled=()=>String(process.env.PONS_RETURNING_WINNER_ENABLED??'true').toLowerCase()==='true';
export function queuePonsReturningWinner(launch:PonsLaunch):void {
 if(!enabled())return;recordFeedDelivery(FEED,'DISCOVERED');worker.enqueue(launch);
}
export async function processPonsReturningWinners():Promise<void>{
 if(!enabled())return;
 await worker.tick();
 const stats=worker.stats();if(stats.pending||stats.active)console.log('[ReturningWinnerDev] QUEUE',stats);
}
