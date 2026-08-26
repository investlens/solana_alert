import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { renderWalletActivityDetail, renderWalletActivityV2 } from '../src/bot/walletTracking.js';
import { normalizeWalletActivityRow, walletActivityMetadata } from '../src/services/walletActivityPresentation.js';
import { WALLET_ANALYSIS_CHUNK_BLOCKS, WALLET_ANALYSIS_LOOKBACK_BLOCKS } from '../src/services/walletHistoricalAnalysisService.js';
import type { WalletWatchEvent } from '../src/core/walletWatcher.js';

const wallet = '0xf435ac1926e21d47bfe0916bd1f15c22ca6ceb4b';
const stonkatm = '0x5571E3b04487438847566a54B59b940e6668A8c6';
const hash = '0x39c784e648cf05e918570862a3401a0a827325a914d60ec75428fdb27875cba1';

function row(type: string, metadata: Record<string, unknown> = {}) {
  return { id: 91, wallet_address: wallet, transaction_signature: hash, activity_type: type, token_address: stonkatm, created_at: '2026-08-26T00:00:00Z', metadata };
}

test('STONKATM real BUY persists and renders identity, amount and verified 0.020 ETH spend', () => {
  const event = {
    kind: 'buy', chain: 'robinhood', wallet, signature: hash, blockNumber: 46_700_244,
    timestamp: 1_777_334_400, tokenMint: stonkatm, tokenSymbol: 'STONKATM', tokenName: 'Stonk ATM',
    tokenAmount: 478_622.7287449723, tokenAmountRaw: '478622728744972325101814', tokenDecimals: 18,
    nativeAmount: 0.02, quoteSymbol: 'ETH', counterparty: '0x1111111111111111111111111111111111111111',
    amountSol: null, type: 'Token received with verified native transaction value',
  } as WalletWatchEvent;
  const metadata = walletActivityMetadata(event);
  const activity = normalizeWalletActivityRow(row('BUY', metadata));
  const rendered = renderWalletActivityV2(wallet, [activity], new Date('2026-08-26T00:18:00Z'));
  assert.match(rendered, /BOUGHT<\/b> · Stonk ATM \(STONKATM\)/);
  assert.match(rendered, /478,622\.728745 STONKATM/);
  assert.match(rendered, /0\.020 ETH/);
  assert.equal(activity.rawTokenAmount, '478622728744972325101814');
  assert.equal(activity.tokenDecimals, 18);
});

test('BUY SELL SEND and RECEIVE presentations preserve verified semantics', () => {
  const base = { token_symbol: 'STONKATM', token_name: 'Stonk ATM', normalized_token_amount: 25, timestamp: 1_777_334_400 };
  const activities = [
    normalizeWalletActivityRow(row('BUY', { ...base, native_amount: 0.02, quote_symbol: 'ETH' })),
    normalizeWalletActivityRow(row('SELL', { ...base, native_amount: 0.031, quote_symbol: 'WETH' })),
    normalizeWalletActivityRow(row('SEND', { ...base, counterparty: '0x2222222222222222222222222222222222222222' })),
    normalizeWalletActivityRow(row('RECEIVE', { ...base, counterparty: '0x3333333333333333333333333333333333333333' })),
  ];
  const rendered = renderWalletActivityV2(wallet, activities, new Date('2026-08-26T00:18:00Z'));
  assert.match(rendered, /BOUGHT/); assert.match(rendered, /SOLD/); assert.match(rendered, /SENT/); assert.match(rendered, /RECEIVED/);
  assert.match(rendered, /Received\s+0\.031 WETH/); assert.match(rendered, /To\s+0x2222/); assert.match(rendered, /From\s+0x3333/);
});

test('old sparse activity and missing metadata fall back truthfully', () => {
  const activity = normalizeWalletActivityRow(row('RECEIVE'));
  const rendered = renderWalletActivityV2(wallet, [activity], new Date('2026-08-26T00:18:00Z'));
  assert.match(rendered, /0x5571…68A8c6/i);
  assert.doesNotMatch(rendered, /Unknown \(UNKNOWN\)|0 tokens/);
});

test('activity detail retains exact CA, transaction identity and compact callback routing', async () => {
  const activity = normalizeWalletActivityRow(row('BUY', { token_symbol: 'STONKATM', token_name: 'Stonk ATM', normalized_token_amount: 478_622.7287449723, native_amount: 0.02, quote_symbol: 'ETH' }));
  const detail = renderWalletActivityDetail(activity);
  assert.match(detail, new RegExp(stonkatm));
  assert.match(detail, /WALLET TRANSACTION|BOUGHT/);
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(source, /COPY_CA_\$\{activity\.tokenContract\}/);
  assert.match(source, /robinhoodchain\.blockscout\.com\/tx\/\$\{activity\.transactionHash\}/);
  assert.match(source, /if \(target\?\.chartUrl\)/);
  for (const callback of [`COPY_CA_${stonkatm}`, 'WALLET_ACTIVITY_DETAIL_123456789_987654321']) assert.ok(Buffer.byteLength(callback) <= 64);
  assert.doesNotMatch(source, /WALLET_ACTIVITY_DETAIL_[\s\S]{0,500}Trade/);
});

test('historical analysis is bounded, read-only, and isolated from monitoring and alerts', async () => {
  assert.equal(WALLET_ANALYSIS_LOOKBACK_BLOCKS, 50_000n);
  assert.equal(WALLET_ANALYSIS_CHUNK_BLOCKS, 2_500n);
  const source = await readFile(new URL('../src/services/walletHistoricalAnalysisService.ts', import.meta.url), 'utf8');
  assert.match(source, /KNOWN_PONS_EMITTERS_BOUNDED/);
  assert.match(source, /wallet_intelligence_analyses/);
  assert.doesNotMatch(source, /wallet_monitor_cursors|commitRobinhoodWalletCheckpoints|deliverTrackedWalletActivity|sendTelegram|persistAlphaSemanticEvent|executeTrade/);
});

test('Analyze Wallet is Robinhood-only and launch history is safely capped', async () => {
  const source = await readFile(new URL('../src/bot/walletTracking.ts', import.meta.url), 'utf8');
  assert.match(source, /WALLET_INTEL_ANALYZE_/);
  assert.match(source, /wallet\.chain !== 'robinhood'/);
  assert.match(source, /launches\.tokens\.slice\(0, 6\)/);
  assert.doesNotMatch(source, /WALLET_INTEL_ANALYZE_[\s\S]{0,900}setTrackedWalletActive/);
});
