import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EchoPreviewLedger} from '../src/echo/manualPreviewLedger.js';
import {createEchoPreviewCallbackHandler} from '../src/echo/manualPreviewCallbackHandler.js';
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const mint='BSe1q3SL6KQPLeZHFG9nNw5VFbDL3ZXvBmtjBVpYpump';
test('Telegram preview callback persists only owner intent; duplicate and outsider denied',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'echo-callback-'));
 try{
  const ledger=new EchoPreviewLedger(join(dir,'intents.json'));await ledger.load();
  const handle=createEchoPreviewCallbackHandler({ownerChatId:'123',walletEnv:{ECHO_EXECUTION_WALLET_PUBLIC_KEY:wallet},ledger});
  const callback={id:'cb1',from:{id:123},message:{chat:{id:123}},data:'echo_preview:b05:'+mint};
  const first=await handle(callback);assert.equal(first.accepted,true);assert.match(first.text,/No quote, simulation, signature or trade submitted/);
  const duplicate=await handle({...callback,id:'cb2'});assert.equal(duplicate.accepted,false);
  const outsider=await handle({...callback,id:'cb3',from:{id:456}});assert.equal(outsider.accepted,false);
  const privateOnly=await handle({...callback,id:'cb4',message:{chat:{id:-123}}});assert.equal(privateOnly.accepted,false);
  assert.equal(ledger.summary().total,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
