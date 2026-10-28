import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { observePhantomManualExit, type PhantomExitEvidence } from '../src/echo/adminPhantomExitObservation.js';
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
const sig='5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
const base: PhantomExitEvidence={
 wallet,expectedWallet:wallet,mint,ledgerPositionMint:mint,transactionSignature:sig,
 chain:'solana-mainnet',confirmed:true,transactionSucceeded:true,walletWasSigner:true,
 outgoingTokenAmountRaw:'100',beforeTokenBalanceRaw:'100',afterTokenBalanceRaw:'0',trustedRpcEvidence:true,
};
describe('Echo Phantom manual exit observer',()=>{
 it('requires independently confirmed wallet-token balance evidence',()=>{
  assert.deepEqual(observePhantomManualExit(base),{
   verifiedManualExit:true,closePositionEligible:true,reason:'FULL_EXIT_OBSERVED',
  });
  assert.deepEqual(observePhantomManualExit({...base,outgoingTokenAmountRaw:'40',afterTokenBalanceRaw:'60'}),{
   verifiedManualExit:true,closePositionEligible:false,reason:'PARTIAL_EXIT_OBSERVED',
  });
 });
 it('fails closed on forged or inconsistent evidence',()=>{
  const bad:Partial<PhantomExitEvidence>[]=[
   {wallet:'other'}, {mint:'other'}, {ledgerPositionMint:'other'},
   {chain:'solana-devnet'},{confirmed:false},{transactionSucceeded:false},
   {walletWasSigner:false},{trustedRpcEvidence:false},
   {afterTokenBalanceRaw:'100'},{outgoingTokenAmountRaw:'99'},
   {beforeTokenBalanceRaw:'NaN'},{outgoingTokenAmountRaw:'-100'},
  ];
  for(const patch of bad)assert.equal(observePhantomManualExit({...base,...patch}).verifiedManualExit,false,JSON.stringify(patch));
 });
});
