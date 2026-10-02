import test from 'node:test';
import assert from 'node:assert/strict';
import { creatorDeepLink, parseResearchChain, registerAddressScreening } from '../src/bot/addressScreening.js';
import { chooseResearchPair, readResearchAccount, renderCreatorResearch, researchCandidates, type AccountFacts } from '../src/services/addressResearch.js';
import { renderContractScreen } from '../src/bot/contractScreening.js';
const address = '0x2222222222222222222222222222222222222222';
const empty: AccountFacts = { kind: 'wallet', balance: 0n, nonce: 0, checkedAt: '2026-10-02T07:30:00Z' };

test('chain matching checks base address and does not assume wallet chain from address format', () => {
  const pairs = [{ chainId: 'arc', baseToken: { address }, liquidity: { usd: 2000 } },
    { chainId: 'robinhood', quoteToken: { address }, baseToken: { address: '0xwrong' }, liquidity: { usd: 99999 } }];
  assert.equal(chooseResearchPair(pairs, address, 'robinhood'), null);
  assert.equal(chooseResearchPair(pairs, address, 'arc')?.chainId, 'arc');
  assert.deepEqual(researchCandidates([], address, { robinhood: empty, arc: empty }), []);
  assert.deepEqual(researchCandidates([], address, { robinhood: { ...empty, nonce: 2 }, arc: { ...empty, balance: 1n } }), ['robinhood', 'arc']);
  assert.equal(parseResearchChain(address), null); assert.equal(parseResearchChain(`arc ${address}`), 'arc');
});
test('creator link opens bot research, preserving sourced creator identity', () => {
  const text = `<a href="https://robinhoodchain.blockscout.com/address/${address}">Creator</a>`;
  assert.match(creatorDeepLink(text, 'AlphaOS_bot'), /start=ci_RH_0x222/);
  assert.equal(creatorDeepLink(text), text);
});
test('creator history labels sampled peaks, drops and stale observations without claiming safe or complete coverage', () => {
  const text = renderCreatorResearch(address, 'robinhood', { ...empty, balance: 10n ** 18n, nonce: 12 }, {
    available: true, capped: true, launches: [{ token: address, launchedAt: '2026-10-01T05:00:00Z', peak: 100000,
      current: 25000, checkedAt: '2026-10-01T06:00:00Z' }] });
  assert.match(text, /1 ETH/); assert.match(text, /Observed peak/); assert.match(text, /75\.0% below peak/);
  assert.match(text, /Outcome checked 2026-10-01 06:00 UTC/); assert.match(text, /Coverage is partial/);
  assert.doesNotMatch(text, /ATH|SAFE|SCAMMER|Win rate|Never launched/);
  const missing = renderCreatorResearch(address, 'arc', { ...empty, kind: 'unknown', balance: null, nonce: null }, { available: false, capped: false, launches: [] });
  assert.match(missing, /unavailable/); assert.doesNotMatch(missing, /0 USDC|Transactions sent/);
});
test('tiny positive creator balances never round into exact zero', () => {
  const pons = { name: 'Token', symbol: 'T', creator: address, decimals: 18, totalSupplyRaw: 10n ** 18n, fdvUsd: null, twitter: null, telegram: null };
  assert.match(renderContractScreen(address, null, pons, 0.00000001), /&lt;0\.01%/);
  assert.match(renderContractScreen(address, null, pons, 0), /0\.00%/);
});
test('RPC chain mismatch and unavailable bytecode never classify as a verified wallet', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (_url, init) => {
    const input = JSON.parse(String(init?.body)); const requests = Array.isArray(input) ? input : [input];
    const results = requests.map((r: any) => r.method === 'eth_getCode' ? { jsonrpc: '2.0', id: r.id, error: { code: -32000, message: 'Unavailable' } } : {
      jsonrpc: '2.0', id: r.id, result: r.method === 'eth_chainId' ? '0x1' : '0x0' });
    return new Response(JSON.stringify(Array.isArray(input) ? results : results[0]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try { const result = await readResearchAccount(address, 'arc', true); assert.equal(result.kind, 'unknown'); assert.equal(result.balance, null); }
  finally { globalThis.fetch = previous; }
});
test('simple scan, bare paste and chain choice work without forced keyword; refresh edits without duplicates', async () => {
  const commands = new Map<string, any>(); const actions: Array<{ pattern: RegExp; handler: any }> = []; let textHandler: any; let startHandler: any;
  const bot = { botInfo: { username: 'AlphaOS_bot' }, command(name: string, handler: any) { commands.set(name, handler); },
    action(pattern: RegExp, handler: any) { actions.push({ pattern, handler }); }, hears(_pattern: RegExp, handler: any) { startHandler = handler; }, on(_name: string, handler: any) { textHandler = handler; } };
  let sends = 0; let edits = 0; const calls: any[] = [];
  registerAddressScreening(bot as any, async (token, chain, refresh, wallet) => {
    calls.push({ token, chain, refresh, wallet });
    if (!chain) return { choices: ['robinhood', 'arc'], reason: 'Choose chain' };
    return { chain, wallet: !!wallet, text: 'Research', image: Buffer.from('png') };
  });
  const ctx = (id: number, text: string) => ({ chat: { id, type: 'private' }, message: { text, message_id: 1 },
    async reply(_text: string, options: any) { if (options) assert.ok(options.reply_markup.inline_keyboard[0][0].callback_data.startsWith('AS_')); },
    async replyWithPhoto() { sends++; }, async answerCbQuery() {}, async editMessageMedia() { edits++; throw new Error('timeout'); } });
  await commands.get('scan')(ctx(8101, `/scan ${address}`));
  const action = actions.find(a => a.pattern.test(`AS_ARC_${address}`))!;
  await action.handler({ ...ctx(8101, ''), callbackQuery: {}, match: ['', 'AS', 'ARC', address] });
  assert.equal(sends, 1); // Choice is immediately clickable, despite scan cooldown.
  await textHandler(ctx(8102, address), () => { throw new Error('Bare address did not scan'); });
  await action.handler({ ...ctx(8103, ''), callbackQuery: {}, match: ['', 'CW', 'RH', address] });
  assert.equal(edits, 1); assert.equal(sends, 1);
  await startHandler({ ...ctx(8104, ''), match: ['', 'RH', address] });
  assert.equal(calls[0].chain, null); assert.equal(calls.at(-1).wallet, true);
  assert.equal(calls.at(-1).chain, 'robinhood');
});
