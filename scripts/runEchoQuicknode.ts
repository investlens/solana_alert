import 'dotenv/config';
import { createServer } from 'node:http';
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { EchoStore } from '../src/echo/store.js';
import { ECHO_WALLETS, echoCard } from '../src/echo/signals.js';
import { extractRpcEchoSignals, classifyEchoRejection, type EchoRejectReason } from '../src/echo/rpcSignals.js';
import { EchoQueue } from '../src/echo/queue.js';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { readEchoTransaction } from '../src/echo/readTransaction.js';

// Independent executable: no shared startup/config, database, bot polling,
// Helius requests, private keys or trade execution imports.
const config = readQuicknodeEchoConfig(process.env);
const store = new EchoStore(config.statePath); await store.load();
let backoffUntil = 0, lastRpcAt: number | null = null, lastDeliveryAt: number | null = null;
let deliveryBackoffUntil = 0;
let lastErrorAt: number | null = null, lastReconcileAt: number | null = null, stopping = false;
const diagnostics = { fetched: 0, signals: 0, delivered: 0, noSignal: 0, rpcFailures: 0, deliveryFailures: 0 };
const rejectionCounts: Partial<Record<EchoRejectReason, number>> = {};
async function rpc(method: string, params: unknown[] = []) {
  if (Date.now() < backoffUntil) throw new Error('RPC backing off');
  try {
    const response = await fetch(config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    if (response.status === 429) {
      const retry = Number(response.headers.get('retry-after'));
      backoffUntil = Date.now() + Math.min(300_000, Math.max(30_000, Number.isFinite(retry) ? retry * 1000 : 60_000));
    }
    if (!response.ok) { console.warn('[Echo] RPC_HTTP_FAILURE', { method, status: response.status }); throw new Error('RPC HTTP failure'); }
    const data = await response.json();
    if (data.error && (data.error.code === 429 || data.error.code === -32005 || /rate.?limit|credits.*exceed/i.test(String(data.error.message)))) backoffUntil = Date.now() + 60_000;
    if (data.error || !Object.prototype.hasOwnProperty.call(data, 'result')) {
      console.warn('[Echo] RPC_RESPONSE_FAILURE', { method, code: Number.isFinite(data.error?.code) ? data.error.code : null });
      throw new Error('RPC response failure');
    }
    lastRpcAt = Date.now(); return data.result;
  } catch { diagnostics.rpcFailures++; lastErrorAt = Date.now(); throw new Error(`Echo RPC ${method} unavailable`); }
}
if (await rpc('getGenesisHash') !== '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d') throw new Error('Echo RPC is not Solana mainnet');
// Read-only Telegram validation. Never sends a dummy alert or starts getUpdates.
const bot = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`, { signal: AbortSignal.timeout(8_000) }).then(r => r.json()).catch(() => null);
if (!bot?.ok || bot.result?.is_bot !== true) throw new Error('Echo Telegram authentication unavailable');

// Optional one-shot read-only rollout diagnostic. Historical replay is evaluated
// in isolation at its block time and NEVER enters the queue or Telegram delivery.
const validationSignature = process.env.ECHO_VALIDATE_V1_SIGNATURE?.trim();
if (validationSignature) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(validationSignature)) throw new Error('Invalid Echo diagnostic signature');
  try {
    const sample = await readEchoTransaction(validationSignature, rpc);
    const signals = sample == null ? [] : extractRpcEchoSignals(sample, validationSignature, sample.blockTime + 1);
    console.log('[Echo] V1_API_PROBE', { version: sample?.version ?? null, parsedSignals: signals.length, historicalOnly: true,
      delivered: false, status: sample?.version === 1 && signals.length > 0 ? 'OK' : 'UNVERIFIED' });
  } catch { console.warn('[Echo] V1_API_PROBE', { status: 'UNAVAILABLE', historicalOnly: true, delivered: false }); }
}


type MarketSnapshot = { name: string; symbol: string; cap: number | null; liquidity: number | null; url: string | null };
const marketCache = new Map<string, { until: number; data: MarketSnapshot | null }>();
const html = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const usd = (v: number) => '(async signature => {
  if (store.has(`tx:${signature}`)) return;
  const tx = await readEchoTransaction(signature, rpc);
  if (tx == null) throw new Error('Confirmed transaction pending');
  diagnostics.fetched++;
  const signals = extractRpcEchoSignals(tx, signature, Date.now() / 1000);
  diagnostics.signals += signals.length;
  if (!signals.length) { diagnostics.noSignal++; const reason = classifyEchoRejection(tx, signature, Date.now() / 1000); rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1; }
  for (const signal of signals) {
    if (store.has(signal.id)) continue;
    const baseCard = echoCard(signal, Date.now() / 1000);
    const result = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ chat_id: config.admin, text: baseCard, parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Transaction', url: `https://solscan.io/tx/${signature}` }, { text: 'Chart', url: `https://dexscreener.com/solana/${signal.mint}` }]] } }),
    }).then(r => r.json()).catch(() => null);
    if (!result?.ok || !Number.isInteger(result.result?.message_id)) {
      if (result?.error_code === 429) deliveryBackoffUntil = Date.now() + Math.min(300_000, Math.max(1000, Number(result.parameters?.retry_after ?? 30) * 1000));
      diagnostics.deliveryFailures++;
      console.warn('[Echo] ADMIN_DELIVERY_UNCONFIRMED', { code: Number.isFinite(result?.error_code) ? result.error_code : null });
      lastErrorAt = Date.now(); throw new Error('Echo admin delivery unconfirmed');
    }
    void enrichCard(signal, result.result.message_id, baseCard);
    console.log('[Echo] RESEARCH_EVENT', JSON.stringify({ caller: signal.caller, wallet: signal.wallet, mint: signal.mint, signature: signal.signature, side: signal.side, tradeAt: signal.timestamp, deliveredAt: Date.now() / 1000, telegramMessageId: result.result.message_id, quoteAmount: signal.quoteAmount, quoteSymbol: signal.quoteSymbol, quoteBasis: signal.quoteBasis ?? 'unavailable' }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    console.log('[Echo] ADMIN_DELIVERY_ACCEPTED', { caller: signal.caller, signature, side: signal.side, messageId: result.result.message_id });
  }
  await store.delivered(`tx:${signature}`, Date.now() / 1000);
});
let reconciling = false;
async function reconcile() {
  if (reconciling || stopping || Date.now() < backoffUntil) return;
  reconciling = true;
  try {
    // 4 address reads/minute; at most 20 recent signatures each. No deep history.
    for (const wallet of Object.keys(ECHO_WALLETS)) {
      const rows = await rpc('getSignaturesForAddress', [wallet, { limit: 20, commitment: 'confirmed' }]);
      if (!Array.isArray(rows)) throw new Error('Echo signature list unavailable');
      for (const row of rows.reverse()) if (row.err == null && Number.isFinite(row.blockTime) && Date.now() / 1000 - row.blockTime <= 120 &&
        /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature ?? '') && !store.has(`tx:${row.signature}`)) queue.add(row.signature);
    }
    lastReconcileAt = Date.now();
  } catch { lastErrorAt = Date.now(); console.warn('[Echo] Reconciliation unavailable; bounded retry scheduled.'); }
  finally { reconciling = false; }
}
const subscription = startEchoSubscription({ url: config.wsUrl, onSignature: signature => { if (!store.has(`tx:${signature}`)) queue.add(signature); }, onReady: () => { void reconcile(); } });
const tick = setInterval(() => { if (!stopping && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil)) void queue.tick(); }, 250);
const sweep = setInterval(() => { void reconcile(); }, 60_000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, rejectionCounts }), 60_000);
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); res.end(); return; }
  const ready = !stopping && subscription.state.ready && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil) &&
    lastReconcileAt != null && Date.now() - lastReconcileAt < 90_000 && queue.size < 48;
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'alphaos-echo', source: 'standard-solana-rpc', mode: 'alerts', ready, liveBuying: false,
    subscriptions: subscription.state.acknowledgedWallets, reconnects: subscription.state.reconnects,
    queued: queue.size, dropped: queue.dropped, lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt }));
});
server.listen(config.port, '0.0.0.0', () => console.log('[Echo] RPC pilot started; only supported Pump/PumpSwap trades; live buying OFF.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(heartbeat); subscription.stop(); server.close();
});
 + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v);
async function getMarket(mint: string): Promise<MarketSnapshot | null> {
  const cached = marketCache.get(mint);
  if (cached && cached.until > Date.now()) return cached.data;
  if (marketCache.size > 80) marketCache.clear();
  let data: MarketSnapshot | null = null;
  try {
    const r = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + encodeURIComponent(mint), { signal: AbortSignal.timeout(1800) });
    if (r.ok) {
      const body = await r.json();
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).filter((p: any) =>
        p?.chainId === 'solana' && p?.baseToken?.address === mint &&
        Number.isFinite(Number(p?.liquidity?.usd)) && Number(p.liquidity.usd) > 0);
      pairs.sort((a: any, b: any) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
      const p = pairs[0];
      if (p) {
        const cap = Number(p.marketCap), liq = Number(p.liquidity.usd);
        data = {
          name: String(p.baseToken.name ?? '').slice(0, 70),
          symbol: String(p.baseToken.symbol ?? '').slice(0, 24),
          cap: Number.isFinite(cap) && cap > 0 ? cap : null,
          liquidity: Number.isFinite(liq) && liq > 0 ? liq : null,
          url: /^https:\/\/dexscreener\.com\/solana\/[A-Za-z0-9]+$/.test(String(p.url)) ? p.url : null
        };
      }
    }
  } catch { /* Enrichment is never required for trade alert delivery. */ }
  marketCache.set(mint, { until: Date.now() + (data ? 60000 : 20000), data });
  return data;
}
async function enrichCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, original: string) {
  const m = await getMarket(signal.mint);
  if (!m) return;
  const extra = [
    m.name || m.symbol ? '<b>Token identity:</b> ' + html(m.name || 'Unknown') + (m.symbol ? ' ((async signature => {
  if (store.has(`tx:${signature}`)) return;
  const tx = await readEchoTransaction(signature, rpc);
  if (tx == null) throw new Error('Confirmed transaction pending');
  diagnostics.fetched++;
  const signals = extractRpcEchoSignals(tx, signature, Date.now() / 1000);
  diagnostics.signals += signals.length;
  if (!signals.length) { diagnostics.noSignal++; const reason = classifyEchoRejection(tx, signature, Date.now() / 1000); rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1; }
  for (const signal of signals) {
    if (store.has(signal.id)) continue;
    const result = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ chat_id: config.admin, text: echoCard(signal, Date.now() / 1000), parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Transaction', url: `https://solscan.io/tx/${signature}` }, { text: 'Chart', url: `https://dexscreener.com/solana/${signal.mint}` }]] } }),
    }).then(r => r.json()).catch(() => null);
    if (!result?.ok || !Number.isInteger(result.result?.message_id)) {
      if (result?.error_code === 429) deliveryBackoffUntil = Date.now() + Math.min(300_000, Math.max(1000, Number(result.parameters?.retry_after ?? 30) * 1000));
      diagnostics.deliveryFailures++;
      console.warn('[Echo] ADMIN_DELIVERY_UNCONFIRMED', { code: Number.isFinite(result?.error_code) ? result.error_code : null });
      lastErrorAt = Date.now(); throw new Error('Echo admin delivery unconfirmed');
    }
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    console.log('[Echo] ADMIN_DELIVERY_ACCEPTED', { caller: signal.caller, signature, side: signal.side, messageId: result.result.message_id });
  }
  await store.delivered(`tx:${signature}`, Date.now() / 1000);
});
let reconciling = false;
async function reconcile() {
  if (reconciling || stopping || Date.now() < backoffUntil) return;
  reconciling = true;
  try {
    // 4 address reads/minute; at most 20 recent signatures each. No deep history.
    for (const wallet of Object.keys(ECHO_WALLETS)) {
      const rows = await rpc('getSignaturesForAddress', [wallet, { limit: 20, commitment: 'confirmed' }]);
      if (!Array.isArray(rows)) throw new Error('Echo signature list unavailable');
      for (const row of rows.reverse()) if (row.err == null && Number.isFinite(row.blockTime) && Date.now() / 1000 - row.blockTime <= 120 &&
        /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature ?? '') && !store.has(`tx:${row.signature}`)) queue.add(row.signature);
    }
    lastReconcileAt = Date.now();
  } catch { lastErrorAt = Date.now(); console.warn('[Echo] Reconciliation unavailable; bounded retry scheduled.'); }
  finally { reconciling = false; }
}
const subscription = startEchoSubscription({ url: config.wsUrl, onSignature: signature => { if (!store.has(`tx:${signature}`)) queue.add(signature); }, onReady: () => { void reconcile(); } });
const tick = setInterval(() => { if (!stopping && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil)) void queue.tick(); }, 250);
const sweep = setInterval(() => { void reconcile(); }, 60_000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, rejectionCounts }), 60_000);
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); res.end(); return; }
  const ready = !stopping && subscription.state.ready && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil) &&
    lastReconcileAt != null && Date.now() - lastReconcileAt < 90_000 && queue.size < 48;
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'alphaos-echo', source: 'standard-solana-rpc', mode: 'alerts', ready, liveBuying: false,
    subscriptions: subscription.state.acknowledgedWallets, reconnects: subscription.state.reconnects,
    queued: queue.size, dropped: queue.dropped, lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt }));
});
server.listen(config.port, '0.0.0.0', () => console.log('[Echo] RPC pilot started; only supported Pump/PumpSwap trades; live buying OFF.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(heartbeat); subscription.stop(); server.close();
});
 + html(m.symbol) + ')' : '') : '',
    m.cap == null ? '' : '<b>Market cap:</b> ' + usd(m.cap),
    m.liquidity == null ? '' : '<b>Pool liquidity:</b> ' + usd(m.liquidity),
    '<i>Market snapshot: third-party data, not a safety certification.</i>'
  ].filter(Boolean).join('\\n');
  try {
    const r = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({
        chat_id: config.admin, message_id: messageId, parse_mode: 'HTML', disable_web_page_preview: true,
        text: original + '\\n\\n' + extra,
        reply_markup: { inline_keyboard: [
          [{ text: '🔎 Transaction', url: 'https://solscan.io/tx/' + signal.signature },
           { text: '📈 Chart', url: m.url || 'https://dexscreener.com/solana/' + signal.mint }],
          [{ text: '👛 Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
        ] }
      })
    });
    const result = await r.json();
    if (result?.ok) console.log('[Echo] MARKET_ENRICHMENT_OK', JSON.stringify({ signature: signal.signature, mint: signal.mint }));
    else console.warn('[Echo] MARKET_ENRICHMENT_UNAVAILABLE', { code: result?.error_code ?? null });
  } catch { console.warn('[Echo] MARKET_ENRICHMENT_UNAVAILABLE', { code: null }); }
}

const queue = new EchoQueue(async signature => {
  if (store.has(`tx:${signature}`)) return;
  const tx = await readEchoTransaction(signature, rpc);
  if (tx == null) throw new Error('Confirmed transaction pending');
  diagnostics.fetched++;
  const signals = extractRpcEchoSignals(tx, signature, Date.now() / 1000);
  diagnostics.signals += signals.length;
  if (!signals.length) { diagnostics.noSignal++; const reason = classifyEchoRejection(tx, signature, Date.now() / 1000); rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1; }
  for (const signal of signals) {
    if (store.has(signal.id)) continue;
    const result = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({ chat_id: config.admin, text: echoCard(signal, Date.now() / 1000), parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: 'Transaction', url: `https://solscan.io/tx/${signature}` }, { text: 'Chart', url: `https://dexscreener.com/solana/${signal.mint}` }]] } }),
    }).then(r => r.json()).catch(() => null);
    if (!result?.ok || !Number.isInteger(result.result?.message_id)) {
      if (result?.error_code === 429) deliveryBackoffUntil = Date.now() + Math.min(300_000, Math.max(1000, Number(result.parameters?.retry_after ?? 30) * 1000));
      diagnostics.deliveryFailures++;
      console.warn('[Echo] ADMIN_DELIVERY_UNCONFIRMED', { code: Number.isFinite(result?.error_code) ? result.error_code : null });
      lastErrorAt = Date.now(); throw new Error('Echo admin delivery unconfirmed');
    }
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    console.log('[Echo] ADMIN_DELIVERY_ACCEPTED', { caller: signal.caller, signature, side: signal.side, messageId: result.result.message_id });
  }
  await store.delivered(`tx:${signature}`, Date.now() / 1000);
});
let reconciling = false;
async function reconcile() {
  if (reconciling || stopping || Date.now() < backoffUntil) return;
  reconciling = true;
  try {
    // 4 address reads/minute; at most 20 recent signatures each. No deep history.
    for (const wallet of Object.keys(ECHO_WALLETS)) {
      const rows = await rpc('getSignaturesForAddress', [wallet, { limit: 20, commitment: 'confirmed' }]);
      if (!Array.isArray(rows)) throw new Error('Echo signature list unavailable');
      for (const row of rows.reverse()) if (row.err == null && Number.isFinite(row.blockTime) && Date.now() / 1000 - row.blockTime <= 120 &&
        /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature ?? '') && !store.has(`tx:${row.signature}`)) queue.add(row.signature);
    }
    lastReconcileAt = Date.now();
  } catch { lastErrorAt = Date.now(); console.warn('[Echo] Reconciliation unavailable; bounded retry scheduled.'); }
  finally { reconciling = false; }
}
const subscription = startEchoSubscription({ url: config.wsUrl, onSignature: signature => { if (!store.has(`tx:${signature}`)) queue.add(signature); }, onReady: () => { void reconcile(); } });
const tick = setInterval(() => { if (!stopping && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil)) void queue.tick(); }, 250);
const sweep = setInterval(() => { void reconcile(); }, 60_000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, rejectionCounts }), 60_000);
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); res.end(); return; }
  const ready = !stopping && subscription.state.ready && Date.now() >= Math.max(backoffUntil, deliveryBackoffUntil) &&
    lastReconcileAt != null && Date.now() - lastReconcileAt < 90_000 && queue.size < 48;
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'alphaos-echo', source: 'standard-solana-rpc', mode: 'alerts', ready, liveBuying: false,
    subscriptions: subscription.state.acknowledgedWallets, reconnects: subscription.state.reconnects,
    queued: queue.size, dropped: queue.dropped, lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt }));
});
server.listen(config.port, '0.0.0.0', () => console.log('[Echo] RPC pilot started; only supported Pump/PumpSwap trades; live buying OFF.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(heartbeat); subscription.stop(); server.close();
});
