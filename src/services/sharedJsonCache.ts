import { createClient, type RedisClientType } from 'redis';
let client:RedisClientType|null=null;let connecting:Promise<void>|null=null;let disabledUntil=0;
async function getClient():Promise<RedisClientType|null>{const url=process.env.REDIS_URL?.trim();if(!url||Date.now()<disabledUntil)return null;if(!client){client=createClient({url});client.on('error',(error)=>console.warn('[SharedCache] Redis unavailable; fail-open:',error instanceof Error?error.message:String(error)));}if(!client.isOpen){try{connecting??=client.connect().then(()=>undefined).finally(()=>{connecting=null;});await Promise.race([connecting,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Redis connect timeout')),500))]);}catch{disabledUntil=Date.now()+30_000;return null;}}return client;}
export async function getSharedJson<T>(key:string):Promise<{value:T;fetchedAt:string}|null>{try{const redis=await getClient();if(!redis)return null;const raw:unknown=await Promise.race([redis.get(key),new Promise<null>((resolve)=>setTimeout(()=>resolve(null),150))]);if(typeof raw!=='string'||!raw)return null;const parsed=JSON.parse(raw) as {value:T;fetchedAt:string};return parsed?.fetchedAt?parsed:null;}catch{return null;}}
export async function setSharedJson(key:string,value:unknown,fetchedAt:string,ttlMs:number):Promise<void>{if(ttlMs<=0)return;try{const redis=await getClient();if(!redis)return;await Promise.race([redis.set(key,JSON.stringify({value,fetchedAt}),{PX:ttlMs}),new Promise<void>((resolve)=>setTimeout(resolve,150))]);}catch{/* Fail open: live market data never depends on Redis. */}}

// Critical delivery claims fail closed. A timeout may have written the key, so
// callers must never interpret unavailable Redis as permission to send.
export async function claimSharedDelivery(key: string, ttlMs: number): Promise<'CLAIMED' | 'EXISTS' | 'UNAVAILABLE'> {
  try {
    const redis = await getClient();
    if (!redis || ttlMs <= 0) return 'UNAVAILABLE';
    const result = await Promise.race([
      redis.set(key, 'claimed', { NX: true, PX: ttlMs }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Delivery claim timeout')), 500)),
    ]);
    return result === 'OK' ? 'CLAIMED' : 'EXISTS';
  } catch { return 'UNAVAILABLE'; }
}

export async function runSharedAtomic(script: string, keys: string[], args: string[]): Promise<unknown> {
  const redis = await getClient();
  if (!redis) throw new Error('Shared monitoring store unavailable');
  return Promise.race([redis.eval(script, { keys, arguments: args }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Shared monitoring deadline')), 750))]);
}
