import test from 'node:test';
import assert from 'node:assert/strict';
import {startEchoLocalOwnershipVerifier} from '../scripts/echoVerifyPhantomWallet.js';
const address='8ndw7DJ6hyZBm1PD3JJMF8G4PD5CJhDCCUK13ECL2pgQ';
const origin='http://127.0.0.1:43891';
test('local Phantom verifier serves UI but rejects wrong origin, wallets and signatures',async()=>{
 const server=startEchoLocalOwnershipVerifier();
 try{
  if(!server.listening)await new Promise<void>(resolve=>server.once('listening',()=>resolve()));
  const ui=await fetch(origin+'/');
  assert.equal(ui.status,200);
  const html=await ui.text();
  assert.equal(html.includes('signMessage'),true);
  assert.equal(html.includes(address),true); // expected wallet is pinned in browser script
  const post=async(path:string,value:unknown,originHeader=origin)=>fetch(origin+path,{
    method:'POST',headers:{origin:originHeader,'content-type':'application/json'},
    body:JSON.stringify(value)
  });
  assert.equal((await post('/ownership/challenge',{wallet:address},'https://evil.example')).status,403);
  assert.equal((await post('/ownership/challenge',{wallet:'invalid'})).status,403);
  const challenge=await post('/ownership/challenge',{wallet:address});
  assert.equal(challenge.status,200);
  const payload=await challenge.json();
  assert.equal(typeof payload.message,'string');
  assert.equal(payload.message.includes('AlphaOS-Echo/wallet-ownership/v1'),true);
  assert.equal(payload.message.includes(address),true);
  const verify=await post('/ownership/verify',{nonceHex:payload.nonceHex,signatureBase58:'x'});
  assert.equal(verify.status,403);
  const replay=await post('/ownership/verify',{nonceHex:payload.nonceHex,signatureBase58:'x'});
  assert.equal(replay.status,403);
 }finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
