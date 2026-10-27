/**
 * Alert-only deployment gate. Uses ONLY read-only Solana RPC and WebSocket
 * subscriptions. Runs before deployment, never signs/sends transactions and
 * never sends Telegram messages or reads private trading keys.
 *
 * Requiring this gate keeps the currently running deployment untouched when
 * both the main RPC and the optional backup are unavailable.
 */
import { readQuicknodeEchoConfig } from '../src/echo/quicknodeConfig.js';
import { ECHO_WALLETS } from '../src/echo/signals.js';
import { extractJupiterRoutedEchoBuys } from '../src/echo/jupiterRouteSignals.js';
import type { ParsedTransactionWithMeta } from '@solana/web3.js';

const MAINNET_GENESIS = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const TEST_SIGNATURE = '5W5d2xZT8K2QTmpixHviNrt5E38esAhqmjNVfqxmfm4Jz8RoEfwsW6efsEJ6ptxT1tj5sxeGFj8UicopFP5TT3Ed';
const config = readQuicknodeEchoConfig(process.env);
const wallets = Object.keys(ECHO_WALLETS);
const assert = (ok: unknown, message: string): void => { if (!ok) throw new Error(message); };
assert(wallets.length === 2 && ECHO_WALLETS['5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij'] === 'WHALE · slingoor',
  'Unsafe caller scope');

async function rpc(url: string, method: string, params: unknown[] = []): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:controller.signal});
    if (!response.ok) throw new Error('HTTP_'+response.status);
    const body = await response.json();
    if (body.error || !Object.prototype.hasOwnProperty.call(body, 'result')) throw new Error('RPC_REJECTED');
    return body.result;
  } finally { clearTimeout(timeout); }
}

async function probeWebSocket(url: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let ready = false;
    const subscriptions = new Set<number>();
    const requests = new Set<number>();
    const socket = new WebSocket(url);
    let finished = false;
    const timeout = setTimeout(() => finish(new Error('WEBSOCKET_ACK_TIMEOUT')), 12_000);
    function finish(error?: Error) {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      try { socket.close(); } catch { /* do not expose provider address */ }
      if (error) reject(error); else resolve();
    }
    socket.addEventListener('open', () => {
      for (let i = 0; i < wallets.length; i++) {
        socket.send(JSON.stringify({jsonrpc:'2.0',id:i+1,method:'logsSubscribe',
          params:[{mentions:[wallets[i]]},{commitment:'confirmed'}]}));
      }
    });
    socket.addEventListener('message', event => {
      if (finished || typeof event.data !== 'string') return;
      let body: any;
      try { body = JSON.parse(event.data); } catch { return; }
      if (!Number.isInteger(body?.id) || body.id < 1 || body.id > wallets.length) return;
      if (body.error || !Number.isSafeInteger(body.result) || body.result < 0) {
        finish(new Error('WEBSOCKET_SUBSCRIPTION_REJECTED')); return;
      }
      if (!requests.has(body.id)) {
        requests.add(body.id); subscriptions.add(body.result);
      }
      if (requests.size === wallets.length && subscriptions.size === wallets.length) {
        ready = true;
        finish();
      }
    });
    socket.addEventListener('error', () => finish(new Error('WEBSOCKET_CONNECT_FAILED')));
    socket.addEventListener('close', () => { if (!ready) finish(new Error('WEBSOCKET_CLOSED')); });
  });
}

async function check(label: 'primary' | 'fallback', rpcUrl: string, wsUrl: string): Promise<boolean> {
  try {
    assert(await rpc(rpcUrl,'getGenesisHash') === MAINNET_GENESIS, 'WRONG_CHAIN');
    const [rows, tx] = await Promise.all([
      rpc(rpcUrl, 'getSignaturesForAddress', [wallets[0],{limit:2,commitment:'confirmed'}]),
      rpc(rpcUrl, 'getTransaction', [TEST_SIGNATURE,{
        encoding:'jsonParsed',commitment:'confirmed',maxSupportedTransactionVersion:1
      }])
    ]);
    assert(Array.isArray(rows), 'HISTORY_UNAVAILABLE');
    assert(tx?.meta?.err === null && Number.isFinite(tx.blockTime), 'SAMPLE_TX_UNAVAILABLE');
    const buys=extractJupiterRoutedEchoBuys(tx as ParsedTransactionWithMeta,
      TEST_SIGNATURE, Number(tx.blockTime)+1);
    assert(buys.length===1 && buys[0].side==='BUY' &&
      buys[0].wallet===wallets[0] &&
      buys[0].mint==='67swHekykm7copiKAufdV9yuPC68mUFs4epsaKympump',
      'SAMPLE_BUY_NOT_DETECTED');
    await probeWebSocket(wsUrl);
    console.log('[EchoPreDeploy] PASS', JSON.stringify({
      provider: label, acknowledgedSubscriptions: wallets.length,
      verifiedHistoricalSwap: true, liveBuying: false
    }));
    return true;
  } catch (error) {
    // Never print URLs, secret query strings or RPC error bodies.
    console.warn('[EchoPreDeploy] PROVIDER_UNAVAILABLE', JSON.stringify({
      provider:label, category: error instanceof Error && /^(?:HTTP_\\d{3}|RPC_REJECTED|WRONG_CHAIN|HISTORY_UNAVAILABLE|SAMPLE_TX_UNAVAILABLE|SAMPLE_BUY_NOT_DETECTED|WEBSOCKET_ACK_TIMEOUT|WEBSOCKET_SUBSCRIPTION_REJECTED|WEBSOCKET_CONNECT_FAILED|WEBSOCKET_CLOSED)$/.test(error.message) ? error.message : 'PROBE_ERROR'
    }));
    return false;
  }
}

const primary = await check('primary', config.rpcUrl, config.wsUrl);
const backup = primary ? false : Boolean(config.fallbackRpcUrl && config.fallbackWsUrl)
  && await check('fallback', config.fallbackRpcUrl!, config.fallbackWsUrl!);
if (!primary && !backup) {
  console.error('[EchoPreDeploy] BLOCKED: no verified RPC+WebSocket provider; existing deployment must remain active.');
  process.exitCode = 1;
} else {
  console.log('[EchoPreDeploy] APPROVED_FOR_ALERT_ONLY_START: the runtime healthcheck and real alert proof remain required.');
}
