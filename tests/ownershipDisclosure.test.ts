import test from 'node:test';
import assert from 'node:assert/strict';
import {withOwnershipDisclosure, validOwnershipPercent} from '../src/ui/ownershipDisclosure.js';
const unknown = {devPercent:null,top10Percent:null,top10Coverage:'UNAVAILABLE' as const};
test('ownership clearly warns at ten percent and precedes the contract', () => {
 const text=withOwnershipDisclosure('BOOST\n\n<b>CONTRACT</b>\n0xabc', {devPercent:10,top10Percent:42,top10Coverage:'INDEXED_SAMPLE'});
 assert.match(text,/10.00%/);assert.match(text,/potential sell pressure/);assert.match(text,/Top 10 · indexed sample/);
 assert.ok(text.indexOf('OWNERSHIP') < text.indexOf('CONTRACT'));
});
test('unknown never becomes zero; verified zero remains visible',()=>{
 for (const value of [null,undefined,'',' ',true,false,[],{},NaN,101,-1]) assert.equal(validOwnershipPercent(value),null);
 assert.match(withOwnershipDisclosure('alert',unknown),/Dev holding  <b>Unavailable/);
 assert.match(withOwnershipDisclosure('alert',{...unknown,devPercent:0}),/0.00%/);
});
test('ownership enrichment remains one section and retains existing measured developer value',()=>{
 const initial=withOwnershipDisclosure('alert\n👨‍💻 Dev holding  <b>10%<\/b>\n\n<b>CONTRACT</b>\n0xabc',unknown);
 const updated=withOwnershipDisclosure(initial,{devPercent:12,top10Percent:50,top10Coverage:'INDEXED_SAMPLE'});
 assert.equal((updated.match(/OWNERSHIP/g)??[]).length,1);
 assert.equal((updated.match(/Top 10/g)??[]).length,1);
 assert.match(updated,/12.00%/);assert.match(initial,/10.00%/);
});

test('ownership precedes the ARC contract even without a contract heading',()=>{
 const text=withOwnershipDisclosure('ARC OPPORTUNITY\n\n<code>0xabc</code>\nDYOR', {devPercent:10,top10Percent:40,top10Coverage:'PROVIDER_REPORTED'});
 assert.ok(text.indexOf('OWNERSHIP')<text.indexOf('<code>'));assert.match(text,/provider wallet sample/);
});
