// Short-lived evidence reuse across cards. No database writes or polling.
export function boundedEvidenceCache<T>(read:(key:string)=>Promise<T|null>, now=Date.now) {
  const cache=new Map<string,{at:number;value:T|null}>();
  const pending=new Map<string,Promise<T|null>>();
  return async(key:string):Promise<T|null>=>{
    const hit=cache.get(key);
    if(hit && now()-hit.at<(hit.value==null?2_000:30_000))return hit.value;
    const running=pending.get(key);if(running)return running;
    const work=Promise.resolve().then(()=>read(key)).catch(()=>null).then(value=>{
      if(cache.size>=100)cache.delete(cache.keys().next().value!);
      cache.set(key,{at:now(),value});return value;
    }).finally(()=>pending.delete(key));
    pending.set(key,work);return work;
  };
}
