import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {extractCallerTokenDeltas} from '../src/echo/adminParsedTokenDeltas.js';
const owner='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='So11111111111111111111111111111111111111112';
describe('Echo parsed token balance evidence',()=>{
 it('extracts precise token increases without claiming a BUY',()=>{
  const pre=[{accountIndex:2,mint,owner,uiTokenAmount:{amount:'9007199254740993'}}];
  const post=[{accountIndex:2,mint,owner,uiTokenAmount:{amount:'9007199254741000'}}];
  const r=extractCallerTokenDeltas(pre,post,owner);
  assert.equal(r.valid,true);assert.equal(r.deltas[0]?.delta,7n);
  assert.equal(r.reason,'UNATTESTED_BALANCE_DELTAS_ONLY');
 });
 it('rejects malformed balances and duplicate account evidence',()=>{
  const item={accountIndex:2,mint,owner,uiTokenAmount:{amount:'1'}};
  assert.equal(extractCallerTokenDeltas([item,item],[],owner).valid,false);
  assert.equal(extractCallerTokenDeltas([{...item,uiTokenAmount:{amount:'1.5'}}],[],owner).valid,false);
 });
});
