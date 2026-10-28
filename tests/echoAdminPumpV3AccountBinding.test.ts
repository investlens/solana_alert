import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {inspectPumpV3Buy} from '../src/echo/adminPumpV3AccountBinding.js';
import {PUMP_CURVE_PROGRAM} from '../src/echo/adminPumpVenue.js';
const caller='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='A'.repeat(44);
const accounts=Array.from({length:17},(_,i)=>'placeholder'+i);
accounts[1]=mint;accounts[2]='So11111111111111111111111111111111111111112';accounts[8]=caller;
const data=new Uint8Array(25);data.set([7,5,29,196,245,23,101,80]);data[8]=1;data[16]=1;
const base={programId:PUMP_CURVE_PROGRAM,data,accounts,callerWallet:caller,
 targetMint:mint,signerAccounts:[caller]};
describe('Echo Pump buy_v3 account binding',()=>{
 it('matches only SOL-quoted v3 signer/mint envelope, never authorizes trade',()=>{
  const r=inspectPumpV3Buy(base);
  assert.equal(r.matched,true);assert.equal(r.verifiedBuy,false);
 });
 it('rejects mismatched mint, signer, quote and layout',()=>{
  for(const patch of [{targetMint:'B'.repeat(44)},
   {signerAccounts:[]},{accounts:[...accounts.slice(0,16)]},
   {accounts:accounts.map((x,i)=>i===2?'C'.repeat(44):x)}]){
   assert.equal(inspectPumpV3Buy({...base,...patch}).matched,false);
  }
 });
});
