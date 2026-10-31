import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import type {ParsedTransactionWithMeta} from '@solana/web3.js';
import {extractPumpAppRoutedEchoBuys,PUMP_APP_ROUTER,PUMP_APP_USDC_BUY_TAG}
 from '../src/echo/pumpAppRouteSignals.js';
import {SOL_MINT,ECHO_WALLETS} from '../src/echo/signals.js';

const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const signature='5BW5sKmZRmYtrDPp4aGmgCR566TGxyL7NMzdAJQQ3E1nAs5KGVWpv9P9hfmNmQa6dJKNqLVMsfUMAi3ge7tGn1UL';
const mint='9AfSCLTcHTwgKdy78ibYdJFn3TGbkQRcaxd2RUyHpump';
const wrapped='EksNhwuhJjTBUbhsWWw3xLo2Y2HrKLkP8SAcppF7nTZJ';
const route=bs58.encode(Buffer.concat([Buffer.from(PUMP_APP_USDC_BUY_TAG,'hex'),Buffer.alloc(74)]));
const tokenBalance=(amount:string)=>({accountIndex:2,owner:wallet,mint,
 uiTokenAmount:{amount,decimals:6,uiAmount:null,uiAmountString:''}});
function fixture():ParsedTransactionWithMeta{
 return {blockTime:1793463230,transaction:{
  signatures:[signature],message:{
   accountKeys:[{pubkey:wallet,signer:true}],
   instructions:[{programId:PUMP_APP_ROUTER,data:route,accounts:Array(83).fill(wallet)}]
  }
 },meta:{err:null,fee:25460,preBalances:[1_000_000_000],postBalances:[385_532_269],
  preTokenBalances:[tokenBalance('0')],postTokenBalances:[tokenBalance('677408979530')],
  innerInstructions:[{index:1,instructions:[
   {programId:'11111111111111111111111111111111',
    parsed:{type:'transfer',info:{source:wallet,destination:wrapped,lamports:614432271}}},
   {programId:'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    parsed:{type:'syncNative',info:{account:wrapped}}},
   {programId:'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'}
  ]}]
 }} as unknown as ParsedTransactionWithMeta;
}
const read=(tx:ParsedTransactionWithMeta)=>extractPumpAppRoutedEchoBuys(tx,signature,1793463231);
test('verified Slingoor native SOL-funded Pump App 82-byte BUY is recognized',()=>{
 const b=read(fixture());assert.equal(b.length,1);
 assert.equal(b[0].wallet,wallet);
 assert.equal(b[0].caller,ECHO_WALLETS[wallet]);
 assert.equal(b[0].mint,mint);assert.equal(b[0].side,'BUY');
 assert.equal(b[0].tokenAmount,677408.97953);
 assert.equal(b[0].quoteAmount,0.614432271);
 assert.equal(b[0].quoteMint,SOL_MINT);
 assert.equal(b[0].quoteBasis,'verified native SOL route transfer');
});
test('token gift and wallet-only fee cannot become BUY',()=>{
 const noSol=fixture();(noSol.meta!.innerInstructions![0].instructions as any[]).splice(0,1);
 assert.deepEqual(read(noSol),[]);
 const noSwap=fixture();(noSwap.meta!.innerInstructions![0].instructions as any[]).splice(2,1);
 assert.deepEqual(read(noSwap),[]);
 const noWrap=fixture();(noWrap.meta!.innerInstructions![0].instructions as any[]).splice(1,1);
 assert.deepEqual(read(noWrap),[]);
});
test('wrong signer, extra token debit, incorrect router shape and SELL deny',()=>{
 const wrongSigner=fixture();(wrongSigner.transaction.message.accountKeys[0] as any).signer=false;
 assert.deepEqual(read(wrongSigner),[]);
 const wrongShape=fixture();(wrongShape.transaction.message.instructions[0] as any).data=bs58.encode(
  Buffer.concat([Buffer.from(PUMP_APP_USDC_BUY_TAG,'hex'),Buffer.alloc(75)]));
 assert.deepEqual(read(wrongShape),[]);
 const extraDebit=fixture();
 extraDebit.meta!.preTokenBalances!.push({...tokenBalance('1000000'),mint:'4'.repeat(44)} as any);
 extraDebit.meta!.postTokenBalances!.push({...tokenBalance('0'),mint:'4'.repeat(44)} as any);
 assert.deepEqual(read(extraDebit),[]);
 const sell=fixture();sell.meta!.preTokenBalances![0]=tokenBalance('677408979530');
 sell.meta!.postTokenBalances![0]=tokenBalance('0');
 assert.deepEqual(read(sell),[]);
});
test('rent-only and multiple native transfers are not allowed',()=>{
 const rent=fixture();(rent.meta!.innerInstructions![0].instructions[0] as any).parsed.info.lamports=1000;
 assert.deepEqual(read(rent),[]);
 const duplicate=fixture();rent.meta!.innerInstructions![0].instructions.push(
  structuredClone(fixture().meta!.innerInstructions![0].instructions[0]));
 assert.deepEqual(read(duplicate).length,1);
 // Two transfers from the signer are ambiguous; never attribute both to one swap.
 duplicate.meta!.innerInstructions![0].instructions.push(
  structuredClone(fixture().meta!.innerInstructions![0].instructions[0]));
 assert.deepEqual(read(duplicate),[]);
});
test('failure, stale blockTime and mismatched signature are excluded',()=>{
 const x=fixture();x.meta!.err={InstructionError:[1,'Custom']} as any;
 assert.deepEqual(read(x),[]);
 assert.deepEqual(extractPumpAppRoutedEchoBuys(fixture(),signature,1793463230+1801),[]);
 assert.deepEqual(extractPumpAppRoutedEchoBuys(fixture(),'3'.repeat(64),1793463231),[]);
});
