import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupResearchSettings } from '../src/services/groupResearchSettings.js';
test('group preference restores after restart and opt-out persists without token data', async () => {
  let saved: string[] = [];
  const storage = { read: async () => ({ value: { groups: [...saved] }, fetchedAt: new Date().toISOString() }), write: async (groups: string[]) => { saved = [...groups]; } };
  const first = createGroupResearchSettings(storage);
  assert.equal(await first.set('-1', true), true);
  const restarted = createGroupResearchSettings(storage);
  assert.equal(await restarted.enabled('-1'), true);
  await restarted.set('-1', false);
  assert.equal(await createGroupResearchSettings(storage).enabled('-1'), false);
  assert.equal(await first.set('123', true), false);
});
test('stored group settings are bounded and invalid IDs are ignored', async () => {
  const registry = createGroupResearchSettings({ read: async () => ({ value: { groups: ['invalid', ...Array.from({ length: 200 }, (_, i) => `-${i+1}`)] }, fetchedAt: '' }), write: async () => {} });
  assert.equal(await registry.enabled('-100'), true); assert.equal(await registry.enabled('-101'), false);
  assert.equal(await registry.set('-201', true), false);
});
