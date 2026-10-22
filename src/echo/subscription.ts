import { ECHO_WALLETS } from './signals.js';
import { setTimeout, clearTimeout } from 'node:timers';
type Socket = { addEventListener(type: string, listener: (event: any) => void): void; send(data: string): void; close(): void };
type Timer = number | NodeJS.Timeout;
type Options = {
  url: string; onSignature(signature: string): void; onReady(): void;
  socket?: (url: string) => Socket;
  later?: (callback: () => void, milliseconds: number) => Timer;
  cancel?: (timer: Timer) => void;
};
export function startEchoSubscription(options: Options) {
  const later = options.later ?? setTimeout, cancel = options.cancel ?? clearTimeout;
  const state = { ready: false, acknowledgedWallets: 0, reconnects: 0, lastMessageAt: null as number | null };
  let socket: Socket | null = null, stopped = false, reconnect: Timer | undefined;
  let timeout: Timer | undefined, delay = 1000;
  function connect() {
    if (stopped) return;
    state.ready = false; state.acknowledgedWallets = 0;
    const ids = new Set<number>();
    const expectedWallets = Object.keys(ECHO_WALLETS).length;
    const requests = new Set<number>();
    const lost = () => {
      if (socket !== current || stopped) return;
      socket = null; state.ready = false; state.acknowledgedWallets = 0;
      if (timeout) cancel(timeout);
      try { current.close(); } catch { /* no provider URLs in logs */ }
      state.reconnects++;
      reconnect = later(connect, delay); delay = Math.min(30_000, delay * 2);
    };
    let current: Socket;
    try { current = (options.socket ?? (url => new WebSocket(url)))(options.url); }
    catch { state.reconnects++; reconnect = later(connect, delay); delay = Math.min(30_000, delay * 2); return; }
    socket = current;
    timeout = later(lost, 10_000);
    current.addEventListener('open', () => {
      if (socket !== current || stopped) return;
      try {
        Object.keys(ECHO_WALLETS).forEach((wallet, i) => current.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'logsSubscribe', params: [{ mentions: [wallet] }, { commitment: 'confirmed' }] })));
      } catch { lost(); }
    });
    current.addEventListener('message', event => {
      if (socket !== current || stopped || typeof event.data !== 'string' || event.data.length > 1_000_000) return;
      let message: any;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      state.lastMessageAt = Date.now();
      if (Number.isInteger(message.id) && message.id >= 1 && message.id <= expectedWallets) {
        if (message.error || !Number.isSafeInteger(message.result) || message.result < 0) { lost(); return; }
        if (requests.has(message.id)) return;
        requests.add(message.id); ids.add(message.result); state.acknowledgedWallets = ids.size;
        if (ids.size === expectedWallets && !state.ready) { state.ready = true; delay = 1000; if (timeout) cancel(timeout); options.onReady(); }
        return;
      }
      if (message.method !== 'logsNotification' || !ids.has(message.params?.subscription)) return;
      const value = message.params?.result?.value;
      if (value?.err != null || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(value?.signature ?? '')) return;
      options.onSignature(value.signature);
    });
    current.addEventListener('close', lost);
    current.addEventListener('error', lost);
  }
  connect();
  return { state, stop() { stopped = true; state.ready = false; if (timeout) cancel(timeout); if (reconnect) cancel(reconnect); const old = socket; socket = null; try { old?.close(); } catch {} } };
}
