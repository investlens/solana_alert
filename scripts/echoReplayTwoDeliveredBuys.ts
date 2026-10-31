/** Read-only, bounded public-RPC replay of two independently logged Echo alerts.
 * Confirms the on-chain classification and signature/mint; Telegram message IDs
 * are separate Railway evidence, NOT independently verified by this script.
 * This DOES NOT establish gap-free coverage.
 */
import {extractRpcEchoSignals} from '../src/echo/rpcSignals.js';
import {extractJupiterRoutedEchoBuys} from '../src/echo/jupiterRouteSignals.js';
import {extractPumpAppRoutedEchoBuys} from '../src/echo/pumpAppRouteSignals.js';
const samples=[
 {caller:'Chairman', wallet:'Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6',
  signature:'2gUqDBjpx9PbRGTVk2BNAzQSLYG22SPtSAajZNtGZk1tfscrhUgChnvLvigG4ABU9A5jLzzFUUjd1fnfapuscRwU',
  mint:'BmtwAb3Bt9jqSL8bKrRavCYkXB3X45w9FXwbawiTpump',telegramMessageId:18665},
 {caller:'Slingoor',wallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij',
  signature:'2tBYKQQVUzpqHGjWFuHRiHet3N9Hf2cd7DEq5JfrHHqTgZffXTezEUptA3fLMYjruJST298X3MZ4TbwWEUn386k1',
  mint:'6y9aDagFD9RXVpJidYqmDozC3Qn2uRdtwPeoxT8pump',telegramMessageId:19133}
] as const;
const endpoints=['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com'];
async function getTx(signature:string):Promise<any|null>{
 for(const endpoint of endpoints){
  try{
   const res=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',
      params:[signature,{encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]}),
    signal:AbortSignal.timeout(8_000)});
   if(!res.ok)continue;
   const json=await res.json();
   if(json?.result?.transaction?.signatures?.[0]===signature)return json.result;
  }catch{/* public provider availability is not proof of a missing transaction */}
 }
 return null;
}
let failed=0;
for(const entry of samples){
 const tx=await getTx(entry.signature);
 if(!tx){console.error('ECHO_AUDIT_PROVIDER_UNAVAILABLE',entry.caller);failed++;continue;}
 const now=tx.blockTime+1;
 const direct=extractRpcEchoSignals(tx,entry.signature,now);
 const jupiter=direct.length?[]:extractJupiterRoutedEchoBuys(tx,entry.signature,now);
 const buy=direct.length?direct:jupiter.length?jupiter:extractPumpAppRoutedEchoBuys(tx,entry.signature,now);
 const ok=buy.length===1&&buy[0].side==='BUY'&&
  buy[0].wallet===entry.wallet&&buy[0].mint===entry.mint;
 console.log('ECHO_INDEPENDENT_BUY_REPLAY',JSON.stringify({
  caller:entry.caller,signature:entry.signature,slot:tx.slot,blockTime:tx.blockTime,
  expectedTelegramIdFromRailway:entry.telegramMessageId,
  telegramVerifiedByReplay:false,validOnChainBuy:ok,classifiedCount:buy.length,
  liveTrading:false}));
 if(!ok)failed++;
}
if(failed)process.exitCode=1;
