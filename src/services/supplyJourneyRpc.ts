// Dedicated read-only transport: no shared alert RPC queue, retries or failover.
export function createSupplyJourneyRpc(endpoint:string, fetcher:typeof fetch=fetch) {
  const url=new URL(endpoint);
  if(!['http:','https:'].includes(url.protocol))throw Error('Invalid research RPC endpoint');
  return async <T>(method:string,params:unknown[],signal?:AbortSignal):Promise<T>=>{
    if(!['eth_chainId','eth_blockNumber','eth_getBlockByNumber','eth_getLogs','eth_call','eth_getTransactionReceipt'].includes(method))throw Error('Unsupported research read');
    const response=await fetcher(endpoint,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal});
    if(!response.ok||!response.body)throw Error(`Research RPC HTTP ${response.status}`);
    const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
    try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;
      if(bytes>256000)throw Error('Research response cap exceeded');text+=decoder.decode(part.value,{stream:true});}
      text+=decoder.decode();
    }finally{await reader.cancel().catch(()=>{});}
    const body=JSON.parse(text);
    if(body.error)throw Error(`Research RPC error ${Number(body.error.code)}: ${String(body.error.message??'unavailable').replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,180)}`);
    if(body.jsonrpc!=='2.0'||body.id!==1||body.result===undefined)throw Error('Invalid research response');
    return body.result as T;
  };
}
