import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSecureEchoBuy, type SecureEchoBuy } from '../src/echo/secureBuyGuard.js';
import { SLINGOOR_WALLET, CHAIRMAN_WALLET, LIVE_EXECUTION_ENABLED } from '../src/echo/liveBuyPolicy.js';
const base: SecureEchoBuy = {
  event:{callerWallet:SLINGOOR_WALLET,mint:'11111111111111111111111111111111',amountSol:0.1,side:'BUY',isVerifiedSwap:true,transactionSignature:'1'.repeat(64)},
  ownerWallet:'11111111111111111111111111111111',nowMs:10_000,observedAtMs:9_000,
  spentTodayLamports:0,walletBalanceLamports:200_000_000,reserveLamports:10_000_000,
  killSwitchEngaged:false,simulationPassed:true,quoteValid:true,mintAuthorityDisabled:true,
  freezeAuthorityDisabled:true,liquidityVerified:true,sellRouteVerified:true,slippageBps:100,
  landing:{computeUnitLimit:300_000,microLamportsPerCu:100_000}
};
test('paper admission supports both callers but live execution remains off',()=>{
  assert.equal(LIVE_EXECUTION_ENABLED,false);
  assert.equal(validateSecureEchoBuy(base).allowed,true);
  assert.equal(validateSecureEchoBuy({...base,event:{...base.event,callerWallet:CHAIRMAN_WALLET}}).allowed,true);
});
test('critical failures always deny admission',()=>{
  const variants:SecureEchoBuy[]=[
    {...base,killSwitchEngaged:true}, {...base,observedAtMs:0}, {...base,simulationPassed:false},
    {...base,quoteValid:false}, {...base,mintAuthorityDisabled:false}, {...base,freezeAuthorityDisabled:false},
    {...base,liquidityVerified:false}, {...base,sellRouteVerified:false}, {...base,slippageBps:301},
    {...base,spentTodayLamports:250_000_000}, {...base,walletBalanceLamports:100_000_000},
    {...base,event:{...base.event,side:'SELL'}}, {...base,landing:{computeUnitLimit:300_000,microLamportsPerCu:1_000_000}}
  ];
  for(const candidate of variants) assert.equal(validateSecureEchoBuy(candidate).allowed,false);
});
