import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {createPrebondResearchStore} from '../src/services/prebondResearchStore.js';
import {currentDatabaseWorkClass} from '../src/services/databaseLoadGovernor.js';
import {currentRequestSignal,withRequestDeadline} from '../src/services/requestDeadline.js';
import {getPonsFactoryDeployments} from '../src/chains/robinhood/ponsContracts.js';
const token='0x'+'1'.repeat(40),curve='0x'+'2'.repeat(40);
const row={token_address:token,curve_address:curve,factory_address:getPonsFactoryDeployments().find(f=>f.id==='v2-current')!.address.toLowerCase(),protocol_version:'v2-current',protocol:'pons'};
function harness(reply:(url:URL,init:RequestInit)=>Promise<Response>,deadline=1000){
 const calls:URL[]=[];
 const client=createClient('https://research.invalid','test-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(input,init)=>{
  assert.equal(currentDatabaseWorkClass(),'BACKGROUND','lazy builder executes in the background lane');
  assert.ok(currentRequestSignal());assert.equal(init?.signal,currentRequestSignal());
  const url=new URL(String(input));calls.push(url);return reply(url,init!);
 }}});
 return {store:createPrebondResearchStore(client,getPonsFactoryDeployments,deadline),calls};
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
test('research lookup is exact, indexed-shaped and bounded; no latest-launch sort or census download',async()=>{
 const h=harness(async()=>json([row]));
 assert.deepEqual(await h.store.lookup(token.toUpperCase().replace('0X','0x')),{token_address:token,curve_address:curve,factory_address:row.factory_address,protocol_version:'v2-current'});
 const u=h.calls[0];assert.equal(u.pathname,'/rest/v1/pons_launches');
 assert.equal(u.searchParams.get('token_address'),'eq.'+token);assert.equal(u.searchParams.get('chain'),'eq.robinhood');
 assert.equal(u.searchParams.get('protocol'),'eq.pons');assert.equal(u.searchParams.get('limit'),'2');assert.equal(u.searchParams.has('order'),false);
 assert.equal(h.calls.length,1);assert.equal(currentDatabaseWorkClass(),undefined);assert.equal(currentRequestSignal(),undefined);
});
test('missing, ambiguous, mismatched and unverified launch evidence cannot admit a quote',async()=>{
 for(const rows of [[],[row,row],[{...row,protocol:'other'}],[{...row,token_address:curve}],[{...row,curve_address:token}],[{...row,curve_address:'bad'}],[{...row,factory_address:curve}],[{...row,protocol_version:'v1-active'}]]){
  const h=harness(async()=>json(rows));assert.equal(await h.store.lookup(token),null);assert.equal(h.calls.length,1);
 }
 const invalid=harness(async()=>{throw Error('unexpected request');});assert.equal(await invalid.store.lookup('bad'),null);assert.equal(invalid.calls.length,0);
});
test('database errors fail closed once, without retries or partial evidence',async()=>{
 const h=harness(async()=>json({message:'unavailable',code:'503'},503));
 await assert.rejects(h.store.lookup(token),/RESEARCH_DATABASE_UNAVAILABLE/);assert.equal(h.calls.length,1);
});
test('deadline cancels transport and rejects a late response even if transport ignores cancellation',async()=>{
 let signal:AbortSignal|undefined,complete!:(r:Response)=>void;
 const h=harness(async(_url,init)=>{signal=init.signal!;return new Promise(resolve=>{complete=resolve;});},20);
 await assert.rejects(h.store.lookup(token),/deadline exceeded/);assert.equal(signal?.aborted,true);
 complete(json([row]));await new Promise(r=>setImmediate(r));assert.equal(h.calls.length,1);
 assert.equal(currentRequestSignal(),undefined);
});
test('inherited expired operations cannot start a research database call',async()=>{
 const h=harness(async()=>json([row]));
 await assert.rejects(withRequestDeadline(5,async()=>{
  await new Promise(r=>setTimeout(r,15));await h.store.lookup(token);
 }),/deadline exceeded/);
 await new Promise(r=>setTimeout(r,20));assert.equal(h.calls.length,0);
});
test('registration, lease and finish use only the isolated research RPCs under the same deadline and lane',async()=>{
 const h=harness(async(url)=>json(url.pathname.endsWith('alpha_claim_prebond_research')?[]:'REGISTERED'));
 assert.equal(await h.store.register({event_identity:'event'}),'REGISTERED');assert.deepEqual(await h.store.claim(),[]);
 assert.equal(await h.store.finish('event','lease',{status:'UNAVAILABLE',price:null,block:null,block_hash:null,at:new Date().toISOString(),reason:'PROVIDER_UNAVAILABLE'}),'REGISTERED');
 assert.deepEqual(h.calls.map(u=>u.pathname),['/rest/v1/rpc/alpha_register_prebond_research','/rest/v1/rpc/alpha_claim_prebond_research','/rest/v1/rpc/alpha_finish_prebond_research']);
});
