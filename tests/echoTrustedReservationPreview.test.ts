import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyEchoPreviewAgainstLedger,type EchoTrustedReservation} from '../src/echo/trustedReservationPreview.js';
const wallet='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const mint='So11111111111111111111111111111111111111112';
const sol='So11111111111111111111111111111111111111112';
const token='2'.repeat(44);
const row:EchoTrustedReservation={executionWallet:wallet,mint:token,state:'reserved',
 amountLamports:50000000,positionClosedAt:null,transactionSignature:null};
const preview={ok:true as const,reason:'RPC_SIMULATION_SUCCEEDED' as const,
 side:'BUY' as const,inputMint:sol,outputMint:token,inputRaw:'50000000',
 quotedOutputRaw:'123456',unsignedTransactionSha256:'a'.repeat(64),
 requestId:'id',logs:[]};
const trusted=(r:EchoTrustedReservation|null)=>({getByWalletAndMint:async()=>r});
test('READ-ONLY BUY preview requires independently fetched matching reservation',async()=>{
 assert.deepEqual(await verifyEchoPreviewAgainstLedger({
 side:'BUY',wallet,mint:token,preview,reader:trusted(row)}),
 {ok:true,mode:'READ_ONLY',transactionSha256:'a'.repeat(64)});
 assert.equal((await verifyEchoPreviewAgainstLedger({
 side:'BUY',wallet,mint:token,preview,reader:trusted(null)})).ok,false);
 assert.equal((await verifyEchoPreviewAgainstLedger({
 side:'BUY',wallet,mint:token,preview,reader:trusted({...row,amountLamports:1})})).ok,false);
});
test('SELL cannot derive trade authorization from a quote or a buy reservation',async()=>{
 const sellPreview={...preview,side:'SELL' as const,inputMint:token,outputMint:sol};
 const checked=await verifyEchoPreviewAgainstLedger({side:'SELL',wallet,mint:token,
 preview:sellPreview,reader:trusted({...row,state:'confirmed',transactionSignature:'3'.repeat(64)})});
 assert.deepEqual(checked,{ok:false,reason:'SELL_CHAIN_BALANCE_AND_OWNER_PROOF_REQUIRED'});
});
test('database outage fails closed',async()=>{
 const checked=await verifyEchoPreviewAgainstLedger({side:'BUY',wallet,mint:token,
 preview,reader:{getByWalletAndMint:async()=>{throw Error('offline')}}});
 assert.deepEqual(checked,{ok:false,reason:'RESERVATION_DATABASE_UNAVAILABLE'});
});
