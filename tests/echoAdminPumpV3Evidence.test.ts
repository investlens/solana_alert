import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPumpV3Evidence} from '../src/echo/adminPumpV3Evidence.js';
import {PUMP_CURVE_PROGRAM} from '../src/echo/adminPumpVenue.js';
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='A'.repeat(44);
const accounts=Array.from({length:17},(_,i)=>'account'+i);
accounts[1]=mint;accounts[2]='So11111111111111111111111111111111111111112';accounts[8]=caller;
const data=new Uint8Array(25);data.set([7,5,29,196,245,23,101,80]);data[8]=1;data[16]=1;
const token=(amount:string)=>[{accountIndex:9,mint,owner:caller,uiTokenAmount:{amount}}];
const base={instruction:{programId:PUMP_CURVE_PROGRAM,data,accounts,
 callerWallet:caller,targetMint:mint,signerAccounts:[caller]},
 preTokenBalances:token('0'),postTokenBalances:token('1000'),
 finalized:true,transactionSucceeded:true,trustedRpc:true};
describe('Echo Pump v3 evidence inspection',()=>{
 it('identifies candidate receipts without certifying BUY',()=>{
  const r=inspectPumpV3Evidence(base);
  assert.equal(r.candidate,true);assert.equal(r.receivedTokens,1000n);
  assert.equal(r.verifiedBuy,false);
 });
 it('rejects failed transaction, wrong mint and no receipt',()=>{
  for(const patch of [{transactionSucceeded:false},{trustedRpc:false},
   {postTokenBalances:token('0')},{instruction:{...base.instruction,targetMint:'B'.repeat(44)}}]){
   const r=inspectPumpV3Evidence({...base,...patch});
   assert.equal(r.candidate,false);assert.equal(r.verifiedBuy,false);
  }
 });
});
