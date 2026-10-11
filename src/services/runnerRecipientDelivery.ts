import {acquireRecipientClaim,telegramExplicitRejection,retryTelegramRejection} from './recipientDeliveryClaim.js';
// Claims are per recipient. A confirmed rejection can be retried; a timeout
// stays claimed because Telegram may already have accepted the message.
export async function deliverRunnerRecipient(identity:string,recipient:string,milestones:number[],send:()=>Promise<number>,
  claim=acquireRecipientClaim):Promise<boolean> {
 const held:Array<Extract<Awaited<ReturnType<typeof acquireRecipientClaim>>,{state:'CLAIMED'}>>=[];
 let started=false;
 try {
  for(const milestone of [...milestones].reverse()){
   const reservation=await claim(`${identity}:${milestone}`,recipient);
   if(reservation.state!=='CLAIMED') {
    if(!held.length)return false;
    // A lower milestone delivered previously does not block a higher one.
    continue;
   }
   held.push(reservation);
  }
  started=true;
  const messageId=await retryTelegramRejection(send);
  for(const reservation of held)await reservation.finish(messageId);
  return true;
 }catch(error){
  if(!started||telegramExplicitRejection(error))for(const reservation of held)await reservation.release().catch(()=>undefined);
  throw error;
 }
}
