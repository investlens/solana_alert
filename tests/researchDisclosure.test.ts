import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';
import { RESEARCH_DISCLOSURE } from '../src/ui/researchDisclosure.js';
test('ARC research disclosure preserves evidence and remains idempotent', () => {
  for (const category of ['ARC OPPORTUNITY', 'BOOST DETECTED', 'DEX PAID DETECTED']) {
    const card = cleanAlertCard(`<b>${category}</b>\nMC $20K\n<code>0x123</code>`);
    assert.ok(card.includes(RESEARCH_DISCLOSURE));
    assert.ok(card.includes('MC $20K'));
    assert.equal(cleanAlertCard(card), card);
  }
});
