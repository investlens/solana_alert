import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { requirePersistedScannerOpportunity } from '../src/chains/robinhood/existingTokenOpportunityScanner.js';
import { OUTCOME_ELIGIBLE_ALERT_TYPES, OUTCOME_ELIGIBLE_SEMANTIC_TYPES,
  checkpointCanUseCurrentPrice, selectOutcomeEligibleCandidates } from '../src/services/alphaAlertOutcomeCheckpoints.js';
import { claimTelegramPollingOwner, resetTelegramPollingOwnerForTests } from '../src/services/telegramPollingOwner.js';
import { assertAlphaActions, renderAlphaNotification, TELEGRAM_MESSAGE_LIMIT } from '../src/ui/alphaNotification.js';

test('existing-token strategies are registered forward-only without weakening integrity or enabling trading', async () => {
  const sql = await readFile('supabase/migrations/20260829120000_existing_token_strategy_registry.sql', 'utf8');
  for (const key of ['EXISTING_TOKEN_MONITOR', 'EXISTING_TOKEN_BREAKOUT', 'EXISTING_TOKEN_REIGNITION', 'EXISTING_TOKEN_RUNNER']) {
    assert.match(sql, new RegExp(key));
  }
  assert.match(sql, /on conflict \(strategy_key\) do update/i);
  assert.match(sql, /select_alpha_outcome_candidates/);
  assert.match(sql, /grant execute[\s\S]*service_role/i);
  assert.match(sql, /not exists[\s\S]*alpha_alert_outcomes/i);
  assert.match(sql, /'manual'/);
  assert.doesNotMatch(sql, /\b(drop|truncate|delete\s+from|on\s+delete|alter\s+table)\b/i);
});

test('late checkpoints cannot relabel a current quote as historical performance', () => {
  assert.equal(checkpointCanUseCurrentPrice(45, 30), true);
  assert.equal(checkpointCanUseCurrentPrice(91, 30), false);
  assert.equal(checkpointCanUseCurrentPrice(3_700, 3_600), false);
});

test('scanner persistence null is a token failure while a persisted row is accepted', () => {
  assert.throws(() => requirePersistedScannerOpportunity(null, 'EXISTING_TOKEN_MONITOR'), /persistence failed/);
  const row = { id: 7 };
  assert.equal(requirePersistedScannerOpportunity(row, 'EXISTING_TOKEN_MONITOR'), row);
});

test('outcome eligibility is applied before the batch limit so internal volume cannot starve alerts', () => {
  const internal = Array.from({ length: 500 }, (_, id) => ({ id, asset_id: `internal-${id}`, chain: 'robinhood',
    price: 1, alerted_at: '2026-08-29T00:00:00Z', semantic_event_type: 'DANGER', alert_type: 'OBSERVE' }));
  const eligible = Array.from({ length: 10 }, (_, index) => ({ id: 1000 + index, asset_id: `eligible-${index}`, chain: 'robinhood',
    price: 1, alerted_at: '2026-08-29T00:00:00Z', semantic_event_type: index % 2 ? 'BOOST' : null, alert_type: index % 2 ? null : 'CHECK_ENTRY' }));
  assert.deepEqual(selectOutcomeEligibleCandidates([...internal, ...eligible], 200).map(row => row.id), eligible.map(row => row.id));
  assert.deepEqual([...OUTCOME_ELIGIBLE_SEMANTIC_TYPES], ['DEX_PAID', 'BOOST', 'VOLUME_SURGE', 'DEV_BURN', 'DEV_SELL', 'LIQUIDITY_RISK']);
  assert.deepEqual([...OUTCOME_ELIGIBLE_ALERT_TYPES], ['ENTRY', 'CHECK_ENTRY', 'OPPORTUNITY']);
});

test('malformed provider identity is bounded before HTML rendering and actions stay callback-safe', () => {
  const rendered = renderAlphaNotification({ category: 'market', severity: 'watch', state: 'BOOST',
    symbol: `<${'BTC'.repeat(4000)}&>`, address: '0xAE2Df3c1749daEE721c1BFcbbFDde5D61ae7cb99',
    subtitle: 'x'.repeat(9000), metrics: Array.from({ length: 20 }, (_, index) => ({ label: `metric-${index}`.repeat(20), value: 'v'.repeat(1000) })),
    evidence: ['e'.repeat(9000), '<unsafe>'], reason: 'r'.repeat(9000), insightTitle: '<Intel>', insight: Array(20).fill('i'.repeat(9000)),
    statusTitle: '<Status>', status: 's'.repeat(9000), recommendedAction: 'Review only; no trade.'.repeat(1000) });
  assert.ok(rendered.length <= TELEGRAM_MESSAGE_LIMIT);
  assert.ok(Buffer.byteLength(rendered, 'utf8') < 8192);
  assert.doesNotMatch(rendered, /<unsafe>/);
  assert.doesNotMatch(rendered, /Trade|BUY|SELL/);
  assert.doesNotThrow(() => assertAlphaActions([[{ text: 'Full Intel', callback_data: 'ti:robinhood:123' }]]));
});

test('same process can claim Telegram polling ownership only once', () => {
  resetTelegramPollingOwnerForTests();
  assert.equal(claimTelegramPollingOwner(), true);
  assert.equal(claimTelegramPollingOwner(), false);
  resetTelegramPollingOwnerForTests();
});
