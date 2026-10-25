import test from 'node:test';
import assert from 'node:assert/strict';
import {identifyJupiterCandidates,JUPITER_V6} from '../src/echo/jupiterCandidates.js';
import {ECHO_WALLETS} from '../src/echo/signals.js';
import type {ParsedTransactionWithMeta} from '@solana/web3.js';
const wallet=Object.keys(ECHO_WALLETS).find(x=>ECHO_WALLETS[x]==='Thedetective')!;
const usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const mint='Dy4AE8VuQDaj85XT6KQ2pQnrjBB4ozVwjZaZaXeapump';
const signature='4BY6YAqTqLcfjdgzqCdyW5FBvarXstEvGabG92srBMTDXv74P1sNKZTkk757twNyuTVe1EeAZgwPYg1Jdi2dr9KL';
const balance=(accountIndex:number,mint:string,amount:string)=>({accountIndex,mint,owner:wallet,uiTokenAmount:{amount,decimals:6,uiAmount:null,uiAmountString:'0'}});
function sample(program=JUPITER_V6,signer=true):ParsedTransactionWithMeta{
 return {slot:1,blockTime:1792905898,version:0,transaction:{signatures:[signature],message:{
 accountKeys:[{pubkey:wallet,signer,writable:true}],
 instructions:[{programId:program,accounts:[wallet],data:'abc'}],
 recentBlockhash:'1'}},meta:{err:null,fee:5000,preBalances:[0],postBalances:[0],
 preTokenBalances:[balance(2,usdc,'250315906'),balance(3,mint,'0')],
 postTokenBalances:[balance(2,usdc,'0'),balance(3,mint,'33449652888687')],innerInstructions:[]}} as unknown as ParsedTransactionWithMeta;
}
test('Jupiter USDC to token produces a research candidate, never a verified alert',()=>{
 const c=identifyJupiterCandidates(sample(),signature);
 assert.equal(c.length,1);assert.equal(c[0].side,'BUY');assert.equal(c[0].verification,'CANDIDATE_ONLY');
});
test('Non-Jupiter, missing signer and bad signature are rejected',()=>{
 assert.equal(identifyJupiterCandidates(sample('11111111111111111111111111111111'),signature).length,0);
 assert.equal(identifyJupiterCandidates(sample(JUPITER_V6,false),signature).length,0);
 assert.equal(identifyJupiterCandidates(sample(),'not-the-signature').length,0);
});
test('USDC receipt from non-swap route is not called a SELL',()=>{
 const tx=sample('11111111111111111111111111111111');
 assert.equal(identifyJupiterCandidates(tx,signature).length,0);
});
test('Ambiguous third asset is rejected',()=>{
 const tx=sample();tx.meta!.postTokenBalances!.push(balance(4,'So11111111111111111111111111111111111111112','55') as any);
 assert.equal(identifyJupiterCandidates(tx,signature).length,0);
});
