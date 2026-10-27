import test from 'node:test';
import assert from 'node:assert/strict';
import { startEchoSubscription } from '../src/echo/subscription.js';
import { ECHO_WALLETS } from '../src/echo/signals.js';

type Listener = (event: any) => void;
test('websocket must acknowledge every tracked wallet before becoming ready', () => {
  const listeners = new Map<string, Listener>();
  const sent: any[] = [], received: string[] = [];
  let ready = 0;
  const socket = {
    addEventListener(type: string, fn: Listener) { listeners.set(type, fn); },
    send(message: string) { sent.push(JSON.parse(message)); },
    close() {},
  };
  const client = startEchoSubscription({
    url: 'wss://example.invalid',
    socket: () => socket,
    onReady: () => { ready++; },
    onSignature: sig => received.push(sig),
    later: () => 1, cancel: () => {},
  });
  listeners.get('open')!({});
  assert.equal(sent.length, Object.keys(ECHO_WALLETS).length);
  assert.equal(client.state.ready, false);
  for (let i = 0; i < sent.length; i++) {
    listeners.get('message')!({ data: JSON.stringify({ jsonrpc: '2.0', id: sent[i].id, result: i + 100 }) });
  }
  assert.equal(client.state.ready, true);
  assert.equal(ready, 1);
  const signature = '3'.repeat(88);
  listeners.get('message')!({ data: JSON.stringify({ method: 'logsNotification', params: {
    subscription: 100, result: { value: { err: null, signature } }
  } }) });
  assert.deepEqual(received, [signature]);
  client.stop();
});
