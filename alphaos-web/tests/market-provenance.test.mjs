import assert from 'node:assert/strict';
import { test } from 'node:test';
import { needsVenueConfirmation } from '../lib/dashboard/market-provenance.ts';
const launch={token_address:'0xabc',chain:'robinhood',curve_address:'0xcurve',pool_address:null,protocol_version:'v2'};
const evidence={token:'0xabc',chain:'robinhood',observedAt:'2026-10-05T16:00:00Z',venueConfirmed:true};
test('withholds Praetor-style dust pool stats without venue evidence',()=>assert.equal(needsVenueConfirmation(launch,{marketCap:3460,liquidity:0.46,pairAddress:'0xdust'}),true));
test('accepts exact-token confirmed curve evidence',()=>assert.equal(needsVenueConfirmation(launch,{marketEvidence:{...evidence,venue:'PONS_CURVE',curveAddress:'0xcurve'}}),false));
test('accepts confirmed graduation with matching pair',()=>assert.equal(needsVenueConfirmation(launch,{pairAddress:'0xpool',marketEvidence:{...evidence,venue:'DEX',graduated:true,pairAddress:'0xpool'}}),false));
test('rejects wrong token, chain, pair and absent graduation',()=>{
 for(const override of [{token:'0xother'},{chain:'arc'},{pairAddress:'0xdust'},{graduated:false},{observedAt:'bad-date'}]){
 assert.equal(needsVenueConfirmation(launch,{pairAddress:'0xpool',marketEvidence:{...evidence,venue:'DEX',graduated:true,pairAddress:'0xpool',...override}}),true);
 }
});
test('does not require PONS curve evidence for unrelated tokens',()=>assert.equal(needsVenueConfirmation(undefined,{}),false));
