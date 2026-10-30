import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { extractPumpAppRoutedEchoBuys, PUMP_APP_ROUTER, PUMP_APP_USDC_BUY_TAG } from '../src/echo/pumpAppRouteSignals.js';

const chairman='Be24Gbf5KisDk1LcWWZsBn8dvB816By7YzYF5zWZnRR6';
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const token='3m8Zk2sgj9nZYmK8zgUnXZ7UijRtKbsuiWdDYPd6pump';
const signature='468XdziMPaFGnTZxC5tq66bRRxfVbNo5DuhEWaFMskiGexo4fkn8M2zg4KRZvn6E5rsAQYCtCYSMWsvgAUCb4P6U';
const tag=bs58.encode(Buffer.concat([Buffer.from(PUMP_APP_USDC_BUY_TAG,'hex'),Buffer.alloc(60)]));
const balance=(mint:string,amount:string)=>({accountIndex:mint===usdc?1:2,mint,owner:chairman,
 uiTokenAmount:{amount,decimals:6}});
function fixture(): ParsedTransactionWithMeta {
 // Ledger deltas and router instruction tag reproduced from verified public
 // chain transaction; other unneeded account fields are synthetic.
 return {
  blockTime:1793349176,
  transaction:{signatures:[signature],message:{
   accountKeys:[{pubkey:chairman,signer:true}],
   instructions:[{programId:PUMP_APP_ROUTER,accounts:[chairman],data:tag}]
  }},
  meta:{err:null,preTokenBalances:[
   balance(usdc,'100000000'),balance(token,'0')
  ],postTokenBalances:[
   balance(usdc,'49847683'),balance(token,'15827021423580')
  ]}
 } as unknown as ParsedTransactionWithMeta;
}
const read=(tx:ParsedTransactionWithMeta)=>extractPumpAppRoutedEchoBuys(tx,signature,1793349177);
test('Chairman real-world Pump App router BUY: one USDC-funded BUY from verified ledger delta',()=>{
 const buys=read(fixture());
 assert.equal(buys.length,1);
 assert.equal(buys[0].wallet,chairman);
 assert.equal(buys[0].mint,token);
 assert.equal(buys[0].side,'BUY');
 assert.equal(buys[0].quoteSymbol,'USDC');
 assert.equal(buys[0].quoteAmount,50.152317);
 assert.equal(buys[0].tokenAmount,15827021.42358);
 assert.equal(buys[0].id,signature+':'+chairman+':'+token+':BUY');
});
test('incoming token transfer lacking a verified router instruction is never a buy',()=>{
 const tx=fixture();
 tx.transaction.message.instructions=[] as any;
 assert.deepEqual(read(tx),[]);
});
test('unknown router instruction, duplicate router, malformed data fail closed',()=>{
 const tx=fixture();
 const wrong=structuredClone(tx);
 (wrong.transaction.message.instructions[0] as any).data=bs58.encode(Buffer.alloc(68));
 assert.deepEqual(read(wrong),[]);
 const duplicate=structuredClone(tx);
 duplicate.transaction.message.instructions.push(duplicate.transaction.message.instructions[0]);
 assert.deepEqual(read(duplicate),[]);
 const malformed=structuredClone(tx);
 (malformed.transaction.message.instructions[0] as any).data='!invalid';
 assert.deepEqual(read(malformed),[]);
});
test('unsigned wallet, missing debit, additional token credit and SELL never become BUYs',()=>{
 const tx=fixture();
 const noSigner=structuredClone(tx);
 (noSigner.transaction.message.accountKeys[0] as any).signer=false;
 assert.deepEqual(read(noSigner),[]);
 const noDebit=structuredClone(tx);
 noDebit.meta!.preTokenBalances=noDebit.meta!.preTokenBalances!.filter(x=>x.mint!==usdc);
 noDebit.meta!.postTokenBalances=noDebit.meta!.postTokenBalances!.filter(x=>x.mint!==usdc);
 assert.deepEqual(read(noDebit),[]);
 const multi=structuredClone(tx);
 multi.meta!.postTokenBalances!.push(balance('4'.repeat(44),'1000000'));
 assert.deepEqual(read(multi),[]);
 const sell=structuredClone(tx);
 sell.meta!.preTokenBalances![1]=balance(token,'15827021423580');
 sell.meta!.postTokenBalances![1]=balance(token,'0');
 assert.deepEqual(read(sell),[]);
});
test('failed, stale and incorrectly signed transactions remain excluded',()=>{
 const tx=fixture();
 const failed=structuredClone(tx);
 failed.meta!.err={InstructionError:[0,'Custom']} as any;
 assert.deepEqual(read(failed),[]);
 assert.deepEqual(extractPumpAppRoutedEchoBuys(tx,signature,tx.blockTime!+1801),[]);
 assert.deepEqual(extractPumpAppRoutedEchoBuys(tx,'5'.repeat(88),tx.blockTime!+1),[]);
});
