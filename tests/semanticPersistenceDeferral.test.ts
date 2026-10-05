import test from 'node:test';
import assert from 'node:assert/strict';
import { persistOrLoadAlphaSemanticEventRecord, getEphemeralSemanticEventEvidence } from '../src/services/alphaSemanticEventService.js';
import { resetDatabaseGovernorForTests } from '../src/services/databaseLoadGovernor.js';

test('governor-deferred DEX Paid writes use stable evidence without querying an unwritten event', async () => {
  const original = process.env.DB_BACKGROUND_WORK_ENABLED;
  const originalFetch = globalThis.fetch;
  let requests = 0;
  process.env.DB_BACKGROUND_WORK_ENABLED = 'false';
  resetDatabaseGovernorForTests();
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected provider/database request'); };
  try {
    const raw = {price:0.01,priceProvenance:'DEXSCREENER_VERIFIED_BASE_PAIR',paymentTimestamp:Date.now()};
    const args = {identity:'deferral-fixture:payment',type:'DEX_PAID' as const,assetId:'0x'+'1'.repeat(40),chain:'robinhood',symbol:'TEST',rawSnapshot:raw};
    const first = await persistOrLoadAlphaSemanticEventRecord(args);
    const duplicate = await persistOrLoadAlphaSemanticEventRecord(args);
    assert.equal(first.ephemeral,true);
    assert.equal(first.raw_snapshot?.symbol,'TEST','recovery audit must retain supplied identity');
    assert.ok(first.id<0);
    assert.equal(first.id,duplicate.id);
    assert.equal(first.event_identity,duplicate.event_identity);
    assert.equal(requests,0,'deferred writes must not execute a missing-row SELECT');
    raw.price=9;
    assert.equal(getEphemeralSemanticEventEvidence(first.event_identity)?.price,0.01);
  } finally {
    if (original === undefined) delete process.env.DB_BACKGROUND_WORK_ENABLED;
    else process.env.DB_BACKGROUND_WORK_ENABLED=original;
    globalThis.fetch=originalFetch;
    resetDatabaseGovernorForTests();
  }
});
