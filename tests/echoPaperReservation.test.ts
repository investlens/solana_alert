import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveEchoPaperIntent, type EchoReservationStore } from '../src/echo/paperReservation.js';
import { SLINGOOR_WALLET, CHAIRMAN_WALLET } from '../src/echo/liveBuyPolicy.js';
import type { SecureEchoBuy } from '../src/echo/secureBuyGuard.js';
const input: SecureEchoBuy = {
  event: {callerWallet:SLINGOOR_WALLET,mint:'11111111111111111111111111111111',amountSol:0.1,side:'BUY',isVerifiedSwap:true,transactionSignature:'1'.repeat(64)},
  ownerWallet:'11111111111111111111111111111111',nowMs:10_000,observedAtMs:9_000,
  spentTodayLamports:0,walletBalanceLamports:200_000_000,reserveLamports:10_000_000,
  killSwitchEngaged:false,simulationPassed:true,quoteValid:true,mintAuthorityDisabled:true,freezeAuthorityDisabled:true,
  liquidityVerified:true,sellRouteVerified:true,slippageBps:100,landing:{computeUnitLimit:300_000,microLamportsPerCu:100_000}
};
test('repeated buys and different callers share one reservation per mint',async()=>{
  const rows=new Set<string>();
  const store:EchoReservationStore={async insertOnce(row){const key=row.executionWallet+':'+row.mint;if(rows.has(key))return false;rows.add(key);return true;}};
  assert.equal((await reserveEchoPaperIntent(input,store)).reserved,true);
  assert.deepEqual(await reserveEchoPaperIntent(input,store),{reserved:false,reason:'DUPLICATE_TOKEN'});
  assert.deepEqual(await reserveEchoPaperIntent({...input,event:{...input.event,callerWallet:CHAIRMAN_WALLET}},store),{reserved:false,reason:'DUPLICATE_TOKEN'});
});
test('storage errors and invalid signals fail closed',async()=>{
  const broken:EchoReservationStore={async insertOnce(){throw Error('db unavailable');}};
  assert.deepEqual(await reserveEchoPaperIntent(input,broken),{reserved:false,reason:'STORAGE_UNAVAILABLE'});
  const invalid={...input,simulationPassed:false};
  assert.equal((await reserveEchoPaperIntent(invalid,broken)).reserved,false);
});

test('simultaneous callers cannot both reserve the same mint',async()=>{
  const keys=new Set<string>();
  const store:EchoReservationStore={async insertOnce(row){
    const key=row.executionWallet+':'+row.mint;
    if(keys.has(key))return false;
    keys.add(key); // stand-in for database atomic unique insert
    await Promise.resolve();
    return true;
  }};
  const results=await Promise.all([
    reserveEchoPaperIntent(input,store),
    reserveEchoPaperIntent({...input,event:{...input.event,callerWallet:CHAIRMAN_WALLET}},store),
  ]);
  assert.equal(results.filter(r=>r.reserved).length,1);
  assert.equal(results.filter(r=>!r.reserved&&r.reason==='DUPLICATE_TOKEN').length,1);
});
