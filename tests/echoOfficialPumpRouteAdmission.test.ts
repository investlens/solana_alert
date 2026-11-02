import test from 'node:test';
import assert from 'node:assert/strict';
import {screenOfficialPumpRoute,ECHO_PUMP_WSOL,ECHO_OFFICIAL_ROUTE_SIGNING_ENABLED}
 from '../src/echo/officialPumpRouteAdmission.js';
const quote='qhbbjGBKJxW3AZGqngWM5tHcrENR3pVoRB9MCf1pump';
const target='D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
const pool1='JBsGNXRZQr9ZPc5PAn3seDE7At6ELq9LjVDCujgLKaq8';
const pool2='1'.repeat(32);
const second={baseMint:target,quoteMint:quote,poolAddress:pool1,
 verifiedFromChain:true,canonicalPumpPool:true,mayhemMode:false};
const first={baseMint:quote,quoteMint:ECHO_PUMP_WSOL,poolAddress:pool2,
 verifiedFromChain:true,canonicalPumpPool:true,mayhemMode:false};
test('token-quoted PumpSwap pool rejects direct SOL single hop',()=>{
 assert.deepEqual(screenOfficialPumpRoute(target,[second]),
  {ok:false,reason:'DISCONTINUOUS_OR_CYCLIC_ROUTE',executable:false});
 assert.equal(ECHO_OFFICIAL_ROUTE_SIGNING_ENABLED,false);
});
test('a verified, chained SOL to intermediate to target route is preview only',()=>{
 assert.deepEqual(screenOfficialPumpRoute(target,[first,second]),
  {ok:true,route:'MULTI_HOP_SOL',hops:2,executable:false});
});
test('reject forged, disjoint, mayhem and noncanonical route hops',()=>{
 for(const broken of [
  {...first,verifiedFromChain:false},
  {...first,canonicalPumpPool:false},
  {...first,mayhemMode:true},
  {...first,baseMint:target},
  {...first,quoteMint:target},
 ]){
  const result=screenOfficialPumpRoute(target,[broken,second]);
  assert.equal(result.ok,false);
 }
 assert.equal(screenOfficialPumpRoute(target,[first]).ok,false);
 assert.equal(screenOfficialPumpRoute(target,[first,first,second]).ok,false);
});
