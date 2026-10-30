import { extractRpcEchoSignals, classifyEchoRejection } from '../src/echo/rpcSignals.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';

/** One-shot read-only incident diagnostic. No credentials, Telegram, writes, or trading.
 * Searches Chairman's signatures around the user-observed 2026-10-30 buy, then
 * classifies only transactions involving the exact reported mint.
 */
const wallet = 'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6';
const mint = '3m8Zk2sgj9nZYmK8zgUnXZ7UijRtKbsuiWdDYPd6pump';
const from = Date.parse('2026-10-30T08:25:00Z') / 1000;
const to = Date.parse('2026-10-30T08:59:00Z') / 1000;
const endpoints = ['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'];

async function rpc(endpoint: string, method: string, params: unknown[]) {
 const res = await fetch(endpoint, {method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(10000)});
 if(!res.ok) throw Error('HTTP_'+res.status);
 const json:any = await res.json();
 if(json.error) throw Error('RPC_'+json.error.code);
 return json.result;
}
for (const endpoint of endpoints) {
 try {
  const signatures: Array<{signature:string; blockTime:number|null; err:unknown}> = [];
  let before: string | undefined;
  for(let page=0;page<4;page++){
   const rows=await rpc(endpoint,'getSignaturesForAddress',[wallet,{limit:1000,...(before?{before}:{})}]);
   if(!Array.isArray(rows))throw Error('INVALID_SIGNATURE_PAGE');
   signatures.push(...rows);
   if(!rows.length|| (rows.at(-1)?.blockTime??0)<from)break;
   before=rows.at(-1)?.signature;
   if(!before)break;
  }
  const matching=signatures.filter(r=>r.err===null&&r.blockTime!==null&&r.blockTime>=from&&r.blockTime<=to)
   .sort((a,b)=>Math.abs((a.blockTime??0)-Date.parse('2026-10-30T08:38:00Z')/1000)
        -Math.abs((b.blockTime??0)-Date.parse('2026-10-30T08:38:00Z')/1000));
  console.log('CHAIRMAN_DISCOVERY',JSON.stringify({provider:new URL(endpoint).hostname,
   signaturesScanned:signatures.length,windowCandidates:matching.length,
   transactionReadsCappedAt:40,oldestBlockTime:signatures.at(-1)?.blockTime??null}));
  let reads=0;
  for(const row of matching.slice(0,40)){
   let tx:any;
   try{tx=await rpc(endpoint,'getTransaction',[row.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);}
   catch(e){console.log('CHAIRMAN_TX_UNAVAILABLE',JSON.stringify({signature:row.signature,reason:String(e).slice(0,70)}));continue;}
   reads++;
   if(!tx?.meta)continue;
   const balances=[...(tx.meta.preTokenBalances??[]),...(tx.meta.postTokenBalances??[])];
   const accounts=tx.transaction?.message?.accountKeys??[];
   const mentioned=balances.some((b:any)=>b.mint===mint)
    ||accounts.some((a:any)=>a.pubkey===mint);
   if(!mentioned)continue;
   const signer=accounts.some((a:any)=>a.pubkey===wallet&&a.signer===true);
   const direct=extractRpcEchoSignals(tx,row.signature,(tx.blockTime??0)+1);
   const routed=extractJupiterRoutedEchoBuys(tx,row.signature,(tx.blockTime??0)+1);
   const ownDelta=(tx.meta.postTokenBalances??[]).filter((x:any)=>x.owner===wallet&&x.mint===mint)
     .reduce((sum:bigint,x:any)=>sum+BigInt(x.uiTokenAmount.amount),0n)
    -(tx.meta.preTokenBalances??[]).filter((x:any)=>x.owner===wallet&&x.mint===mint)
     .reduce((sum:bigint,x:any)=>sum+BigInt(x.uiTokenAmount.amount),0n);
   console.log('CHAIRMAN_MINT_MATCH',JSON.stringify({signature:row.signature,blockTime:tx.blockTime,
    success:tx.meta.err===null,signer,netTokenRaw:ownDelta.toString(),
    direct:direct.map(s=>({side:s.side,mint:s.mint,quote:s.quoteAmount})),
    routed:routed.map(s=>({side:s.side,mint:s.mint,quote:s.quoteAmount})),
    reject:direct.length||routed.length?null:classifyEchoRejection(tx,row.signature,(tx.blockTime??0)+1),
    programs:[...new Set((tx.transaction?.message?.instructions??[]).map((ix:any)=>ix.programId))]}));
  }
  console.log('CHAIRMAN_DISCOVERY_COMPLETE',JSON.stringify({provider:new URL(endpoint).hostname,transactionReads:reads}));
  process.exit(0);
 } catch(e) {
  console.warn('CHAIRMAN_PROVIDER_UNAVAILABLE',JSON.stringify({provider:new URL(endpoint).hostname,error:String(e).slice(0,90)}));
 }
}
console.error('CHAIRMAN_DIAGNOSTIC_UNAVAILABLE: Public RPC providers could not return usable signature history');
process.exit(1);
