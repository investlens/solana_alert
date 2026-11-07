import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
// Source-level contract regression: both sides must continue naming
// the same mandatory fields. Nothing is signed, sent or RPC-fetched.
test('unsigned SDK pilot scenario exports every signer-required budget/FX field',()=>{
 const producer=readFileSync(join(process.cwd(),
  'scripts/echoOfficialFiveUsdScenarioQuote.ts'),'utf8');
 const consumer=readFileSync(join(process.cwd(),
  'scripts/echoRunSignerDiagnosticFromSdkScenario.ts'),'utf8');
 for(const name of [
  'scenarioAllInCents','publicFxUpperCents','publicFxConsensusOnly'
 ]){
  assert.match(producer,new RegExp('\\b'+name+':'));
  assert.match(consumer,new RegExp('x\\.'+name));
 }
 assert.match(producer,/ECHO_SCENARIO_ALL_IN_CENTS/);
 assert.match(consumer,/UNVERIFIED_PUBLIC_SPOT_PRICE/);
 assert.match(consumer,/MISSING_EXPLICIT_PILOT_CAP/);
});
