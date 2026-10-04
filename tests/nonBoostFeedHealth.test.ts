import test from 'node:test';
import assert from 'node:assert/strict';
import { localFeedHealth, recordFeedDelivery, renderFeedHealth } from '../src/services/feedDeliveryHealth.js';
test('screening distinguishes unavailable data, waiting conditions, risk and delivery without raw token storage',()=>{
  for(const stage of ['DISCOVERED','EVALUATED','DATA_UNAVAILABLE','CONDITION_WAIT','RISK_REJECTED','QUALIFIED'] as const) recordFeedDelivery('TRADE_SETUP_WATCH',stage);
  const snapshot=localFeedHealth();
  const text=renderFeedHealth([{name:'PONS',snapshot}]);
  assert.match(text,/data unavailable 1/); assert.match(text,/risk rejects 1/);
  assert.match(text,/qualified 1/); assert.match(text,/accepted 0/);
  assert.match(text,/checks, not unique tokens/);
});
