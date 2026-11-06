import test from 'node:test';
import assert from 'node:assert/strict';
import {screenEchoFiveDollarCall,ECHO_FIVE_DOLLAR_CALL_BROADCAST_ENABLED,
 type EchoFiveDollarCall} from '../src/echo/fiveDollarCallPolicy.js';
import {SLINGOOR_WALLET,CHAIRMAN_WALLET} from '../src/echo/liveBuyPolicy.js';
const w='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111113';
const a='2'.repeat(64),b='3'.repeat(64);
function candidate(overrides:Partial<EchoFiveDollarCall>={}):EchoFiveDollarCall {
 return {executionWallet:w,callerWallet:SLINGOOR_WALLET,mint,sourceSignature:a,
 side:'BUY',verifiedCallerSigner:true,verifiedSwap:true,verifiedSpend:true,
 verifiedTokenCredit:true,isTransferOrGift:false,marketCapUsd:50000,
 callerPriceSolPerToken:0.000001,buyPriceSolPerToken:0.0000014,
 maxSlippageBps:1000,nowMs:1800000000000,observedAtMs:1800000000000,
 marketCapObservedAtMs:1800000000000,balanceVerifiedAtMs:1800000000000,
 solUsdObservedAtMs:1800000000000,
 principalLamports:'20000000',networkAndPriorityFeeLamports:'50000',
 accountRentLamports:'2000000',additionalCpiDebitLamports:'100000',
 sellReserveLamports:'2000000',pendingWalletDebitLamports:'0',
 availableWalletLamports:'100000000',solUsdPriceCents:'20000',
 exactMessageAndCpiAudited:true,manualSellRouteAndReserveVerified:true,
 walletBalanceAndFxVerified:true,durableReservationAvailable:true,
 killSwitch:false,openOrPendingLots:0,sourceTransactionAlreadyReserved:false,
 ...overrides};
}
test('distinct source transactions permit two buys of same mint while broadcast remains off',()=>{
 const first=screenEchoFiveDollarCall(candidate());
 const second=screenEchoFiveDollarCall(candidate({sourceSignature:b,callerWallet:CHAIRMAN_WALLET,openOrPendingLots:1}));
 assert.equal(first.eligible,true);
 assert.equal(second.eligible,true);
 if(first.eligible&&second.eligible){
  assert.notEqual(first.intentKey,second.intentKey);
  assert.equal(first.allInCents,'443');
  assert.equal(second.allInCents,'443');
  assert.equal(first.executable,false);
 }
 assert.equal(ECHO_FIVE_DOLLAR_CALL_BROADCAST_ENABLED,false);
});
test('same on-chain call replay cannot reserve again even when Telegram redelivers',()=>{
 const result=screenEchoFiveDollarCall(candidate({sourceTransactionAlreadyReserved:true}));
 assert.deepEqual(result,{eligible:false,executable:false,reason:'DUPLICATE_SOURCE_TRANSACTION'});
});
test('multiple open lots and repeat same-token calls remain eligible with fresh funding',()=>{
 for(const n of [2,3,10]){
  const result=screenEchoFiveDollarCall(candidate({openOrPendingLots:n,sourceSignature:b}));
  assert.equal(result.eligible,true,'new source call at '+n+' active lots');
 }
 const invalid=screenEchoFiveDollarCall(candidate({openOrPendingLots:-1}));
 assert.deepEqual(invalid,{eligible:false,executable:false,reason:'INVALID_OPEN_LOT_COUNT'});
});
test('the token market-cap ceiling is inclusive at $500,000',()=>{
 assert.equal(screenEchoFiveDollarCall(candidate({marketCapUsd:499999})).eligible,true);
 assert.equal(screenEchoFiveDollarCall(candidate({marketCapUsd:500000})).eligible,true);
 assert.deepEqual(screenEchoFiveDollarCall(candidate({marketCapUsd:500000.01})),
  {eligible:false,executable:false,reason:'MARKET_CAP_NOT_ELIGIBLE'});
 assert.equal(screenEchoFiveDollarCall(candidate({marketCapUsd:500001})).eligible,false);
});
test('all-in debit including fees, rent and CPI must remain <= $5, no lifetime cap',()=>{
 const atCap=screenEchoFiveDollarCall(candidate({
  principalLamports:'22000000',networkAndPriorityFeeLamports:'50000',
  accountRentLamports:'2000000',additionalCpiDebitLamports:'950000'
 }));
 assert.equal(atCap.eligible,true);
 const tooMuch=screenEchoFiveDollarCall(candidate({additionalCpiDebitLamports:'4000000'}));
 assert.deepEqual(tooMuch,{eligible:false,executable:false,reason:'FIVE_DOLLAR_ALL_IN_CAP'});
});
test('unverified economic inputs, missing balance, unknown manual exit fail closed',()=>{
 const cases:Partial<EchoFiveDollarCall>[]=[
  {exactMessageAndCpiAudited:false},{manualSellRouteAndReserveVerified:false},
  {walletBalanceAndFxVerified:false},{durableReservationAvailable:false},
  {availableWalletLamports:'0'},{additionalCpiDebitLamports:'not verified'},
  {sellReserveLamports:'0'},{killSwitch:true}
 ];
 for(const change of cases)assert.equal(screenEchoFiveDollarCall(candidate(change)).eligible,false,
  JSON.stringify(change));
});
test('reject gifts, transfers, invalid callers, stale calls, market cap, price premium, slippage',()=>{
 const cases:Partial<EchoFiveDollarCall>[]=[
  {side:'SELL'},{isTransferOrGift:true},{verifiedSpend:false},
  {callerWallet:'1'.repeat(44)},{sourceSignature:'bad'},
  {observedAtMs:1800000000000-76000},{marketCapUsd:500001},
  {buyPriceSolPerToken:0.000001500001},{maxSlippageBps:1001}
 ];
 for(const change of cases)assert.equal(screenEchoFiveDollarCall(candidate(change)).eligible,false,
  JSON.stringify(change));
});

test('no arbitrary $6 floor; BUY permitted only if exact debit and exit reserve fit',()=>{
 // At $200/SOL this wallet holds $5.50, still enough for the tested
 // ~$4.43 all-in BUY plus the independent manual-exit reserve.
 assert.equal(screenEchoFiveDollarCall(candidate({availableWalletLamports:'27500000'})).eligible,true);
 assert.deepEqual(screenEchoFiveDollarCall(candidate({availableWalletLamports:'24149999'})),
  {eligible:false,executable:false,reason:'INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE'});
 assert.deepEqual(screenEchoFiveDollarCall(candidate({availableWalletLamports:'27500000',pendingWalletDebitLamports:'4000000'})),
  {eligible:false,executable:false,reason:'INSUFFICIENT_WALLET_BALANCE_AND_EXIT_RESERVE'});
});
