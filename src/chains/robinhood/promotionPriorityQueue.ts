import type {PromotionUpdate} from './promotionStreams.js';
export function createPromotionPriorityQueue(limit=64) {
 const pending=new Map<string,{token:string;due:number;expires:number;attempts:number}>();
 const cooldown=new Map<string,number>();
 return {
  admit(rows:PromotionUpdate[],now=Date.now()) {
   let dropped=0;
   for(const row of rows){
    if(pending.has(row.tokenAddress)||(cooldown.get(row.tokenAddress)??0)>now)continue;
    if(pending.size>=limit){dropped++;continue;}
    pending.set(row.tokenAddress,{token:row.tokenAddress,due:now,expires:now+8*60000,attempts:0});
   }
   return dropped;
  },
  next(now=Date.now()):string|null {
   for(const [key,value] of pending)if(value.expires<=now)pending.delete(key);
   for(const [key,until] of cooldown)if(until<=now)cooldown.delete(key);
   const row=[...pending.values()].filter(x=>x.due<=now).sort((a,b)=>a.due-b.due)[0];
   if(!row)return null;row.due=now+60000;row.attempts++;return row.token;
  },
  finish(token:string,detected:boolean,now=Date.now()) {
   const row=pending.get(token);if(!row)return;
   if(detected||row.attempts>=4){pending.delete(token);if(cooldown.size>=500)cooldown.delete(cooldown.keys().next().value!);cooldown.set(token,now+60000);}
  },
  get size(){return pending.size;}
 };
}
