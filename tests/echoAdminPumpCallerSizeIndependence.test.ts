import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPumpV3Buy} from '../src/echo/adminPumpV3AccountBinding.js';
import {PUMP_CURVE_PROGRAM} from '../src/echo/adminPumpVenue.js';
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='A'.repeat(44);
describe('Echo caller sizing independent from pilot execution sizing',()=>{
 it('observes a large caller buy without authorizing an execution',()=>{
  const accounts=Array.from({length:17},(_,i)=>'account'+i);
  accounts[1]=mint;accounts[2]='So11111111111111111111111111111111111111112';accounts[8]=caller;
  const data=new Uint8Array(25);data.set([7,5,29,196,245,23,101,80]);
  data[8]=1;
  // 2 SOL quote cap, larger than our independent 0.1 SOL pilot cap.
  const value=2000000000n;
  for(let i=0;i<8;i++)data[16+i]=Number((value>>(BigInt(i)*8n))&255n);
  const result=inspectPumpV3Buy({programId:PUMP_CURVE_PROGRAM,data,accounts,
   callerWallet:caller,targetMint:mint,signerAccounts:[caller]});
  assert.equal(result.matched,true);
  assert.equal(result.verifiedBuy,false);
 });
});
