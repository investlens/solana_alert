import test from 'node:test';
import assert from 'node:assert/strict';
import {routeBoostSecurity,clearBoostSecurityRouterCacheForTests} from '../src/chains/robinhood/boostSecurityRouter.js';
import {readFileSync} from 'node:fs';
test('BOOST withholds custom alerts without verified execution, including provider timeouts',async()=>{
 const original=globalThis.fetch,token='0x'+'a'.repeat(40);
 try {
  for(const [flags,allowed] of [[{},false],[{is_honeypot:'0'},false],[{is_honeypot:'0',cannot_sell_all:'0'},false],[{is_honeypot:'1'},false],[{cannot_sell_all:'1'},false]] as const){
   clearBoostSecurityRouterCacheForTests();
   globalThis.fetch=async()=>new Response(JSON.stringify({result:{[token]:flags}}));
   const result=await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false,requireExplicitSellability:true,allowUnknownSellability:true});
   assert.equal(result.allowed,allowed);
   if(allowed) assert.match(result.reason,/unverified/i);
  }
  clearBoostSecurityRouterCacheForTests();globalThis.fetch=async()=>{throw Error('timeout');};
  const result=await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false,requireExplicitSellability:true,allowUnknownSellability:true});
  assert.equal(result.allowed,false);assert.equal(result.sellabilityVerified,false);assert.match(result.reason,/Exit unverified/);
  const source=readFileSync(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts',import.meta.url),'utf8');
  assert.match(source,/verifiedTrustedLaunchpad: origin !== null, requireExplicitSellability: true, allowUnknownSellability: true/);
  const deliverySource=readFileSync(new URL('../src/services/alphaSemanticDeliveryService.ts',import.meta.url),'utf8');
  assert.match(deliverySource,/verifiedTrustedLaunchpad:trusted, requireExplicitSellability:true, allowUnknownSellability:true/,
    'The delivery gate must preserve the observer warning policy; confirmed honeypots still block');
 }finally{globalThis.fetch=original;clearBoostSecurityRouterCacheForTests();}
});
