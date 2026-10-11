import test from 'node:test';import assert from 'node:assert/strict';
import {getIndexedVerifiedPonsLaunch,resetIndexedPonsCacheForTests} from '../src/chains/robinhood/ponsLaunchState.js';
import {supabase} from '../src/services/supabase.js';
const token='0xf0c0fc281314a48ae4e52a9db08731cb6a38ca25',factory='0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
test('simultaneous provenance reads share one indexed query and reuse confirmed origin',async()=>{
 resetIndexedPonsCacheForTests();const original=supabase.from;let requests=0,like=0;
 const builder={select:()=>builder,eq:()=>builder,in:()=>builder,order:()=>builder,ilike:()=>{like++;return builder;},limit:()=>builder,abortSignal:()=>builder,maybeSingle:async()=>{requests++;return {data:{token_address:token,factory_address:factory,deployer_address:null},error:null};}};
 supabase.from=(()=>builder) as unknown as typeof original;
 try{const rows=await Promise.all([getIndexedVerifiedPonsLaunch(token),getIndexedVerifiedPonsLaunch(token)]);assert.ok(rows.every(r=>r?.exists));await getIndexedVerifiedPonsLaunch(token);assert.equal(requests,1);assert.equal(like,0);}
 finally{supabase.from=original;resetIndexedPonsCacheForTests();}
});
test('noncanonical historical casing keeps the compatibility lookup; failure never becomes verified',async()=>{
 const original=supabase.from;let requests=0;
 const builder={select:()=>builder,eq:()=>builder,in:()=>builder,order:()=>builder,ilike:()=>builder,limit:()=>builder,abortSignal:()=>builder,maybeSingle:async()=>({data:++requests===1?null:{token_address:token,factory_address:factory},error:null})};
 supabase.from=(()=>builder) as unknown as typeof original;
 try{assert.equal((await getIndexedVerifiedPonsLaunch(token))?.exists,true);assert.equal(requests,2);resetIndexedPonsCacheForTests();builder.maybeSingle=async()=>({data:null,error:new Error('timeout')}) as any;assert.equal(await getIndexedVerifiedPonsLaunch(token),null);}
 finally{supabase.from=original;resetIndexedPonsCacheForTests();}
});
