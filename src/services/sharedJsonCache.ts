import { createClient, type RedisClientType } from 'redis';
let client:RedisClientType|null=null;let connecting:Promise<void>|null=null;let disabledUntil=0;
async function getClient(connectTimeoutMs=1500):Promise<RedisClientType|null>{
 const url=process.env.REDIS_URL?.trim();if(!url||Date.now()<disabledUntil)return null;
 if(!client){client=createClient({url,socket:{connectTimeout:5000}});client.on('error',()=>console.warn('[SharedCache] Redis connection unavailable'));}
 if(client.isReady)return client;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try {
   if(!connecting&&!client.isOpen)connecting=client.connect().then(()=>undefined).finally(()=>{connecting=null;});
   const ready=connecting??new Promise<void>((resolve,reject)=>{
     const onReady=()=>{cleanup();resolve();},onError=()=>{cleanup();reject(new Error('Redis connection unavailable'));};
     const cleanup=()=>{client?.off('ready',onReady);client?.off('error',onError);};
     client!.once('ready',onReady);client!.once('error',onError);
     setTimeout(()=>{cleanup();reject(new Error('Redis ready timeout'));},connectTimeoutMs).unref();
   });
   await Promise.race([ready,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Redis connect timeout')),connectTimeoutMs);})]);
   return client.isReady?client:null;
 }catch{disabledUntil=Date.now()+30_000;return null;}finally{if(timer)clearTimeout(timer);}
}
export async function getSharedJson<T>(key:string,deadlineMs=150):Promise<{value:T;fetchedAt:string}|null>{const timeout=Math.max(150,Math.min(1500,deadlineMs));try{const redis=await getClient(Math.max(500,timeout));if(!redis)return null;const raw:unknown=await Promise.race([redis.get(key),new Promise<null>((resolve)=>setTimeout(()=>resolve(null),timeout))]);if(typeof raw!=='string'||!raw)return null;const parsed=JSON.parse(raw) as {value:T;fetchedAt:string};return parsed?.fetchedAt?parsed:null;}catch{return null;}}
export async function setSharedJson(key:string,value:unknown,fetchedAt:string,ttlMs:number):Promise<void>{if(ttlMs<=0)return;try{const redis=await getClient();if(!redis)return;await Promise.race([redis.set(key,JSON.stringify({value,fetchedAt}),{PX:ttlMs}),new Promise<void>((resolve)=>setTimeout(resolve,150))]);}catch{/* Fail open: live market data never depends on Redis. */}}

// Critical delivery claims fail closed. A timeout may have written the key, so
// callers must never interpret unavailable Redis as permission to send.
export async function claimSharedDelivery(key: string, ttlMs: number, owner = 'claimed'): Promise<'CLAIMED' | 'EXISTS' | 'UNAVAILABLE'> {
  try {
    const redis = await getClient();
    if (!redis || ttlMs <= 0) return 'UNAVAILABLE';
    const result = await Promise.race([
      redis.set(key, owner, { NX: true, PX: ttlMs }),
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

// Checkpoints must distinguish a missing key from a failed read. Otherwise a
// restart can overwrite recoverable watches after a transient Redis timeout.
export async function getWatchCheckpoint<T>(key: string): Promise<{value:T;fetchedAt:string}|null> {
  const redis = await getClient(1500);
  if (!redis) throw new Error('Watch checkpoint store unavailable');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const raw = await Promise.race([redis.get(key), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Watch checkpoint read timeout')), 1500);
    })]);
    if (raw === null) { console.log(`[WatchCheckpoint] MISSING key=${key}`); return null; }
    if (typeof raw !== 'string') throw new Error('Invalid watch checkpoint response');
    const parsed = JSON.parse(raw) as {value:T;fetchedAt:string};
    if (!parsed?.fetchedAt || parsed.value === undefined) throw new Error('Invalid watch checkpoint');
    return parsed;
  } finally { if (timeout) clearTimeout(timeout); }
}

export async function setWatchCheckpoint(key: string, value: unknown, fetchedAt: string, ttlMs: number): Promise<void> {
  const redis = await getClient(1500);
  if (!redis || ttlMs <= 0) throw new Error('Watch checkpoint store unavailable');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([redis.set(key, JSON.stringify({value, fetchedAt}), {PX: ttlMs}), new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Watch checkpoint write timeout')), 1500);
    })]);
    if (result !== 'OK') throw new Error('Watch checkpoint write not acknowledged');
  } finally { if (timeout) clearTimeout(timeout); }
}
