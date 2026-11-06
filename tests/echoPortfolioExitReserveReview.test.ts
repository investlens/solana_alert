import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewEchoPortfolioExitReserve,
 type EchoOpenManualExitLot,ECHO_PORTFOLIO_EXIT_RESERVE_CAN_SELL}
 from '../src/echo/portfolioExitReserveReview.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const now=1800000000000;
function lot(n:number):EchoOpenManualExitLot{
 const mint=n===1?'GczSofuFAmwZkTXBaw9kpeo36Sven8q9fXDXmvUSpump':
  'D4AnTZk3spQgCEMpC4iqtFp8U2qbiDvzrzdaq7Dopump';
 return {sourceSignature:String(n+1).repeat(64),wallet,mint,
  quote:{wallet,mint,outputMint:'So11111111111111111111111111111111111111112',
   quoteObservedAtMs:now-100,nowMs:now,
   walletTokenBalanceRaw:'900000',quotedSellInputRaw:'900000',
   minimumSolOutputLamports:'100000',networkAndPriorityFeeUpperLamports:'10000',
   accountRentUpperLamports:'2000000',extraCpiUpperLamports:'100000',
   walletSolBalanceLamports:'6000000',existingReservedExitLamports:'0',
   quoteIndependentlyFetched:true,feeAndCpiIndependentlyBounded:true,
   poolAndTokenOwnersVerified:true,exactManualTransactionPreviewVerified:true}};
}
function input(){return {wallet,openLots:[lot(1),lot(2)],
 actualWalletBalanceLamports:'6000000',pendingBuyCommitmentsLamports:'1000000',nowMs:now};}
test('two open positions require two separately reserved manual exits',()=>{
 const r=reviewEchoPortfolioExitReserve(input());
 assert.deepEqual(r,{ok:true,mode:'READ_ONLY_PORTFOLIO_EXIT_BUDGET',
  requiredExitReserveLamports:'4220000',
  totalExistingWalletLamports:'6000000',realPhantomSellVerified:false,
  signingAllowed:false,broadcastAllowed:false});
 assert.equal(ECHO_PORTFOLIO_EXIT_RESERVE_CAN_SELL,false);
});
test('duplicates, missing quotes, mismatched mint and insufficient reserve fail',()=>{
 const x=input();
 for(const change of [
  {actualWalletBalanceLamports:'5219999'},
  {openLots:[lot(1),lot(1)]},
  {openLots:[lot(1),{...lot(2),quote:{...lot(2).quote!,walletSolBalanceLamports:'9999999'}}]},
  {openLots:[lot(1),{...lot(2),quote:null}]},
  {openLots:[lot(1),{...lot(2),mint:lot(1).mint}]},
  {openLots:[lot(1),{...lot(2),quote:{...lot(2).quote!,existingReservedExitLamports:'100'}}]},
  {openLots:[lot(1),{...lot(2),quote:{...lot(2).quote!,quoteObservedAtMs:now-3000}}]}
 ]){
  const r=reviewEchoPortfolioExitReserve({...x,...change});
  assert.equal(r.ok,false,JSON.stringify(change));
  assert.equal(r.broadcastAllowed,false);
 }
});

test('three or more lots permitted with distinct signatures and adequate wallet reserves',()=>{
 const third={...lot(2),sourceSignature:'4'.repeat(64)};
 const openLots=[lot(1),lot(2),third];
 const fundedWallet='9000000';
 const normalized=openLots.map(l=>({...l,quote:{...l.quote!,walletSolBalanceLamports:fundedWallet}}));
 const result=reviewEchoPortfolioExitReserve({wallet,openLots:normalized,
  actualWalletBalanceLamports:fundedWallet,pendingBuyCommitmentsLamports:'1000000',nowMs:now});
 assert.equal(result.ok,true,JSON.stringify(result));
 if(result.ok){
  assert.equal(result.requiredExitReserveLamports,'6330000');
  assert.equal(result.signingAllowed,false);
 }
});
