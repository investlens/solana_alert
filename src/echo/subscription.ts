import { ECHO_WALLETS } from './signals.js';
import { mayContainWalletSwap } from './logPrefilter.js';
import { setTimeout, clearTimeout } from 'node:timers';
type Socket = { addEventListener(type: string, listener: (event: any) => void): void; send(data: string): void; close(): void };
type Timer = number | NodeJS.Timeout;
type Options = {
  url: string; fallbackUrl?: string | null; onSignature(signature: string, wallet: string): unknown; onReady(): void;
  socket?: (url: string) => Socket;
  later?: (callback: () => void, milliseconds: number) => Timer;
  cancel?: (timer: Timer) => void;
};
export function startEchoSubscription(options: Options) {
  const later = options.later ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const state = { ready: false, acknowledgedWallets: 0, reconnects: 0, lastMessageAt: null as number | null, lastDisconnectReason: 'none' as string, lastConnectedAt: null as number | null, activeProvider: 'primary' as 'primary' | 'fallback', skippedNonSwapLogs: 0, observedTradeSignatures: 0, walletNotifications: {} as Record<string,number>, walletPrefilterSkipped: {} as Record<string,number>, walletQueued: {} as Record<string,number> };
  let socket: Socket | null = null, stopped = false, reconnect: Timer | undefined;
  let timeout: Timer | undefined, delay = 1000, consecutiveFailures = 0, useFallback = false;
  function failedAttempt() {
    consecutiveFailures++;
    if (options.fallbackUrl && consecutiveFailures >= 3) {
      useFallback = !useFallback;
      consecutiveFailures = 0;
      delay = 1000; // Test the independent provider promptly, without a reconnect storm.
    }
  }
  function connect() {
    if (stopped) return;
    state.ready = false; state.acknowledgedWallets = 0;
    const ids = new Set<number>();
    const wallets = Object.keys(ECHO_WALLETS);
    const walletForSubscription = new Map<number, string>();
    const expectedWallets = Object.keys(ECHO_WALLETS).length;
    const requests = new Set<number>();
    const lost = (reason = 'closed') => {
      if (socket !== current || stopped) return;
      socket = null; state.ready = false; state.acknowledgedWallets = 0; state.lastDisconnectReason = reason;
      if (timeout) cancel(timeout);
      try { current.close(); } catch { /* no provider URLs in logs */ }
      state.reconnects++; failedAttempt();
      reconnect = later(connect, delay); delay = Math.min(60_000, delay * 2);
    };
    let current: Socket;
    const endpoint = useFallback && options.fallbackUrl ? options.fallbackUrl : options.url;
    state.activeProvider = useFallback && options.fallbackUrl ? 'fallback' : 'primary';
    try { current = (options.socket ?? (url => new WebSocket(url)))(endpoint); }
    catch { state.lastDisconnectReason = 'socket_constructor_failed'; state.reconnects++; failedAttempt(); reconnect = later(connect, delay); delay = Math.min(60_000, delay * 2); return; }
    socket = current;
    timeout = later(() => lost('subscription_ack_timeout'), 10_000);
    current.addEventListener('open', () => {
      if (socket !== current || stopped) return;
      state.lastConnectedAt = Date.now();
      try {
        Object.keys(ECHO_WALLETS).forEach((wallet, i) => current.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe', params: [{ mentions: [wallet] }, { commitment: 'confirmed' }] })));
      } catch { lost('subscription_send_failed'); }
    });
    current.addEventListener('message', event => {
      if (socket !== current || stopped || typeof event.data !== 'string' || event.data.length > 1_000_000) return;
      let message: any;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      state.lastMessageAt = Date.now();
      if (Number.isInteger(message.id) && message.id >= 1 && message.id <= expectedWallets) {
        if (message.error || !Number.isSafeInteger(message.result) || message.result < 0) { lost('subscription_rejected_' + String(message.error?.code ?? 'invalid_ack')); return; }
        if (requests.has(message.id)) return;
        requests.add(message.id); ids.add(message.result); walletForSubscription.set(message.result, wallets[message.id - 1]); state.acknowledgedWallets = ids.size;
        if (ids.size === expectedWallets && !state.ready) { state.ready = true; delay = 1000; consecutiveFailures = 0; if (timeout) cancel(timeout); options.onReady(); }
        return;
      }
      if (message.method !== 'logsNotification' || !ids.has(message.params?.subscription)) return;
      const value = message.params?.result?.value;
      if (value?.err != null || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value?.signature ?? '')) return;
      const wallet = walletForSubscription.get(message.params.subscription);
      if (!wallet) return;
      state.walletNotifications[wallet] = (state.walletNotifications[wallet] ?? 0) + 1;
      if (!mayContainWalletSwap(value.logs)) {
        state.skippedNonSwapLogs++;
        state.walletPrefilterSkipped[wallet] = (state.walletPrefilterSkipped[wallet] ?? 0) + 1;
        return;
      }
      state.observedTradeSignatures++;
      // Count callback handoffs only after the admission callback returns.
      // A throwing callback must not be reported as successfully forwarded.
      const admitted = options.onSignature(value.signature, wallet);
      if (admitted !== false) state.walletQueued[wallet] = (state.walletQueued[wallet] ?? 0) + 1;
    });
    current.addEventListener('close', (event: any) => lost('closed_' + String(Number.isInteger(event?.code) ? event.code : 'unknown')));
    current.addEventListener('error', () => lost('socket_error'));
  }
  connect();
  return { state, stop() { stopped = true; state.ready = false; if (timeout) cancel(timeout); if (reconnect) cancel(reconnect); const old = socket; socket = null; try { old?.close(); } catch {} } };
}
