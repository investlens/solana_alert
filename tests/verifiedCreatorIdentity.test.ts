import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCreatorIdentity } from '../src/services/verifiedCreatorIdentity.js';
const token='0x1234567890abcdef1234567890abcdef12345678';
const creator='0xabcdef1234567890abcdef1234567890abcdef12';
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
