import test from 'node:test';
import assert from 'node:assert/strict';
import { extractScanContract, renderContractScreen } from '../src/bot/contractScreening.js';
const token = '0x1111111111111111111111111111111111111111';
test('contract scans reject partial, embedded and multiple addresses', () => {
  assert.equal(extractScanContract(`/scan robinhood ${token}`), token);
  assert.equal(extractScanContract(`a${token}`), null);
  assert.equal(extractScanContract(`${token}0`), null);
  assert.equal(extractScanContract(`${token} ${token}`), null);
});
test('scan card preserves genuine zero, hides missing metrics and separates FDV', () => {
  const text = renderContractScreen(token, { baseToken: { name: '<Fake>', symbol: 'TEST' }, priceUsd: '0.0001', fdv: 12000,
    txns: { m5: { buys: 5, sells: 0 } } });
  assert.match(text, /&lt;Fake&gt;/);
  assert.match(text, /FDV.*12.0K/);
  assert.doesNotMatch(text, /MC  |Vol · 5m|LP liquidity|ATH|DEX Paid/);
  assert.match(text, /5 buy \/ 0 sell/);
  assert.match(text, /not assessed/);
  assert.ok(text.length <= 1024);
});
test('unsupported market data yields one clear explanation, never a green safety claim', () => {
  const text = renderContractScreen(token, null);
  assert.match(text, /could not be verified/);
  assert.doesNotMatch(text, /SAFE|VERIFIED|\$0|Unverified\n.*Unverified/);
});
test('pre-bond PONS snapshot supplies identity, price and supply without inventing market cap or liquidity', () => {
  const text = renderContractScreen(token, null, { name: 'Launch', symbol: 'NEW', creator: token,
    decimals: 18, totalSupplyRaw: 1_000_000n * 10n ** 18n, priceUsd: 1e-10, fdvUsd: 0.0001,
    twitter: null, telegram: null });
  assert.match(text, /PONS snapshot · DEX market not indexed/);
  assert.match(text, /1e-10/); assert.match(text, /Total supply.*1,000,000/);
  assert.doesNotMatch(text, /MC  |LP liquidity|ATH/); assert.ok(text.length <= 1024);
});
test('signed hourly change and genuine zero volume remain truthful in a bounded caption', () => {
  const text = renderContractScreen(token, { baseToken: { name: '<'.repeat(60), symbol: '<'.repeat(24) },
    priceUsd: '0.000001', marketCap: 50000, liquidity: { usd: 20000 }, volume: { m5: 0, h24: 12345 },
    priceChange: { h1: -25.5 }, txns: { m5: { buys: 0, sells: 1 } } });
  assert.match(text, /Move · 1h.*-25\.50%/); assert.match(text, /Vol · 24h/);
  assert.match(text, /Vol · 5m.*0/); assert.ok(text.length <= 1024);
});

test('screen formats inactive five-minute data and age without padding or duplicate title', () => {
  const text = renderContractScreen(token, { priceUsd: '0.000010350', marketCap: 10400,
    volume: { m5: 0 }, txns: { m5: { buys: 0, sells: 0 } }, pairCreatedAt: Date.now() - 487 * 60_000 });
  assert.match(text, /Price.*\$0\.00001035<\/b>/);
  assert.match(text, /Vol · 5m.*\$0<\/b>/);
  assert.match(text, /No trades reported/);
  assert.match(text, /8h 7m/);
  assert.doesNotMatch(text, /ALPHAOS · CONTRACT SCREEN|\$0\.0000<\/b>|487m/);
});

test('reported creator identity is sourced and real zero balance remains distinct from missing balance', () => {
  const pons = { name: 'Launch', symbol: 'NEW', creator: token, decimals: 18,
    totalSupplyRaw: 1_000_000_000n * 10n ** 18n, fdvUsd: null, twitter: null, telegram: null };
  assert.doesNotMatch(renderContractScreen(token, null, pons), /Creator balance/);
  const text = renderContractScreen(token, null, pons, 0);
  assert.match(text, /Creator · PONS page/); assert.match(text, /Creator balance.*0\.00%/);
  assert.match(text, /risks not assessed/); assert.ok(text.length <= 1024);
});

test('refresh edits original photo and never sends another report even when edit fails', async () => {
  const { registerContractScreening } = await import('../src/bot/contractScreening.js');
  let action: any; let edits = 0; let sends = 0; const refreshes: boolean[] = [];
  const bot = { command() {}, on() {}, action(_pattern: unknown, handler: any) { action = handler; } };
  registerContractScreening(bot as any, async (_token, refresh) => {
    refreshes.push(!!refresh); return { text: 'Updated', image: Buffer.from('png') };
  });
  const context = (id: number, fail: boolean) => ({ chat: { id }, match: ['', token],
    async answerCbQuery() {}, async reply() { sends++; }, async replyWithPhoto() { sends++; },
    async editMessageMedia(media: any) { edits++; assert.equal(media.caption, 'Updated'); if (fail) throw new Error('timeout'); } });
  await action(context(9001, false)); await action(context(9002, true));
  assert.equal(edits, 2); assert.equal(sends, 0); assert.deepEqual(refreshes, [true, true]);
});
