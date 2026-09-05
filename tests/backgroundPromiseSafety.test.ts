import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeBackgroundError,
  logUnhandledRejection,
  protectBackgroundPromise,
} from '../src/services/backgroundPromiseSafety.js';

test('rejected background promise is contained and logged with its service name', async () => {
  const logs: string[] = [];
  await assert.doesNotReject(() => protectBackgroundPromise('LiveTrack',
    Promise.reject({ message: 'upstream request timeout', code: '57014' }), line => logs.push(line)));
  assert.deepEqual(logs, ['[LiveTrack] Background task failed: code=57014 upstream request timeout']);
});

test('a later background cycle still runs after a transient rejected cycle', async () => {
  let cycles = 0;
  const runCycle = () => {
    cycles += 1;
    return cycles === 1 ? Promise.reject(new Error('upstream request timeout')) : Promise.resolve();
  };
  await protectBackgroundPromise('LiveTrack', runCycle(), () => {});
  await protectBackgroundPromise('LiveTrack', runCycle(), () => {});
  assert.equal(cycles, 2);
});

test('unhandled rejection safety logging handles object reasons without throwing', () => {
  const logs: string[] = [];
  assert.doesNotThrow(() => logUnhandledRejection({ message: 'upstream request timeout' }, line => logs.push(line)));
  assert.deepEqual(logs, ['[Main] Unhandled promise rejection: upstream request timeout']);
});

test('unknown rejection objects are concise and never stringify the full object', () => {
  assert.equal(describeBackgroundError({ response: '<html>large upstream response</html>' }), 'non-Error object rejection');
});

test('object rejection with a throwing message getter is safely described', () => {
  const reason = Object.defineProperty({}, 'message', { get() { throw new Error('getter failed'); } });
  assert.equal(describeBackgroundError(reason), 'uninspectable object rejection');
});
