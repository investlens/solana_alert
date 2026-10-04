import { cleanAlertCard, cleanAlertButtons } from '../ui/alertCardLayout.js';
import { scanRobinhoodDexPaid } from '../chains/robinhood/security/dexPaidScanner.js';
import type { AlphaNotificationAction } from '../ui/alphaNotification.js';
export type AlertDexPaidStatus = 'PAID' | 'NOT_PAID' | 'UNKNOWN';
async function withinDisplayBudget(work: Promise<AlertDexPaidStatus>): Promise<AlertDexPaidStatus> {
  let timer:ReturnType<typeof setTimeout>;
  try{return await Promise.race([work,new Promise<AlertDexPaidStatus>(resolve=>{timer=setTimeout(()=>resolve('UNKNOWN'),750);})]);}
  finally{clearTimeout(timer!);}
}
export function decorateDexPaidAlert(text: string, buttons: AlphaNotificationAction[][], token: string, status: AlertDexPaidStatus) {
  const label = status === 'PAID' ? 'Yes' : status === 'NOT_PAID' ? 'No paid order reported' : 'Unavailable';
  const line = `<b>Dex Paid</b>  ${label}`;
  const clean = text.replace(/^<b>Dex Paid<\/b>  [^\n]*\n?/gm, '');
  const index = clean.search(/<b>CONTRACT<\/b>|<code>0x/i);
  const message = index >= 0 ? `${clean.slice(0,index).trimEnd()}\n\n${line}\n\n${clean.slice(index)}` : `${clean}\n\n${line}`;
  const actions = buttons.flat().map(button => ({...button}));
  if (status === 'PAID' && /^0x[a-fA-F0-9]{40}$/.test(token)) {
    const existing = actions.find(button => button.url && /^https:\/\/dexscreener\.com\/robinhood\//i.test(button.url));
    if (existing) existing.text = '💎 DexScreener';
    else actions.splice(actions[0]?.url?.includes('ponsfamily.com') ? 1 : 0, 0,
      {text:'💎 DexScreener',url:`https://dexscreener.com/robinhood/${token.toLowerCase()}`});
  }
  const rows: AlphaNotificationAction[][]=[];
  for(let i=0;i<actions.length;i+=2) rows.push(actions.slice(i,i+2));
  return {text:cleanAlertCard(message),buttons:cleanAlertButtons(rows)!};
}
export function createAlertDexPaidReader(scan = scanRobinhoodDexPaid, now = Date.now) {
  const cache = new Map<string,{status:AlertDexPaidStatus;expires:number}>();
  const pending = new Map<string,Promise<AlertDexPaidStatus>>();
  let budgetAt=0;let used=0;
  return async (token:string):Promise<AlertDexPaidStatus> => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return 'UNKNOWN';
    const key=token.toLowerCase();const at=now();const saved=cache.get(key);
    if (saved && saved.expires>at) return saved.status;
    if (pending.has(key)) return withinDisplayBudget(pending.get(key)!);
    if(at-budgetAt>=60_000){budgetAt=at;used=0;}
    if(pending.size>=2||used>=10) return 'UNKNOWN';
    used++;
    const work=scan(key).then(result => result.dexPaid === true ? 'PAID' as const : result.dexPaid === false ? 'NOT_PAID' as const : 'UNKNOWN' as const)
      .catch(()=>'UNKNOWN' as const).then(status=>{
        if(cache.size>=100&&!cache.has(key))cache.delete(cache.keys().next().value!);
        cache.set(key,{status,expires:now()+(status==='UNKNOWN'?15_000:60_000)});return status;
      }).finally(()=>pending.delete(key));
    pending.set(key,work);
    // Keep initial notification latency bounded; the lookup warms the cache even
    // if the provider takes longer. No retry or additional send is scheduled.
    return withinDisplayBudget(work);
  };
}
export const readAlertDexPaid = createAlertDexPaidReader();
export async function discloseAlertDexPaid(text:string,buttons:AlphaNotificationAction[][],token:string) {
  return decorateDexPaidAlert(text,buttons,token,await readAlertDexPaid(token));
}
