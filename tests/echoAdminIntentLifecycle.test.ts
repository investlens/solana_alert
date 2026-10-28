import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { intentKey, transitionIntent, type IntentRecord } from '../src/echo/adminIntentLifecycle.js';
const sig = '5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
const base: IntentRecord = { executionWallet: 'wallet', mint: 'mint', callerSignature: sig, state: 'reserved', signedSignature: null };
describe('Echo future durable intent state machine', () => {
  it('keeps wallet and mint distinct in composite keys', () => {
    assert.notEqual(intentKey('ab','c'), intentKey('a','bc'));
  });
  it('requires signed payload persistence before submission and same signature confirmation', () => {
    assert.equal(transitionIntent(base,'SUBMITTED').ok,false);
    const signed=transitionIntent(base,'SIGNED_PERSISTED',sig);
    assert.equal(signed.ok,true);
    if (!signed.ok) return;
    assert.equal(transitionIntent(signed.next,'SUBMITTED','other').ok,false);
    const submitted=transitionIntent(signed.next,'SUBMITTED',sig);
    assert.equal(submitted.ok,true);
    if (!submitted.ok) return;
    assert.equal(transitionIntent(submitted.next,'CHAIN_CONFIRMED','other').ok,false);
    const confirmed=transitionIntent(submitted.next,'CHAIN_CONFIRMED',sig);
    assert.equal(confirmed.ok,true);
    if (confirmed.ok) assert.equal(transitionIntent(confirmed.next,'SUBMITTED',sig).ok,false);
  });
  it('locks unknown, expired, and preflight-failed intents for manual review', () => {
    const signed=transitionIntent(base,'SIGNED_PERSISTED',sig);
    assert.equal(signed.ok,true);
    if (!signed.ok) return;
    for (const event of ['CONFIRMATION_UNKNOWN','BLOCKHASH_EXPIRED_UNRESOLVED'] as const) {
      const outcome=transitionIntent(signed.next,event);
      assert.equal(outcome.ok,true);
      if(outcome.ok) assert.equal(transitionIntent(outcome.next,'SUBMITTED',sig).ok,false);
    }
    const failed=transitionIntent(base,'PREFLIGHT_FAILED');
    assert.equal(failed.ok,true);
    if(failed.ok) assert.equal(transitionIntent(failed.next,'SIGNED_PERSISTED',sig).ok,false);
  });
});
