import test from 'node:test';import assert from 'node:assert/strict';import {createArcRunnerExitGate} from '../src/services/automaticRunnerExitGate.js';
test('ARC winners use fresh exact-pool evidence and preserve LP warning',async()=>{
 let seen:unknown[]=[];const gate=createArcRunnerExitGate(async()=>({allowed:true,reason:'flags'}),async(...args)=>{seen=args;return {allowed:true,reason:'Receipt-backed sells; full exit unverified; LIQUIDITY PROTECTION UNVERIFIED',lpStatus:'UNKNOWN',observedAt:1};});
 const result=await gate({chain:'arc',token:'token',pair_id:'pool'});assert.equal(seen[5],'pool');assert.equal(result.allowed,true);assert.equal(result.pairId,'pool');assert.match(result.reason,/full exit unverified/);assert.equal(result.lpStatus,'UNKNOWN');
});
test('ARC winner is withheld when fresh evidence is blocked',async()=>{
 const gate=createArcRunnerExitGate(async()=>({allowed:false,reason:'honeypot'}),async()=>({allowed:false,reason:'honeypot'}));assert.equal((await gate({chain:'arc',token:'token',pair_id:'pool'})).allowed,false);
});
