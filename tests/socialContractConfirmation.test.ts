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
test('feed eligibility gate runs before market, creator enrichment and all message delivery', async () => {
  const source = await readFile(new URL('../src/chains/robinhood/ponsSocialMafiaAlert.ts', import.meta.url), 'utf8');
  const process = source.slice(source.indexOf('async function processLaunch'));
  assert.ok(process.indexOf('if (!route)') < process.indexOf('const partial:'));
  assert.ok(process.indexOf('if (!route)') < process.indexOf('const chats = await enabledLiveRecipients'));
  assert.match(process, /if \(!route\) \{[\s\S]*?return false;/);
});

 test('public X shells are unavailable evidence, not a contract mismatch', async () => {
  const result = await verifySocialContract(args, async () => '<html><script>renderProfile()</script></html>');
  assert.equal(result.reason, 'X_CONTENT_UNREADABLE');
  assert.equal(result.confirmed, false);
});

test('technical X failures preserve unknown eligibility while readable rejection remains false', async () => {
  const { socialEvidenceEligibility } = await import('../src/chains/robinhood/socialContractConfirmation.js');
  for (const reason of ['X_UNAVAILABLE', 'X_CONTENT_UNREADABLE'] as const)
    assert.equal(socialEvidenceEligibility({ confirmed: false, reason }), null);
  for (const reason of ['X_CONTRACT_NOT_CONFIRMED', 'TELEGRAM_CONTRACT_CONFLICT'] as const)
    assert.equal(socialEvidenceEligibility({ confirmed: false, reason }), false);
});
test('unavailable X checks coalesce, cool down and retry after expiry; no proof is invented', async () => {
  const { createSocialContractVerifier } = await import('../src/chains/robinhood/socialContractConfirmation.js');
  let calls = 0; let time = 0;
  const verify = createSocialContractVerifier(async () => { calls++; return '<html>X shell</html>'; }, () => time);
  const results = await Promise.all([verify(args), verify(args)]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => !result.confirmed && result.reason === 'X_CONTENT_UNREADABLE'));
  time = 299_999; await verify(args); assert.equal(calls, 1);
  time = 300_000; await verify(args); assert.equal(calls, 2);
});

test('cross-linked website confirms exact-chain CA; copied metadata or missing backlink does not',async()=>{
 const profile=bio('Our project')+'<div data-testid="UserUrl"><a href="https://project.example/">Website</a></div>';
 const page=`<a href="https://x.com/RevenueFamily">X</a><p>Robinchain CA: ${token}</p>`;
 const good=await verifySocialContract(args,async url=>url.includes('x.com')?profile:url.includes('project.example')?page:null);
 assert.equal(good.confirmed,true);assert.equal(good.evidenceSource,'Website');
 for(const invalid of [page.replace('RevenueFamily','Impersonator'),page.replace(token,other),page.replace('Robinchain','Solana'),`<script><a href="https://x.com/RevenueFamily">X</a></script><p>Robinchain CA: ${token}</p>`])assert.equal((await verifySocialContract(args,async url=>url.includes('x.com')?profile:invalid)).confirmed,false);
 assert.equal((await verifySocialContract(args,async url=>url.includes('x.com')?null:page)).confirmed,false);
});
test('public Telegram acknowledgement requires reciprocal profile links and conflicts fail closed',async()=>{
 const profile=bio('Our project')+'<div data-testid="UserUrl"><a href="https://t.me/RevenueFamily">TG</a></div>';
 const page=`<a href="https://x.com/RevenueFamily">X</a><span>100 subscribers</span><div class="tgme_page_description">Robinchain CA: ${token}</div>`;
 assert.equal((await verifySocialContract(args,async url=>url.includes('x.com')?profile:page)).evidenceSource,'Telegram');
 assert.equal((await verifySocialContract(args,async url=>url.includes('x.com')?profile:page.replace(token,other))).confirmed,false);
});
test('public page checks exclude internal network addresses',async()=>{
 const {publicSocialAddress}=await import('../src/chains/robinhood/socialContractConfirmation.js');
 for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.1.1','192.168.0.1','100.64.0.1','::1','::ffff:127.0.0.1','fe80::1','fc00::1'])assert.equal(publicSocialAddress(ip),false);
 assert.equal(publicSocialAddress('8.8.8.8'),true);
});

test('observed X profile links survive temporary X outage for one hour only',async()=>{
 const {createSocialContractVerifier}=await import('../src/chains/robinhood/socialContractConfirmation.js');
 let time=0,available=true,published=false;
 const profile=bio('Our project')+'<div data-testid="UserUrl"><a href="https://project.example/">Website</a></div>';
 const verify=createSocialContractVerifier(async url=>url.includes('x.com')?(available?profile:null):url.includes('project.example')?`<a href="https://x.com/RevenueFamily">X</a><p>${published?'Robinchain CA: '+token:'Coming soon'}</p>`:null,()=>time);
 assert.equal((await verify(args)).confirmed,false);
 available=false;published=true;time=60001;assert.equal((await verify(args)).evidenceSource,'Website');
 time=3600001;assert.equal((await verify(args)).confirmed,false);
});
