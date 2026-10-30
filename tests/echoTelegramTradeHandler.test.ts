import test from 'node:test';
import assert from 'node:assert/strict';
import { createEchoTradeCallback, type EchoCallbackStore, type StoredEchoCallback } from '../src/echo/telegramTradeCallback.js';
import { handleEchoTradeCallback } from '../src/echo/telegramTradeHandler.js';
import { ECHO_EXPECTED_EXECUTION_WALLET } from '../src/echo/executionWallet.js';
const intent = { action:'SELL' as const, telegramUserId:'123', authorizedAdminId:'123',
 executionWallet:ECHO_EXPECTED_EXECUTION_WALLET,
 mint:'So11111111111111111111111111111111111111112', sellPercent:50,
 confirmationTokenVerified:true };
test('admin callback is admitted once for review; no trading',async()=>{
 const rows=new Map<string,StoredEchoCallback>();
 const store:EchoCallbackStore={
  async insertOnce(k,v){rows.set(k,v);return true;},
  async consumeOnce(k){const v=rows.get(k)??null;rows.delete(k);return v;}
 };
 const token=await createEchoTradeCallback(store,intent,1000);
 assert.equal(token.created,true);
 if(!token.created)return;
 let count=0;
 const queue={async enqueueForReview(){count++;return true;}};
 const update={fromId:123,data:token.token,chatId:123,messageId:1};
 assert.deepEqual(await handleEchoTradeCallback(update,'123',store,queue,2000),{accepted:true,reason:'QUEUED_FOR_REVIEW_ONLY'});
 assert.equal((await handleEchoTradeCallback(update,'123',store,queue,2001)).accepted,false);
 assert.equal(count,1);
});
test('wrong admin cannot consume token',async()=>{
 const store:EchoCallbackStore={async insertOnce(){return true;},async consumeOnce(){throw Error('should not be called');}};
 const result=await handleEchoTradeCallback({fromId:456,data:'echo_invalid',chatId:1,messageId:1},'123',store,{async enqueueForReview(){throw Error('should not run');}},1000);
 assert.deepEqual(result,{accepted:false,reason:'UNAUTHORIZED_ADMIN'});
});
