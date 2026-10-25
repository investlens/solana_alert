/** Read-only Echo recipient eligibility. No broadcasting or credential access in this module. */
export type EchoSubscriber = {
 telegram_id:string; tier:'admin'|'paid'|'free'; subscription_status:string;
 is_blocked:boolean; paid_active_until:string|null; free_trial_used:number; free_trial_limit:number;
};
export type EchoAudience = 'admin'|'paid'|'free';
export const ECHO_TIER_DELAY_MS:Readonly<Record<EchoAudience,number>>={admin:0,paid:5000,free:30000};
export function eligibleEchoRecipients(rows:readonly EchoSubscriber[], now=new Date()):Record<EchoAudience,string[]> {
 const result:Record<EchoAudience,string[]>={admin:[],paid:[],free:[]};
 const seen=new Set<string>();
 for(const row of rows){
  if(row.is_blocked || !/^[1-9]\d+$/.test(row.telegram_id) || seen.has(row.telegram_id))continue;
  if(row.tier==='admin'&&row.subscription_status==='active')result.admin.push(row.telegram_id);
  else if(row.tier==='paid'&&row.subscription_status==='active'&&row.paid_active_until
    && Number.isFinite(Date.parse(row.paid_active_until))&&Date.parse(row.paid_active_until)>now.getTime())
    result.paid.push(row.telegram_id);
  else if(row.tier==='free'&&row.subscription_status!=='active')
    result.free.push(row.telegram_id);
  else continue;
  seen.add(row.telegram_id);
 }
 return result;
}
