import 'dotenv/config';
import { createServer } from 'node:http';
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { EchoStore } from '../src/echo/store.js';
import { EchoResearch } from '../src/echo/research.js';
import { EchoSolanaPromotions } from '../src/echo/solanaPromotions.js';
import { EchoTierDispatcher } from '../src/echo/tierDispatch.js';
import { pumpCurveSnapshot } from '../src/echo/curveSnapshot.js';
import { ECHO_WALLETS, echoCard } from '../src/echo/signals.js';
import { extractRpcEchoSignals, classifyEchoRejection, type EchoRejectReason } from '../src/echo/rpcSignals.js';
import { EchoQueue } from '../src/echo/queue.js';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { readEchoTransaction } from '../src/echo/readTransaction.js';

// Independent executable: no shared startup/config, database, bot polling,
// Helius requests, private keys or trade execution imports.
const config = readQuicknodeEchoConfig(process.env);
const store = new EchoStore(config.statePath); await store.load();
const tiers = new EchoTierDispatcher(config.statePath+'.solana-tiers-v1.json',config.botToken,config.admin,
 process.env.ECHO_PUBLIC_TIERS_ENABLED==='true'?process.env.ECHO_SUBSCRIBER_SUPABASE_URL:undefined,
 process.env.ECHO_PUBLIC_TIERS_ENABLED==='true'?process.env.ECHO_SUBSCRIBER_SUPABASE_SERVICE_KEY:undefined);
try{await tiers.load();}catch{throw Error('Echo tier persistence unavailable: refusing unsafe public distribution');}
const research = new EchoResearch(config.statePath+'.research-v1.json',async event=>{
 const icon=event.kind==='ENTRY'?'🧪':event.kind==='EXIT'?'🛑':'🏆';
 const title=event.kind==='ENTRY'?'PAPER ENTRY':event.kind==='EXIT'?'PAPER STOP EXIT':String(event.multiple)+'x OBSERVED';
 const msg=[icon+' <b>ALPHAOS · '+title+'</b>','<b>Source:</b> '+event.caller,
  '<b>Token:</b> <code>'+event.mint+'</code>',
  '<b>Entry USD:</b> '+event.entry.toPrecision(5),
  '<b>Observed USD:</b> '+event.price.toPrecision(5),
  '<b>Price change:</b> '+event.roiPercent.toFixed(1)+'%',
  '<b>Simulated investment:</b> 
  '<i>Paper only · mark-price simulation · hypothetical sale, not executable quote</i>'].join(String.fromCharCode(10));
 const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({chat_id:config.admin,text:msg,parse_mode:'HTML',disable_web_page_preview:true,
   reply_markup:{inline_keyboard:[[{text:'📈 Chart',url:'https://dexscreener.com/solana/'+event.mint}]]}})}).then(r=>r.json());
 if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Paper notification unconfirmed');
 console.log('[EchoResearch] NOTIFIED',JSON.stringify({kind:event.kind,mint:event.mint,multiple:event.multiple??null}));
});
let researchReady = false;
try { await research.load(); researchReady = true; }
catch { console.warn('[EchoResearch] STARTUP_DISABLED: research state unavailable, alerts unaffected'); }
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


type EchoMarket = { name: string; symbol: string; marketCap: number | null; liquidity: number | null };
const echoMarketCache = new Map<string, { expiry: number; data: EchoMarket | null }>();
async function echoMarket(mint: string): Promise<EchoMarket | null> {
  const previous = echoMarketCache.get(mint);
  if (previous && previous.expiry > Date.now()) return previous.data;
  if (echoMarketCache.size > 80) echoMarketCache.clear();
  let data: EchoMarket | null = null;
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body = await response.json();
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).filter((p: any) =>
        p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint &&
        Number.isFinite(Number(p.liquidity?.usd)) && Number(p.liquidity.usd) > 0);
      pairs.sort((a: any, b: any) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
      const pair = pairs[0];
      if (pair) {
        const marketCap = Number(pair.marketCap), liquidity = Number(pair.liquidity.usd);
        data = { name: String(pair.baseToken.name || '').slice(0, 64), symbol: String(pair.baseToken.symbol || '').slice(0, 24),
          marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
          liquidity: Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null };
      }
    }
  } catch { /* optional lookup only */ }
  echoMarketCache.set(mint, { expiry: Date.now() + (data ? 60000 : 20000), data });
  return data;
}
async function enrichEchoCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, _baseCard: string) {
  const market = await echoMarket(signal.mint);
  if (!market) return;
  const updatedCard = echoCard(signal, Date.now() / 1000, market);
  try {
    const response = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ chat_id: config.admin, message_id: messageId, text: updatedCard,
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: 'Transaction', url: 'https://solscan.io/tx/' + signal.signature },
           { text: 'Chart', url: 'https://dexscreener.com/solana/' + signal.mint }],
          [{ text: 'Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
        ] } })
    });
    const result = await response.json();
    if (result?.ok) console.log('[Echo] ENRICHED', JSON.stringify({ mint: signal.mint, signature: signal.signature }));
  } catch { /* original delivered message remains */ }
}

const promotions = new EchoSolanaPromotions(config.statePath+'.solana-promotions-v1.json',async ev => {
  const market = await echoMarket(ev.mint);
  const curve = market?.marketCap ? null : await pumpCurveSnapshot(ev.mint,config.rpcUrl);
  const escape = (v:string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const money = (n:number|null|undefined) => n!=null && Number.isFinite(n) && n>0
    ? '$'+n.toLocaleString('en-US',{maximumFractionDigits:0}) : 'Unavailable';
  const title = ev.kind==='BOOST' ? '🚀 ALPHAOS · SOLANA BOOST' : '💳 ALPHAOS · SOLANA DEX PAID';
  const name = market?.symbol || curve?.symbol || market?.name || curve?.name || 'Token name pending';
  const text = '<b>'+title+'</b>\n'
    +'<b>'+escape(name)+'</b>'+(market?.name && market.name!==name?' · '+escape(market.name):'')+'\n'
    +'💰 <b>MC:</b> '+money(market?.marketCap ?? curve?.marketCap)+' · <b>LP:</b> '+(market?.liquidity ? money(market.liquidity) : 'No verified DEX LP')+'\n'
    +(curve?.marketCap && !market?.marketCap?'📈 <i>MC: pre-bonding estimate (Pump.fun)</i>\n':'')
    +(curve?.devHoldingPercent!=null?'👤 <b>Dev holding:</b> '+curve.devHoldingPercent.toFixed(2)+'% (creator wallet only)\n':'')
    +(ev.kind==='BOOST'?'⚡ <b>Active boosts:</b> '+(ev.amount ?? 'Unavailable')+'\n':'📢 <b>Promotion:</b> DexScreener paid advertisement\n')
    +'\n<b>CA:</b> <code>'+ev.mint+'</code>\n'
    +'<i>Paid promotion · Caller trade unverified · Research only</i>';
  const buttons = {inline_keyboard:[
    [{text:'📈 DexScreener',url:'https://dexscreener.com/solana/'+ev.mint},
     {text:'🔎 Solscan',url:'https://solscan.io/token/'+ev.mint}],
    [{text:'📋 Copy CA',copy_text:{text:ev.mint}}]
  ]};
  const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
    method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({chat_id:config.admin,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:buttons})
  }).then(r=>r.json());
  if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Telegram promotion delivery unconfirmed');
  await tiers.enqueue({id:ev.id,mint:ev.mint,text,buttons,acceptedAt:Date.now()}).catch(()=>console.warn('[EchoTiers] PROMOTION_QUEUE_WRITE_FAILED'));
  if(researchReady) void research.addBuy({caller:ev.kind==='BOOST'?'SOLANA_BOOST':'SOLANA_DEX_PAID',mint:ev.mint,signature:ev.id,deliveryAt:Date.now()/1000}).catch(()=>console.warn('[EchoResearch] PROMOTION_PAPER_PERSIST_FAILED'));

});
let promotionsReady=false;
try{await promotions.load();promotionsReady=true;}catch{console.warn('[EchoPromotions] DISABLED: invalid state');}
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
    void enrichEchoCard(signal, result.result.message_id, baseCard);
    console.log('[Echo] RESEARCH_EVENT', JSON.stringify({ caller: signal.caller, wallet: signal.wallet, mint: signal.mint,
      signature: signal.signature, side: signal.side, tradeAt: signal.timestamp, deliveryAt: Date.now() / 1000,
      telegramMessageId: result.result.message_id, quoteAmount: signal.quoteAmount, quoteSymbol: signal.quoteSymbol,
      quoteBasis: signal.quoteBasis || 'unavailable' }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    await tiers.enqueue({id:signal.id,mint:signal.mint,text:baseCard,acceptedAt:Date.now(),buttons:{inline_keyboard:[
      [{text:'🔎 Transaction',url:'https://solscan.io/tx/'+signal.signature},{text:'📈 Chart',url:'https://dexscreener.com/solana/'+signal.mint}]]}}).catch(()=>console.warn('[EchoTiers] CALLER_QUEUE_WRITE_FAILED'));
    if (researchReady && signal.side === 'BUY') void research.addBuy({caller:signal.caller,mint:signal.mint,signature:signal.signature,deliveryAt:Date.now()/1000}).catch(() => console.warn('[EchoResearch] PERSIST_FAILED'));

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
const promotionTick=setInterval(()=>{if(promotionsReady)void promotions.tick();},30_000);
if(promotionsReady)void promotions.tick();
const researchTick = setInterval(() => { if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] TICK_FAILED')); }, 60_000);
if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] INITIAL_TICK_FAILED'));
const tierTick=setInterval(()=>{void tiers.tick().catch(()=>console.warn('[EchoTiers] TICK_FAILED'));},1000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, promotions: promotionsReady ? promotions.summary() : {enabled:false}, research: researchReady ? research.summary() : {enabled:false},tiers:tiers.summary(), rejectionCounts }), 60_000);
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
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(researchTick); clearInterval(promotionTick); clearInterval(tierTick); clearInterval(heartbeat); subscription.stop(); server.close();
});
+event.paperUsd.toFixed(2),
  '<b>Token units:</b> '+event.quantity.toPrecision(6),
  '<b>Estimated sale value:</b> 
  '<i>Paper only · observed prices · no actual trade</i>'].join(String.fromCharCode(10));
 const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({chat_id:config.admin,text:msg,parse_mode:'HTML',disable_web_page_preview:true,
   reply_markup:{inline_keyboard:[[{text:'📈 Chart',url:'https://dexscreener.com/solana/'+event.mint}]]}})}).then(r=>r.json());
 if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Paper notification unconfirmed');
 console.log('[EchoResearch] NOTIFIED',JSON.stringify({kind:event.kind,mint:event.mint,multiple:event.multiple??null}));
});
let researchReady = false;
try { await research.load(); researchReady = true; }
catch { console.warn('[EchoResearch] STARTUP_DISABLED: research state unavailable, alerts unaffected'); }
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


type EchoMarket = { name: string; symbol: string; marketCap: number | null; liquidity: number | null };
const echoMarketCache = new Map<string, { expiry: number; data: EchoMarket | null }>();
async function echoMarket(mint: string): Promise<EchoMarket | null> {
  const previous = echoMarketCache.get(mint);
  if (previous && previous.expiry > Date.now()) return previous.data;
  if (echoMarketCache.size > 80) echoMarketCache.clear();
  let data: EchoMarket | null = null;
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body = await response.json();
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).filter((p: any) =>
        p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint &&
        Number.isFinite(Number(p.liquidity?.usd)) && Number(p.liquidity.usd) > 0);
      pairs.sort((a: any, b: any) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
      const pair = pairs[0];
      if (pair) {
        const marketCap = Number(pair.marketCap), liquidity = Number(pair.liquidity.usd);
        data = { name: String(pair.baseToken.name || '').slice(0, 64), symbol: String(pair.baseToken.symbol || '').slice(0, 24),
          marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
          liquidity: Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null };
      }
    }
  } catch { /* optional lookup only */ }
  echoMarketCache.set(mint, { expiry: Date.now() + (data ? 60000 : 20000), data });
  return data;
}
async function enrichEchoCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, _baseCard: string) {
  const market = await echoMarket(signal.mint);
  if (!market) return;
  const updatedCard = echoCard(signal, Date.now() / 1000, market);
  try {
    const response = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ chat_id: config.admin, message_id: messageId, text: updatedCard,
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: 'Transaction', url: 'https://solscan.io/tx/' + signal.signature },
           { text: 'Chart', url: 'https://dexscreener.com/solana/' + signal.mint }],
          [{ text: 'Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
        ] } })
    });
    const result = await response.json();
    if (result?.ok) console.log('[Echo] ENRICHED', JSON.stringify({ mint: signal.mint, signature: signal.signature }));
  } catch { /* original delivered message remains */ }
}

const promotions = new EchoSolanaPromotions(config.statePath+'.solana-promotions-v1.json',async ev => {
  const market = await echoMarket(ev.mint);
  const curve = market?.marketCap ? null : await pumpCurveSnapshot(ev.mint,config.rpcUrl);
  const escape = (v:string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const money = (n:number|null|undefined) => n!=null && Number.isFinite(n) && n>0
    ? '$'+n.toLocaleString('en-US',{maximumFractionDigits:0}) : 'Unavailable';
  const title = ev.kind==='BOOST' ? '🚀 ALPHAOS · SOLANA BOOST' : '💳 ALPHAOS · SOLANA DEX PAID';
  const name = market?.symbol || curve?.symbol || market?.name || curve?.name || 'Token name pending';
  const text = '<b>'+title+'</b>\n'
    +'<b>'+escape(name)+'</b>'+(market?.name && market.name!==name?' · '+escape(market.name):'')+'\n'
    +'💰 <b>MC:</b> '+money(market?.marketCap ?? curve?.marketCap)+' · <b>LP:</b> '+(market?.liquidity ? money(market.liquidity) : 'No verified DEX LP')+'\n'
    +(curve?.marketCap && !market?.marketCap?'📈 <i>MC: pre-bonding estimate (Pump.fun)</i>\n':'')
    +(curve?.devHoldingPercent!=null?'👤 <b>Dev holding:</b> '+curve.devHoldingPercent.toFixed(2)+'% (creator wallet only)\n':'')
    +(ev.kind==='BOOST'?'⚡ <b>Active boosts:</b> '+(ev.amount ?? 'Unavailable')+'\n':'📢 <b>Promotion:</b> DexScreener paid advertisement\n')
    +'\n<b>CA:</b> <code>'+ev.mint+'</code>\n'
    +'<i>Paid promotion · Caller trade unverified · Research only</i>';
  const buttons = {inline_keyboard:[
    [{text:'📈 DexScreener',url:'https://dexscreener.com/solana/'+ev.mint},
     {text:'🔎 Solscan',url:'https://solscan.io/token/'+ev.mint}],
    [{text:'📋 Copy CA',copy_text:{text:ev.mint}}]
  ]};
  const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
    method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({chat_id:config.admin,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:buttons})
  }).then(r=>r.json());
  if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Telegram promotion delivery unconfirmed');
  await tiers.enqueue({id:ev.id,mint:ev.mint,text,buttons,acceptedAt:Date.now()}).catch(()=>console.warn('[EchoTiers] PROMOTION_QUEUE_WRITE_FAILED'));
  if(researchReady) void research.addBuy({caller:ev.kind==='BOOST'?'SOLANA_BOOST':'SOLANA_DEX_PAID',mint:ev.mint,signature:ev.id,deliveryAt:Date.now()/1000}).catch(()=>console.warn('[EchoResearch] PROMOTION_PAPER_PERSIST_FAILED'));

});
let promotionsReady=false;
try{await promotions.load();promotionsReady=true;}catch{console.warn('[EchoPromotions] DISABLED: invalid state');}
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
    void enrichEchoCard(signal, result.result.message_id, baseCard);
    console.log('[Echo] RESEARCH_EVENT', JSON.stringify({ caller: signal.caller, wallet: signal.wallet, mint: signal.mint,
      signature: signal.signature, side: signal.side, tradeAt: signal.timestamp, deliveryAt: Date.now() / 1000,
      telegramMessageId: result.result.message_id, quoteAmount: signal.quoteAmount, quoteSymbol: signal.quoteSymbol,
      quoteBasis: signal.quoteBasis || 'unavailable' }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    await tiers.enqueue({id:signal.id,mint:signal.mint,text:baseCard,acceptedAt:Date.now(),buttons:{inline_keyboard:[
      [{text:'🔎 Transaction',url:'https://solscan.io/tx/'+signal.signature},{text:'📈 Chart',url:'https://dexscreener.com/solana/'+signal.mint}]]}}).catch(()=>console.warn('[EchoTiers] CALLER_QUEUE_WRITE_FAILED'));
    if (researchReady && signal.side === 'BUY') void research.addBuy({caller:signal.caller,mint:signal.mint,signature:signal.signature,deliveryAt:Date.now()/1000}).catch(() => console.warn('[EchoResearch] PERSIST_FAILED'));

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
const promotionTick=setInterval(()=>{if(promotionsReady)void promotions.tick();},30_000);
if(promotionsReady)void promotions.tick();
const researchTick = setInterval(() => { if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] TICK_FAILED')); }, 60_000);
if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] INITIAL_TICK_FAILED'));
const tierTick=setInterval(()=>{void tiers.tick().catch(()=>console.warn('[EchoTiers] TICK_FAILED'));},1000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, promotions: promotionsReady ? promotions.summary() : {enabled:false}, research: researchReady ? research.summary() : {enabled:false},tiers:tiers.summary(), rejectionCounts }), 60_000);
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
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(researchTick); clearInterval(promotionTick); clearInterval(tierTick); clearInterval(heartbeat); subscription.stop(); server.close();
});
+event.exitValueUsd.toFixed(2),
  '<b>Estimated net P&amp;L:</b> '+(event.netPnlUsd>=0?'+':'')+'
  '<i>Paper only · observed prices · no actual trade</i>'].join(String.fromCharCode(10));
 const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({chat_id:config.admin,text:msg,parse_mode:'HTML',disable_web_page_preview:true,
   reply_markup:{inline_keyboard:[[{text:'📈 Chart',url:'https://dexscreener.com/solana/'+event.mint}]]}})}).then(r=>r.json());
 if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Paper notification unconfirmed');
 console.log('[EchoResearch] NOTIFIED',JSON.stringify({kind:event.kind,mint:event.mint,multiple:event.multiple??null}));
});
let researchReady = false;
try { await research.load(); researchReady = true; }
catch { console.warn('[EchoResearch] STARTUP_DISABLED: research state unavailable, alerts unaffected'); }
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


type EchoMarket = { name: string; symbol: string; marketCap: number | null; liquidity: number | null };
const echoMarketCache = new Map<string, { expiry: number; data: EchoMarket | null }>();
async function echoMarket(mint: string): Promise<EchoMarket | null> {
  const previous = echoMarketCache.get(mint);
  if (previous && previous.expiry > Date.now()) return previous.data;
  if (echoMarketCache.size > 80) echoMarketCache.clear();
  let data: EchoMarket | null = null;
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body = await response.json();
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).filter((p: any) =>
        p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint &&
        Number.isFinite(Number(p.liquidity?.usd)) && Number(p.liquidity.usd) > 0);
      pairs.sort((a: any, b: any) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
      const pair = pairs[0];
      if (pair) {
        const marketCap = Number(pair.marketCap), liquidity = Number(pair.liquidity.usd);
        data = { name: String(pair.baseToken.name || '').slice(0, 64), symbol: String(pair.baseToken.symbol || '').slice(0, 24),
          marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
          liquidity: Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null };
      }
    }
  } catch { /* optional lookup only */ }
  echoMarketCache.set(mint, { expiry: Date.now() + (data ? 60000 : 20000), data });
  return data;
}
async function enrichEchoCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, _baseCard: string) {
  const market = await echoMarket(signal.mint);
  if (!market) return;
  const updatedCard = echoCard(signal, Date.now() / 1000, market);
  try {
    const response = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ chat_id: config.admin, message_id: messageId, text: updatedCard,
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: 'Transaction', url: 'https://solscan.io/tx/' + signal.signature },
           { text: 'Chart', url: 'https://dexscreener.com/solana/' + signal.mint }],
          [{ text: 'Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
        ] } })
    });
    const result = await response.json();
    if (result?.ok) console.log('[Echo] ENRICHED', JSON.stringify({ mint: signal.mint, signature: signal.signature }));
  } catch { /* original delivered message remains */ }
}

const promotions = new EchoSolanaPromotions(config.statePath+'.solana-promotions-v1.json',async ev => {
  const market = await echoMarket(ev.mint);
  const curve = market?.marketCap ? null : await pumpCurveSnapshot(ev.mint,config.rpcUrl);
  const escape = (v:string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const money = (n:number|null|undefined) => n!=null && Number.isFinite(n) && n>0
    ? '$'+n.toLocaleString('en-US',{maximumFractionDigits:0}) : 'Unavailable';
  const title = ev.kind==='BOOST' ? '🚀 ALPHAOS · SOLANA BOOST' : '💳 ALPHAOS · SOLANA DEX PAID';
  const name = market?.symbol || curve?.symbol || market?.name || curve?.name || 'Token name pending';
  const text = '<b>'+title+'</b>\n'
    +'<b>'+escape(name)+'</b>'+(market?.name && market.name!==name?' · '+escape(market.name):'')+'\n'
    +'💰 <b>MC:</b> '+money(market?.marketCap ?? curve?.marketCap)+' · <b>LP:</b> '+(market?.liquidity ? money(market.liquidity) : 'No verified DEX LP')+'\n'
    +(curve?.marketCap && !market?.marketCap?'📈 <i>MC: pre-bonding estimate (Pump.fun)</i>\n':'')
    +(curve?.devHoldingPercent!=null?'👤 <b>Dev holding:</b> '+curve.devHoldingPercent.toFixed(2)+'% (creator wallet only)\n':'')
    +(ev.kind==='BOOST'?'⚡ <b>Active boosts:</b> '+(ev.amount ?? 'Unavailable')+'\n':'📢 <b>Promotion:</b> DexScreener paid advertisement\n')
    +'\n<b>CA:</b> <code>'+ev.mint+'</code>\n'
    +'<i>Paid promotion · Caller trade unverified · Research only</i>';
  const buttons = {inline_keyboard:[
    [{text:'📈 DexScreener',url:'https://dexscreener.com/solana/'+ev.mint},
     {text:'🔎 Solscan',url:'https://solscan.io/token/'+ev.mint}],
    [{text:'📋 Copy CA',copy_text:{text:ev.mint}}]
  ]};
  const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
    method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({chat_id:config.admin,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:buttons})
  }).then(r=>r.json());
  if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Telegram promotion delivery unconfirmed');
  await tiers.enqueue({id:ev.id,mint:ev.mint,text,buttons,acceptedAt:Date.now()}).catch(()=>console.warn('[EchoTiers] PROMOTION_QUEUE_WRITE_FAILED'));
  if(researchReady) void research.addBuy({caller:ev.kind==='BOOST'?'SOLANA_BOOST':'SOLANA_DEX_PAID',mint:ev.mint,signature:ev.id,deliveryAt:Date.now()/1000}).catch(()=>console.warn('[EchoResearch] PROMOTION_PAPER_PERSIST_FAILED'));

});
let promotionsReady=false;
try{await promotions.load();promotionsReady=true;}catch{console.warn('[EchoPromotions] DISABLED: invalid state');}
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
    void enrichEchoCard(signal, result.result.message_id, baseCard);
    console.log('[Echo] RESEARCH_EVENT', JSON.stringify({ caller: signal.caller, wallet: signal.wallet, mint: signal.mint,
      signature: signal.signature, side: signal.side, tradeAt: signal.timestamp, deliveryAt: Date.now() / 1000,
      telegramMessageId: result.result.message_id, quoteAmount: signal.quoteAmount, quoteSymbol: signal.quoteSymbol,
      quoteBasis: signal.quoteBasis || 'unavailable' }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    await tiers.enqueue({id:signal.id,mint:signal.mint,text:baseCard,acceptedAt:Date.now(),buttons:{inline_keyboard:[
      [{text:'🔎 Transaction',url:'https://solscan.io/tx/'+signal.signature},{text:'📈 Chart',url:'https://dexscreener.com/solana/'+signal.mint}]]}}).catch(()=>console.warn('[EchoTiers] CALLER_QUEUE_WRITE_FAILED'));
    if (researchReady && signal.side === 'BUY') void research.addBuy({caller:signal.caller,mint:signal.mint,signature:signal.signature,deliveryAt:Date.now()/1000}).catch(() => console.warn('[EchoResearch] PERSIST_FAILED'));

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
const promotionTick=setInterval(()=>{if(promotionsReady)void promotions.tick();},30_000);
if(promotionsReady)void promotions.tick();
const researchTick = setInterval(() => { if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] TICK_FAILED')); }, 60_000);
if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] INITIAL_TICK_FAILED'));
const tierTick=setInterval(()=>{void tiers.tick().catch(()=>console.warn('[EchoTiers] TICK_FAILED'));},1000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, promotions: promotionsReady ? promotions.summary() : {enabled:false}, research: researchReady ? research.summary() : {enabled:false},tiers:tiers.summary(), rejectionCounts }), 60_000);
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
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(researchTick); clearInterval(promotionTick); clearInterval(tierTick); clearInterval(heartbeat); subscription.stop(); server.close();
});
+event.netPnlUsd.toFixed(2),
  '<b>Assumed costs:</b> '+(event.costBpsPerSide/100).toFixed(1)+'% each side',
  '<i>Paper only · observed prices · no actual trade</i>'].join(String.fromCharCode(10));
 const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
  method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
  body:JSON.stringify({chat_id:config.admin,text:msg,parse_mode:'HTML',disable_web_page_preview:true,
   reply_markup:{inline_keyboard:[[{text:'📈 Chart',url:'https://dexscreener.com/solana/'+event.mint}]]}})}).then(r=>r.json());
 if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Paper notification unconfirmed');
 console.log('[EchoResearch] NOTIFIED',JSON.stringify({kind:event.kind,mint:event.mint,multiple:event.multiple??null}));
});
let researchReady = false;
try { await research.load(); researchReady = true; }
catch { console.warn('[EchoResearch] STARTUP_DISABLED: research state unavailable, alerts unaffected'); }
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


type EchoMarket = { name: string; symbol: string; marketCap: number | null; liquidity: number | null };
const echoMarketCache = new Map<string, { expiry: number; data: EchoMarket | null }>();
async function echoMarket(mint: string): Promise<EchoMarket | null> {
  const previous = echoMarketCache.get(mint);
  if (previous && previous.expiry > Date.now()) return previous.data;
  if (echoMarketCache.size > 80) echoMarketCache.clear();
  let data: EchoMarket | null = null;
  try {
    const response = await fetch('https://api.dexscreener.com/latest/dex/tokens/' + mint, { signal: AbortSignal.timeout(1500) });
    if (response.ok) {
      const body = await response.json();
      const pairs = (Array.isArray(body.pairs) ? body.pairs : []).filter((p: any) =>
        p && p.chainId === 'solana' && p.baseToken && p.baseToken.address === mint &&
        Number.isFinite(Number(p.liquidity?.usd)) && Number(p.liquidity.usd) > 0);
      pairs.sort((a: any, b: any) => Number(b.liquidity.usd) - Number(a.liquidity.usd));
      const pair = pairs[0];
      if (pair) {
        const marketCap = Number(pair.marketCap), liquidity = Number(pair.liquidity.usd);
        data = { name: String(pair.baseToken.name || '').slice(0, 64), symbol: String(pair.baseToken.symbol || '').slice(0, 24),
          marketCap: Number.isFinite(marketCap) && marketCap > 0 ? marketCap : null,
          liquidity: Number.isFinite(liquidity) && liquidity > 0 ? liquidity : null };
      }
    }
  } catch { /* optional lookup only */ }
  echoMarketCache.set(mint, { expiry: Date.now() + (data ? 60000 : 20000), data });
  return data;
}
async function enrichEchoCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, _baseCard: string) {
  const market = await echoMarket(signal.mint);
  if (!market) return;
  const updatedCard = echoCard(signal, Date.now() / 1000, market);
  try {
    const response = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(2000),
      body: JSON.stringify({ chat_id: config.admin, message_id: messageId, text: updatedCard,
        parse_mode: 'HTML', disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [
          [{ text: 'Transaction', url: 'https://solscan.io/tx/' + signal.signature },
           { text: 'Chart', url: 'https://dexscreener.com/solana/' + signal.mint }],
          [{ text: 'Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
        ] } })
    });
    const result = await response.json();
    if (result?.ok) console.log('[Echo] ENRICHED', JSON.stringify({ mint: signal.mint, signature: signal.signature }));
  } catch { /* original delivered message remains */ }
}

const promotions = new EchoSolanaPromotions(config.statePath+'.solana-promotions-v1.json',async ev => {
  const market = await echoMarket(ev.mint);
  const curve = market?.marketCap ? null : await pumpCurveSnapshot(ev.mint,config.rpcUrl);
  const escape = (v:string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const money = (n:number|null|undefined) => n!=null && Number.isFinite(n) && n>0
    ? '$'+n.toLocaleString('en-US',{maximumFractionDigits:0}) : 'Unavailable';
  const title = ev.kind==='BOOST' ? '🚀 ALPHAOS · SOLANA BOOST' : '💳 ALPHAOS · SOLANA DEX PAID';
  const name = market?.symbol || curve?.symbol || market?.name || curve?.name || 'Token name pending';
  const text = '<b>'+title+'</b>\n'
    +'<b>'+escape(name)+'</b>'+(market?.name && market.name!==name?' · '+escape(market.name):'')+'\n'
    +'💰 <b>MC:</b> '+money(market?.marketCap ?? curve?.marketCap)+' · <b>LP:</b> '+(market?.liquidity ? money(market.liquidity) : 'No verified DEX LP')+'\n'
    +(curve?.marketCap && !market?.marketCap?'📈 <i>MC: pre-bonding estimate (Pump.fun)</i>\n':'')
    +(curve?.devHoldingPercent!=null?'👤 <b>Dev holding:</b> '+curve.devHoldingPercent.toFixed(2)+'% (creator wallet only)\n':'')
    +(ev.kind==='BOOST'?'⚡ <b>Active boosts:</b> '+(ev.amount ?? 'Unavailable')+'\n':'📢 <b>Promotion:</b> DexScreener paid advertisement\n')
    +'\n<b>CA:</b> <code>'+ev.mint+'</code>\n'
    +'<i>Paid promotion · Caller trade unverified · Research only</i>';
  const buttons = {inline_keyboard:[
    [{text:'📈 DexScreener',url:'https://dexscreener.com/solana/'+ev.mint},
     {text:'🔎 Solscan',url:'https://solscan.io/token/'+ev.mint}],
    [{text:'📋 Copy CA',copy_text:{text:ev.mint}}]
  ]};
  const response=await fetch('https://api.telegram.org/bot'+config.botToken+'/sendMessage',{
    method:'POST',headers:{'content-type':'application/json'},signal:AbortSignal.timeout(8000),
    body:JSON.stringify({chat_id:config.admin,text,parse_mode:'HTML',disable_web_page_preview:true,reply_markup:buttons})
  }).then(r=>r.json());
  if(!response?.ok||!Number.isInteger(response.result?.message_id))throw Error('Telegram promotion delivery unconfirmed');
  await tiers.enqueue({id:ev.id,mint:ev.mint,text,buttons,acceptedAt:Date.now()}).catch(()=>console.warn('[EchoTiers] PROMOTION_QUEUE_WRITE_FAILED'));
  if(researchReady) void research.addBuy({caller:ev.kind==='BOOST'?'SOLANA_BOOST':'SOLANA_DEX_PAID',mint:ev.mint,signature:ev.id,deliveryAt:Date.now()/1000}).catch(()=>console.warn('[EchoResearch] PROMOTION_PAPER_PERSIST_FAILED'));

});
let promotionsReady=false;
try{await promotions.load();promotionsReady=true;}catch{console.warn('[EchoPromotions] DISABLED: invalid state');}
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
    void enrichEchoCard(signal, result.result.message_id, baseCard);
    console.log('[Echo] RESEARCH_EVENT', JSON.stringify({ caller: signal.caller, wallet: signal.wallet, mint: signal.mint,
      signature: signal.signature, side: signal.side, tradeAt: signal.timestamp, deliveryAt: Date.now() / 1000,
      telegramMessageId: result.result.message_id, quoteAmount: signal.quoteAmount, quoteSymbol: signal.quoteSymbol,
      quoteBasis: signal.quoteBasis || 'unavailable' }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    await tiers.enqueue({id:signal.id,mint:signal.mint,text:baseCard,acceptedAt:Date.now(),buttons:{inline_keyboard:[
      [{text:'🔎 Transaction',url:'https://solscan.io/tx/'+signal.signature},{text:'📈 Chart',url:'https://dexscreener.com/solana/'+signal.mint}]]}}).catch(()=>console.warn('[EchoTiers] CALLER_QUEUE_WRITE_FAILED'));
    if (researchReady && signal.side === 'BUY') void research.addBuy({caller:signal.caller,mint:signal.mint,signature:signal.signature,deliveryAt:Date.now()/1000}).catch(() => console.warn('[EchoResearch] PERSIST_FAILED'));

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
const promotionTick=setInterval(()=>{if(promotionsReady)void promotions.tick();},30_000);
if(promotionsReady)void promotions.tick();
const researchTick = setInterval(() => { if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] TICK_FAILED')); }, 60_000);
if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] INITIAL_TICK_FAILED'));
const tierTick=setInterval(()=>{void tiers.tick().catch(()=>console.warn('[EchoTiers] TICK_FAILED'));},1000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, promotions: promotionsReady ? promotions.summary() : {enabled:false}, research: researchReady ? research.summary() : {enabled:false},tiers:tiers.summary(), rejectionCounts }), 60_000);
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
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(researchTick); clearInterval(promotionTick); clearInterval(tierTick); clearInterval(heartbeat); subscription.stop(); server.close();
});
