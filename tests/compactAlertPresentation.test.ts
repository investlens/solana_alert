import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAlphaMarketActions } from '../src/ui/alphaNotificationActions.js';
import { buildSocialMafiaActions, buildSocialMafiaAlertText, resolveSocialMafiaSocials } from '../src/chains/robinhood/ponsSocialMafiaAlert.js';
import { buildPremiumTokenNotification } from '../src/ui/premiumTokenNotification.js';

const token = '0x1234567890abcdef1234567890abcdef12345678';
const socials = resolveSocialMafiaSocials({ twitter: 'https://x.com/projectalpha', telegram: 'https://t.me/projectalpha' })!;
test('compact actions retain exact callbacks, use two columns and omit duplicate destinations', () => {
  const rows = buildAlphaMarketActions({ chartUrl: 'https://dexscreener.com/robinhood/pair',
    tokenUrl: `https://robinhoodchain.blockscout.com/token/${token}`, fullIntelCallback: `FI_RH_${token}`,
    trackCallback: `BOOST_TRACK_${token}`, copyContractCallback: `COPY_CA_${token}`, muteCallback: `BOOST_MUTE_${token}`,
    xUrl: socials.xUrl, telegramUrl: socials.telegramUrl });
  assert.deepEqual(rows.map(row => row.map(button => button.text)), [['📊 Chart', '🧠 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['𝕏 X', '✈️ TG']]);
  for (const button of rows.flat()) if (button.callback_data) assert.ok(Buffer.byteLength(button.callback_data) <= 64);
  assert.deepEqual(buildAlphaMarketActions({ tokenUrl: `https://robinhoodchain.blockscout.com/token/${token}` }),
    [[{ text: '🔎 Token', url: `https://robinhoodchain.blockscout.com/token/${token}` }]]);
});
test('Social Mafia keeps truthful FDV, verified zero holdings, linked explorer and short social buttons', () => {
  const message = buildSocialMafiaAlertText({ tokenAddress: token, launchpadLabel: 'PONS', socials,
    symbol: 'AXIL', name: 'Axil Token', fdv: 51000, devHoldingPercent: 0 });
  assert.match(message, /AXIL.*Axil Token/);
  assert.match(message, /FDV\s+<b>\$51\.0K/);
  assert.doesNotMatch(message, /Market cap/);
  assert.match(message, /Dev holding\s+<b>0\.00%/);
  assert.match(message, /blockscout\.com\/token/);
  const unavailable = buildSocialMafiaAlertText({ tokenAddress: token, launchpadLabel: 'PONS', socials });
  assert.match(unavailable, /Symbol unavailable/);
  assert.match(unavailable, /Unverified/);
  const rows = buildSocialMafiaActions(token, { id: 'PONS', label: 'PONS', tokenUrl: () => 'https://www.ponsfamily.com/launchpad/token' }, socials);
  assert.deepEqual(rows.map(row => row.map(button => button.text)), [['🚀 PONS', '🧠 Full Intel'], ['⭐ Track', '📋 Copy CA'], ['𝕏 X', '✈️ TG']]);
});
test('boost shows verified holdings, boost count and social links without implying unlocked LP safety', () => {
  const message = buildPremiumTokenNotification({ state: 'BOOST', symbol: 'READOUT', address: token,
    market: { symbol: "READOUT", name: null, address: token, price: null, fdv: null, volume5m: null, chartUrl: null, marketCap: 4100, liquidity: 6200 }, boostTotal: 30, boostIncrement: 30,
    evidence: { devHoldingEvidence: 'VERIFIED', devHoldingPercent: 4.25, burnedPercent: null, burnEvidence: 'UNAVAILABLE' },
    socials: { twitter: socials.xUrl, telegram: socials.telegramUrl },
    insightTitle: 'WHY NOW', insight: ['LP UNLOCKED'], statusTitle: 'Security', status: 'LP UNLOCKED' });
  assert.match(message, /30 total \(\+30\)/);
  assert.match(message, /4\.25%/);
  assert.match(message, /HIGH RUG RISK/);
  assert.match(message, /No sell-restriction flag reported/);
  assert.doesNotMatch(message, /✅|PASSED|\bSAFE\b/);
  assert.match(message, /href="https:\/\/x.com\/projectalpha"/);
  assert.match(message, /href="https:\/\/t.me\/projectalpha"/);
});
