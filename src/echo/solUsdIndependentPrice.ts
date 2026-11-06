/** Read-only SOL/USD consensus from independent public spot exchanges.
 * Not a signed oracle, fee attestation, signer authorization, or live FX cache.
 * Prices in USD cents are rounded UP to avoid exceeding a $5 all-in limit.
 * Both responses must belong to the same bounded observation window.
 */
export const ECHO_PUBLIC_FX_CAN_SIGN=false as const;
export const ECHO_PUBLIC_FX_CAN_BROADCAST=false as const;
export type EchoSolUsdPublicQuote={
 source:'coinbase'|'kraken'; cents:string; receivedAtMs:number;
};
export type EchoSolUsdCrossCheck=
 |{ok:true;mode:'PUBLIC_SPOT_DIAGNOSTIC_ONLY';upperCents:string;
   lowerCents:string;divergenceBps:string;observedAtMs:number;
   signingAllowed:false;broadcastAllowed:false}
 |{ok:false;reason:string;signingAllowed:false;broadcastAllowed:false};
const bad=(reason:string):EchoSolUsdCrossCheck=>({
 ok:false,reason,signingAllowed:false,broadcastAllowed:false
});
/** No floating point: round USD to whole cents conservatively. */
export function usdSpotToCeilingCents(s:unknown):string|null{
 if(typeof s!=='string'||!/^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,10})?$/.test(s))
  return null;
 const [whole,fraction='']=s.split('.');
 const low=BigInt(whole)*100n;
 const sub=fraction.slice(0,2).padEnd(2,'0');
 const extra=fraction.slice(2);
 const amount=low+BigInt(sub)+(extra.split('').some(c=>c!=='0')?1n:0n);
 return amount>0n&&amount<100000000n?String(amount):null;
}
export function parseCoinbaseSolUsdProduct(x:unknown):string|null{
 if(!x||typeof x!=='object')return null;
 const r=x as Record<string,unknown>;
 if(r.product_id!=='SOL-USD'||r.trading_disabled===true||r.is_disabled===true)
  return null;
 return usdSpotToCeilingCents(r.price);
}
export function parseKrakenSolUsdTicker(x:unknown):string|null{
 if(!x||typeof x!=='object')return null;
 const r=x as Record<string,unknown>;
 if(!Array.isArray(r.error)||r.error.length!==0||!r.result||
  typeof r.result!=='object')return null;
 const entries=Object.entries(r.result as Record<string,unknown>);
 if(entries.length!==1)return null;
 const [key,ticker]=entries[0];
 if(!['SOLUSD','SOLZUSD','SOLUSD.d'].includes(key)||!ticker||
  typeof ticker!=='object')return null;
 const last=(ticker as Record<string,unknown>).c;
 return Array.isArray(last)?usdSpotToCeilingCents(last[0]):null;
}
export function crossCheckSolUsdPublicQuotes(quotes:EchoSolUsdPublicQuote[],
 nowMs:number):EchoSolUsdCrossCheck{
 if(quotes.length!==2||!Number.isSafeInteger(nowMs))return bad('TWO_SOURCES_REQUIRED');
 const sources=new Set(quotes.map(q=>q.source));
 if(sources.size!==2||!sources.has('coinbase')||!sources.has('kraken'))
  return bad('INDEPENDENT_SOURCES_REQUIRED');
 for(const q of quotes){
  if(!Number.isSafeInteger(q.receivedAtMs)||q.receivedAtMs>nowMs||
     nowMs-q.receivedAtMs>3000||!/^[1-9][0-9]{0,7}$/.test(q.cents))
   return bad('STALE_OR_INVALID_FX_RESPONSE');
 }
 const numbers=quotes.map(q=>BigInt(q.cents));
 const lo=numbers[0]<numbers[1]?numbers[0]:numbers[1];
 const hi=numbers[0]>numbers[1]?numbers[0]:numbers[1];
 if(lo<100n||hi>10000000n)return bad('IMPLAUSIBLE_SOL_USD_PRICE');
 const divergence=(hi-lo)*10000n/lo;
 if(divergence>200n)return bad('FX_SOURCES_DISAGREE');
 return {ok:true,mode:'PUBLIC_SPOT_DIAGNOSTIC_ONLY',
  upperCents:String(hi),lowerCents:String(lo),
  divergenceBps:String(divergence),
  observedAtMs:Math.min(...quotes.map(q=>q.receivedAtMs)),
  signingAllowed:false,broadcastAllowed:false};
}
