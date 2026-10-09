import assert from 'node:assert/strict';
import test from 'node:test';
import { protocolDiscoveryRoute, buildProtocolDiscoveryAlertText, socialMafiaMarketGate } from '../src/chains/robinhood/ponsSocialMafiaAlert.js';

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


test('Social Mafia waits for current buying and creator evidence, not social publication alone',()=>{
 const now=2000000;
 const stats={price:0.01,marketCap:10000,volume5m:300,buys:4,sells:1,preBond:true,curveReserve:800};
 const owner={devPercent:1,devObservedAt:now,top10Percent:null,top10Coverage:'UNAVAILABLE' as const};
 const gate=(s=stats,o=owner,f:any=null)=>socialMafiaMarketGate(s,o,f,now);
 assert.equal(gate().qualified,true);
 // Reported KUNAI snapshot: no recent buys, nearly empty reserve, dust holding.
 assert.equal(gate({...stats,volume5m:23.291,buys:0,sells:1,curveReserve:1.373},{...owner,devPercent:0.00001}).qualified,false);
 assert.equal(gate({...stats,curveReserve:1.373}).reason,'DRAINED_CURVE');
 assert.equal(gate({...stats,buys:2,sells:3}).reason,'WEAK_OR_SELL_DOMINATED_ACTIVITY');
 assert.equal(socialMafiaMarketGate({...stats,move5m:-1},owner,null,now).reason,'FALLING_MARKET');
 assert.equal(gate(stats,{...owner,devPercent:0}).reason,'CREATOR_BALANCE_DEPLETED_WITHOUT_VERIFIED_BURN');
 assert.equal(gate(stats,{...owner,devObservedAt:now-120001}).missing,true);
 assert.equal(socialMafiaMarketGate({...stats,buys:null},owner,null,now).missing,true);
 assert.equal(gate(stats,owner,{confirmedDevBurnPercent:0,otherDevTransferPercent:1,evidenceStatus:'COMPLETE',scannedAt:now}).reason,'CREATOR_OUTFLOW_OBSERVED');
 const burn={confirmedDevBurnPercent:1,otherDevTransferPercent:0,evidenceStatus:'COMPLETE',scannedAt:now};
 assert.equal(gate(stats,{...owner,devPercent:0},burn).qualified,true);
 assert.equal(gate(stats,{...owner,devPercent:0},{...burn,evidenceStatus:'BALANCES_ONLY'}).qualified,false);
 assert.equal(socialMafiaMarketGate({...stats,preBond:false,liquidity:100},owner,null,now).reason,'THIN_MARKET');
});
