import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DELIVERY_LEASE_SECONDS,
  reclaimReservationLease,
  reservationCanBeReclaimed,
} from '../src/services/reservationLease.js';

test('fresh reservation blocks duplicate while stale reservation is reclaimable', () => {
  const now = Date.parse('2026-08-23T18:00:00Z');
  assert.equal(reservationCanBeReclaimed({ state: 'RESERVED', reservedAt: now - 10_000, now }), false);
  assert.equal(reservationCanBeReclaimed({
    state: 'RESERVED', reservedAt: now - DELIVERY_LEASE_SECONDS * 1000, now,
  }), true);
});

test('delivered reservation can never be reclaimed', () => {
  assert.equal(reservationCanBeReclaimed({ state: 'DELIVERED', reservedAt: 0, now: Date.now() }), false);
});

test('two competing stale reclaim attempts cannot both win against refreshed state', () => {
  const now = Date.parse('2026-08-23T18:00:00Z');
  const stale = { state: 'RESERVED', reservedAt: now - 600_000, leaseToken: 'old' } as const;
  const first = reclaimReservationLease(stale, { now, leaseToken: 'worker-a' });
  assert.ok(first);
  const second = reclaimReservationLease(first!, { now, leaseToken: 'worker-b' });
  assert.equal(second, null);
});

test('persisted stale reservation is structurally recoverable after restart', () => {
  const serialized = JSON.stringify({ state: 'RESERVED', reservedAt: '2026-08-23T17:00:00Z', leaseToken: 'dead-process' });
  const restored = JSON.parse(serialized);
  assert.ok(reclaimReservationLease(restored, {
    now: Date.parse('2026-08-23T18:00:00Z'), leaseToken: 'new-process',
  }));
});

test('compatibility migration supports old and new delivery identities', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260823180000_delivery_rollout_compatibility_and_leases.sql', import.meta.url), 'utf8');
  assert.match(sql, /alter column delivery_identity set default 'legacy:auto'/);
  assert.match(sql, /new\.delivery_identity is null or new\.delivery_identity = 'legacy:auto'/);
  assert.match(sql, /upper\(coalesce\(new\.recommended_action, 'UNKNOWN'\)\)/);
  assert.match(sql, /before insert on public\.opportunity_deliveries/);
  assert.match(sql, /on conflict \(opportunity_id, telegram_id, delivery_channel, delivery_identity\)/);
  assert.match(sql, /metadata ->> 'state' = 'RESERVED'/);
  assert.match(sql, /reserved_at[\s\S]*make_interval/);
  assert.doesNotMatch(sql, /drop table|truncate/i);
});

test('lease claims are atomic and restricted to service role', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260823180000_delivery_rollout_compatibility_and_leases.sql', import.meta.url), 'utf8');
  assert.match(sql, /update public\.opportunity_deliveries[\s\S]*metadata ->> 'state' = 'RESERVED'[\s\S]*returning id into claimed_id/);
  assert.match(sql, /update public\.wallet_activity_deliveries[\s\S]*metadata ->> 'state' = 'RESERVED'[\s\S]*returning id into claimed_id/);
  assert.match(sql, /revoke all[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
});

test('payment exits clear payment ownership on Back, start, Cancel, Home and success', async () => {
  const source = await readFile(new URL('../src/bot/commands.ts', import.meta.url), 'utf8');
  assert.match(source, /bot\.start\([\s\S]{0,260}clearPaymentInputState\(telegramId\)/);
  assert.match(source, /MAIN_MENU[\s\S]{0,180}clearPaymentInputState\(telegramId\)/);
  assert.match(source, /\['PREMIUM', 'MEMBERSHIP_HOME'\][\s\S]{0,140}clearPaymentInputState/);
  assert.match(source, /UPGRADE_CANCEL[\s\S]{0,180}clearPaymentInputState\(telegramId\)/);
  assert.match(source, /createPendingPayment\([\s\S]{0,420}clearPaymentInputState\(telegramId\)/);
  assert.match(source, /invalid payment signature|does not look like a valid Solana transaction signature/i);
});

test('contained trading restoration executes exactly once during startup', async () => {
  const source = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.equal((source.match(/await restoreOpenTradesForStartup\(\)/g) ?? []).length, 1);
});

test('release safety check reports only state and never secret values', async () => {
  const source = await readFile(new URL('../scripts/releaseSafetyCheck.ts', import.meta.url), 'utf8');
  assert.match(source, /adminTradingEnabled === false/);
  assert.match(source, /executionMode === 'paper'/);
  assert.match(source, /adminAutoBuyEnabled === false/);
  assert.doesNotMatch(source, /adminTradingPrivateKey|SUPABASE_SERVICE_ROLE_KEY|TELEGRAM_BOT_TOKEN/);
});
