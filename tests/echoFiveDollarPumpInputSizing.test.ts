import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeEchoFiveUsdPumpInput,ECHO_FIVE_USD_SIZING_SIGNING_ENABLED,
 type EchoPumpSizeInput} from '../src/echo/fiveDollarPumpInputSizing.js';
const fixture=(patch:Partial<EchoPumpSizeInput>={}):EchoPumpSizeInput=>({
 solUsdCents:'20000',networkAndPriorityFeeLamports:'5000',
 ataAndOtherAccountRentLamports:'11704320',
 maximumAdditionalCpiDebitLamports:'1000000',
 walletBalanceLamports:'100000000',pendingReservedLamports:'0',
 manualSellReserveLamports:'2000000',freshFxVerified:true,
 completeFeeAndCpiAudit:true,freshWalletBalanceVerified:true,
 manualSellReserveVerified:true,...patch
});
test('build maximum $5 all-in input only with audited fees/rent/CPI, not fixed 0.025 SOL',()=>{
 const r=sizeEchoFiveUsdPumpInput(fixture());
 assert.deepEqual(r,{ok:true,signingAllowed:false,
  inputLamports:'12290680',reservedAllInLamports:'25000000',
  allInCentsCeiling:'500'});
 assert.equal(ECHO_FIVE_USD_SIZING_SIGNING_ENABLED,false);
});
test('unknown CPI, FX, manual SELL reserve or network fee refuses input amount',()=>{
 for(const patch of [
  {completeFeeAndCpiAudit:false},{freshFxVerified:false},
  {manualSellReserveVerified:false},{networkAndPriorityFeeLamports:'0'},
  {maximumAdditionalCpiDebitLamports:'unknown'},
  {manualSellReserveLamports:'0'}
 ])assert.equal(sizeEchoFiveUsdPumpInput(fixture(patch)).ok,false,JSON.stringify(patch));
});
test('higher fees reduce principal and still never exceed $5 all-in',()=>{
 const higher=sizeEchoFiveUsdPumpInput(fixture({
  maximumAdditionalCpiDebitLamports:'3000000'}));
 assert.equal(higher.ok,true);
 if(higher.ok){
  assert.equal(higher.inputLamports,'10290680');
  assert.equal(higher.allInCentsCeiling,'500');
 }
});
test('insufficient wallet after pending orders and SELL fee reserve rejects',()=>{
 const candidate=sizeEchoFiveUsdPumpInput(fixture({
  walletBalanceLamports:'26000000',pendingReservedLamports:'3000000'
 }));
 assert.deepEqual(candidate,{ok:false,
  reason:'WALLET_CANNOT_COVER_FULL_FIVE_DOLLAR_BUY',signingAllowed:false});
});
test('no arbitrary $6 minimum: lower wallet balance can work if exact $5 + SELL reserve fits',()=>{
 const result=sizeEchoFiveUsdPumpInput(fixture({
  walletBalanceLamports:'27000000'
 }));
 assert.equal(result.ok,true);
});
test('price moves recalculate principal, no stale fixed-SOL principal',()=>{
 const result=sizeEchoFiveUsdPumpInput(fixture({solUsdCents:'25000'}));
 assert.equal(result.ok,true);
 if(result.ok){
  assert.equal(result.inputLamports,'7290680');
  assert.equal(result.reservedAllInLamports,'20000000');
  assert.equal(result.allInCentsCeiling,'500');
 }
});
