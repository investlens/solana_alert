import test from 'node:test';
import assert from 'node:assert/strict';
import {echoJupiterAuditFixtures,ECHO_JUPITER_V6} from './fixtures/echoJupiterMissed.js';

// Tests constrain interpretation: negative USDC and positive token is a BUY CANDIDATE,
// not a fully verified routed swap or an instruction to alert.
test('audited Jupiter candidates retain transaction evidence and expected directions',()=>{
  assert.equal(ECHO_JUPITER_V6,'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4');
  assert.equal(echoJupiterAuditFixtures.length,3);
  for(const v of echoJupiterAuditFixtures){
    const usdc=BigInt(v.usdcRaw), token=BigInt(v.tokenRaw);
    assert.notEqual(usdc,0n);assert.notEqual(token,0n);
    assert.equal(usdc*token<0n,true);
    assert.equal(v.side,usdc<0n?'BUY':'SELL');
    assert.match(v.signature,/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  }
});
test('balance direction alone must not create an executable alert',()=>{
  for(const fixture of echoJupiterAuditFixtures) {
    assert.equal('verifiedSwap' in fixture,false);
  }
});
