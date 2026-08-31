import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderXAccountList } from '../src/bot/xIntelligenceAdmin.js';
import { ingestXMention, xMentionIdentity, xMentionIsUserFacingEligible, type XMentionObservation } from '../src/services/xMentionIngestionService.js';
import { defaultStrategyEnabledForUser } from '../src/services/strategyService.js';
import { normalizeXHandle, type XReputedAccount } from '../src/services/xReputedAccountService.js';
import { boundedXPostExcerpt, renderXMentionNotification, safeXPostUrl, xMentionButtons } from '../src/ui/xMentionNotification.js';

const address = '0x1111111111111111111111111111111111111111';
const account: XReputedAccount = { id: 1, handle: 'exampleaccount', display_name: 'Example', enabled: true,
  tier: 'REPUTED', source: 'ADMIN_MANUAL', source_rank: null, source_metrics: {}, notes: null,
  added_by: 'admin', created_at: '2026-08-31T00:00:00Z', updated_at: '2026-08-31T00:00:00Z' };
const observation: XMentionObservation = { xHandle: '@ExampleAccount', postId: '123456789',
  postUrl: 'https://x.com/exampleaccount/status/123456789', postCreatedAt: '2026-08-31T00:00:00Z',
  postExcerpt: '<b>look</b> https://evil.example', tokenAddress: address, tokenSymbol: 'BIRD', tokenName: 'Bird Token',
  chain: 'robinhood', tokenMatchMethod: 'EXACT_CA', tokenMatchConfidence: 1, source: 'TEST_FIXTURE' };

test('X handles normalize case-insensitively and reject malformed identities', () => {
  assert.equal(normalizeXHandle('@ExampleAccount'), 'exampleaccount');
  assert.equal(normalizeXHandle('exampleaccount'), 'exampleaccount');
  assert.equal(normalizeXHandle('EXAMPLEACCOUNT'), 'exampleaccount');
  assert.throws(() => normalizeXHandle('bad.handle'));
  assert.throws(() => normalizeXHandle('@'));
});

test('X match eligibility requires an actual Robinhood contract and strong match method', () => {
  assert.equal(xMentionIsUserFacingEligible(observation), true);
  assert.equal(xMentionIsUserFacingEligible({ ...observation, tokenMatchMethod: 'TOKEN_LINK_RESOLVED' }), true);
  assert.equal(xMentionIsUserFacingEligible({ ...observation, tokenMatchMethod: 'TICKER_ONLY' }), false);
  assert.equal(xMentionIsUserFacingEligible({ ...observation, tokenMatchMethod: 'NAME_ONLY' }), false);
  assert.equal(xMentionIsUserFacingEligible({ ...observation, tokenAddress: null }), false);
  assert.equal(xMentionIsUserFacingEligible({ ...observation, chain: 'solana' }), false);
});

test('X post identity is normalized and deterministic per post and contract', () => {
  assert.equal(xMentionIdentity(observation), `exampleaccount:123456789:${address}`);
  assert.equal(xMentionIdentity({ ...observation, xHandle: 'EXAMPLEACCOUNT' }), xMentionIdentity(observation));
  assert.throws(() => xMentionIdentity({ ...observation, postId: 'not-a-post' }));
  assert.equal(safeXPostUrl(observation.postUrl)?.startsWith('https://x.com/'), true);
  assert.equal(safeXPostUrl('javascript:alert(1)'), null);
  assert.equal(safeXPostUrl('https://example.com/status/123'), null);
});

test('disabled and weak X observations cannot persist or deliver', async () => {
  let persisted = 0; let delivered = 0;
  const dependencies = { accountByHandle: async () => ({ ...account, enabled: false }),
    persist: async () => { persisted += 1; return { id: 10, event_identity: 'x' }; },
    deliver: async () => { delivered += 1; return { delivered: 1, failed: 0 }; } };
  assert.deepEqual(await ingestXMention(observation, dependencies), { status: 'ACCOUNT_DISABLED' });
  assert.equal(persisted, 0); assert.equal(delivered, 0);
  dependencies.accountByHandle = async () => account;
  assert.deepEqual(await ingestXMention({ ...observation, tokenMatchMethod: 'TICKER_ONLY' }, dependencies), { status: 'NOT_USER_FACING' });
  assert.equal(persisted, 0); assert.equal(delivered, 0);
});

test('eligible rediscovery uses one semantic identity and durable delivery dedup contract', async () => {
  const persistedIdentities: string[] = []; const deliveredIds = new Set<number>(); let sends = 0;
  const dependencies = { accountByHandle: async () => account,
    persist: async (args: any) => { persistedIdentities.push(args.identity); return { id: 44, event_identity: `v2:X_REPUTED_MENTION:${args.identity}` }; },
    deliver: async (args: any) => { if (!deliveredIds.has(args.event.id)) { deliveredIds.add(args.event.id); sends += 1; }
      return { delivered: 1, failed: 0 }; } };
  assert.equal((await ingestXMention(observation, dependencies)).status, 'DELIVERED');
  assert.equal((await ingestXMention(observation, dependencies)).status, 'DELIVERED');
  assert.deepEqual(new Set(persistedIdentities), new Set([xMentionIdentity(observation)]));
  assert.equal(sends, 1);
});

test('X renderer is bounded, escaped, truthful with sparse context, and has no Trade action', () => {
  const oversized = `<script>${'bird '.repeat(200)}</script>`;
  const message = renderXMentionNotification({ handle: 'example_account', accountTier: 'REPUTED',
    postExcerpt: oversized, tokenAddress: address, tokenSymbol: '<BIRD>', matchMethod: 'EXACT_CA', market: null });
  assert.match(message, /🐦 <b>REPUTED X MENTION<\/b>/);
  assert.match(message, /&lt;BIRD&gt;/); assert.doesNotMatch(message, /<script>/);
  assert.doesNotMatch(message, /Market Cap|FDV|Liquidity|UNKNOWN/);
  assert.ok(boundedXPostExcerpt(oversized).length <= 280);
  const enriched = renderXMentionNotification({ handle: 'example', accountTier: 'HIGH_ALPHA', postExcerpt: 'Verified post',
    tokenAddress: address, matchMethod: 'TOKEN_LINK_RESOLVED', market: { marketCap: 128_000, fdv: 200_000,
      liquidity: 24_000, volume5m: 8_000, pairAge: '3h' } });
  assert.match(enriched, /Market Cap: <b>\$128\.0K<\/b>/); assert.doesNotMatch(enriched, /FDV:/);
  const buttons = xMentionButtons({ postUrl: observation.postUrl, chartUrl: 'https://dexscreener.com/robinhood/pair', tokenAddress: address });
  assert.deepEqual(buttons[0].map(button => button.text), ['🐦 View Post', '📊 Chart']);
  assert.equal(buttons.flat().some(button => /Trade/i.test(button.text)), false);
  assert.equal(buttons.flat().every(button => !button.callback_data || Buffer.byteLength(button.callback_data) <= 64), true);
});

test('Admin X management is bounded, database-backed, and manual accounts default WATCH', async () => {
  const [service, admin, menu, migration] = await Promise.all([
    readFile(new URL('../src/services/xReputedAccountService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/bot/xIntelligenceAdmin.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/bot/menus.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260831160226_x_intelligence_foundation.sql', import.meta.url), 'utf8'),
  ]);
  assert.match(service, /tier: 'WATCH'[\s\S]*source: 'ADMIN_MANUAL'/);
  assert.match(service, /code === '23505'/); // database uniqueness is surfaced as a duplicate
  assert.match(service, /Math\.min\(10/); assert.match(admin, /const PAGE_SIZE = 8/);
  assert.match(admin, /setXReputedAccountEnabled/); assert.match(admin, /setXReputedAccountTier/);
  assert.match(admin, /removeXReputedAccount/); assert.match(admin, /config\.adminTelegramId/);
  assert.match(menu, /X_INTEL_HOME/);
  assert.match(migration, /unique index[\s\S]*lower\(handle\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all[\s\S]*anon, authenticated/i);
  const many = Array.from({ length: 8 }, (_, i) => ({ ...account, id: i + 1, handle: `account_${i}` }));
  const list = renderXAccountList(many, 1, 18);
  assert.equal((list.match(/🟢/g) ?? []).length, 8);
  assert.ok(list.length < 4096);
});

test('X preference defaults OFF and no discovery poller starts with the application', async () => {
  assert.equal(defaultStrategyEnabledForUser('X_REPUTED_MENTION'), false);
  assert.equal(defaultStrategyEnabledForUser('DEX_PAID'), false);
  assert.equal(defaultStrategyEnabledForUser('PONS_BREAKOUT'), true);
  const [index, ingestion, migration] = await Promise.all([
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/xMentionIngestionService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../supabase/migrations/20260831160226_x_intelligence_foundation.sql', import.meta.url), 'utf8'),
  ]);
  assert.doesNotMatch(index, /X_REPUTED|XMention|xMention|X Intelligence/);
  assert.doesNotMatch(ingestion, /setInterval|setTimeout|cron|fetch\(/);
  assert.match(migration, /'X_REPUTED_MENTION'[\s\S]*false, 'manual', 'WATCH'/);
  assert.doesNotMatch(migration, /insert into public\.x_reputed_accounts/i);
});
