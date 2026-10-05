import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreatorIdentity, creatorFromVerifiedPonsMarker, resolvePonsCreatorFromSources } from '../src/services/verifiedCreatorIdentity.js';
import {PONS_CONTRACTS} from '../src/chains/robinhood/ponsContracts.js';
const token='0x1234567890abcdef1234567890abcdef12345678';
const creator='0xabcdef1234567890abcdef1234567890abcdef12';
test('verified launch marker skips index and incompatible legacy factory reads',async()=>{
 const result=await resolvePonsCreatorFromSources(token,{marker:async()=>({token,creator,factory:PONS_CONTRACTS.factory}),indexed:async()=>{throw Error('must not run');},factory:async()=>{throw Error('must not run');}});
 assert.equal(result?.deployer,creator);
 for(const marker of [{token:creator,creator,factory:PONS_CONTRACTS.factory},{token,creator,factory:creator},{token,creator:'0x'+'0'.repeat(40),factory:PONS_CONTRACTS.factory},{creator,factory:PONS_CONTRACTS.factory}])assert.equal(creatorFromVerifiedPonsMarker(token,marker),null);
});
test('indexed V2 creator works without legacy factory and wrong-token index falls back',async()=>{
 let factoryCalls=0;
 const sources={marker:async()=>null,indexed:async()=>({exists:true,token,deployer:creator}),factory:async()=>{factoryCalls++;return null;}};
 assert.equal((await resolvePonsCreatorFromSources(token,sources))?.deployer,creator);assert.equal(factoryCalls,0);
 assert.equal(await resolvePonsCreatorFromSources(token,{...sources,indexed:async()=>({exists:true,token:creator,deployer:creator})}),null);assert.equal(factoryCalls,1);
});
test('verified matching factory creator does not need unavailable explorer history',async()=>{
 let history=0;const value=await resolveCreatorIdentity(token,null,{factory:async()=>({exists:true,token:token.toUpperCase(),deployer:creator}),history:async()=>{history++;return null;}});
 assert.equal(value,creator);assert.equal(history,0);
});
test('unrelated, missing or zero factory identities cannot manufacture creator holdings',async()=>{
 for(const launch of [{exists:false,token,deployer:creator},{exists:true,token:creator,deployer:creator},{exists:true,token,deployer:'0x'+'0'.repeat(40)}])assert.equal(await resolveCreatorIdentity(token,null,{factory:async()=>launch,history:async()=>null}),null);
});
test('known creator avoids new reads; failed factory can use existing history',async()=>{
 assert.equal(await resolveCreatorIdentity(token,creator,{factory:async()=>{throw Error('should not run');},history:async()=>{throw Error('should not run');}}),creator);
 assert.equal(await resolveCreatorIdentity(token,null,{factory:async()=>{throw Error('provider');},history:async()=>creator}),creator);
});
