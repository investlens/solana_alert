import test from 'node:test';
import assert from 'node:assert/strict';
import { screenEchoManualSell, ECHO_MANUAL_SELL_BROADCAST_ENABLED } from '../src/echo/manualSellAdmission.js';
const good={ownerChatId:'123',senderId:123,chatId:123,
 mint:'So11111111111111111111111111111111111111112',
 percent:50 as const,verifiedTokenBalanceRaw:'10000000',heldPositionVerified:true,
 activeSellReservation:false,quoteVerified:true,simulationPassed:true};
test('manual sell remains eligible when auto-buy slots are occupied or buy kill switch is on',()=>{
 assert.deepEqual(screenEchoManualSell(good),{allowed:true,percent:50});
 assert.deepEqual(screenEchoManualSell({...good,percent:100}),{allowed:true,percent:100});
 assert.equal(ECHO_MANUAL_SELL_BROADCAST_ENABLED,false);
});
test('manual sell denies unauthorized, unverified, duplicate and unsimulated requests',()=>{
 for(const overrides of [{senderId:999},{chatId:999},{mint:'invalid'},
  {heldPositionVerified:false},{verifiedTokenBalanceRaw:'0'},
  {activeSellReservation:true},{quoteVerified:false},{simulationPassed:false}])
  assert.equal(screenEchoManualSell({...good,...overrides}).allowed,false);
});
