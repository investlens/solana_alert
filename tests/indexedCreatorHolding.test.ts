import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIndexedCreatorHolding} from '../src/services/indexedCreatorHolding.js';
import {tokenBalancePercent} from '../src/services/tokenBalancePercent.js';
import {withOwnershipDisclosure} from '../src/ui/ownershipDisclosure.js';
const token='0x'+'1'.repeat(40);
const row=(value='1',total_supply='1000000000000000000000000000')=>({value,token:{address_hash:token,type:'ERC-20',total_supply}});
test('creator balances distinguish tiny holdings, genuine zero and impossible supply',()=>{
 assert.ok(tokenBalancePercent(1n,10n**27n)!>0);
 assert.equal(tokenBalancePercent(0n,10n),0);
 assert.equal(tokenBalancePercent(11n,10n),null);
 assert.equal(tokenBalancePercent(1n,0n),null);
});
test('indexed fallback requires one exact ERC20 row with supply and never guesses missing zero',()=>{
 assert.ok(parseIndexedCreatorHolding([row()],token,100)!.percent>0);
 assert.equal(parseIndexedCreatorHolding([row('0','10')],token,100)!.percent,0);
 for(const payload of [[],{},[row(),row()],[row('11','10')],[row('1','0')],[row('', '10')],
  [{...row(),token:{...row().token,address_hash:'0x'+'2'.repeat(40)}}],
  [{...row(),token:{...row().token,type:'ERC-721'}}]])assert.equal(parseIndexedCreatorHolding(payload,token),null);
});
test('indexed fallback discloses index limitations and does not invent a chain block',()=>{
 const text=withOwnershipDisclosure('alert',{devPercent:0.001,devSource:'BLOCKSCOUT_INDEXED',devObservedAt:100,
 top10Percent:null,top10Coverage:'UNAVAILABLE'});
 assert.match(text,/indexed/);assert.match(text,/live block not confirmed/);assert.match(text,/&lt;0.01%/);
 assert.doesNotMatch(text,/on-chain block/);
});
