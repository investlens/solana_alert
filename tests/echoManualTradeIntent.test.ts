import test from 'node:test';
import assert from 'node:assert/strict';
import { validateManualEchoIntent, ECHO_MANUAL_TRADING_ENABLED } from '../src/echo/manualTradeIntent.js';
import { ECHO_EXPECTED_EXECUTION_WALLET } from '../src/echo/executionWallet.js';
const base = {
 action:'BUY' as const, telegramUserId:'12345', authorizedAdminId:'12345',
 executionWallet:ECHO_EXPECTED_EXECUTION_WALLET, mint:'So11111111111111111111111111111111111111112',
 amountSol:0.05, confirmationTokenVerified:true
};
test('manual trading stays disabled and accepts only constrained intent shapes',()=>{
 assert.equal(ECHO_MANUAL_TRADING_ENABLED,false);
 assert.deepEqual(validateManualEchoIntent(base),{allowed:true,reservationKey:base.executionWallet+':'+base.mint});
 assert.equal(validateManualEchoIntent({...base,amountSol:0.1}).allowed,true);
 assert.equal(validateManualEchoIntent({...base,action:'SELL',amountSol:undefined,sellPercent:50}).allowed,true);
 assert.equal(validateManualEchoIntent({...base,action:'SELL',amountSol:undefined,sellPercent:100}).allowed,true);
});
test('unauthorized, unconfirmed, wrong wallet, bad mint and overspend fail closed',()=>{
 const invalid = [
 {...base,telegramUserId:'other'}, {...base,authorizedAdminId:''},
 {...base,confirmationTokenVerified:false}, {...base,executionWallet:'11111111111111111111111111111111'},
 {...base,mint:'not-a-mint'}, {...base,amountSol:0.2}, {...base,amountSol:0},
 {...base,amountSol:undefined}, {...base,sellPercent:50},
 {...base,action:'SELL' as const,amountSol:0.05,sellPercent:100},
 {...base,action:'SELL' as const,amountSol:undefined,sellPercent:25},
 {...base,action:'SELL' as const,amountSol:undefined},
 ];
 for(const candidate of invalid) assert.equal(validateManualEchoIntent(candidate).allowed,false,JSON.stringify(candidate));
});
