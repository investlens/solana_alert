import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getIndexedVerifiedPonsLaunch, isApprovedPonsOrigin, isVerifiedPonsLaunch } from '../src/chains/robinhood/ponsLaunchState.js';
import { supabase } from '../src/services/supabase.js';
import { routeBoostSecurity } from '../src/chains/robinhood/boostSecurityRouter.js';

const token = '0xf0c0fc281314a48ae4e52a9db08731cb6a38ca25';
const factory = '0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e';
test('actual missed V2 indexed origin routes trusted without a V1 view or honeypot provider', async () => {
  const original = supabase.from;
  const builder = { select: () => builder, eq: () => builder, ilike: () => builder,
    limit: () => builder, abortSignal: () => builder, maybeSingle:async()=>({ data: {token_address: token, factory_address: factory,
      deployer_address:'0x82f55f91d68b248021c64fbe5ccd931f999bbd51'}, error: null }) };
  supabase.from = (() => builder) as unknown as typeof original;
  try {
    const verified = await isVerifiedPonsLaunch(token);
    assert.equal(verified, true);
    assert.equal((await getIndexedVerifiedPonsLaunch(token))?.deployer,'0x82f55f91d68b248021c64fbe5ccd931f999bbd51');
    const decision = await routeBoostSecurity({tokenAddress:token, verifiedTrustedLaunchpad:verified, requireExplicitSellability:true});
    assert.equal(decision.allowed, true);
    assert.equal(decision.route, 'TRUSTED_LAUNCHPAD');
  } finally { supabase.from = original; }
});
test('origin rejects mismatched contract and unapproved factory', () => {
  assert.equal(isApprovedPonsOrigin(token,token,factory),true);
  assert.equal(isApprovedPonsOrigin(token,'0x1111111111111111111111111111111111111111',factory),false);
  assert.equal(isApprovedPonsOrigin(token,token,'0x1111111111111111111111111111111111111111'),false);
});
test('Boost delivery and DEX paid use V2-aware provenance and not the V1-only view', async () => {
  for (const path of ['src/services/alphaSemanticDeliveryService.ts','src/chains/robinhood/security/dexPaidAlertSafetyGate.ts']) {
    const source = await readFile(path,'utf8');
    assert.ok(source.includes('isVerifiedPonsLaunch'));
    assert.ok(!source.includes('getPonsLaunchState'));
  }
  const source = await readFile('src/services/alphaSemanticDeliveryService.ts','utf8');
  assert.equal(source.match(/const trusted = await isVerifiedPonsLaunch/g)?.length,1,'verify once before fanout, not once per user');
});
