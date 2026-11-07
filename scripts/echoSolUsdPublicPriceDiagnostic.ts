/** One-shot public-market SOL/USD diagnostic. NO API KEYS, wallet state,
 * transactions, signing, execution, or production service calls.
 * Two independent HTTPS spot sources, with bounded wall-clock freshness.
 * Spot tick timestamps may lag retrieval; never treat result as executable.
 */
import {parseCoinbaseSolUsdProduct,parseKrakenSolUsdTicker,
 crossCheckSolUsdPublicQuotes,type EchoSolUsdPublicQuote
} from '../src/echo/solUsdIndependentPrice.js';
const sources=[
 {source:'coinbase' as const,
  url:'https://api.coinbase.com/api/v3/brokerage/market/products/SOL-USD',
  parse:parseCoinbaseSolUsdProduct},
 {source:'kraken' as const,
  url:'https://api.kraken.com/0/public/Ticker?pair=SOLUSD',
  parse:parseKrakenSolUsdTicker}
];
const checks=await Promise.all(sources.map(async s=>{
 try{
  const res=await fetch(s.url,{headers:{Accept:'application/json'},
   signal:AbortSignal.timeout(2500),redirect:'error'});
  if(!res.ok)return null;
  const raw:unknown=await res.json();
  const cents=s.parse(raw);
  return cents?{source:s.source,cents,receivedAtMs:Date.now()}:null;
 }catch{return null;}
}));
const quotes=checks.filter((x):x is EchoSolUsdPublicQuote=>x!==null);
const result=crossCheckSolUsdPublicQuotes(quotes,Date.now());
process.stdout.write('ECHO_SOL_USD_PUBLIC_CROSSCHECK '+JSON.stringify({
 ...result,sourceCount:quotes.length,marketTickTimeIndependentlyVerified:false,
 signedOracleVerified:false,feeAndCpiVerified:false,phantomSellVerified:false,
 realWalletSimulationVerified:false,realSignerSigned:false,broadcast:false
})+'\n');
// A good spot cross-check is only evidence of recent endpoint retrieval,
// never proof of market-tick timestamp or executable BUY pricing.
if(!result.ok)process.exitCode=1;
