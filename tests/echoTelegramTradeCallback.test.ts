import test from 'node:test';
import assert from 'node:assert/strict';
import { createEchoTradeCallback, authorizeEchoTelegramCallback, type EchoCallbackStore, type StoredEchoCallback } from '../src/echo/telegramTradeCallback.js';
import { ECHO_EXPECTED_EXECUTION_WALLET } from '../src/echo/executionWallet.js';
const intent = {
 action: 'BUY' as const, telegramUserId: '123', authorizedAdminId: '123',
 executionWallet: ECHO_EXPECTED_EXECUTION_WALLET, mint: 'So11111111111111111111111111111111111111112',
 amountSol: 0.05, confirmationTokenVerified: true,
};
function memoryStore(): EchoCallbackStore {
 const rows = new Map<string, StoredEchoCallback>();
 return {
  async insertOnce(token, payload) { if (rows.has(token)) return false; rows.set(token, payload); return true; },
  async consumeOnce(token) { const payload=rows.get(token) ?? null; rows.delete(token); return payload; },
 };
}
test('short Telegram callback works once for authorized user', async () => {
 const store=memoryStore();
 const created=await createEchoTradeCallback(store,intent,1000);
 assert.equal(created.created,true);
 if(!created.created) return;
 assert.ok(Buffer.byteLength(created.token,'utf8')<=64);
 assert.equal((await authorizeEchoTelegramCallback(store,created.token,'123',2000)).allowed,true);
 assert.equal((await authorizeEchoTelegramCallback(store,created.token,'123',2001)).allowed,false);
});
test('unauthorized or expired callbacks cannot execute', async () => {
 const store=memoryStore();
 const first=await createEchoTradeCallback(store,intent,1000);
 if(!first.created) return;
 assert.equal((await authorizeEchoTelegramCallback(store,first.token,'456',2000)).allowed,false);
 const second=await createEchoTradeCallback(store,intent,1000);
 if(!second.created) return;
 assert.equal((await authorizeEchoTelegramCallback(store,second.token,'123',61001)).allowed,false);
});
