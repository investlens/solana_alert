import test from 'node:test';
import assert from 'node:assert/strict';
import {usdSpotToCeilingCents,parseCoinbaseSolUsdProduct,
 parseKrakenSolUsdTicker,crossCheckSolUsdPublicQuotes,
 ECHO_PUBLIC_FX_CAN_SIGN,ECHO_PUBLIC_FX_CAN_BROADCAST
} from '../src/echo/solUsdIndependentPrice.js';
const now=1800000000000;
test('fractional spot USD prices round UP, never understate $5 debit',()=>{
 assert.equal(usdSpotToCeilingCents('199.001'),'19901');
 assert.equal(usdSpotToCeilingCents('199.000'),'19900');
 assert.equal(usdSpotToCeilingCents('200.999999'),'20100');
 for(const value of ['1e3','-5','NaN','12x','0','01.00','200.12345678901',199.2])
  assert.equal(usdSpotToCeilingCents(value),null,String(value));
});
test('reject wrong pair, halted Coinbase and malformed Kraken ticker',()=>{
 assert.equal(parseCoinbaseSolUsdProduct({product_id:'SOL-USD',price:'201.0105'}),'20102');
 assert.equal(parseCoinbaseSolUsdProduct({product_id:'BTC-USD',price:'201.01'}),null);
 assert.equal(parseCoinbaseSolUsdProduct({product_id:'SOL-USD',price:'201.01',trading_disabled:true}),null);
 assert.equal(parseKrakenSolUsdTicker({error:[],result:{SOLUSD:{c:['200.505','1']}}}),'20051');
 assert.equal(parseKrakenSolUsdTicker({error:['bad'],result:{SOLUSD:{c:['200.50']}}}),null);
 assert.equal(parseKrakenSolUsdTicker({error:[],result:{XXBTZUSD:{c:['200.50']}}}),null);
});
test('two independent recent quotes choose conservative upper USD, never trade',()=>{
 const r=crossCheckSolUsdPublicQuotes([
  {source:'coinbase',cents:'20001',receivedAtMs:now-30},
  {source:'kraken',cents:'20102',receivedAtMs:now-50}
 ],now);
 assert.deepEqual(r,{ok:true,mode:'PUBLIC_SPOT_DIAGNOSTIC_ONLY',
  upperCents:'20102',lowerCents:'20001',divergenceBps:'50',
  observedAtMs:now-50,signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_PUBLIC_FX_CAN_SIGN,false);
 assert.equal(ECHO_PUBLIC_FX_CAN_BROADCAST,false);
});
test('missing, stale, duplicate or diverging quotes fail closed',()=>{
 const good=[
  {source:'coinbase' as const,cents:'20000',receivedAtMs:now},
  {source:'kraken' as const,cents:'20000',receivedAtMs:now}
 ];
 for(const q of [
  good.slice(0,1),
  [good[0],good[0]],
  [good[0],{...good[1],receivedAtMs:now-3001}],
  [good[0],{...good[1],receivedAtMs:now+1}],
  [good[0],{...good[1],cents:'22000'}],
  [good[0],{...good[1],cents:'0'}]
 ]){
  const r=crossCheckSolUsdPublicQuotes(q,now);
  assert.equal(r.ok,false,JSON.stringify(q));
 }
});
