import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanAlertCard } from '../src/ui/alertCardLayout.js';
import { RESEARCH_DISCLOSURE, withResearchDisclosure } from '../src/ui/researchDisclosure.js';
import { alphaosWelcomeText, alphaosUsageGuide, alphaosGroupGuide, alphaosScanGuide } from '../src/bot/welcome.js';
import { alphaosHomeText, alphaosFeatureGuide } from '../src/product/featureGuide.js';
test('research disclosure is explicit and idempotent across alert families', () => {
  for (const title of ['BOOST DETECTED', 'DEX PAID DETECTED', 'SOCIAL MAFIA ALERT', 'TRADE SETUP WATCH', 'ARC OPPORTUNITY', 'WALLET RESEARCH']) {
    const original = `<b>${title}</b>\nMC $10K\n<code>0x123</code>`;
    const result = cleanAlertCard(original);
    assert.ok(result.includes(RESEARCH_DISCLOSURE));
    assert.ok(result.includes('MC $10K'));
    assert.equal(cleanAlertCard(result), result);
  }
  assert.equal(withResearchDisclosure(withResearchDisclosure('Research')), withResearchDisclosure('Research'));
});
test('onboarding, help, group setup and plan guide explain research-only purpose', () => {
  for (const text of [alphaosWelcomeText, alphaosUsageGuide, alphaosGroupGuide, alphaosScanGuide, alphaosHomeText(), alphaosFeatureGuide()]) {
    assert.ok(text.includes(RESEARCH_DISCLOSURE));
  }
});
