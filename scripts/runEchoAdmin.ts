import 'dotenv/config';
import { createServer } from 'node:http';
import { authenticEchoHeader, readEchoConfig } from '../src/echo/config.js';
import { EchoStore } from '../src/echo/store.js';
import { echoCard, type EchoTransaction } from '../src/echo/signals.js';
import { deliverEchoBatch } from '../src/echo/delivery.js';

// Deliberately independent of startup.ts, config.ts, Telegram polling, shared
// database jobs and autoTradeManager. No keys or signing/execution code needed.
const { admin, secret, botToken, rpcUrl, statePath, port } = readEchoConfig(process.env);
const store = new EchoStore(statePath);
await store.load();
let active = false, lastDeliveredAt: number | null = null, lastErrorAt: number | null = null;
let stopping = false;
async function jsonRequest(url: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error('Upstream request failed');
  return response.json();
}
const server = createServer(async (req, res) => {
  const respond = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET' && req.url === '/health') return respond(stopping ? 503 : 200, { service: 'alphaos-echo', mode: 'alerts', liveBuying: false, lastDeliveredAt, lastErrorAt });
  if (req.method !== 'POST' || req.url !== '/helius') return respond(404, { error: 'Not found' });
  const authorization = req.headers.authorization ?? '';
  if (!authenticEchoHeader(authorization, secret)) return respond(401, { error: 'Unauthorized' });
  if (active || stopping) return respond(503, { error: 'Retry later' });
  active = true;
  try {
    let size = 0; const chunks: Buffer[] = [];
    for await (const chunk of req) { size += chunk.length; if (size > 1_000_000) { respond(413, { error: 'Payload too large' }); return; } chunks.push(Buffer.from(chunk)); }
    let transactions: unknown;
    try { transactions = JSON.parse(Buffer.concat(chunks).toString()); } catch { respond(400, { error: 'Invalid JSON' }); return; }
    if (!Array.isArray(transactions) || transactions.length > 100) { respond(400, { error: 'Expected up to 100 transactions' }); return; }
    const delivered = await deliverEchoBatch(transactions as EchoTransaction[], {
      now: () => Date.now() / 1000, store,
      confirmation: async signature => {
        const status = await jsonRequest(rpcUrl, { jsonrpc: '2.0', id: 1, method: 'getSignatureStatuses', params: [[signature], { searchTransactionHistory: false }] });
        if (status.error) throw new Error('RPC confirmation unavailable');
        const confirmation = status.result?.value?.[0];
        if (confirmation?.err) return 'failed';
        return ['confirmed', 'finalized'].includes(confirmation?.confirmationStatus) ? 'confirmed' : 'pending';
      },
      send: async signal => {
        const result = await jsonRequest(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          chat_id: admin, text: echoCard(signal, Date.now() / 1000), parse_mode: 'HTML', disable_web_page_preview: true,
          reply_markup: { inline_keyboard: [[{ text: 'Transaction', url: `https://solscan.io/tx/${signal.signature}` }, { text: 'Chart', url: `https://dexscreener.com/solana/${signal.mint}` }]] },
        });
        if (result.ok !== true || !Number.isInteger(result.result?.message_id)) throw new Error('Telegram delivery unconfirmed');
        lastDeliveredAt = Date.now();
      },
    });
    respond(200, { delivered });
  } catch {
    lastErrorAt = Date.now(); console.error('[Echo] Delivery failed; provider should retry.');
    respond(503, { error: 'Retry later' });
  } finally { active = false; }
});
server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(port, '0.0.0.0', () => console.log('[Echo] Admin alert receiver ready; live buying disabled.'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => { stopping = true; server.close(); });
