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

test('creator percent is a fraction; missing creator does not borrow owner holding',()=>{
 assert.equal(arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0',creator_percent:''}).devHoldingPercent,null);
 assert.equal(arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0',owner_percent:'0.10'}).devHoldingPercent,null);
 assert.equal(arcBoostSafetyFromEvidence({is_honeypot:'0',cannot_sell_all:'0',creator_percent:'1'}).devHoldingPercent,100);
});
test('provider wallet sample excludes contracts and burn addresses; incomplete percentage remains unknown',()=>{
 const base={is_honeypot:'0',cannot_sell_all:'0'};
 assert.equal(arcBoostSafetyFromEvidence({...base,holders:[{is_contract:'0',percent:'0.1'},{is_contract:'1',percent:'0.8'}]}).top10Percent,10);
 assert.equal(arcBoostSafetyFromEvidence({...base,holders:[{is_contract:'0',percent:''}]}).top10Percent,null);
});

test('incomplete sellability does not discard independent ownership evidence',()=>{
 const creator='0x'+'b'.repeat(40);
 const result=arcBoostSafetyFromEvidence({creator_address:creator,creator_percent:'0.15',holders:[{is_contract:'0',percent:'0.20'}]});
 assert.equal(result.allowed,false);assert.equal(result.sellabilityVerified,undefined);
 assert.equal(result.creator,creator);assert.equal(result.devHoldingPercent,15);assert.equal(result.top10Percent,20);
 const flagged=arcBoostSafetyFromEvidence({is_honeypot:'1',creator_address:creator,creator_percent:'0.15'});
 assert.equal(flagged.sellabilityBlocked,true);assert.equal(flagged.allowed,false);
 assert.equal(arcBoostSafetyFromEvidence({creator_address:'<script>',owner_address:creator}).creator,null);
});
