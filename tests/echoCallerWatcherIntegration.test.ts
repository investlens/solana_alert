import test from 'node:test';
import assert from 'node:assert/strict';
import { ECHO_WALLETS } from '../src/echo/signals.js';
import { ECHO_MONITORED_CALLERS, ECHO_ALERT_CALLER_WALLETS } from '../src/echo/callerRegistry.js';
test('live watcher address registry matches vetted alert-enabled monitoring', () => {
 const configured = ECHO_MONITORED_CALLERS.filter(c => c.alert).map(c => c.wallet).sort();
 assert.deepEqual(Object.keys(ECHO_WALLETS).sort(), configured);
 assert.deepEqual(Object.keys(ECHO_WALLETS).sort(), [...ECHO_ALERT_CALLER_WALLETS].sort());
 assert.equal(ECHO_WALLETS[ECHO_MONITORED_CALLERS[0]!.wallet], 'WHALE · slingoor');
});
