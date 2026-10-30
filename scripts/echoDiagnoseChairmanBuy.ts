import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';

const wallet = 'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6';
const mint = '3m8Zk2sgj9nZYmK8zgUnXZ7UijRtKbsuiWdDYPd6pump';
const earliest = Math.floor(new Date('2026-10-30T07:40:00Z').getTime()/1000);
const rpcHosts=['https://solana-rpc.publicnode.com','https://api.mainnet-beta.solana.com'];
async function request(method:string,params:unknown[]) {
 for (const url of rpcHosts) {
  try {
   const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(8000)});
   if(!response.ok) continue;
   const json=await response.json();
   if(!json.error && Object.prototype.hasOwnProperty.call(json,'result')) return json.result;
  }catch{}
 }
 throw Error(method+' unavailable via public RPC');
}
type Row = {signature:string;blockTime:number|null;err:unknown};
let rows:Row[]=[];
try{
 rows=await request('getSignaturesForAddress',[wallet,{limit:150,commitment:'confirmed'}]);
 console.log('CHAIRMAN_SCAN',JSON.stringify({wallet,mint,signaturesAvailable:rows.length,latestTime:rows[0]?.blockTime??null,oldestTime:rows.at(-1)?.blockTime??null}));
}catch(err){console.error('CHAIRMAN_SCAN_UNAVAILABLE',String(err));process.exit(0);}
// Cross-check both address indexes without assuming the profile wallet signed.
try {
 const mintRows:Row[]=await request('getSignaturesForAddress',[mint,{limit:500,commitment:'confirmed'}]);
 const walletMap=new Map(rows.map(row=>[row.signature,row]));
 const common=mintRows.filter(row=>walletMap.has(row.signature));
 console.log('CHAIRMAN_MINT_WALLET_INTERSECTION',JSON.stringify({
  mintSignaturesAvailable:mintRows.length,mintNewest:mintRows[0]?.blockTime??null,
  mintOldest:mintRows.at(-1)?.blockTime??null,matchingSignatures:common.length,
  matches:common.slice(0,15).map(row=>({signature:row.signature,blockTime:row.blockTime}))
 }));
}catch(error){console.log('CHAIRMAN_MINT_INDEX_UNAVAILABLE',String(error));}
let checked=0,found=0,unavailable=0;
for(const row of rows.filter(r=>r.err===null && r.blockTime!==null && r.blockTime>=earliest).slice(0,65)){
 try {
  const tx=await request('getTransaction',[row.signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]);
  if(!tx) {unavailable++;continue;}
  checked++;
  const balances=[...(tx.meta?.preTokenBalances??[]),...(tx.meta?.postTokenBalances??[])];
  const mintPresent=balances.some((x:any)=>x.mint===mint);
  const instructions=[...(tx.transaction?.message?.instructions??[]),...(tx.meta?.innerInstructions??[]).flatMap((x:any)=>x.instructions??[])];
  const targetInstruction=instructions.some((x:any)=>JSON.stringify(x).includes(mint));
  if(!mintPresent&&!targetInstruction)continue;
  found++;
  const direct=extractRpcEchoSignals(tx,row.signature,Math.floor(Date.now()/1000));
  const routed=extractJupiterRoutedEchoBuys(tx,row.signature,Math.floor(Date.now()/1000));
  const signers=(tx.transaction?.message?.accountKeys??[]).filter((x:any)=>x.signer).map((x:any)=>x.pubkey);
  const programs=[...new Set(instructions.map((x:any)=>x.programId?.toString?.()??'unknown'))];
  const ownerDeltas=new Map<string,{raw:bigint;decimals:number}>();
  for(const [factor,items] of [[-1n,tx.meta?.preTokenBalances??[]],[1n,tx.meta?.postTokenBalances??[]]] as const)
   for(const item of items) if(item.owner===wallet){
    const old=ownerDeltas.get(item.mint);
    ownerDeltas.set(item.mint,{raw:(old?.raw??0n)+factor*BigInt(item.uiTokenAmount.amount),decimals:item.uiTokenAmount.decimals});
   }
  console.log('CHAIRMAN_TX_MATCH',JSON.stringify({
   signature:row.signature,blockTime:tx.blockTime,successful:tx.meta?.err===null,
   signer:signers.includes(wallet),ownerDeltas:[...ownerDeltas].map(([mint,v])=>({mint,delta:Number(v.raw)/10**v.decimals})),
   programIds:programs,classification:classifyEchoRejection(tx,row.signature,Math.floor(Date.now()/1000)),
   direct:direct.map(x=>({side:x.side,mint:x.mint,quote:x.quoteAmount})),
   routed:routed.map(x=>({side:x.side,mint:x.mint,quote:x.quoteAmount}))
  }));
 }catch(err){unavailable++;console.log('CHAIRMAN_TX_RPC_UNAVAILABLE',{sig:row.signature.slice(0,8),message:String(err).slice(0,80)});}
}
console.log('CHAIRMAN_DIAGNOSTIC_RESULT',JSON.stringify({checked,found,unavailable,rangeStart:earliest}));
