import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoPreviewLedger} from '../src/echo/manualPreviewLedger.js';
import {echoPreviewButtons,parseOwnerPreviewCallback,ECHO_CALLBACK_BROADCAST_ALLOWED} from '../src/echo/telegramManualPreview.js';
import {readEchoWalletIdentity,simulateEchoUnsignedTransaction,ECHO_SEND_TRANSACTION_ENABLED} from '../src/echo/readOnlySimulation.js';
import {ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED} from '../src/core/adminTrading.js';
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump';
test('owner-only Telegram callback parsing denies impersonation and wrong chat',()=>{
 const value='echo_preview:b05:'+mint;
 assert.deepEqual(parseOwnerPreviewCallback(value,123,123,'123'),{ok:true,request:{action:'BUY',mint,amountSol:0.05}});
 assert.equal(parseOwnerPreviewCallback(value,124,123,'123').ok,false);
 assert.equal(parseOwnerPreviewCallback(value,123,-123,'123').ok,false);
 assert.equal(parseOwnerPreviewCallback('echo_preview:b11:'+mint,123,123,'123').ok,false);
 assert.equal(echoPreviewButtons(mint).inline_keyboard.length,2);
 assert.equal(ECHO_CALLBACK_BROADCAST_ALLOWED,false);
});
test('durable paper-only preview ledger permits one token BUY, even after restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-preview-')),path=join(dir,'ledger.json');
 try{
  const ledger=new EchoPreviewLedger(path);await ledger.load();
  const i={ownerChatId:'123',wallet,mint,action:'BUY' as const,amountSol:0.05};
  const [a,b]=await Promise.all([ledger.request(i,1000),ledger.request({...i,amountSol:0.1},1001)]);
  assert.equal([a,b].filter(x=>x.created).length,1);
  assert.equal(ledger.summary().total,1);
  const restarted=new EchoPreviewLedger(path);await restarted.load();
  assert.equal((await restarted.request(i,1002)).created,false);
  const sell=await restarted.request({ownerChatId:'123',wallet,mint,action:'SELL',sellPercent:50},1003);
  assert.equal(sell.created,true);
  if(sell.created)assert.equal(await restarted.markSimulation(sell.item.id,true),true);
  assert.equal(restarted.summary().simulated,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('read-only simulation never submits and rejects invalid or failed results',async()=>{
 assert.equal(readEchoWalletIdentity({ECHO_EXECUTION_WALLET_PUBLIC_KEY:wallet}).configured,true);
 assert.equal(readEchoWalletIdentity({}).configured,false);
 assert.throws(()=>readEchoWalletIdentity({ECHO_EXECUTION_WALLET_PUBLIC_KEY:wallet,ECHO_EXECUTION_PRIVATE_KEY:'redacted'}));
 const calls:string[]=[];
 const post=(async (_url:string,opts:RequestInit)=>{
  const payload=JSON.parse(String(opts.body));
  calls.push(payload.method);
  return {ok:true,json:async()=>({result:{value:{err:null,logs:['simulation only']}}})} as Response;
 }) as typeof fetch;
 const r=await simulateEchoUnsignedTransaction('https://example-rpc.invalid','A'.repeat(128),post);
 assert.equal(r.ok,true);
 assert.deepEqual(calls,['simulateTransaction']);
 const denied=await simulateEchoUnsignedTransaction('http://not-secure.invalid','A'.repeat(128),post);
 assert.equal(denied.ok,false);
 assert.equal(ECHO_SEND_TRANSACTION_ENABLED,false);
 assert.equal(ONCHAIN_ADMIN_TRADING_PERMANENTLY_DISABLED,true);
});
