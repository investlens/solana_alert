import test from 'node:test';
import assert from 'node:assert/strict';
import {interpretEchoPilotReservationReply} from '../src/echo/supabaseAtomicPilotStore.js';
const w='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const m='So11111111111111111111111111111111111111112';
test('atomic RPC response admits only RESERVED',()=>{
 assert.deepEqual(interpretEchoPilotReservationReply('RESERVED',null,w,m),
  {reserved:true,key:w+':'+m});
 for(const reason of ['DUPLICATE_TOKEN','TWO_SLOTS_FULL','DAILY_LIMIT'] as const)
  assert.deepEqual(interpretEchoPilotReservationReply(reason,null,w,m),{reserved:false,reason});
});
test('unknown, missing, invalid and RPC errors fail closed',()=>{
 for(const data of ['INVALID_REQUEST','UNKNOWN','reserved',null,{status:'RESERVED'}])
  assert.deepEqual(interpretEchoPilotReservationReply(data,null,w,m),
   {reserved:false,reason:'DATABASE_UNAVAILABLE'});
 assert.deepEqual(interpretEchoPilotReservationReply('RESERVED',{message:'db outage'},w,m),
  {reserved:false,reason:'DATABASE_UNAVAILABLE'});
});
