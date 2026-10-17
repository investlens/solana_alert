import test from 'node:test';
import assert from 'node:assert/strict';
import { compareReportedDemand, readReportedDemandWindow } from '../src/services/confirmedDemandShadow.js';
const token = '0x' + '1'.repeat(40), creator = '0x' + '2'.repeat(40), buyer = '0x' + '3'.repeat(40), venue = '0x' + '4'.repeat(40);
const scope = (observedAt = 1_000_000) => ({ token, creator, venue, observedAt });
const trade = (index = 0, timestamp = 990, trader = buyer, side = 'buy') => {
  const txHash = '0x' + 'a'.repeat(64);
  return { id: txHash + ':' + index, txHash, trader, side, timestamp, quoteAmount: 0.1 };
};
const read = (items: any[], nextCursor: unknown = null, at = 1_000_000) => readReportedDemandWindow(scope(at), { items, nextCursor });
test('reports activity without claiming independent demand or eligibility', () => {
  const first = read([trade(), trade(1, 980, creator), trade(2, 970, buyer, 'sell')]).window!;
  const second = read([trade(3, 1290), trade(4, 1280, creator, 'sell')], null, 1_300_000).window!;
  const result = compareReportedDemand(first, second);
  assert.equal(result.first.reportedNonCreatorBuyWallets, 1);
  assert.equal(result.first.reportedNonCreatorBuyQuote, 0.1);
  assert.equal(result.reportedRepeatBuyWallets, 1);
  assert.equal(result.second.reportedCreatorSells, 1);
  assert.equal(result.eligibleForAlert, false);
  assert.ok(result.missing.includes('RELATED_WALLET_ASSESSMENT'));
  assert.ok(result.missing.includes('EXECUTABLE_EXIT_DEPTH'));
});
test('partial, unordered and unscoped pages cannot establish a complete window', () => {
  assert.equal(read([trade()], 'more').reason, 'INCOMPLETE_WINDOW');
  assert.equal(read([trade(), trade(1, 700)], 'more').window?.trades.length, 1);
  assert.equal(read([trade(1, 700), trade()], 'more').reason, 'UNORDERED_PAGE');
  assert.equal(readReportedDemandWindow(scope(), { items: [] }).window, null);
  assert.equal(readReportedDemandWindow({ ...scope(), venue: token.replace(/1/g, '0') }, {}).reason, 'INVALID_SCOPE');
  assert.equal(readReportedDemandWindow(undefined as any, {}).reason, 'INVALID_SCOPE');
});
test('rejects missing identity, malformed amounts, future and duplicate trades', () => {
  for (const change of [{ trader: null }, { quoteAmount: NaN }, { quoteAmount: 0 }, { timestamp: 1001 },
    { txHash: token }, { id: 'arbitrary' }, { side: 'transfer' }, { timestamp: -1 }]) {
    assert.equal(read([{ ...trade(), ...change }]).reason, 'INVALID_TRADE');
  }
  assert.equal(read([trade(), trade()]).reason, 'DUPLICATE_TRADE');
  assert.equal(read([trade(), { ...trade(), id: trade().txHash + ':00' }]).reason, 'DUPLICATE_TRADE');
  assert.equal(read(Array.from({ length: 101 }, (_, i) => trade(i))).reason, 'INVALID_OR_OVERSIZED_PAGE');
});
test('overlap, long gaps, token and venue changes cannot masquerade as retention', () => {
  const first = read([trade()]).window!;
  for (const at of [1_200_000, 1_400_000]) {
    assert.throws(() => compareReportedDemand(first, read([trade(1, at / 1000 - 1)], null, at).window!), /Windows/);
  }
  const second = read([trade(1, 1290)], null, 1_300_000).window!;
  for (const key of ['token', 'creator', 'venue']) assert.throws(() => compareReportedDemand(first, { ...second, [key]: buyer }), /changed/);
  assert.throws(() => compareReportedDemand(first, { ...second, trades: [null] } as any), /Invalid/);
});
test('zero reported creator sales still leaves distribution and sellability unknown', () => {
  const first = read([trade()]).window!, second = read([trade(1, 1290)], null, 1_300_000).window!;
  const r = compareReportedDemand(first, second);
  assert.equal(r.second.reportedCreatorSells, 0);
  assert.ok(r.missing.includes('CREATOR_DISTRIBUTION_COVERAGE'));
  assert.equal(r.eligibleForAlert, false);
  assert.equal(compareReportedDemand({ ...first, trades: [{ ...first.trades[0], wallet: creator.toUpperCase().replace('0X', '0x') }] }, second).first.reportedNonCreatorBuyWallets, 0);
});
test('empty complete pages are evidence of no reported activity, never a positive signal', () => {
  const r = compareReportedDemand(read([]).window!, read([], null, 1_300_000).window!);
  assert.equal(r.first.reportedSells, 0); assert.equal(r.reportedRepeatBuyWallets, 0); assert.equal(r.eligibleForAlert, false);
});
