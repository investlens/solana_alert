type Chain='robinhood'|'arc';
type Options={chainId:(chain:Chain)=>number;urls:(chain:Chain)=>(string|undefined)[];fetch?:typeof fetch;now?:()=>number};
// Read-only, bounded failover. The caller's deadline and pinned block survive
// every retry; a successful simulation response (including a revert) is final.
export function createExitRpcTransport(options:Options){
 const now=options.now??Date.now;
 const health=new Map<string,{verifiedUntil:number;until:number;unsupported:Map<string,number>}>();
 return async(chain:Chain,method:string,params:unknown[],signal:AbortSignal):Promise<any>=>{
  if(!['eth_chainId','eth_blockNumber','eth_simulateV1'].includes(method))throw Error('Exit RPC method not permitted');
  const urls=[...new Set(options.urls(chain).map(v=>v?.trim()).filter((v):v is string=>Boolean(v)))].slice(0,4);
  for(const url of urls){
   signal.throwIfAborted();const key=`${chain}:${url}`;
   let state=health.get(key);if(!state){if(health.size>=12)health.delete(health.keys().next().value!);state={verifiedUntil:0,until:0,unsupported:new Map()};health.set(key,state);}
   if(state.until>now()||(state.unsupported.get(method)??0)>now())continue;
   const attemptSignal=AbortSignal.any([signal,AbortSignal.timeout(1500)]);
   const call=async(name:string,args:unknown[])=>{
    const response=await (options.fetch??globalThis.fetch)(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:name,params:args}),signal:attemptSignal});
    if(!response.ok){state!.until=now()+(response.status===429?60_000:30_000);throw Error('Exit RPC unavailable');}
    const json=await response.json() as any;
    if(json.error||json.result==null){
     if(json.error?.code===-32601)state!.unsupported.set(name,now()+300_000);
     else state!.until=now()+30_000;
     throw Error('Exit RPC data unavailable');
    }
    return json.result;
   };
   try{
    if(method==='eth_chainId'||state.verifiedUntil<=now()){
     const id=await call('eth_chainId',[]);
     if(!/^0x[0-9a-f]+$/i.test(String(id))||BigInt(id)!==BigInt(options.chainId(chain))){state.until=now()+300_000;throw Error('RPC chain identity mismatch');}
     state.verifiedUntil=now()+60_000;if(method==='eth_chainId')return id;
    }
    return await call(method,params);
   }catch{
    signal.throwIfAborted();
    // No endpoint, credential, payload or provider error is logged.
    if(state.until<=now()&&(state.unsupported.get(method)??0)<=now())state.until=now()+15_000;
   }
  }
  throw Error('Exit verification providers unavailable; retry required');
 };
}
