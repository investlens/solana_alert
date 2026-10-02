import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifySocialContract, confirmsRobinchainContract, xProjectStatements } from '../src/chains/robinhood/socialContractConfirmation.js';
const token = '0x00c61698ae874be28ad7c0c600d417cad1fc871a';
const other = '0x1111111111111111111111111111111111111111';
const args = { token, xHandle: 'RevenueFamily', telegramUrl: 'https://t.me/RevenueFamily' };
const bio = (text: string) => `<div data-testid="UserDescription">${text}</div>`;
test('exact CA, explicit chain and contract context required; conflicts and warnings fail closed', () => {
  assert.equal(confirmsRobinchainContract(`Robinhood Chain CA: ${token}`, token), true);
  for (const text of [`CA: ${token}`, `Solana CA: ${token}`, `Robinchain CA: ${other}`,
    `Robinchain fake CA: ${token}`, `Robinchain CA: ${token} ${other}`, `Robinchain CA: ${token}a`])
    assert.equal(confirmsRobinchainContract(text, token), false, text);
});
test('scripts, links, unrelated authors and copied social metadata cannot confirm', () => {
  assert.deepEqual(xProjectStatements(`<script>${bio(`Robinchain CA: ${token}`)}</script>`, 'RevenueFamily'), []);
  assert.deepEqual(xProjectStatements(`<a href="/${token}">Robinchain</a>`, 'RevenueFamily'), []);
  const post = `<article><div data-testid="User-Name"><a href="/someoneelse">Other</a></div><div data-testid="tweetText">Robinchain CA: ${token}</div></article>`;
  assert.deepEqual(xProjectStatements(post, 'RevenueFamily'), []);
});
test('missing or inaccessible X suppresses even when Telegram repeats the token CA', async () => {
  for (const html of [null, 'Site Unavailable', bio('No token launched'), bio('Solana CA: CuP5Ng85HiCdHiKnc9pKe9MVEVkJDHmMsyEvbXHopump')]) {
    const result = await verifySocialContract(args, async url => url.includes('x.com') ? html : `Robinchain CA: ${token}`);
    assert.equal(result.confirmed, false);
  }
});
test('positive X match allows alert; explicit Telegram mismatch suppresses it', async () => {
  const x = bio(`Our Robinchain token CA: ${token}`);
  assert.equal((await verifySocialContract(args, async url => url.includes('x.com') ? x : null)).confirmed, true);
  const result = await verifySocialContract(args, async url => url.includes('x.com') ? x : `<div class="tgme_page_description">CA: ${other}</div>`);
  assert.deepEqual(result, { confirmed: false, reason: 'TELEGRAM_CONTRACT_CONFLICT' });
});
test('identity gate runs before market, creator enrichment and all message delivery', async () => {
  const source = await readFile(new URL('../src/chains/robinhood/ponsSocialMafiaAlert.ts', import.meta.url), 'utf8');
  const process = source.slice(source.indexOf('async function processLaunch'));
  assert.ok(process.indexOf('if (!identity.confirmed)') < process.indexOf('const partial:'));
  assert.ok(process.indexOf('if (!identity.confirmed)') < process.indexOf('const chats = await recipients()'));
  assert.match(process, /if \(!identity\.confirmed\) \{[\s\S]*?return;/);
});

 test('public X shells are unavailable evidence, not a contract mismatch', async () => {
  const result = await verifySocialContract(args, async () => '<html><script>renderProfile()</script></html>');
  assert.equal(result.reason, 'X_CONTENT_UNREADABLE');
  assert.equal(result.confirmed, false);
});
