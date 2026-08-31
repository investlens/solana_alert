import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { parseDexScreenerPaidOrders, scanRobinhoodDexPaid } from '../src/chains/robinhood/security/dexPaidScanner.js';
import { buildAlphaSemanticEvent } from '../src/services/alphaSemanticEventService.js';
import { resetDexScreenerGovernorForTests } from '../src/services/dexscreenerRequestGovernor.js';

const token = '0x698F8994e59f4d2586C46817788cc915D1069420';
const paymentTimestamp = 1_788_058_073_247;
const response = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

test('current DexScreener orders object produces verified DEX Paid evidence', async () => {
  resetDexScreenerGovernorForTests({ fetch: async () => response({ orders: [{ chainId: 'robinhood', tokenAddress: token,
    type: 'tokenProfile', status: 'approved', paymentTimestamp }], boosts: [] }) });
  const result = await scanRobinhoodDexPaid(token);
  assert.equal(result.dexPaid, true); assert.equal(result.status, 'PAID');
  assert.deepEqual(result.orderTypes, ['tokenProfile']); assert.equal(result.latestPaymentTimestamp, paymentTimestamp);
});

test('legacy top-level order arrays remain supported and malformed responses remain UNKNOWN', async () => {
  assert.equal(parseDexScreenerPaidOrders([{ type: 'tokenProfile', status: 'approved', paymentTimestamp }]).malformed, false);
  assert.equal(parseDexScreenerPaidOrders([null, { type: 'tokenProfile', paymentTimestamp }]).malformed, true);
  resetDexScreenerGovernorForTests({ fetch: async () => response({ unexpected: [] }) });
  const result = await scanRobinhoodDexPaid(token);
  assert.equal(result.dexPaid, null); assert.equal(result.status, 'UNKNOWN'); assert.match(result.warnings[0]!, /malformed/);
});

test('DEX Paid semantic identity is deterministic and cannot collide with BOOST', () => {
  const rawSnapshot = { paymentTimestamp, orderTypes: ['tokenProfile'], price: 0.0001,
    priceProvenance: 'DEXSCREENER_VERIFIED_BASE_PAIR' };
  const dexPaid = buildAlphaSemanticEvent({ identity: `${token.toLowerCase()}:${paymentTimestamp}`,
    type: 'DEX_PAID', assetId: token, chain: 'robinhood', intelligenceState: 'FORMING', rawSnapshot });
  const duplicate = buildAlphaSemanticEvent({ identity: `${token.toLowerCase()}:${paymentTimestamp}`,
    type: 'DEX_PAID', assetId: token, chain: 'robinhood', intelligenceState: 'FORMING', rawSnapshot });
  const boost = buildAlphaSemanticEvent({ identity: `${token.toLowerCase()}:${paymentTimestamp}`,
    type: 'BOOST', assetId: token, chain: 'robinhood', rawSnapshot });
  assert.equal(dexPaid.event_identity, duplicate.event_identity);
  assert.notEqual(dexPaid.event_identity, boost.event_identity);
  assert.equal(dexPaid.lifecycle_action, 'OBSERVE'); assert.equal(dexPaid.semantic_event_type, 'DEX_PAID');
});

test('DEX Paid remains NORMAL priority and uses immutable semantic event plus shared durable delivery', async () => {
  const [scanner, observer, delivery] = await Promise.all([
    readFile(new URL('../src/chains/robinhood/security/dexPaidScanner.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/chains/robinhood/robinhoodObserver.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/alphaSemanticDeliveryService.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(scanner, /caller: 'robinhood_dex_paid', priority: 'NORMAL'/);
  assert.match(observer, /persistOrLoadAlphaSemanticEventRecord\(\{[\s\S]{0,160}type: 'DEX_PAID'/);
  assert.match(observer, /deliverAlphaSemanticEvent\(\{ event:[\s\S]{0,180}type: 'DEX_PAID'/);
  assert.ok(observer.indexOf('processRobinhoodDexPaidDiscoverySlice(discovery.tokens)') <
    observer.indexOf('await evaluateCandidate('), 'DEX Paid must run before actionable candidate gates');
  assert.match(delivery, /reserve_alpha_semantic_delivery/); assert.match(delivery, /deliverReservedTelegram/);
  assert.doesNotMatch(observer, /type: 'DEX_PAID'[\s\S]{0,200}(BUY|CHECK_ENTRY|RUNNER_50|RUNNER_100)/);
});

test('duplicate governed DEX Paid observations retain cache dedup without extra provider traffic', async () => {
  let calls = 0;
  resetDexScreenerGovernorForTests({ fetch: async () => { calls++; return response({ orders: [{ type: 'tokenProfile',
    status: 'approved', paymentTimestamp }] }); } });
  assert.equal((await scanRobinhoodDexPaid(token)).dexPaid, true);
  assert.equal((await scanRobinhoodDexPaid(token.toLowerCase())).dexPaid, true);
  assert.equal(calls, 1);
});
