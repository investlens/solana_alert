import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePonsPublicContext, classifyTelegramPreview } from '../src/chains/robinhood/ponsPublicContext.js';
const token = '0x1111111111111111111111111111111111111111';
const factory = '0x2222222222222222222222222222222222222222';
const creator = '0x3333333333333333333333333333333333333333';
function page(address = token) {
  const record = { initialDetails: { token: address, factory, deployer: creator, name: 'AXIL', symbol: '$$AXIL',
    phase: 0, venue: 'curve', decimals: 18, totalSupplyWei: '1000000000000000000000000000', socials: { twitter: 'https://x.com/axil', telegram: 'https://t.me/axil_coin' } }, initialPriceQuote: 1.664e-8, quoteUsd: 228.38 };
  return `<script>self.__next_f.push(${JSON.stringify([1, '18:' + JSON.stringify(['$', 'screen', null, record]) + '\n'])})</script>`;
}
test('PONS identity and non-native quote FDV require matching token, factory and creator', () => {
  const context = parsePonsPublicContext(page(), token, factory, creator)!;
  assert.equal(context.symbol, 'AXIL'); assert.equal(context.name, 'AXIL');
  assert.equal(context.creator, creator); assert.ok(Math.abs(context.fdvUsd! - 3800.2432) < 0.001);
  assert.equal(context.phase, 0); assert.equal(context.venue, 'curve');
  assert.equal(parsePonsPublicContext(page(factory), token, factory, creator), null);
  assert.equal(parsePonsPublicContext(page(), token, token, creator), null);
  assert.equal(parsePonsPublicContext(page(), token, factory, token), null);
  assert.equal(parsePonsPublicContext('<html>Site unavailable</html>', token, factory, creator), null);
});
test('Telegram preview distinguishes explicit community counts; invites and blocked pages remain unknown', () => {
  assert.equal(classifyTelegramPreview('<div class="tgme_page_extra">123 members, 12 online</div>'), 'Group');
  assert.equal(classifyTelegramPreview('<div class="tgme_page_extra">5,231 subscribers</div>'), 'Channel');
  assert.equal(classifyTelegramPreview('<div class="tgme_page_extra">@axil_coin</div><a>Send Message</a>'), 'Personal account');
  assert.equal(classifyTelegramPreview('<div class="tgme_page_extra">@axil_coin</div>'), 'Type unverified');
  assert.equal(classifyTelegramPreview('Site Unavailable'), 'Type unverified');
});
