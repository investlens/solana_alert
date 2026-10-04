import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFlapOriginVerifier, FLAP_ROBINHOOD_PORTAL } from '../src/chains/robinhood/flapLaunchState.js';
import { routeBoostSecurity } from '../src/chains/robinhood/boostSecurityRouter.js';
import { evaluatePositiveAlertSecurity, labelLaunchType } from '../src/security/positiveAlertSecurity.js';
import { createDexPaidEventGate } from '../src/chains/robinhood/security/dexPaidAlertSafetyGate.js';
const token='0x1111111111111111111111111111111111111111';
test('Flap proof allows real curve/DEX state but never invalid, staged, killed or obsolete states', async()=>{
  assert.equal(FLAP_ROBINHOOD_PORTAL,'0x26605f322f7ff986f381bb9a6e3f5dab0beaeb09');
  for(const status of [0,1,2,3,4,5,99])assert.equal(await createFlapOriginVerifier(async()=>status)(token),status===1||status===4);
  assert.equal(await createFlapOriginVerifier(async()=>{throw Error('RPC down');})(token),false);
  assert.equal(await createFlapOriginVerifier(async()=>1)('FLAP'),false);
});
test('Flap verification is coalesced and cached, not a new global indexer',async()=>{
  let calls=0,now=1000;
  const verify=createFlapOriginVerifier(async()=>{calls++;return 1;},()=>now);
  assert.deepEqual(await Promise.all([verify(token),verify(token)]),[true,true]);assert.equal(calls,1);
  await verify(token);assert.equal(calls,1);now+=300001;await verify(token);assert.equal(calls,2);
});
test('verified Flap boost and positive alerts skip separate security providers and disclose origin',async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=(async()=>{throw Error('No security HTTP allowed');}) as typeof fetch;
  try {
    const boost=await routeBoostSecurity({tokenAddress:token,verifiedTrustedLaunchpad:true,requireExplicitSellability:true});
    assert.equal(boost.allowed,true);assert.equal(boost.route,'TRUSTED_LAUNCHPAD');assert.equal(boost.liquidity,null);
    const positive=evaluatePositiveAlertSecurity({launchType:'FLAP',raw:{}});
    assert.equal(positive.allowed,true);assert.equal(positive.liquidityVerified,false);
    assert.match(labelLaunchType('Alert\nStats','FLAP'),/Launch: <b>FLAP<\/b>/);
  }finally{globalThis.fetch=prior;}
});
test('fresh verified Flap DEX payment skips custom checks but freshness and exact-token matching remain',async()=>{
  const now=Date.now();let calls=0;
  const paid={tokenAddress:token,dexPaid:true,status:'PAID' as const,orderTypes:['tokenProfile'],orderStatuses:['approved'],latestPaymentTimestamp:now-1000,warnings:[],scannedAt:now};
  const deps={paid:async()=>paid,launch:async()=>({exists:true,token,deployer:null,launchType:'FLAP' as const}),
    custom:async()=>{calls++;return {allowed:false,route:'CUSTOM_SECURITY_REQUIRED' as const,liquidity:null,reason:'unknown',cached:false};},now:()=>now};
  const result=await createDexPaidEventGate(deps)(token);
  assert.equal(result.allowed,true);assert.equal(result.launchType,'FLAP');assert.equal(calls,0);
  assert.equal((await createDexPaidEventGate({...deps,paid:async()=>({...paid,latestPaymentTimestamp:now-601000})})(token)).allowed,false);
  assert.equal((await createDexPaidEventGate({...deps,launch:async()=>({...await deps.launch(),token:'0x2222222222222222222222222222222222222222'})})(token)).allowed,false);
  assert.equal(calls,1);
});
test('observer, delivery and general positive gate share the approved-launchpad resolver',async()=>{
  for(const path of ['src/chains/robinhood/robinhoodBoostObserver.ts','src/services/alphaSemanticDeliveryService.ts','src/chains/robinhood/launchSecurity.ts','src/chains/robinhood/security/dexPaidAlertSafetyGate.ts'])
    assert.ok((await readFile(path,'utf8')).includes('getVerifiedRobinhoodLaunchpad'));
});
