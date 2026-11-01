/** Bounded independent Solana BUY coverage audit for one historical window.
 * NOT the live Echo provider, not a full-day scan, no Telegram API access.
 * Fails CLOSED on missing timestamp/scan coverage, RPC throttling, transaction
 * budget overflow, unmatched BUY or unexpected Telegram entries.
 * One signature-page RPC + at most 30 getTransaction calls; no retries.
 */
import {readFileSync} from 'node:fs';
import {extractRpcEchoSignals} from '../src/echo/rpcSignals.js';
import {extractJupiterRoutedEchoBuys} from '../src/echo/jupiterRouteSignals.js';
import {extractPumpAppRoutedEchoBuys} from '../src/echo/pumpAppRouteSignals.js';
import {reconcileEchoBuys,type VerifiedBuy,type TelegramBuy} from '../src/echo/buyAcceptance.js';
const WALLET='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const CALLER='WHALE · slingoor';
const RPC='https://solana-rpc.publicnode.com';
const MAX_TX=30;
const file=process.argv[2];
if(!file||process.argv.length!==3)throw Error('REFERENCE_WINDOW_REQUIRED');
const cfg=JSON.parse(readFileSync(file,'utf8'));
if(cfg.wallet!==WALLET||cfg.caller!==CALLER||
 !Number.isSafeInteger(cfg.from)||!Number.isSafeInteger(cfg.to)||
 cfg.from>=cfg.to||cfg.to-cfg.from>180||
 typeof cfg.anchorSignature!=='string'||!^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(cfg.anchorSignature)||
 !Array.isArray(cfg.deliveries)||cfg.deliveries.length>50)throw Error('INVALID_REFERENCE_WINDOW');
let rpcCount=0;
async function rpc(method:string,params:unknown[]){
 rpcCount++;
 const response=await fetch(RPC,{method:'POST',
  headers:{'content-type':'application/json'},
  body:JSON.stringify({jsonrpc:'2.0',id:rpcCount,method,params}),
  signal:AbortSignal.timeout(7000)});
 if(!response.ok)throw Error('PUBLIC_RPC_HTTP_'+response.status);
 const body=await response.json();
 if(body.error)throw Error('PUBLIC_RPC_ERROR_'+String(body.error.code));
 return body.result;
}
async function main(){
 // A previously independently logged caller-BUY signature anchors the upper
 // boundary. We prove only the contiguous segment ending at that signature,
 // not every transaction with the same second or any later wallet activity.
 const anchor=await rpc('getTransaction',[cfg.anchorSignature,{
   encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
 if(!anchor||anchor.transaction?.signatures?.[0]!==cfg.anchorSignature||
    anchor.blockTime!==cfg.to)throw Error('REFERENCE_ANCHOR_NOT_VERIFIED');
 const page=await rpc('getSignaturesForAddress',[WALLET,{
   before:cfg.anchorSignature,limit:1000,commitment:'confirmed'}]);
 if(!Array.isArray(page)||!page.length)throw Error('REFERENCE_SIGNATURES_UNAVAILABLE');
 const oldest=page.at(-1)?.blockTime;
 if(!Number.isFinite(oldest)||oldest>cfg.from)
  throw Error('REFERENCE_ANCHORED_WINDOW_NOT_FULLY_PAGED');
 const window=[{signature:cfg.anchorSignature,blockTime:cfg.to,err:null},
  ...page.filter((r:any)=>r.blockTime>=cfg.from&&r.blockTime<=cfg.to)];
 if(window.length>MAX_TX)throw Error('REFERENCE_TX_BUDGET_EXCEEDED_'+window.length);
 if(window.some((r:any)=>!Number.isFinite(r.blockTime)||r.err!==null))
  throw Error('UNVERIFIED_REFERENCE_TRANSACTION');
 const expected:VerifiedBuy[]=[];
 for(const row of window.reverse()){
  const tx=row.signature===cfg.anchorSignature?anchor:await rpc('getTransaction',[row.signature,{
   encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);
  if(!tx||tx.transaction?.signatures?.[0]!==row.signature||
     !Number.isFinite(tx.blockTime))throw Error('MISSING_REFERENCE_TX');
  let buys=extractRpcEchoSignals(tx,row.signature,tx.blockTime+1);
  if(!buys.length)buys=extractJupiterRoutedEchoBuys(tx,row.signature,tx.blockTime+1);
  if(!buys.length)buys=extractPumpAppRoutedEchoBuys(tx,row.signature,tx.blockTime+1);
  for(const b of buys)if(b.wallet===WALLET&&b.side==='BUY'){
   expected.push({caller:CALLER,signature:row.signature,mint:b.mint,tradeAt:tx.blockTime});
  }
 }
 const delivered=cfg.deliveries as TelegramBuy[];
 const result=reconcileEchoBuys(expected,delivered,[{caller:CALLER,
  complete:true,from:cfg.from,to:cfg.to}],10);
 console.log('ECHO_INDEPENDENT_WINDOW_RECONCILIATION',JSON.stringify({
  from:cfg.from,to:cfg.to,eligibleBuys:expected.length,telegramDeliveries:delivered.length,
  scannedTransactions:window.length,rpcCalls:rpcCount,accepted:result.accepted,
  matched:result.matched,missing:result.missing,unexpected:result.unexpectedDeliveries,
  duplicate:result.duplicateDeliveries,late:result.lateDeliveries,
  independentPublicRpc:true,telegramIdsFromRailwayLogsOnly:true,
  allDayGapFree:false,upperBoundaryAnchoredBySignature:true,
  laterSameSecondTransactionsNotChecked:true,liveTrading:false
 }));
 if(!result.accepted)process.exitCode=1;
}
main().catch(e=>{
 console.error('ECHO_INDEPENDENT_WINDOW_INCOMPLETE',JSON.stringify({
  reason:e instanceof Error?e.message:'UNKNOWN',rpcCalls:rpcCount,
  allDayGapFree:false,referenceComplete:false}));
 process.exitCode=1;
});
