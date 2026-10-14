import {createHmac,timingSafeEqual} from 'node:crypto';
// Telegram Mini App authentication; browser-supplied tiers/user IDs are ignored.
export function telegramUser(initData:string,botToken:string,now=Date.now()):string{
 if(typeof initData!=='string'||initData.length>8192)throw Error('Authentication required');
 const p=new URLSearchParams(initData),seen=new Set<string>();for(const [k]of p){if(seen.has(k))throw Error('Invalid authentication');seen.add(k);}
 const hash=p.get('hash')??'';if(!/^[a-f0-9]{64}$/.test(hash))throw Error('Invalid authentication');
 const authDate=Number(p.get('auth_date'));if(!Number.isSafeInteger(authDate)||now-authDate*1000>15*60000||authDate*1000>now+30000)throw Error('Authentication expired');
 p.delete('hash');const check=[...p.entries()].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(botToken).digest(),expected=createHmac('sha256',secret).update(check).digest();
 if(!timingSafeEqual(Buffer.from(hash,'hex'),expected))throw Error('Invalid authentication');
 const user=JSON.parse(p.get('user')??'null');if(!Number.isSafeInteger(user?.id)||user.id<=0)throw Error('Invalid authentication');return String(user.id);
}
