import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';

const caller = '5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const signature = '3'.repeat(88);
const jup = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const usdc = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const token = '4'.repeat(44);
const routeData = bs58.encode(Buffer.concat([
  createHash('sha256').update('global:route').digest().subarray(0,8),
  Buffer.alloc(20)
]));
const make = (overrides: Record<string,unknown>={}) => ({
  blockTime: 1000,
  transaction: {
    signatures: [signature],
    message: {accountKeys: [{pubkey: caller, signer: true}],
      instructions: [{programId: jup, accounts: [caller], data: routeData}]},
  },
  meta: {
    err: null, innerInstructions: [], preBalances: [1_000_000_000],
    postBalances: [998_000_000],
    preTokenBalances: [
      {accountIndex: 1, mint: usdc, owner: caller, uiTokenAmount:{amount:'50000000',decimals:6}},
      {accountIndex: 2, mint:token, owner:caller, uiTokenAmount:{amount:'0',decimals:6}}
    ],
    postTokenBalances: [
      {accountIndex: 1, mint: usdc, owner: caller, uiTokenAmount:{amount:'40000000',decimals:6}},
      {accountIndex: 2, mint: token, owner: caller, uiTokenAmount:{amount:'2000000',decimals:6}}
    ]
  },
  ...overrides
}) as unknown as ParsedTransactionWithMeta;

test('Jupiter router BUY: exact debit and net received token, one alert', () => {
  const v=extractJupiterRoutedEchoBuys(make(),signature,1002);
  assert.equal(v.length,1);
  assert.equal(v[0].side,'BUY');
  assert.equal(v[0].mint,token);
  assert.equal(v[0].tokenAmount,2);
  assert.equal(v[0].quoteAmount,10);
  assert.equal(v[0].quoteMint,usdc);
  assert.equal(v[0].quoteBasis,'token-account net change');
});
test('Jupiter v6 V2 route decodes same verified net asset BUY as classic router', () => {
  const tx=make();
  const data=bs58.encode(Buffer.concat([
    createHash('sha256').update('global:shared_accounts_route_v2').digest().subarray(0,8),
    Buffer.alloc(20)
  ]));
  const v2=make({transaction:{...tx.transaction,message:{...tx.transaction.message,
    instructions:[{programId:jup,accounts:[caller],data}]}}});
  const results=extractJupiterRoutedEchoBuys(v2,signature,1002);
  assert.equal(results.length,1);
  assert.equal(results[0].quoteAmount,10);
  assert.equal(results[0].tokenAmount,2);
});
test('Transfers, invalid router data and caller-not-signer produce zero BUYs', () => {
  const tx=make();
  const noRoute=make({transaction:{...tx.transaction,
    message:{...tx.transaction.message,instructions:[{programId:'11111111111111111111111111111111',data:routeData}]}}});
  assert.deepEqual(extractJupiterRoutedEchoBuys(noRoute,signature,1002),[]);
  const noSigner=make({transaction:{...tx.transaction,
    message:{...tx.transaction.message,accountKeys:[{pubkey:caller,signer:false}]}}});
  assert.deepEqual(extractJupiterRoutedEchoBuys(noSigner,signature,1002),[]);
  assert.deepEqual(extractJupiterRoutedEchoBuys(make(),signature,4000),[]);
});
test('Missing debit evidence and multiple token credits must fail closed', () => {
  const tx=make();
  const noDebit=make({meta:{...tx.meta,preBalances:[998000000],postBalances:[998000000],
    preTokenBalances:tx.meta!.preTokenBalances!.filter(x=>x.mint!==usdc),
    postTokenBalances:tx.meta!.postTokenBalances!.filter(x=>x.mint!==usdc)}});
  assert.deepEqual(extractJupiterRoutedEchoBuys(noDebit,signature,1002),[]);
  const secondToken = '5'.repeat(44);
  const manyCredits=make({meta:{...tx.meta,postTokenBalances:[
    ...tx.meta!.postTokenBalances!,{accountIndex:3,mint:secondToken,owner:caller,uiTokenAmount:{amount:'100',decimals:0}}
  ]}});
  assert.deepEqual(extractJupiterRoutedEchoBuys(manyCredits,signature,1002),[]);
});
