import test from 'node:test';
import assert from 'node:assert/strict';
import { getHolderLaunchConfig } from '../lib/holder-launch.ts';
test('prelaunch has no contract and cannot grant membership',()=>{
  const value=getHolderLaunchConfig({}); assert.equal(value.contract,null); assert.equal(value.status,'LAUNCHING_SOON'); assert.equal(value.minimumTokens,1000000); assert.equal(value.verificationEnabled,false);
});
test('a configured CA only publishes metadata, never enables verification',()=>{
  const value=getHolderLaunchConfig({ALPHAOS_TOKEN_ADDRESS:'0x'+'1'.repeat(40),ALPHAOS_HOLDER_ENABLED:'true'});
  assert.equal(value.status,'CONTRACT_PUBLISHED_VERIFICATION_PENDING'); assert.equal(value.verificationEnabled,false);
});
for(const value of ['0x'+'0'.repeat(40),'0x123','https://fake.example','<script>alert(1)</script>'])test('reject invalid or zero CA '+value,()=>assert.equal(getHolderLaunchConfig({ALPHAOS_TOKEN_ADDRESS:value}).contract,null));
