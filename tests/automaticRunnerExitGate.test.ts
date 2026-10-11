import test from 'node:test';import assert from 'node:assert/strict';
import {createRunnerExitGate} from '../src/services/automaticRunnerExitGate.js';
const token='0x'+'a'.repeat(40),pair='0x'+'b'.repeat(64);
test('factory-verified PONS runner never invokes custom exit checks',async()=>{
 let checks=0;const gate=createRunnerExitGate({launch:async()=>({launchType:'PONS',token,deployer:null}),exit:async()=>{checks++;throw Error('PONS must bypass');}});
 assert.equal((await gate({chain:'robinhood',token,pair_id:pair})).allowed,true);assert.equal(checks,0);
});
test('unverified provenance cannot use PONS label to bypass exact runner pool checking',async()=>{
 let seen:unknown;const gate=createRunnerExitGate({launch:async()=>null,exit:async request=>{seen=request;return {allowed:false,reason:'Exit loss',observedAt:Date.now()};}});
 assert.equal((await gate({chain:'robinhood',token,pair_id:pair})).allowed,false);assert.deepEqual(seen,{chain:'robinhood',token,pairId:pair});
});
