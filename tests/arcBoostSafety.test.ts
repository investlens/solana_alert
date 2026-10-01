import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBoostSafetyFromEvidence, processArcBoostObservation } from '../src/chains/arc/boostSafety.js';
test('ARC boost requires explicit honeypot and sell evidence, but no volume or LP measurement', () => {
  for (const evidence of [null, {}, {is_honeypot:'0'}, {is_honeypot:'1',cannot_sell_all:'0'}, {is_honeypot:'0',cannot_sell_all:'1'}])
    assert.equal(arcBoostSafetyFromEvidence(evidence).allowed, false);
  const verified = arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0',creator_percent:'0.04'});
  assert.equal(verified.allowed,true);assert.equal(verified.devHoldingPercent,4);
});
test('failed ARC delivery retries same total; accepted delivery deduplicates and allows later increase', async () => {
  const totals = new Map<string, number>();const boost={tokenAddress:'0xABC',totalAmount:30};
  await processArcBoostObservation(totals,boost,async()=>false); assert.equal(totals.size,0);
  const calls:string[]=[]; const send=async(type:string)=>{calls.push(type);return true;};
  await processArcBoostObservation(totals,boost,send);await processArcBoostObservation(totals,boost,send);
  await processArcBoostObservation(totals,{...boost,totalAmount:50},send);
  assert.deepEqual(calls,['NEW','INCREASE']);assert.equal(totals.get('0xabc'),50);
});
