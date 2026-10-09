import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorHoldingPercentFromRaw, parsePonsPublicContext, parsePonsV1PoolMapping, classifyTelegramPreview } from '../src/chains/robinhood/ponsPublicContext.js';
const token = '0x1111111111111111111111111111111111111111';
const factory = '0x2222222222222222222222222222222222222222';
const creator = '0x3333333333333333333333333333333333333333';
test('V1 direct-pool mapping accepts the legacy page shape but rejects identity and curve conflicts', () => {
  const pool = '0x6675aD01Adb2cA3c2f2793A4842E648e6C112bF7';
  const render = (overrides = {}) => `<script>self.__next_f.push(${JSON.stringify([1, '18:' + JSON.stringify({initialDetails:{token,deployer:creator,pool,...overrides}}) + '\n'])})</script>`;
  assert.equal(parsePonsV1PoolMapping(render(),token,creator),pool);
  assert.equal(parsePonsV1PoolMapping(render({token:factory}),token,creator),null);
  assert.equal(parsePonsV1PoolMapping(render({deployer:factory}),token,creator),null);
  assert.equal(parsePonsV1PoolMapping(render({pool:'0x'+'0'.repeat(40)}),token,creator),null);
  assert.equal(parsePonsV1PoolMapping(render({venue:'curve',curveAddress:factory}),token,creator),null);
  assert.equal(parsePonsV1PoolMapping('<html>blocked</html>',token,creator),null);
});
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

test('creator balance preserves tiny nonzero percentages and rejects inconsistent reads',()=>{
 assert.equal(creatorHoldingPercentFromRaw(0n,10n**27n),0);
 assert.ok(creatorHoldingPercentFromRaw(1n,10n**27n)!>0);
 assert.equal(creatorHoldingPercentFromRaw(10n,100n),10);
 assert.equal(creatorHoldingPercentFromRaw(101n,100n),null);
 assert.equal(creatorHoldingPercentFromRaw(1n,0n),null);
});

function currentPage(overrides={}, tradeOverrides={}) {
 const launch={address:token,name:'Brivon Network',symbol:'BRIVON',protocol:'v2',stage:'curve',factory,deployer:creator,
  decimals:18,totalSupply:1000000000,circulatingSupply:1000000000,priceUsd:0.000022657873478285073,
  marketCapUsd:22657.873478285073,volumeUsd:12392.456227052136,raisedUsd:5662.309818065646,progress:0.5392,
  createdAt:1000,curve:factory,poolId:null,quoteUsd:2500,socials:{twitter:'https://x.com/brivonnetwork',telegram:null},...overrides};
 const text='25:T4,test14:'+JSON.stringify(['$','screen',null,{address:token,launch,trades:'$@27'}])+'\n27:'+JSON.stringify({items:[
  {id:'a',side:'buy',timestamp:1950,quoteAmount:0.01},
  {id:'b',side:'sell',timestamp:1800,quoteAmount:0.02},
  {id:'c',side:'buy',timestamp:1600,quoteAmount:0.03}],nextCursor:'more',...tradeOverrides})+'\n';
 return `<script>self.__next_f.push(${JSON.stringify([1,text.slice(0,80)])})</script><script>self.__next_f.push(${JSON.stringify([1,text.slice(80)])})</script>`;
}
test('current PONS launch payload survives text-record prefixes and split chunks with exact identity checks',()=>{
 const c=parsePonsPublicContext(currentPage(),token,factory,creator,2000000)!;
 assert.equal(c.name,'Brivon Network');assert.equal(c.marketCapUsd,22657.873478285073);
 assert.equal(c.priceUsd,0.000022657873478285073);assert.equal(c.totalSupplyRaw,10n**27n);
 assert.equal(c.phase,0);assert.equal(c.venue,'curve');assert.equal(c.creator,creator);
 assert.equal(c.volumeTotalUsd,12392.456227052136);assert.equal(c.curveReserveUsd,5662.309818065646);
 assert.equal(c.progressPct,53.92);assert.equal(c.volume5mUsd,75);assert.equal(c.buys5m,1);assert.equal(c.sells5m,1);
 for(const changes of [{address:factory},{factory:token},{deployer:token},{totalSupply:-1},{decimals:37}])
  assert.equal(parsePonsPublicContext(currentPage(changes),token,factory,creator,2000000),null);
});
test('PONS partial trade history cannot masquerade as complete 5m volume; MC requires circulating supply',()=>{
 const c=parsePonsPublicContext(currentPage({circulatingSupply:null},{items:[{id:'a',side:'buy',timestamp:1950,quoteAmount:1}]}),token,factory,creator,2000000)!;
 assert.equal(c.volume5mUsd,null);assert.equal(c.buys5m,null);assert.equal(c.marketCapUsd,null);
 assert.ok(c.fdvUsd!>0);assert.ok(c.volumeTotalUsd!>0);
 assert.equal(parsePonsPublicContext(currentPage({circulatingSupply:2000000000}),token,factory,creator,2000000)!.marketCapUsd,null);
});


test('PONS graduated stage is postbond while unknown stages stay unconfirmed',()=>{
 for(const stage of ['dex','graduated']) {
  const c=parsePonsPublicContext(currentPage({stage,circulatingSupply:285714000}),token,factory,creator,2000000)!;
  assert.equal(c.phase,1);assert.equal(c.venue,'dex');
  assert.ok(c.marketCapUsd!<c.fdvUsd!);
 }
 const unknown=parsePonsPublicContext(currentPage({stage:'unknown'}),token,factory,creator,2000000)!;
 assert.equal(unknown.phase,null);assert.equal(unknown.venue,null);
});
