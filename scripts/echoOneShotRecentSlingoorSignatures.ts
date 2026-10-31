/** One-time read-only public-RPC lookup of recent Slingoor signatures.
 * No keys, no trading, no Railway requests. Maximum 12 signature rows,
 * one request per endpoint, and no full transaction fetch in this probe.
 */
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
for(const endpoint of ['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']){
 try {
  const response=await fetch(endpoint,{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignaturesForAddress',
    params:[wallet,{limit:12,commitment:'confirmed'}]}),
   signal:AbortSignal.timeout(8000)
  });
  if(!response.ok){console.log('RECENT_SIGNATURES_UNAVAILABLE',JSON.stringify({
   endpoint:new URL(endpoint).hostname,status:response.status}));continue;}
  const raw=await response.json();
  if(!Array.isArray(raw.result)){console.log('RECENT_SIGNATURES_UNAVAILABLE',JSON.stringify({
   endpoint:new URL(endpoint).hostname,errorCode:raw.error?.code??null}));continue;}
  const rows=raw.result.map((r:any)=>({signature:r.signature,slot:r.slot,blockTime:r.blockTime,
   err:r.err?true:false}));
  console.log('RECENT_SIGNATURES_FOUND',JSON.stringify({
   endpoint:new URL(endpoint).hostname,count:rows.length,rows}));
  process.exit(0);
 }catch{
  console.log('RECENT_SIGNATURES_NETWORK_UNAVAILABLE',new URL(endpoint).hostname);
 }
}
process.exit(1);
