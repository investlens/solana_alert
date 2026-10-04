import test from 'node:test';
import assert from 'node:assert/strict';
import {createDexPaidEventGate} from '../src/chains/robinhood/security/dexPaidAlertSafetyGate.js';
import {routeBoostSecurity,clearBoostSecurityRouterCacheForTests} from '../src/chains/robinhood/boostSecurityRouter.js';
const token='0x'+'a'.repeat(40),now=Date.now();
const paid={tokenAddress:token,dexPaid:true,status:'PAID' as const,orderTypes:['tokenProfile'],orderStatuses:['approved'],latestPaymentTimestamp:now-1000,warnings:[],scannedAt:now};
test('verified PONS payment alerts without market, age, holder or developer entry gates',async()=>{
 let customCalls=0;
 const gate=createDexPaidEventGate({paid:async()=>paid,launch:async()=>({exists:true,token,deployer:token}),
  custom:async()=>{customCalls++;throw Error('No separate PONS honeypot check');},now:()=>now});
 const result=await gate(token);
 assert.equal(result.allowed,true);assert.equal(result.launchType,'PONS');assert.equal(customCalls,0);
 assert.deepEqual(result.checks.map(c=>c.key),['DEX_PAID_CONFIRMED','PAYMENT_FRESHNESS','TRUSTED_LAUNCHPAD']);
 assert.equal(result.marketCapUsd,null);
});
test('unknown provenance does not override custom security; stale payments stop before security lookups',async()=>{
 let calls=0;
 const deps={paid:async()=>paid,launch:async()=>null,custom:async()=>{calls++;return {allowed:false,route:'CUSTOM_SECURITY_REQUIRED' as const,liquidity:null,reason:'sellability unavailable',cached:false};},now:()=>now};
 assert.equal((await createDexPaidEventGate(deps)(token)).allowed,false);assert.equal(calls,1);
 const stale=await createDexPaidEventGate({...deps,paid:async()=>({...paid,latestPaymentTimestamp:now-601000})})(token);
 assert.equal(stale.allowed,false);assert.deepEqual(stale.reasons,['PAYMENT_OUTSIDE_WINDOW']);assert.equal(calls,1);
});
test('custom event route requires explicit negative honeypot and sell restriction flags',async()=>{
 const prior=globalThis.fetch;
 try {
  for(const [flags,allowed] of [[{},false],[{is_honeypot:'0',cannot_sell_all:'0'},true],[{is_honeypot:'1',cannot_sell_all:'0'},false]] as const){
   clearBoostSecurityRouterCacheForTests();
   globalThis.fetch=(async()=>new Response(JSON.stringify({result:{[token]:{...flags,lp_holders:[{address:'0x000000000000000000000000000000000000dead',percent:'1'}]}}}),{status:200})) as typeof fetch;
   assert.equal((await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false,requireExplicitSellability:true})).allowed,allowed);
  }
 }finally{globalThis.fetch=prior;clearBoostSecurityRouterCacheForTests();}
});
