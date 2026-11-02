import test from 'node:test';
import assert from 'node:assert/strict';
import type {SupabaseClient} from '@supabase/supabase-js';
import {claimEchoSignedBuyOnce,ECHO_SUPABASE_ONE_SHOT_SUBMISSION_ENABLED}
 from '../src/echo/supabaseOneShotBuyClaim.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump';
test('unverified signer, wrong wallet, and missing blockheight never call DB or broadcast',async()=>{
 const called:string[]=[];
 const client={rpc:async(name:string)=>{
  called.push(name);return {data:'CLAIMED',error:null};
 }} as unknown as SupabaseClient;
 const args={client,executionWallet:wallet,mint,signedTransactionBase64:'invalid',
  approvedMessageSha256:'a'.repeat(64),lastValidBlockHeight:500};
 const cases=[
  {...args,executionWallet:'5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'},
  {...args,mint:'not-a-solana-token'},
  {...args,lastValidBlockHeight:0},
  {...args}
 ];
 for(const c of cases){
  const r=await claimEchoSignedBuyOnce(c);
  assert.equal(r.claimed,false);
  assert.equal(r.broadcastAllowed,false);
 }
 assert.deepEqual(called,[]);
 assert.equal(ECHO_SUPABASE_ONE_SHOT_SUBMISSION_ENABLED,false);
});
