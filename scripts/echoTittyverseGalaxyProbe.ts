/** One-shot diagnostic: exact public Tittyverse galaxy routes from site's JS.
 * <=3 read-only GETs, no token trading, no Solana RPC, no private key, no loop.
 */
const origin='https://sling-rewards-backend.onrender.com';
const tao='BDTixhrJpvpqAWyh3GCg4YpToo14bsKyKXuSjTx8pump';
const root='C5xph2yL6gMdxmuLGxJBkGpmuDFfyi5fqkBNhvL6pump';
async function probe(path:string){
 const res=await fetch(origin+path,{headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
 const contentType=res.headers.get('content-type')??'';
 let bytes=0,parts:string[]=[];
 if(res.body){const stream=res.body.getReader();
  while(true){const {done,value}=await stream.read();if(done)break;
   bytes+=value.byteLength;
   if(bytes>1_000_000){await stream.cancel();throw Error('GALAXY_RESPONSE_OVER_ONE_MB');}
   parts.push(new TextDecoder().decode(value));
  }
 }
 let body:unknown=null;
 try{body=JSON.parse(parts.join(''));}catch{}
 const obj=body&&typeof body==='object'&&!Array.isArray(body)?body as Record<string,unknown>:null;
 const keys=obj?Object.keys(obj).slice(0,16):[];
 const shape=Object.fromEntries(keys.map(k=>{
  const v=obj![k];return [k,Array.isArray(v)?'array('+v.length+')':v===null?'null':typeof v];
 }));
 const found=JSON.stringify(body??'').includes(tao);
 console.log('GALAXY_PUBLIC_API_PROBE',JSON.stringify({
  path,status:res.status,contentType,bytes,keys,shape,hasTaoMint:found,
  hasBtcMint:JSON.stringify(body??'').includes(root)
 }));
}
for(const path of ['/api/galaxy/bootstrap','/api/galaxy/search?q='+tao,
 '/api/galaxy/system?mint='+tao]){
 try{await probe(path);}catch(error){
  console.log('GALAXY_PUBLIC_API_PROBE_ERROR',JSON.stringify({path,
   reason:error instanceof Error?error.message.slice(0,120):'UNKNOWN'}));
 }
}
