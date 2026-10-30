import bs58 from 'bs58';
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
  // A mint-address history lookup narrows potentially dozens of wallet
  // transactions to only signatures that also reference this exact token.
  // This is read-only and avoids flooding public RPC with getTransaction calls.
  const tokenSignatures = new Set<string>();
  let tokenBefore: string | undefined;
  let tokenPages = 0;
  try {
   for(let page=0;page<6;page++){
    const rows = await rpc(endpoint,'getSignaturesForAddress',[mint,
     {limit:1000,...(tokenBefore?{before:tokenBefore}:{})}]);
    if(!Array.isArray(rows))throw Error('INVALID_MINT_SIGNATURE_PAGE');
    tokenPages++;
    for(const row of rows) if(typeof row.signature === 'string') tokenSignatures.add(row.signature);
    if(!rows.length || (rows.at(-1)?.blockTime??0)<from)break;
    tokenBefore=rows.at(-1)?.signature;
    if(!tokenBefore)break;
   }
  } catch(error) {
   console.warn('CHAIRMAN_MINT_INDEX_UNAVAILABLE',JSON.stringify({provider:new URL(endpoint).hostname,
    error:String(error).slice(0,80)}));
  }
  const candidates=matching.filter(row=>tokenSignatures.has(row.signature));
  console.log('CHAIRMAN_TOKEN_INTERSECTION',JSON.stringify({provider:new URL(endpoint).hostname,
   walletWindow:matching.length,tokenHistoryChecked:tokenSignatures.size,tokenPages,
   intersection:candidates.length,candidateSignatures:candidates.slice(0,18).map(x=>x.signature)}));
  if(!tokenPages || candidates.length===0) {
   // Zero intersection may mean the provider's token history is incomplete,
   // not that no BUY occurred. Do not incorrectly mark this investigation done.
   console.warn('CHAIRMAN_MATCH_UNVERIFIED',JSON.stringify({reason:'NO_TOKEN_INTERSECTION_OR_INCOMPLETE_INDEX'}));
   continue;
  }
  let reads=0, found=0;
  for(const row of candidates.slice(0,18)){
   let tx:any;
   try{
    let lastError: unknown;
    for(const url of [endpoint,...endpoints.filter(u=>u!==endpoint)]) {
     for(let attempt=0;attempt<3;attempt++){
      try{
       tx=await rpc(url,'getTransaction',[row.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
       break;
      }catch(e){lastError=e;await new Promise(resolve=>setTimeout(resolve,800*(attempt+1)));}
     }
     if(tx)break;
    }
    if(!tx)throw lastError??Error('TRANSACTION_UNAVAILABLE');
   }catch(e){console.log('CHAIRMAN_TX_UNAVAILABLE',JSON.stringify({signature:row.signature,reason:String(e).slice(0,70)}));continue;}
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
   found++;
   const app = '6Vo3245eszAb5wuqEMw8mGdbfRUdKbHhDHP5LcaGuTAB';
   const instructionList=[...(tx.transaction?.message?.instructions??[]),
    ...(tx.meta.innerInstructions??[]).flatMap((x:any)=>x.instructions??[])];
   const appInstructions=instructionList.filter((ix:any)=>ix.programId===app)
    .map((ix:any)=>({tag:typeof ix.data==='string'
      ?Buffer.from(bs58.decode(ix.data).subarray(0,8)).toString('hex'):null,
     length:typeof ix.data==='string'?bs58.decode(ix.data).length:null}));
   const signerIndex=accounts.findIndex((a:any)=>a.pubkey===wallet&&a.signer===true);
   const solDeltaLamports=signerIndex<0?null:
    tx.meta.postBalances[signerIndex]-tx.meta.preBalances[signerIndex];
   console.log('CHAIRMAN_MINT_MATCH',JSON.stringify({signature:row.signature,blockTime:tx.blockTime,
    success:tx.meta.err===null,signer,netTokenRaw:ownDelta.toString(),solDeltaLamports,appInstructions,
    direct:direct.map(s=>({side:s.side,mint:s.mint,quote:s.quoteAmount})),
    routed:routed.map(s=>({side:s.side,mint:s.mint,quote:s.quoteAmount})),
    reject:direct.length||routed.length?null:classifyEchoRejection(tx,row.signature,(tx.blockTime??0)+1),
    programs:[...new Set((tx.transaction?.message?.instructions??[]).map((ix:any)=>ix.programId))]}));
  }
  console.log('CHAIRMAN_DISCOVERY_COMPLETE',JSON.stringify({provider:new URL(endpoint).hostname,transactionReads:reads,mintMatches:found}));
  if(found>0)process.exit(0);
  console.warn('CHAIRMAN_MATCH_UNVERIFIED',JSON.stringify({reason:'NO_FETCHABLE_MINT_TRANSACTION'}));
 } catch(e) {
  console.warn('CHAIRMAN_PROVIDER_UNAVAILABLE',JSON.stringify({provider:new URL(endpoint).hostname,error:String(e).slice(0,90)}));
 }
}
console.error('CHAIRMAN_DIAGNOSTIC_UNAVAILABLE: Public RPC providers could not return usable signature history');
process.exit(1);
