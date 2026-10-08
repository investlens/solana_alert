import test from 'node:test';
import assert from 'node:assert/strict';
import {sendAlphaosPhotoAlert,telegramRecipientUnavailable} from '../src/ui/alphaosPhotoDelivery.js';
test('unreachable recipients preserve Telegram details and do not trigger a fallback send', async () => {
  let requests = 0;
  const request = (async () => { requests++; return new Response(JSON.stringify({ok:false,error_code:403,description:'Forbidden: bot was blocked by the user'}), {status:403}); }) as typeof fetch;
  await assert.rejects(sendAlphaosPhotoAlert({botToken:'test',chatId:'1',text:'AXIL',keyboard:[],image:Buffer.from('png')},request), /403 Forbidden: bot was blocked/);
  assert.equal(requests,1);
  assert.equal(telegramRecipientUnavailable(new Error('Telegram delivery rejected: 400 Bad Request: chat not found')),true);
  assert.equal(telegramRecipientUnavailable(new Error('Telegram delivery rejected: 429 Too Many Requests')),false);
  assert.equal(telegramRecipientUnavailable(new Error('Telegram delivery rejected: 400 can\'t parse entities')),false);
});
