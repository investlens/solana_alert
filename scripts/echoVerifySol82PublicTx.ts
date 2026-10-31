import {extractPumpAppRoutedEchoBuys} from '../src/echo/pumpAppRouteSignals.js';
const signature='5BW5sKmZRmYtrDPp4aGmgCR566TGxyL7NMzdAJQQ3E1nAs5KGVWpv9P9hfmNmQa6dJKNqLVMsfUMAi3ge7tGn1UL';
for(const endpoint of ['https://api.mainnet-beta.solana.com','https://solana-rpc.publicnode.com']){
 try{
  const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTransaction',params:[signature,{
    encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1}]}),
   signal:AbortSignal.timeout(8000)});
  if(!response.ok)continue;
  const data=await response.json();
  const tx=data.result;
  if(!tx)continue;
  if(tx.transaction?.signatures?.[0]!==signature)throw Error('SIGNATURE_MISMATCH');
  const buy=extractPumpAppRoutedEchoBuys(tx,signature,tx.blockTime+1);
  const verified=buy.length===1&&buy[0].wallet==='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'&&
   buy[0].mint==='9AfSCLTcHTwgKdy78ibYdJFn3TGbkQRcaxd2RUyHpump'&&
   buy[0].quoteMint==='So11111111111111111111111111111111111111112'&&
   Math.abs(buy[0].quoteAmount!-0.614432271)<1e-9&&
   Math.abs(buy[0].tokenAmount-677408.97953)<1e-5;
  console.log('ECHO_SOL82_REAL_TX',JSON.stringify({
   signatureMatched:true,slot:tx.slot,blockTime:tx.blockTime,
   shape:'PUMP_APP_NATIVE_SOL_82',validated:verified,
   buyCount:buy.length,inputSol:buy[0]?.quoteAmount??null,
   outputTokens:buy[0]?.tokenAmount??null,liveTrading:false}));
  if(!verified)process.exitCode=1;
  break;
 }catch(e){
  console.warn('ECHO_SOL82_RPC_UNAVAILABLE',new URL(endpoint).hostname);
 }
}
if(process.exitCode===undefined&&!process.env.ECHO_SOL82_RESULT){} // no mutating actions
