import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderAdminWalletStatus, type AdminWalletSnapshot } from '../src/echo/adminWalletStatus.js';
const wallet='5YRgrP3mjGzrzirYYN5HAQH19cTYREYwGxW6XRJQUzij';
const base:AdminWalletSnapshot={publicAddress:wallet,balanceSol:0.23,observedAt:Date.now(),
 verifiedMainnet:true,openPositions:0,realizedPnlSol:0,emergencyStop:true};
describe('Echo read-only wallet status',()=>{
 it('always shows trading disabled and emergency stop',()=>{
  const view=renderAdminWalletStatus(base);
  assert.match(view,/Live BUY: DISABLED/);
  assert.match(view,/Automatic SELL: DISABLED/);
  assert.match(view,/Emergency STOP: ON/);
  assert.match(view,/0 \/ 2/);
 });
 it('does not present unverified addresses as fundable',()=>{
  const view=renderAdminWalletStatus({...base,verifiedMainnet:false});
  assert.match(view,/Wallet: NOT VERIFIED/);
  assert.match(view,/Do not fund/);
 });
 it('fails closed on stale or invalid balance',()=>{
  for(const patch of [{observedAt:Date.now()-120000},{balanceSol:NaN},{balanceSol:-1},{observedAt:null}])
   assert.match(renderAdminWalletStatus({...base,...patch}),/Balance: UNAVAILABLE/);
 });
});
