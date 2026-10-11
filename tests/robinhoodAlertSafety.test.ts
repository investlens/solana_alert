import test from 'node:test';
import assert from 'node:assert/strict';
import {createRobinhoodAlertSafety} from '../src/services/robinhoodAlertSafety.js';
import {routeBoostSecurity,clearBoostSecurityRouterCacheForTests} from '../src/chains/robinhood/boostSecurityRouter.js';
const token='0x'+'a'.repeat(40);
test('PONS positive alerts bypass security with no stored snapshot or provider availability',async()=>{
 let simulated=0;
 const safety=createRobinhoodAlertSafety({launch:async()=>({launchType:'PONS',token,deployer:null}),gate:args=>routeBoostSecurity(args,async()=>{simulated++;throw Error('must bypass');})});
 const result=await safety(token);
 assert.equal(result.security.allowed,true);assert.equal(result.origin?.launchType,'PONS');assert.equal(simulated,0);
});
test('custom successful exits warn for unlocked and unavailable LP; failed exits remain withheld',async()=>{
 const original=globalThis.fetch;
 try {
  for(const status of ['LOCKED','BURNED','UNLOCKED','UNKNOWN'] as const){
   clearBoostSecurityRouterCacheForTests();
   globalThis.fetch=async()=>new Response(JSON.stringify({result:{[token]:{is_honeypot:'0',cannot_sell_all:'0'}}}));
   const result=await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false},async()=>({allowed:true,lpStatus:status,reason:'Same-wallet exit simulated',observedAt:Date.now()}));
   assert.equal(result.allowed,true);assert.equal(result.liquidity?.status,status);
   assert.equal(result.reason.includes('RISKY ALERT'),status==='UNLOCKED'||status==='UNKNOWN');
  }
  clearBoostSecurityRouterCacheForTests();
  const blocked=await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:false},async()=>({allowed:false,reason:'Sell fails',observedAt:Date.now()}));
  assert.equal(blocked.allowed,false);
 }finally{globalThis.fetch=original;clearBoostSecurityRouterCacheForTests();}
});
