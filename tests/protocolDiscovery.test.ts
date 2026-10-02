import assert from 'node:assert/strict';
import test from 'node:test';
import { protocolDiscoveryRoute, buildProtocolDiscoveryAlertText } from '../src/chains/robinhood/ponsSocialMafiaAlert.js';

test('protocol name discovery is a separate weaker route and confirmed tokens receive one stronger card', () => {
  for (const name of ['Alpha Protocol', 'PROTOCOLS Labs', 'Alpha Protocol-v2']) assert.equal(protocolDiscoveryRoute(name, false), 'PROTOCOL_DISCOVERY');
  for (const name of ['Protocolized', 'MyProtocols', 'ordinary project', '', null]) assert.equal(protocolDiscoveryRoute(name, false), null);
  assert.equal(protocolDiscoveryRoute('Alpha Protocol', true), 'SOCIAL_MAFIA');
  assert.equal(protocolDiscoveryRoute('ordinary project', true), 'SOCIAL_MAFIA');
});

test('discovery card omits unsupported metrics, distinguishes FDV and makes no confirmation claim', () => {
  const text = buildProtocolDiscoveryAlertText({ token: '0x' + '1'.repeat(40), name: '<Protocol>', symbol: 'A&B',
    socials: { xUrl: 'https://x.com/project', xHandle: 'project', telegramUrl: 'https://t.me/project', telegramLabel: '@project' },
    creator: '0x' + '2'.repeat(40), ageMinutes: 15.5, checkedAt: '12:00:00 UTC', fdv: 4500,
    marketCap: null, price: NaN, holding: null, volume5m: 0,
  });
  assert.match(text, /&lt;Protocol&gt;/); assert.match(text, /A&amp;B/);
  assert.match(text, /FDV/); assert.doesNotMatch(text, /MC |Price |Creator holding|CA listed|Data unavailable/);
  assert.match(text, /Volume · 5m/); assert.match(text, /15m/);
  assert.match(text, /Social ownership unverified · Research only/);
});
