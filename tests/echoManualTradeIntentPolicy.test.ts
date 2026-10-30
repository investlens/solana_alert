import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualTradeIntent,MANUAL_TRANSACTION_SUBMISSION_ENABLED,AUTOMATIC_SELL_ENABLED } from '../src/echo/manualTradeIntentPolicy.js';
import {ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED} from '../src/core/adminTrading.js';
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump';
const base={requesterChatId:'123',ownerChatId:'123',wallet,mint,action:'BUY' as const,amountSol:0.05,confirmed:true,nonce:'request-1'};
test('manual buy intent: owner-only, explicit confirmation and cap',()=>{
 const good=validateManualTradeIntent(base);
 assert.deepEqual(good,{accepted:true,reservationKey:wallet+':'+mint,executionEnabled:false});
 for(const x of [{...base,requesterChatId:'456'},{...base,confirmed:false},{...base,amountSol:0.10001},
   {...base,amountSol:0},{...base,amountSol:Infinity},{...base,nonce:''},{...base,mint:'bad'}]){
   assert.equal(validateManualTradeIntent(x).accepted,false);
 }
});
test('manual sell only exact percentages, no automatic selling',()=>{
 const {amountSol,...rest}=base;
 for(const percent of [25,50,100]){
  const ok=validateManualTradeIntent({...rest,action:'SELL',percent});
  assert.equal(ok.accepted,true);
 }
 for(const percent of [0,30,101]) assert.equal(validateManualTradeIntent({...rest,action:'SELL',percent}).accepted,false);
 assert.equal(AUTOMATIC_SELL_ENABLED,false);
 assert.equal(MANUAL_TRANSACTION_SUBMISSION_ENABLED,false);
 assert.equal(ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED,true);
});
