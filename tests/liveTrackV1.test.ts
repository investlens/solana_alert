import 'dotenv/config';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LIVE_TRACK_FAST_INTERVAL_MS, LIVE_TRACK_NORMAL_INTERVAL_MS, buildLiveTrackButtons,
  captureLiveTrackSnapshot, marketFreshnessAgeMs, meaningfulLiveTrackTransitions, mergeLiveTrackSnapshot,
  nextLiveTrackDelayMs, renderLiveTrackMessage,
  type LiveTrackSession, type LiveTrackSnapshot,
} from '../src/services/liveTrackService.js';
import { boostMetadataFallback, mergeBoostMetadata } from '../src/chains/robinhood/boostMetadataResolver.js';

const snapshot = (patch: Partial<LiveTrackSnapshot> = {}): LiveTrackSnapshot => ({
  observedAt: '2026-09-01T00:00:00.000Z', source: 'DEXSCREENER', name: 'Alpha', symbol: 'ALPHA',
  price: 1, marketCap: 100_000, liquidity: 20_000, volume5m: 5_000, buys5m: 20, sells5m: 10,
  devHolding: null, devBurn: null, devSell: null, devTransfer: null, boostTotal: 200, dexPaid: true,
  intelligenceState: 'BUILDING', lifecycleState: 'TRACK', chartUrl: 'https://dexscreener.com/robinhood/pair', ...patch,
});
const session = (latest = snapshot()): LiveTrackSession => ({ id: '12345678-1234-1234-1234-123456789012',
  user_id: 'u1', chain: 'robinhood', token_address: '0x1111111111111111111111111111111111111111', opportunity_id: 1,
  started_at: '2026-09-01T00:00:00.000Z', expires_at: '2026-09-01T00:15:00.000Z', status: 'ACTIVE',
  telegram_chat_id: 'u1', telegram_message_id: 7, baseline: snapshot(), latest, peak: {},
  next_update_at: '2026-09-01T00:00:15.000Z', last_observed_at: latest.observedAt });

test('Track captures an immediate verified baseline and retains honest unknown intelligence', async () => {
  const value = await captureLiveTrackSnapshot({ chain: 'robinhood', token: '0x1' }, {
    now: () => new Date('2026-09-01T00:00:00Z'),
    market: async () => ({ source: 'DEXSCREENER', price: .25, marketCap: null, liquidity: 9_000,
      volume5m: 500, buys5m: 4, sells5m: 2 }),
    evidence: async () => ({ devHolding: null, devSell: null, dexPaid: true, boostTotal: 50 }),
    send: async () => null, edit: async () => {},
  });
  assert.equal(value.price, .25); assert.equal(value.marketCap, null);
  assert.equal(value.devHolding, null); assert.equal(value.dexPaid, true);
});

test('cadence is 15s for first two minutes then 30s', () => {
  const start = new Date('2026-09-01T00:00:00Z');
  assert.equal(nextLiveTrackDelayMs(start, new Date(start.getTime() + 119_999)), LIVE_TRACK_FAST_INTERVAL_MS);
  assert.equal(nextLiveTrackDelayMs(start, new Date(start.getTime() + 120_000)), LIVE_TRACK_NORMAL_INTERVAL_MS);
});

test('last-known-good market and identity survive misses, then recovered verified fields replace them', () => {
  const good = snapshot({ observedAt: '2026-09-01T00:00:00Z', fieldFreshness: {
    price: { verifiedAt: '2026-09-01T00:00:00Z', source: 'DEXSCREENER' },
    marketCap: { verifiedAt: '2026-09-01T00:00:00Z', source: 'DEXSCREENER' },
    liquidity: { verifiedAt: '2026-09-01T00:00:00Z', source: 'DEXSCREENER' },
    name: { verifiedAt: '2026-09-01T00:00:00Z', source: 'DEXSCREENER' },
    symbol: { verifiedAt: '2026-09-01T00:00:00Z', source: 'DEXSCREENER' },
  } });
  const miss = snapshot({ observedAt: '2026-09-01T00:00:20Z', source: null, name: null, symbol: null,
    price: null, marketCap: null, liquidity: null, volume5m: null, buys5m: null, sells5m: null,
    chartUrl: null, marketRefreshMiss: true, fieldFreshness: {} });
  const carried = mergeLiveTrackSnapshot(good, miss);
  assert.equal(carried.price, 1); assert.equal(carried.marketCap, 100_000); assert.equal(carried.liquidity, 20_000);
  assert.equal(carried.name, 'Alpha'); assert.equal(carried.symbol, 'ALPHA'); assert.equal(marketFreshnessAgeMs(carried), 20_000);
  assert.match(renderLiveTrackMessage(session(carried)), /Market refresh delayed · last verified 20s ago/);
  const repeated = mergeLiveTrackSnapshot(carried, { ...miss, observedAt: '2026-09-01T00:01:20Z' });
  assert.equal(marketFreshnessAgeMs(repeated), 80_000);
  assert.match(renderLiveTrackMessage(session(repeated)), /STALE.*last verified 1m 20s ago/s);
  const recovered = mergeLiveTrackSnapshot(repeated, snapshot({ observedAt: '2026-09-01T00:01:40Z', price: 1.2,
    marketCap: 120_000, fieldFreshness: { price: { verifiedAt: '2026-09-01T00:01:40Z', source: 'DEXSCREENER' },
      marketCap: { verifiedAt: '2026-09-01T00:01:40Z', source: 'DEXSCREENER' } } }));
  assert.equal(recovered.price, 1.2); assert.equal(recovered.marketCap, 120_000); assert.equal(marketFreshnessAgeMs(recovered), 0);
});

test('unknown intelligence cannot erase evidence, while verified dev SELL updates immediately', () => {
  const known = snapshot({ devHolding: 3.5, devSell: null });
  const unknown = mergeLiveTrackSnapshot(known, snapshot({ devHolding: null, devSell: null }));
  assert.equal(unknown.devHolding, 3.5); assert.equal(unknown.devSell, null);
  const sell = mergeLiveTrackSnapshot(unknown, snapshot({ devHolding: null, devSell: true }));
  assert.equal(sell.devHolding, 3.5); assert.equal(sell.devSell, true);
});

test('Telegram UX edits one durable message and never labels FDV as market cap', async () => {
  const rendered = renderLiveTrackMessage(session(snapshot({ marketCap: null, devHolding: null })));
  assert.match(rendered, /Market Cap\s+<b>Unavailable<\/b>/); assert.match(rendered, /Dev holding\s+<b>Unknown<\/b>/);
  assert.doesNotMatch(rendered, /FDV/);
  assert.deepEqual(buildLiveTrackButtons(session()).map(row => row.map(button => button.text)),
    [['📊 Chart', '🔎 Token'], ['🔬 Full Intel'], ['📋 Copy CA'], ['⏹ Stop Track', '⏱ +15m']]);
  const source = await readFile(new URL('../src/services/liveTrackService.ts', import.meta.url), 'utf8');
  assert.match(source, /dependencies\.edit\(session\.telegram_chat_id/);
  assert.doesNotMatch(source.slice(source.indexOf('updateLiveTrackSession'), source.indexOf('stopLiveTrack')), /dependencies\.send\(session\.telegram_chat_id,\s*renderLiveTrackMessage/);
});

test('meaningful transitions and milestones are one-key candidates with no duplicate engine', () => {
  const transitions = meaningfulLiveTrackTransitions(snapshot(), snapshot({ price: 2.1, liquidity: 4_000,
    devSell: true, intelligenceState: 'BREAKOUT' }));
  assert.deepEqual(transitions, ['BREAKOUT', 'DEV_SELL', 'MATERIAL_LIQUIDITY_DROP', 'MILESTONE_20', 'MILESTONE_50', 'MILESTONE_100']);
});

test('migration provides expiry recovery, learning timeline, dedup and per-user/token isolation', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260901120000_alphaos_live_track_v1.sql', import.meta.url), 'utf8');
  assert.match(sql, /expires_at timestamptz not null/); assert.match(sql, /alpha_live_track_observations/);
  assert.match(sql, /unique\(session_id, transition_key\)/); assert.match(sql, /user_id, chain, token_address/);
  assert.match(sql, /where status = 'ACTIVE'/); assert.match(sql, /enable row level security/g);
});

test('Stop, Extend, restart recovery and provider governance are wired without trading changes', async () => {
  const [service, actions, main, market] = await Promise.all([
    readFile(new URL('../src/services/liveTrackService.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/bot/opportunityActions.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/main.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/chains/robinhood/market.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(actions, /LT_STOP_/); assert.match(actions, /LT_EXT_/); assert.match(main, /startLiveTrackService\(\)/);
  assert.match(service, /status: 'EXPIRED'/); assert.match(service, /caller: 'alpha_live_track'/);
  assert.match(service, /raw_refresh/); assert.match(service, /carried_forward_fields/);
  assert.match(service, /LIVE_TRACK_HYDRATION_BUDGET_MS/); assert.match(service, /Late intelligence hydration/);
  assert.match(service, /evidence: async \(\) => \(\{\}\)/); // baseline market fetch does not duplicate hydration
  assert.match(service, /session\.telegram_message_id[\s\S]*dependencies\.edit/); // late hydration edits durable message
  assert.doesNotMatch(service, /setInterval\([\s\S]{0,120}evidence/); // no new intelligence polling loop
  assert.match(market, /governedDexScreenerJson/); assert.doesNotMatch(service, /executeTrade|autoBuy|CHECK_ENTRY|BUY/);
});

test('BOOST metadata uses complete cached identity, truthful fallback and late safe edit', async () => {
  assert.deepEqual(mergeBoostMetadata({ symbol: 'AAA' }, { name: 'Alpha', symbol: 'OLD' }),
    { name: 'Alpha', symbol: 'AAA', source: null });
  assert.match(boostMetadataFallback('0x1111111111111111111111111111111111111111').symbol!, /^0x111111…111111$/);
  const [boost, resolver, delivery] = await Promise.all([
    readFile(new URL('../src/chains/robinhood/robinhoodBoostObserver.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/chains/robinhood/boostMetadataResolver.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/services/alphaSemanticDeliveryService.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(resolver, /token_intelligence_cache/); assert.match(resolver, /robinhood_observations/);
  assert.match(resolver, /getRobinhoodTokenMetadata/); assert.match(boost, /enrichDeliveredBoostAlert/);
  assert.match(boost, /editTelegramMessage/); assert.match(delivery, /telegram_message_id/);
  assert.match(boost, /BOOST_INTERVAL_MS\s*=\s*15_000/);
});
