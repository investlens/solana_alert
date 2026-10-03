import test from 'node:test';
import assert from 'node:assert/strict';
import { alphaosAlertCardSvg, buildAlphaosAlertCard } from '../src/ui/alphaosAlertCard.js';
import { polishArcTelegramPresentation } from '../src/chains/arc/telegramPresentation.js';
test('ARC banner renders neutral research rather than an X confirmation badge', async () => {
  const args = { symbol: 'COLLECT', category: 'ARC OPPORTUNITY', chainLabel: 'ARC', badge: 'INFORMATION / DYOR' };
  const image = await buildAlphaosAlertCard(args);
  assert.equal(image.subarray(1, 4).toString(), 'PNG');
  assert.notEqual(alphaosAlertCardSvg(args), alphaosAlertCardSvg({ symbol: 'COLLECT' }));
});
test('ARC market screening does not claim contract security is verified', () => {
  const text = polishArcTelegramPresentation('AlphaOS · ARC OPPORTUNITY\n🚀 <b>COLLECT</b>\n💰 Market Cap <b>$45,498</b>\n💧 Liquidity <b>$18,767</b>\n📊 5m Volume <b>$8,225</b>').text;
  assert.match(text, /Market activity detected · Security incomplete/);
  assert.doesNotMatch(text, /Core ARC checks passed/);
});
test('ARC FDV-only presentation never relabels FDV as market cap', () => {
  const text = polishArcTelegramPresentation('AlphaOS · ARC OPPORTUNITY\n🚀 <b>NEW</b>\n💰 FDV <b>$45,498</b>\n💧 Liquidity <b>$18,767</b>\n📊 5m Volume <b>$8,225</b>').text;
  assert.match(text, /<b>FDV<\/b>/); assert.doesNotMatch(text, /Market cap|n\/a/);
});

test('Boost and Burn preserve FDV labels and opportunities preserve flow ratio', () => {
  for (const heading of ['BOOST DETECTED · ARC', 'AlphaOS · ARC SUPPLY BURN']) {
    const text = polishArcTelegramPresentation(`${heading}\n<b>TEST</b>\n💰 FDV <b>$12K</b>`).text;
    assert.match(text, /<b>FDV<\/b>.*\$12K/);
    assert.doesNotMatch(text, /Market cap/);
  }
  const flow = polishArcTelegramPresentation('AlphaOS · ARC OPPORTUNITY\n🟢 Buys / Sells <b>30 / 10</b> · <b>3.00x</b>').text;
  assert.match(flow, /30 \/ 10 · 3.00x/);
});
