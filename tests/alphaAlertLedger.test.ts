import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
process.env.SUPABASE_URL ??= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';

const opportunity = (action = 'CHECK_ENTRY') => ({ id: 7, asset_id: '0xabc', chain: 'robinhood', strategy_key: 'PONS_BREAKOUT', recommended_action: action, status: 'NEW', title: null, why: 'Momentum confirmed.', what_happened: null, invalidation: null, risk_reason: null, confidence: 82, risk_score: 22, raw_data: { symbol: 'ALPHA', marketCap: 9000, priceWhenVerified: 1, priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR', marketIndexState: 'VERIFIED', devHoldingPercent: 4, devHoldingEvidence: 'VERIFIED', preIndexValuation: { valueUsd: 8000 } } });

test('alert snapshot is immutable after opportunity mutation and EXIT is distinct', async () => {
  const { alphaAlertEventIdentity, buildAlphaAlertEvent } = await import('../src/services/alphaAlertLedger.js');
  const source = opportunity(); const event = buildAlphaAlertEvent(source, '2026-08-24T00:00:00Z');
  source.raw_data.marketCap = 1; source.raw_data.symbol = 'MUTATED';
  assert.equal(event.market_cap, 9000); assert.equal((event.raw_snapshot as Record<string, unknown>).symbol, 'ALPHA');
  assert.notEqual(alphaAlertEventIdentity(source), alphaAlertEventIdentity(opportunity('EXIT')));
  assert.equal(alphaAlertEventIdentity(source), alphaAlertEventIdentity(opportunity()));
});

test('checkpoint measures price with provenance and missing price stays unavailable', async () => {
  const { buildAlphaOutcomeCheckpoint } = await import('../src/services/alphaAlertOutcomeCheckpoints.js');
  const event = { id: 1, asset_id: '0xabc', chain: 'robinhood', price: 1, alerted_at: '2026-08-24T00:00:00Z' };
  const measured = buildAlphaOutcomeCheckpoint({ event, checkpointSeconds: 30, currentPrice: 1.2, source: 'MARKET', provenance: 'DEX_BASE_V1', prior: [] });
  assert.equal(measured.status, 'MEASURED'); assert.ok(Math.abs(Number(measured.current_roi) - 20) < 0.001); assert.equal(measured.price_provenance, 'DEX_BASE_V1');
  const unavailable = buildAlphaOutcomeCheckpoint({ event, checkpointSeconds: 60, currentPrice: null, source: null, provenance: null, prior: [] });
  assert.equal(unavailable.status, 'UNAVAILABLE'); assert.equal(unavailable.current_roi, null);
});

test('normal standalone risk is suppressed and explicit existing critical evidence qualifies', async () => {
  const { criticalAvoidReason, shouldDeliverExit } = await import('../src/services/alphaExitRelevance.js');
  assert.equal(shouldDeliverExit({ action: 'EXIT', relevant: false, criticalReason: null }), false);
  assert.equal(shouldDeliverExit({ action: 'EXIT', relevant: true, criticalReason: null }), true);
  assert.equal(criticalAvoidReason({ emergencyExit: { severity: 'CRITICAL', reason: 'LIQUIDITY_COLLAPSE' } }), 'LIQUIDITY_COLLAPSE');
  assert.equal(criticalAvoidReason({ emergencyExit: { severity: 'CRITICAL', reason: 'HARD_STOP_LOSS' } }), null);
});

test('migrations enforce append-only semantic events and unique checkpoints', async () => {
  const events = await readFile(new URL('../supabase/migrations/20260824100000_alpha_alert_event_ledger.sql', import.meta.url), 'utf8');
  const outcomes = await readFile(new URL('../supabase/migrations/20260824101000_alpha_alert_outcome_checkpoints.sql', import.meta.url), 'utf8');
  assert.match(events, /event_identity text not null unique/); assert.match(events, /before update/); assert.match(events, /before delete/);
  assert.match(outcomes, /30, 60, 180, 300, 900, 1800, 3600/); assert.match(outcomes, /unique\s*\(alert_event_id, checkpoint_seconds\)/);
});

test('delivery integration persists before per-user fanout and keeps watchlist user-scoped', async () => {
  const delivery = await readFile(new URL('../src/services/opportunityDeliveryService.ts', import.meta.url), 'utf8');
  assert.ok(delivery.indexOf('await persistAlphaAlertEvent(opportunity)') < delivery.indexOf('for (\n    const user of users'));
  const relevance = await readFile(new URL('../src/services/alphaExitRelevance.ts', import.meta.url), 'utf8');
  assert.match(relevance, /\.eq\('telegram_id', args\.telegramId\)/); assert.match(relevance, /user_opportunity_watchlist/);
  assert.match(relevance, /wallet_activity_deliveries/);
});
