import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeAbiParameters, parseAbiParameters } from 'viem';

import {
  buildSocialMafiaAlertText,
  extractTelegramLabel,
  extractXUsername,
  isVerifiedSocialMafiaLaunch,
  queueVerifiedLaunchpadSocialMafiaScreen,
  resetPonsSocialMafiaForTests,
  socialMafiaScreeningStatus,
  drainPonsSocialMafiaForTests,
  resolveSocialMafiaSocials,
} from '../src/chains/robinhood/ponsSocialMafiaAlert.js';
import { getPonsFactoryDeployments } from '../src/chains/robinhood/ponsContracts.js';
import type { PonsLaunch } from '../src/chains/robinhood/ponsHistoricalLaunchScanner.js';

test('Social Mafia requires both a valid X profile and Telegram community link', () => {
  const socials = resolveSocialMafiaSocials({
    twitter: 'https://x.com/seriousdev',
    telegram: 'https://t.me/seriouscommunity',
  });

  assert.deepEqual(socials, {
    xUrl: 'https://x.com/seriousdev',
    xHandle: 'seriousdev',
    telegramUrl: 'https://t.me/seriouscommunity',
    telegramLabel: '@seriouscommunity',
  });

  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://x.com/seriousdev', telegram: null }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: null, telegram: 'https://t.me/seriouscommunity' }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://example.com/x', telegram: 'https://t.me/seriouscommunity' }), null);
  assert.equal(resolveSocialMafiaSocials({ twitter: 'https://x.com/seriousdev', telegram: 'https://example.com/tg' }), null);
});

test('Social Mafia validates only direct project social destinations', () => {
  assert.equal(extractXUsername('https://x.com/project_alpha'), 'project_alpha');
  assert.equal(extractXUsername('https://twitter.com/projectalpha'), 'projectalpha');
  assert.equal(extractXUsername('https://x.com/intent/post'), null);

  assert.equal(extractTelegramLabel('https://t.me/projectalpha'), '@projectalpha');
  assert.equal(extractTelegramLabel('https://telegram.me/projectalpha'), '@projectalpha');
  assert.equal(extractTelegramLabel('https://t.me/share/url?url=test'), null);
  assert.equal(extractTelegramLabel('https://t.me/+AbCd_123'), 'Telegram invite');
  assert.equal(extractTelegramLabel('https://t.me/joinchat/AbCd_123'), 'Telegram invite');
  for (const path of ['+', 'joinchat', 's/projectalpha', 'c/123/456', 'proxy', 'addstickers/cats', 'login']) {
    assert.equal(extractTelegramLabel(`https://t.me/${path}`), null, path);
  }
});

test('Social Mafia admits only registered Robinchain PONS factories, never CUSTOM or UNKNOWN', () => {
  const factory = getPonsFactoryDeployments()[0];
  const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: factory.id,
    factory_address: factory.address } as PonsLaunch;
  assert.equal(isVerifiedSocialMafiaLaunch(launch, 'PONS'), true);
  for (const label of ['CUSTOM', 'UNKNOWN', '']) {
    assert.equal(isVerifiedSocialMafiaLaunch(launch, label), false);
  }
  assert.equal(isVerifiedSocialMafiaLaunch({ ...launch, factory_address: '0x123' }, 'PONS'), false);
  assert.equal(isVerifiedSocialMafiaLaunch({ ...launch, protocol_version: 'UNKNOWN' }, 'PONS'), false);
  assert.equal(isVerifiedSocialMafiaLaunch({ ...launch, chain: 'solana' } as unknown as PonsLaunch, 'PONS'), false);
});

test('Social Mafia queue ignores unverified launches and screens duplicate tokens only once', { timeout: 2_000 }, async t => {
  resetPonsSocialMafiaForTests();
  const previousEnabled = process.env.PONS_SOCIAL_MAFIA_ENABLED;
  process.env.PONS_SOCIAL_MAFIA_ENABLED = 'true';
  const factory = getPonsFactoryDeployments()[0];
  const token = '0x1234567890abcdef1234567890abcdef12345678';
  const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: factory.id,
    factory_address: factory.address, token_address: token,
    block_timestamp: new Date(Date.now() - 15 * 60_000).toISOString() } as PonsLaunch;
  const context = { id: 'PONS', label: 'PONS', tokenUrl: () => 'https://www.ponsfamily.com' };
  let requests = 0;
  let skipped = 0;
  let screened!: () => void;
  const done = new Promise<void>(resolve => { screened = resolve; });
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests += 1;
    const body = JSON.parse(String(init.body));
    assert.equal(body.method, 'eth_call');
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id,
      result: encodeAbiParameters(parseAbiParameters('string, string, string, string, string'), ['', '', '', '', '']) }),
    { headers: { 'content-type': 'application/json' } });
  });
  t.mock.method(console, 'log', (message: string) => {
    if (message.includes('[SocialMafia] skipped')) { skipped += 1; screened(); }
  });
  try {
    for (const id of ['CUSTOM', 'UNKNOWN']) queueVerifiedLaunchpadSocialMafiaScreen(launch, { ...context, id });
    queueVerifiedLaunchpadSocialMafiaScreen({ ...launch, factory_address: '0x123' }, context);
    assert.equal(requests, 0);
    queueVerifiedLaunchpadSocialMafiaScreen(launch, context);
    queueVerifiedLaunchpadSocialMafiaScreen({ ...launch, token_address: token.toUpperCase() }, context);
    await done;
    await new Promise<void>(resolve => setImmediate(resolve));
    queueVerifiedLaunchpadSocialMafiaScreen(launch, context);
    assert.equal(requests, 1);
    assert.equal(skipped, 1);
  } finally {
    if (previousEnabled === undefined) delete process.env.PONS_SOCIAL_MAFIA_ENABLED;
    else process.env.PONS_SOCIAL_MAFIA_ENABLED = previousEnabled;
    resetPonsSocialMafiaForTests();
  }
});

test('Social Mafia alert shows verified launchpad plus both communities', () => {
  const socials = resolveSocialMafiaSocials({
    twitter: 'https://x.com/projectalpha',
    telegram: 'https://t.me/projectalpha',
  });
  assert.ok(socials);

  const text = buildSocialMafiaAlertText({
    tokenAddress: '0x1234567890abcdef1234567890abcdef12345678',
    launchpadLabel: 'PONS',
    socials,
    symbol: 'ALPHA',
    name: 'Alpha Token',
    marketCap: 51_800,
    devHoldingPercent: 4.25,
  });

  assert.match(text, /SOCIAL MAFIA ALERT/);
  assert.match(text, /Type unverified/);
  assert.match(text, /Social ownership unverified/);
  assert.doesNotMatch(text, /<b>COMMUNITY<\/b>/);
  assert.match(text, /Launchpad\s+<b>PONS<\/b>/);
  assert.match(text, /X\s+<a href="https:\/\/x.com\/projectalpha">@projectalpha<\/a>/);
  assert.match(text, /TG\s+<a href="https:\/\/t.me\/projectalpha">@projectalpha<\/a>/);
  assert.match(text, /Market cap\s+<b>\$51\.8K<\/b>/);
  assert.match(text, /Dev holding\s+<b>4\.25%<\/b>/);
  assert.match(text, /Verified launchpad \+ X \+ Telegram/);
});

test('screening waits 15 minutes, retries four times and rejects expired launches without RPC', async t => {
  resetPonsSocialMafiaForTests();
  const factory = getPonsFactoryDeployments().find(f => f.enabled)!;
  const token = '0x7777777777777777777777777777777777777777';
  const start = Date.now(); let now = start; let requests = 0; let skipped = 0;
  t.mock.method(Date, 'now', () => now);
  const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: factory.id, factory_address: factory.address,
    token_address: token, block_timestamp: new Date(start).toISOString() } as PonsLaunch;
  const context = { id: 'PONS', label: 'PONS', tokenUrl: () => 'https://www.ponsfamily.com' };
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    requests++; const body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id,
      result: encodeAbiParameters(parseAbiParameters('string, string, string, string, string'), ['', '', '', '', '']) }),
      { headers: { 'content-type': 'application/json' } });
  });
  t.mock.method(console, 'log', (message: string) => { if (message.includes('[SocialMafia] skipped')) skipped++; });
  try {
    queueVerifiedLaunchpadSocialMafiaScreen(launch, context);
    assert.equal(requests, 0);
    now += 14 * 60_000; drainPonsSocialMafiaForTests(); assert.equal(requests, 0);
    for (const minute of [15, 30, 45, 60]) {
      now = start + minute * 60_000; drainPonsSocialMafiaForTests();
      for (let i = 0; i < 5; i++) await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(skipped, minute / 15);
    }
    assert.equal(requests, 4);
    now = start + 61 * 60_000;
    queueVerifiedLaunchpadSocialMafiaScreen(launch, context); drainPonsSocialMafiaForTests();
    assert.equal(requests, 4);
  } finally { resetPonsSocialMafiaForTests(); }
});


test('waiting launch burst fits the bounded identity budget without starting early checks', t => {
  resetPonsSocialMafiaForTests();
  const now = Date.now();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  const factory = getPonsFactoryDeployments().find(f => f.enabled)!;
  const context = { id: 'PONS', label: 'PONS', tokenUrl: () => 'https://www.ponsfamily.com' };
  const launch = { chain: 'robinhood', protocol: 'pons', protocol_version: factory.id,
    factory_address: factory.address, block_timestamp: new Date(now).toISOString() } as PonsLaunch;
  try {
    for (let i = 1; i <= 501; i++) queueVerifiedLaunchpadSocialMafiaScreen({ ...launch,
      token_address: `0x${i.toString(16).padStart(40, '0')}` }, context);
    const state = socialMafiaScreeningStatus();
    assert.equal(state.waiting, 500); assert.equal(state.identityCount, 500);
    assert.equal(state.active, 0); assert.equal(state.concurrency, 1);
    queueVerifiedLaunchpadSocialMafiaScreen({ ...launch, token_address: `0x${'1'.padStart(40, '0')}` }, context);
    assert.equal(socialMafiaScreeningStatus().waiting, 500);
    t.mock.method(Date, 'now', () => now + 60 * 60_000 + 30_001);
    drainPonsSocialMafiaForTests();
    assert.equal(socialMafiaScreeningStatus().waiting, 0);
    assert.equal(socialMafiaScreeningStatus().identityCount, 0);
  } finally { resetPonsSocialMafiaForTests(); }
});
