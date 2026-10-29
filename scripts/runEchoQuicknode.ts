import 'dotenv/config';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { EchoStore } from '../src/echo/store.js';
import { EchoResearch } from '../src/echo/research.js';
import { EchoSolanaPromotions } from '../src/echo/solanaPromotions.js';
import { EchoTierDispatcher } from '../src/echo/tierDispatch.js';
import { pumpCurveSnapshot } from '../src/echo/curveSnapshot.js';
import { ECHO_WALLETS, echoCard } from '../src/echo/signals.js';
import { extractRpcEchoSignals, classifyEchoRejection, type EchoRejectReason } from '../src/echo/rpcSignals.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';
import { EchoQueue } from '../src/echo/queue.js';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { readEchoTransaction } from '../src/echo/readTransaction.js';
import { advanceFreshScan, type FreshScanState } from '../src/echo/freshScan.js';

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
 const usd=String.fromCharCode(36);
 const fmt=(n:number)=>Number.isFinite(n)?n.toFixed(2):'Unavailable';
 const msg=[icon+' <b>ALPHAOS · '+title+'</b>',
  '<b>Source:</b> '+event.caller,
  '<b>Token:</b> <code>'+event.mint+'</code>',
  '<b>Entry USD:</b> '+event.entry.toPrecision(5),
  '<b>Observed USD:</b> '+event.price.toPrecision(5),
  '<b>Price change:</b> '+event.roiPercent.toFixed(1)+'%',
  '<b>Paper investment:</b> '+usd+fmt(event.paperUsd),
  '<b>Units purchased:</b> '+event.quantity.toPrecision(6),
  '<b>Hypothetical sale:</b> '+usd+fmt(event.exitValueUsd),
  '<b>Net P&amp;L:</b> '+(event.netPnlUsd>=0?'+':'-')+usd+fmt(Math.abs(event.netPnlUsd)),
  '<b>Assumed costs:</b> '+(event.costBpsPerSide/100).toFixed(1)+'% per side',
  '<i>Paper only · estimated execution, not an actual fill</i>'].join(String.fromCharCode(10));
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
let backoffUntil = 0, reconcileBackoffUntil = 0, lastRpcAt: number | null = null, lastDeliveryAt: number | null = null;
let fallbackBackoffUntil = 0, fallbackReconcileBackoffUntil = 0;
let deliveryBackoffUntil = 0;
let historyLimitStreak = 0, fallbackHistoryLimitStreak = 0;
let lastErrorAt: number | null = null, lastReconcileAt: number | null = null, stopping = false;
const diagnostics = { fetched: 0, signals: 0, delivered: 0, noSignal: 0, rpcFailures: 0,
  fallbackRpcUses: 0, deliveryFailures: 0 };
const rejectionCounts: Partial<Record<EchoRejectReason, number>> = {};
function historyRateLimited(retryHeader: string | null, fallback = false) {
  if (fallback) fallbackHistoryLimitStreak++; else historyLimitStreak++;
  const streak = fallback ? fallbackHistoryLimitStreak : historyLimitStreak;
  const retry = retryHeader == null ? 0 : Number(retryHeader);
  const exponential = Math.min(900_000, 60_000 * 2 ** Math.min(4, streak - 1));
  const until = Date.now() + Math.min(900_000, Math.max(exponential, Number.isFinite(retry) ? retry * 1000 : 0));
  if (fallback) fallbackReconcileBackoffUntil = until;
  else reconcileBackoffUntil = until;
}
const rpcBackoff = (method: string, fallback: boolean) => method === 'getSignaturesForAddress'
  ? (fallback ? fallbackReconcileBackoffUntil : reconcileBackoffUntil)
  : (fallback ? fallbackBackoffUntil : backoffUntil);
const liveRpcAvailable = () => Date.now() >= backoffUntil ||
  (Boolean(config.fallbackRpcUrl) && Date.now() >= fallbackBackoffUntil);
const historyRpcAvailable = () => Date.now() >= reconcileBackoffUntil ||
  (Boolean(config.fallbackRpcUrl) && Date.now() >= fallbackReconcileBackoffUntil);

/** Transaction reads are always read-only. Independent fallback is optional,
 * does not double-send successful requests, and never attempts signing/trades.
 */
async function rpc(method: string, params: unknown[] = [], forceFallback = false): Promise<any> {
  const primaryReady = Date.now() >= rpcBackoff(method, false);
  const backupReady = Boolean(config.fallbackRpcUrl) && Date.now() >= rpcBackoff(method, true);
  const useBackup = forceFallback || (!primaryReady && backupReady);
  if (useBackup ? !backupReady : !primaryReady) throw new Error('Echo RPC backing off');
  const endpoint = useBackup ? config.fallbackRpcUrl! : config.rpcUrl;
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(8_000) });
    if (response.status === 429) {
      if (method === 'getSignaturesForAddress') historyRateLimited(response.headers.get('retry-after'), useBackup);
      else {
        const header = response.headers.get('retry-after');
        const seconds = header === null ? 60 : Number(header);
        const retryMs = Math.min(300_000, Math.max(30_000, Number.isFinite(seconds) ? seconds * 1000 : 60_000));
        if (useBackup) fallbackBackoffUntil = Date.now() + retryMs;
        else backoffUntil = Date.now() + retryMs;
      }
    }
    if (!response.ok) {
      console.warn('[Echo] RPC_HTTP_FAILURE', { method, status: response.status,
        provider: useBackup ? 'fallback' : 'primary' });
      throw new Error('RPC HTTP failure');
    }
    const data = await response.json();
    if (data.error && (data.error.code === 429 || data.error.code === -32005 ||
        /rate.?limit|credits.*exceed/i.test(String(data.error.message)))) {
      if (method === 'getSignaturesForAddress') historyRateLimited(null, useBackup);
      else if (useBackup) fallbackBackoffUntil = Date.now() + 60_000;
      else backoffUntil = Date.now() + 60_000;
    }
    if (data.error || !Object.prototype.hasOwnProperty.call(data, 'result')) {
      console.warn('[Echo] RPC_RESPONSE_FAILURE', { method,
        provider: useBackup ? 'fallback' : 'primary',
        code: Number.isFinite(data.error?.code) ? data.error.code : null });
      throw new Error('RPC response failure');
    }
    if (method === 'getSignaturesForAddress') {
      if (useBackup) { fallbackHistoryLimitStreak = 0; fallbackReconcileBackoffUntil = 0; }
      else { historyLimitStreak = 0; reconcileBackoffUntil = 0; }
    }
    if (useBackup) diagnostics.fallbackRpcUses++;
    lastRpcAt = Date.now();
    return data.result;
  } catch {
    if (!useBackup && backupReady) {
      // Primary is unavailable; try the independently configured read-only endpoint.
      try { return await rpc(method, params, true); } catch { /* report an unavailable read */ }
    }
    diagnostics.rpcFailures++; lastErrorAt = Date.now();
    throw new Error(`Echo RPC ${method} unavailable`);
  }
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
  for (const endpoint of [
    'https://api.dexscreener.com/tokens/v1/solana/'+mint,
    'https://api.dexscreener.com/latest/dex/tokens/'+mint
  ]) {
    try {
      const response=await fetch(endpoint,{signal:AbortSignal.timeout(3500)});
      if(!response.ok){console.warn('[EchoMarket] HTTP',{status:response.status});continue;}
      const body=await response.json();
      const rows=Array.isArray(body)?body:(Array.isArray(body?.pairs)?body.pairs:[]);
      const pairs=rows.filter((p:any)=>p?.chainId==='solana' && p?.baseToken?.address===mint);
      pairs.sort((a:any,b:any)=>(Number(b?.liquidity?.usd)||0)-(Number(a?.liquidity?.usd)||0));
      const pair=pairs.find((p:any)=>Number(p?.liquidity?.usd)>0) ?? pairs[0];
      if(!pair)continue;
      const marketCap=Number(pair.marketCap),liquidity=Number(pair?.liquidity?.usd);
      data={name:String(pair.baseToken?.name||'').slice(0,64),symbol:String(pair.baseToken?.symbol||'').slice(0,24),
        marketCap:Number.isFinite(marketCap)&&marketCap>0?marketCap:null,
        liquidity:Number.isFinite(liquidity)&&liquidity>0?liquidity:null};
      if(data.name&&data.marketCap&&data.liquidity)break;
    } catch {console.warn('[EchoMarket] LOOKUP_FAILED',{mint});}
  }
  echoMarketCache.set(mint, { expiry: Date.now() + (data?.marketCap&&data?.liquidity&&data?.name ? 60000 : 2500), data });
  return data;
}
async function enrichEchoCard(signal: ReturnType<typeof extractRpcEchoSignals>[number], messageId: number, _baseCard: string) {
  // Pump.fun launch-phase pairs can be absent from DexScreener momentarily.
  // Retry briefly and use creator/curve data when no quoted DEX pool exists.
  for (const delay of [0,2500,7000,15000,30000,60000]) {
    if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
    const market = await echoMarket(signal.mint);
    const curve = (!market?.marketCap || !market?.name) ? await pumpCurveSnapshot(signal.mint,config.rpcUrl) : null;
    const enriched = {
      name:market?.name || curve?.name || '',
      symbol:market?.symbol || curve?.symbol || '',
      marketCap:market?.marketCap ?? curve?.marketCap ?? null,
      liquidity:market?.liquidity ?? null
    };
    if(!enriched.name&&!enriched.symbol&&enriched.marketCap===null&&enriched.liquidity===null)continue;
    // A partial early response should not permanently stop enrichment while fields are missing.
    const updatedCard = echoCard(signal, Date.now() / 1000, enriched);
    try {
      const response = await fetch('https://api.telegram.org/bot' + config.botToken + '/editMessageText', {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(5000),
        body: JSON.stringify({ chat_id: config.admin, message_id: messageId, text: updatedCard,
          parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [
            [{ text: 'Transaction', url: 'https://solscan.io/tx/' + signal.signature },
             { text: 'Chart', url: 'https://dexscreener.com/solana/' + signal.mint }],
            [{ text: 'Caller wallet', url: 'https://solscan.io/account/' + signal.wallet }]
          ] } })
      });
      const result = await response.json();
      if(result?.ok || result?.description==='Bad Request: message is not modified'){
        console.log('[Echo] ENRICHED',JSON.stringify({mint:signal.mint,signature:signal.signature,hasMarketCap:enriched.marketCap!==null,hasLiquidity:enriched.liquidity!==null,hasName:!!enriched.name}));
        if(enriched.name && enriched.marketCap!==null && enriched.liquidity!==null)return;
        continue;
      }
      console.warn('[Echo] ENRICHMENT_EDIT_FAILED',{code:result?.error_code??null});
    } catch {console.warn('[Echo] ENRICHMENT_RETRY',{mint:signal.mint});}
  }
  console.warn('[Echo] ENRICHMENT_UNAVAILABLE',{mint:signal.mint,signature:signal.signature});
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
  const directSignals = extractRpcEchoSignals(tx, signature, Date.now() / 1000);
  const signals = directSignals.length ? directSignals : extractJupiterRoutedEchoBuys(tx, signature, Date.now() / 1000);
  diagnostics.signals += signals.length;
  if (!signals.length) { diagnostics.noSignal++; const reason = classifyEchoRejection(tx, signature, Date.now() / 1000); rejectionCounts[reason] = (rejectionCounts[reason] ?? 0) + 1; }
  for (const signal of signals) {
    // User requested only confirmed BUY notifications, never incoming transfers or SELLs.
    if (signal.side !== 'BUY' || store.has(signal.id)) continue;
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
      quoteBasis: signal.quoteBasis || 'unavailable', inputMint: signal.quoteMint || null }));
    await store.delivered(signal.id, Date.now() / 1000); lastDeliveryAt = Date.now(); diagnostics.delivered++;
    await tiers.enqueue({id:signal.id,mint:signal.mint,text:baseCard,acceptedAt:Date.now(),buttons:{inline_keyboard:[
      [{text:'🔎 Transaction',url:'https://solscan.io/tx/'+signal.signature},{text:'📈 Chart',url:'https://dexscreener.com/solana/'+signal.mint}]]}}).catch(()=>console.warn('[EchoTiers] CALLER_QUEUE_WRITE_FAILED'));
    if (researchReady && signal.side === 'BUY') void research.addBuy({caller:signal.caller,mint:signal.mint,signature:signal.signature,deliveryAt:Date.now()/1000}).then(() => { if (signal.caller === 'WHALE · slingoor') void research.tick(true).catch(() => console.warn('[EchoResearch] PRIORITY_TICK_FAILED')); }).catch(() => console.warn('[EchoResearch] PERSIST_FAILED'));

    console.log('[Echo] ADMIN_DELIVERY_ACCEPTED', { caller: signal.caller, signature, side: signal.side, messageId: result.result.message_id });
  }
  await store.delivered(`tx:${signature}`, Date.now() / 1000);
}, Date.now, config.statePath + '.pending-v1.json');
let reconciling = false;
// Limit historical RPC consumption per pass; continue from the last cursor on the next pass.
// Persist pagination cursors on the same private volume as the durable alert queue.
const historyCursorPath = config.statePath + '.history-cursors-v1.json';
const historyCursors = new Map<string, string>();
try {
  const saved = JSON.parse(readFileSync(historyCursorPath, 'utf8'));
  if (saved.version !== 1 || !Array.isArray(saved.cursors)) throw Error('Invalid history cursor journal');
  for (const entry of saved.cursors) {
    if (!Array.isArray(entry) || entry.length !== 2 || !(entry[0] in ECHO_WALLETS) ||
      !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(entry[1])) throw Error('Invalid history cursor');
    historyCursors.set(entry[0], entry[1]);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
function persistHistoryCursors() {
  mkdirSync(dirname(historyCursorPath), { recursive: true, mode: 0o700 });
  const temp = historyCursorPath + '.tmp';
  writeFileSync(temp, JSON.stringify({ version: 1, cursors: [...historyCursors] }), { mode: 0o600 });
  renameSync(temp, historyCursorPath);
}
// Fresh frontier is independent from the bounded historical archive cursor.
const freshCursorPath = config.statePath + '.fresh-cursors-v1.json';
const freshCursors = new Map<string, FreshScanState>();
try {
  const saved = JSON.parse(readFileSync(freshCursorPath, 'utf8'));
  if (saved.version !== 1 || !Array.isArray(saved.cursors)) throw Error('Invalid fresh cursor journal');
  for (const [wallet, state] of saved.cursors) {
    if (!(wallet in ECHO_WALLETS) || !state || typeof state !== 'object' ||
      !['checkpoint','before','candidate'].every(k => state[k] === null ||
        (typeof state[k] === 'string' && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(state[k]))))
      throw Error('Invalid fresh cursor');
    freshCursors.set(wallet, state);
  }
} catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
function persistFreshCursors() {
  mkdirSync(dirname(freshCursorPath), { recursive: true, mode: 0o700 });
  const temp = freshCursorPath + '.tmp';
  writeFileSync(temp, JSON.stringify({ version: 1, cursors: [...freshCursors] }), { mode: 0o600 });
  renameSync(temp, freshCursorPath);
}
const historyWindowSeconds = 1800;
const historyPagesPerPass = 3;
async function reconcile() {
  if (reconciling || stopping || !historyRpcAvailable() || queue.size > 64) return;
  reconciling = true;
  try {
    const cutoff = Date.now() / 1000 - historyWindowSeconds;
    for (const wallet of Object.keys(ECHO_WALLETS)) {
      if (stopping || !historyRpcAvailable() || queue.size > 64) break;
      // Page the fresh frontier independently; never advance its checkpoint until
      // reaching the previous checkpoint (or exhausting the available signatures).
      let fresh = freshCursors.get(wallet) ?? { checkpoint: null, before: null, candidate: null };
      let headRows: Array<{ signature: string; err: unknown; blockTime: number | null }> = [];
      let freshComplete = false;
      for (let page = 0; page < historyPagesPerPass && !freshComplete; page++) {
        if (stopping || !historyRpcAvailable() || queue.size > 64) break;
        const rows = await rpc('getSignaturesForAddress', [wallet,
          { limit: 100, commitment: 'confirmed', ...(fresh.before ? { before: fresh.before } : {}) }]);
        if (!Array.isArray(rows)) throw Error('Echo fresh signature page unavailable');
        if (page === 0) headRows = rows;
        const progress = advanceFreshScan(fresh, rows);
        for (const row of [...progress.scanned].reverse()) if (row.err == null &&
          Number.isFinite(row.blockTime) && row.blockTime! >= cutoff &&
          /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature ?? '') &&
          !store.has(`tx:${row.signature}`)) queue.add(row.signature!);
        fresh = progress.state;
        freshComplete = progress.complete;
        freshCursors.set(wallet, fresh);
        persistFreshCursors();
      }
      if (!freshComplete) console.warn('[Echo] FRESH_COVERAGE_INCOMPLETE', {
        caller: ECHO_WALLETS[wallet], reason: 'fresh-pagination-pending'
      });
      let before = historyCursors.get(wallet);
      let complete = !before && (headRows.length < 100 ||
        (Number.isFinite(headRows[headRows.length - 1]?.blockTime) && headRows[headRows.length - 1].blockTime < cutoff));
      if (!before && !complete && headRows[headRows.length - 1]?.signature) {
        before = headRows[headRows.length - 1].signature;
        historyCursors.set(wallet, before);
        persistHistoryCursors();
      }
      // Reserve the first RPC request for fresh signals; use the remaining
      // bounded budget to catch up from the durable backlog cursor.
      for (let page = 1; page < historyPagesPerPass && !complete && before; page++) {
        if (stopping || !historyRpcAvailable() || queue.size > 64) break;
        const rows = await rpc('getSignaturesForAddress', [wallet, { limit: 100, commitment: 'confirmed', ...(before ? { before } : {}) }]);
        if (!Array.isArray(rows)) throw new Error('Echo signature list unavailable');
        for (const row of [...rows].reverse()) if (row.err == null && Number.isFinite(row.blockTime) && row.blockTime >= cutoff &&
          /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(row.signature ?? '') && !store.has(`tx:${row.signature}`)) queue.add(row.signature);
        const oldest = rows[rows.length - 1];
        if (rows.length < 100 || (Number.isFinite(oldest?.blockTime) && oldest.blockTime < cutoff)) {
          complete = true;
          historyCursors.delete(wallet);
          persistHistoryCursors();
          break;
        }
        if (!oldest?.signature || oldest.signature === before) break;
        before = oldest.signature;
        historyCursors.set(wallet, before);
        persistHistoryCursors();
      }
      if (!complete) console.warn('[Echo] HISTORY_COVERAGE_INCOMPLETE', {
        caller: ECHO_WALLETS[wallet], reason: 'pagination-pending',
        notice: 'Catch-up cursor retained for a bounded follow-up pass'
      });
    }
    lastReconcileAt = Date.now();
  } catch { lastErrorAt = Date.now(); console.warn('[Echo] Reconciliation unavailable; bounded retry scheduled.'); }
  finally { reconciling = false; }
}
const subscription = startEchoSubscription({ url: config.wsUrl, fallbackUrl: config.fallbackWsUrl, onSignature: (signature, wallet) => { if (!store.has(`tx:${signature}`)) queue.add(signature, ECHO_WALLETS[wallet] === 'WHALE · slingoor'); }, onReady: () => { void reconcile(); } });
const tick = setInterval(() => { if (!stopping && liveRpcAvailable() && Date.now() >= deliveryBackoffUntil) void queue.tick(); }, 250);
// Reduce history polling (especially on an active WebSocket) so live BUY processing
// gets priority over expensive archive scans. After 429, adaptive backoff applies.
// When connected, verify history periodically without spending archive credits every
// three minutes. During a disconnect, request bounded catch-up with provider backoff.
const sweep = setInterval(() => {
  if (!subscription.state.ready || historyCursors.size > 0 || lastReconcileAt == null || Date.now() - lastReconcileAt >= 15 * 60_000)
    void reconcile();
}, 60_000);
const promotionTick=setInterval(()=>{if(promotionsReady)void promotions.tick();},30_000);
if(promotionsReady)void promotions.tick();
const researchTick = setInterval(() => { if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] TICK_FAILED')); }, 60_000);
if (researchReady) void research.tick().catch(() => console.warn('[EchoResearch] INITIAL_TICK_FAILED'));
const tierTick=setInterval(()=>{void tiers.tick().catch(()=>console.warn('[EchoTiers] TICK_FAILED'));},1000);
const heartbeat = setInterval(() => console.log('[Echo] HEALTH', { subscriptions: subscription.state.acknowledgedWallets,
  websocketReady: subscription.state.ready, reconnects: subscription.state.reconnects,
  lastDisconnectReason: subscription.state.lastDisconnectReason, lastConnectedAt: subscription.state.lastConnectedAt,
  activeWebSocketProvider: subscription.state.activeProvider,
  skippedNonSwapLogs: subscription.state.skippedNonSwapLogs, observedTradeSignatures: subscription.state.observedTradeSignatures, queued: queue.size, dropped: queue.dropped,
  lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt, ...diagnostics, promotions: promotionsReady ? promotions.summary() : {enabled:false}, research: researchReady ? JSON.stringify(research.summary()) : {enabled:false},tiers:tiers.summary(), rejectionCounts }), 60_000);
const server = createServer((req, res) => {
  if (req.method !== 'GET' || req.url !== '/health') { res.writeHead(404); res.end(); return; }
  // A healthy WebSocket must not be marked down merely because history reconciliation is rate-limited.
  const ready = !stopping && subscription.state.ready && liveRpcAvailable() && Date.now() >= deliveryBackoffUntil && queue.size < 2048;
  res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ service: 'alphaos-echo', source: 'standard-solana-rpc', mode: 'alerts', ready, liveBuying: false,
    subscriptions: subscription.state.acknowledgedWallets, reconnects: subscription.state.reconnects,
    lastDisconnectReason: subscription.state.lastDisconnectReason, lastConnectedAt: subscription.state.lastConnectedAt,
    skippedNonSwapLogs: subscription.state.skippedNonSwapLogs, observedTradeSignatures: subscription.state.observedTradeSignatures,
    queued: queue.size, dropped: queue.dropped, lastRpcAt, lastDeliveryAt, lastErrorAt, lastReconcileAt }));
});
server.listen(config.port, '0.0.0.0', () => console.log('[Echo] Alert-only watcher started; Pump/PumpSwap/Jupiter BUY routes; live buying OFF.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => {
  stopping = true; clearInterval(tick); clearInterval(sweep); clearInterval(researchTick); clearInterval(promotionTick); clearInterval(tierTick); clearInterval(heartbeat); subscription.stop(); server.close();
});
